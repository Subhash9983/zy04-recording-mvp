import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Recording, IRecording } from '../models/Recording.js';
import { audioService } from './audioService.js';
import { parseSerial } from '../utils/serial.js';
import { config } from '../config.js';

export interface SaveUploadPayload {
  sn: string;
  esp_version?: string;
  dsp_version?: string;
  file_name?: string;
  mac?: string;
  session_id: string;
  create_time?: string;
  duration?: string;
  audio_type?: string;
  channel?: string;
  sample_rate?: string;
  frame_size_ms?: string;
  frame_rate?: string;
  sig_type?: string;
  compress?: string | null;
  serial: string;
  fileBuffer: Buffer;
}

export class RecordingService {
  /**
   * Generates a unique record ID.
   */
  public generateRecordId(): string {
    return 'rec_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  }

  /**
   * Saves uploaded slice and creates MongoDB record.
   * Returns record_id immediately for supplier response.
   */
  public async handleUpload(payload: SaveUploadPayload): Promise<{ record_id: string; recording: IRecording }> {
    const record_id = this.generateRecordId();
    const parsed = parseSerial(payload.serial);

    const snDir = payload.sn.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionDir = payload.session_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const folderPath = path.join(config.uploadDir, snDir, sessionDir);

    await fs.mkdir(folderPath, { recursive: true });

    // Format slice filename based on 8-digit hex or slice index
    const sliceHex = parsed.formattedHex.replace('0x', '');
    const sliceFilename = `${sliceHex}.opus`;
    const sliceFilePath = path.join(folderPath, sliceFilename);

    await fs.writeFile(sliceFilePath, payload.fileBuffer);

    const durationMs = parseInt(payload.duration || '0', 10) || 0;
    const sampleRate = parseInt(payload.sample_rate || '16000', 10) || 16000;
    const frameSizeMs = parseInt(payload.frame_size_ms || '20', 10) || 20;
    const frameRate = parseInt(payload.frame_rate || '8', 10) || 8;

    const recording = new Recording({
      record_id,
      device_sn: payload.sn,
      mac: payload.mac || '',
      session_id: payload.session_id,
      file_name: payload.file_name || sliceFilename,
      serial: payload.serial,
      create_time: payload.create_time || Date.now().toString(),
      duration_ms: durationMs,
      audio_type: payload.audio_type || 'OPUS',
      channel: payload.channel || 'STEREO',
      sample_rate: sampleRate,
      frame_size_ms: frameSizeMs,
      frame_rate: frameRate,
      sig_type: payload.sig_type || '2',
      compress: payload.compress || null,
      original_file_path: sliceFilePath,
      wav_file_path: null,
      status: 'RECEIVED',
      created_at: new Date()
    });

    await recording.save();

    // Trigger async background decoding so HTTP response is not delayed
    setImmediate(() => {
      this.triggerAsyncProcessing(payload.sn, payload.session_id, folderPath, {
        sampleRate,
        channels: (payload.channel || 'STEREO').toUpperCase() === 'STEREO' ? 2 : 1,
        frameSizeMs,
        compress: payload.compress
      }).catch((err) => {
        console.error(`[RecordingService] Async decoding failed for session ${payload.session_id}:`, err);
      });
    });

    return { record_id, recording };
  }

  /**
   * Asynchronous processor: merges session slices and decodes to WAV.
   */
  public async triggerAsyncProcessing(
    deviceSn: string,
    sessionId: string,
    sessionFolder: string,
    options: { sampleRate: number; channels: number; frameSizeMs: number; compress?: string | null }
  ): Promise<void> {
    try {
      await Recording.updateMany(
        { session_id: sessionId, status: { $in: ['RECEIVED', 'PROCESSING'] } },
        { status: 'PROCESSING' }
      );

      // Find all slices for this session, sorted by serial
      const slices = await Recording.find({ session_id: sessionId }).lean();
      if (!slices.length) return;

      const sortedSlices = [...slices].sort((a, b) => {
        const pa = parseSerial(a.serial);
        const pb = parseSerial(b.serial);
        return pa.sliceIndex - pb.sliceIndex;
      });

      const slicePaths = sortedSlices.map((s) => s.original_file_path);
      const wavDestination = path.join(sessionFolder, 'recording.wav');

      await audioService.processAndSaveWav(slicePaths, wavDestination, options);

      await Recording.updateMany(
        { session_id: sessionId },
        {
          wav_file_path: wavDestination,
          status: 'READY'
        }
      );

      console.log(`[RecordingService] Successfully processed session ${sessionId} -> ${wavDestination}`);
    } catch (error) {
      console.error(`[RecordingService] Error processing session ${sessionId}:`, error);
      await Recording.updateMany(
        { session_id: sessionId },
        { status: 'FAILED' }
      );
    }
  }

  /**
   * Retrieves all recordings grouped by session_id so multiple slices
   * are treated as a unified recording session.
   */
  public async getAllRecordings() {
    const allSlices = await Recording.find().sort({ created_at: -1 }).lean();

    const sessionMap = new Map<string, {
      record_id: string;
      device_sn: string;
      session_id: string;
      file_name: string;
      duration_ms: number;
      status: string;
      created_at: Date;
      audio_type: string;
      channel: string;
      sample_rate: number;
      slice_count: number;
      wav_file_path?: string | null;
    }>();

    for (const slice of allSlices) {
      const existing = sessionMap.get(slice.session_id);
      if (!existing) {
        sessionMap.set(slice.session_id, {
          record_id: slice.record_id,
          device_sn: slice.device_sn,
          session_id: slice.session_id,
          file_name: slice.file_name,
          duration_ms: slice.duration_ms || 0,
          status: slice.status,
          created_at: slice.created_at,
          audio_type: slice.audio_type,
          channel: slice.channel,
          sample_rate: slice.sample_rate,
          slice_count: 1,
          wav_file_path: slice.wav_file_path
        });
      } else {
        existing.duration_ms += (slice.duration_ms || 0);
        existing.slice_count += 1;
        if (slice.wav_file_path) {
          existing.wav_file_path = slice.wav_file_path;
        }
        // If any slice is READY, session is READY; if any FAILED and not READY, FAILED
        if (slice.status === 'READY') {
          existing.status = 'READY';
        } else if (slice.status === 'PROCESSING' && existing.status !== 'READY') {
          existing.status = 'PROCESSING';
        } else if (slice.status === 'FAILED' && existing.status !== 'READY') {
          existing.status = 'FAILED';
        }
      }
    }

    return Array.from(sessionMap.values());
  }

  /**
   * Retrieves single recording by record_id or session_id.
   */
  public async getRecordingById(idOrSession: string) {
    return Recording.findOne({
      $or: [{ record_id: idOrSession }, { session_id: idOrSession }]
    }).lean();
  }
}

export const recordingService = new RecordingService();
