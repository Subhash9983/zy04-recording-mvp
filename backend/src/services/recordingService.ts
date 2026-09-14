import path from 'path';
import crypto from 'crypto';
import { Recording, IRecording, RecordingStatus } from '../models/Recording.js';
import { audioService } from './audioService.js';
import { ParsedSerial, parseSerial } from '../utils/serial.js';
import { config } from '../config.js';
import {
  recordingSliceObjectKey,
  recordingWavObjectKey,
  storageService,
  StoredDownload
} from './storageService.js';

export interface SaveUploadPayload {
  sn: string;
  esp_version: string;
  dsp_version: string;
  file_name: string;
  mac: string;
  session_id: string;
  create_time: string;
  duration: string;
  audio_type: 'OPUS';
  channel: 'STEREO';
  sample_rate: '16000';
  frame_size_ms: '20';
  frame_rate: '8';
  sig_type: '2';
  compress: 'lz4' | null;
  serial: string;
  fileBuffer: Buffer;
}

export interface SessionSliceForDecision {
  serial: string;
  slice_number?: number;
  is_last_slice?: boolean;
  compress?: string | null;
}

export type SessionDecisionKind =
  | 'RECEIVED'
  | 'WAITING_SLICES'
  | 'PENDING_LZ4_CONFIRMATION'
  | 'READY_TO_PROCESS';

export interface SessionDecision {
  kind: SessionDecisionKind;
  finalSliceNumber?: number;
  missingSlices: number[];
  reason?: string;
}

const LZ4_CONFIRMATION_REASON =
  'Supplier LZ4 frame/block/stream boundaries are unconfirmed; compressed originals preserved without decoding';

/** Pure session-state decision used by runtime processing and safe manual verification. */
export function assessSessionSlices(slices: SessionSliceForDecision[]): SessionDecision {
  const normalized: Array<SessionSliceForDecision & { sliceNumber: number; isLast: boolean }> = [];

  try {
    for (const slice of slices) {
      const parsed = parseSerial(slice.serial);
      normalized.push({
        ...slice,
        sliceNumber: slice.slice_number ?? parsed.sliceNumber,
        isLast: slice.is_last_slice ?? parsed.isLastSlice
      });
    }
  } catch {
    return {
      kind: 'WAITING_SLICES',
      missingSlices: [],
      reason: 'Session contains legacy slice metadata with an invalid serial value'
    };
  }

  const finalSlices = normalized.filter((slice) => slice.isLast);
  if (finalSlices.length === 0) {
    return { kind: 'RECEIVED', missingSlices: [] };
  }
  if (finalSlices.length !== 1) {
    return {
      kind: 'WAITING_SLICES',
      missingSlices: [],
      reason: 'Session contains more than one final-slice marker'
    };
  }

  const finalSliceNumber = finalSlices[0].sliceNumber;
  const counts = new Map<number, number>();
  for (const slice of normalized) {
    counts.set(slice.sliceNumber, (counts.get(slice.sliceNumber) || 0) + 1);
  }

  const missingSlices: number[] = [];
  const duplicateSlices: number[] = [];
  for (let number = 1; number <= finalSliceNumber; number += 1) {
    const count = counts.get(number) || 0;
    if (count === 0) missingSlices.push(number);
    if (count > 1) duplicateSlices.push(number);
  }
  const unexpectedSlices = normalized
    .filter((slice) => slice.sliceNumber > finalSliceNumber)
    .map((slice) => slice.sliceNumber);

  if (missingSlices.length || duplicateSlices.length || unexpectedSlices.length) {
    const problems: string[] = [];
    if (missingSlices.length) problems.push(`missing slices: ${missingSlices.join(', ')}`);
    if (duplicateSlices.length) problems.push(`duplicate slice numbers: ${duplicateSlices.join(', ')}`);
    if (unexpectedSlices.length) problems.push(`slices after final marker: ${unexpectedSlices.join(', ')}`);
    return {
      kind: 'WAITING_SLICES',
      finalSliceNumber,
      missingSlices,
      reason: problems.join('; ')
    };
  }

  if (normalized.some((slice) => slice.compress?.toLowerCase() === 'lz4')) {
    return {
      kind: 'PENDING_LZ4_CONFIRMATION',
      finalSliceNumber,
      missingSlices: [],
      reason: LZ4_CONFIRMATION_REASON
    };
  }

  return {
    kind: 'READY_TO_PROCESS',
    finalSliceNumber,
    missingSlices: []
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export class RecordingService {
  private readonly processingSessions = new Set<string>();

  public generateRecordId(): string {
    return `rec_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
  }

  private sessionFilter(deviceSn: string, sessionId: string) {
    return { device_sn: deviceSn, session_id: sessionId };
  }

  private safePathComponent(value: string): string {
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || '_';
    if (sanitized === value) return sanitized;
    const suffix = crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
    return `${sanitized.slice(0, 87)}_${suffix}`;
  }

  private sessionFolder(deviceSn: string, sessionId: string): string {
    return path.join(
      config.uploadDir,
      this.safePathComponent(deviceSn),
      this.safePathComponent(sessionId)
    );
  }

  private scheduleSessionEvaluation(deviceSn: string, sessionId: string): void {
    setImmediate(() => {
      this.evaluateSessionForProcessing(deviceSn, sessionId).catch((error) => {
        console.error(`[RecordingService] Session evaluation failed for ${deviceSn}/${sessionId}:`, error);
      });
    });
  }

  private async handleExistingSlice(
    existing: IRecording,
    payload: SaveUploadPayload,
    parsed: ParsedSerial,
    expectedFilePath: string,
    expectedObjectKey: string
  ): Promise<{ record_id: string; recording: IRecording }> {
    const existingIsUsable = await storageService.exists(
      existing.original_object_key,
      existing.original_file_path
    );
    const needsR2Migration = storageService.usesR2 && !existing.original_object_key;

    if (!existingIsUsable || needsR2Migration) {
      const sourceBuffer = existingIsUsable
        ? await storageService.read(existing.original_object_key, existing.original_file_path)
        : payload.fileBuffer;
      const stored = await storageService.save(
        expectedObjectKey,
        expectedFilePath,
        sourceBuffer,
        'audio/opus'
      );
      await Recording.updateOne(
        { _id: existing._id },
        {
          $set: {
            original_file_path: stored.localPath,
            original_object_key: stored.objectKey,
            wav_file_path: null,
            wav_object_key: null,
            status: 'RECEIVED',
            processing_error: null,
            missing_slices: [],
            updated_at: new Date()
          }
        }
      );
      existing.original_file_path = stored.localPath;
      existing.original_object_key = stored.objectKey;
      existing.wav_file_path = null;
      existing.wav_object_key = null;
      existing.status = 'RECEIVED';
    }

    // Legacy rows remain readable and are not destructively migrated during a retry.
    if (existing.slice_number === undefined) existing.slice_number = parsed.sliceNumber;
    if (existing.is_last_slice === undefined) existing.is_last_slice = parsed.isLastSlice;
    this.scheduleSessionEvaluation(payload.sn, payload.session_id);
    return { record_id: existing.record_id, recording: existing };
  }

  /** Save one logical slice idempotently and acknowledge it before background processing. */
  public async handleUpload(payload: SaveUploadPayload): Promise<{ record_id: string; recording: IRecording }> {
    // Ensure the partial unique index is ready before accepting new parsed slices.
    await Recording.init();
    const parsed = parseSerial(payload.serial);
    const identity = {
      device_sn: payload.sn,
      session_id: payload.session_id,
      serial: parsed.raw
    };
    const folderPath = this.sessionFolder(payload.sn, payload.session_id);
    const sliceFilePath = path.join(folderPath, `${parsed.formattedHex.slice(2)}.opus`);
    const sliceObjectKey = recordingSliceObjectKey(
      payload.sn,
      payload.session_id,
      parsed.raw,
      payload.file_name
    );

    const existing = await Recording.findOne(identity);
    if (existing) {
      return this.handleExistingSlice(existing, payload, parsed, sliceFilePath, sliceObjectKey);
    }

    const recording = new Recording({
      record_id: this.generateRecordId(),
      device_sn: payload.sn,
      esp_version: payload.esp_version,
      dsp_version: payload.dsp_version,
      mac: payload.mac,
      session_id: payload.session_id,
      file_name: payload.file_name,
      serial: parsed.raw,
      slice_number: parsed.sliceNumber,
      is_last_slice: parsed.isLastSlice,
      create_time: payload.create_time,
      duration_ms: Number(payload.duration),
      audio_type: payload.audio_type,
      channel: payload.channel,
      sample_rate: Number(payload.sample_rate),
      frame_size_ms: Number(payload.frame_size_ms),
      frame_rate: Number(payload.frame_rate),
      sig_type: payload.sig_type,
      compress: payload.compress,
      original_file_path: storageService.usesR2 ? null : sliceFilePath,
      original_object_key: storageService.usesR2 ? sliceObjectKey : null,
      decompressed_file_path: null,
      wav_file_path: null,
      wav_object_key: null,
      status: 'RECEIVED',
      missing_slices: [],
      processing_error: null,
      created_at: new Date(),
      updated_at: new Date()
    });

    try {
      await recording.save();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const duplicate = await Recording.findOne(identity);
      if (!duplicate) throw error;
      return this.handleExistingSlice(duplicate, payload, parsed, sliceFilePath, sliceObjectKey);
    }

    try {
      await storageService.save(sliceObjectKey, sliceFilePath, payload.fileBuffer, 'audio/opus');
    } catch (error) {
      await Recording.updateOne(
        { _id: recording._id },
        {
          $set: {
            status: 'FAILED',
            processing_error: 'Original slice could not be saved safely',
            wav_file_path: null,
            wav_object_key: null,
            updated_at: new Date()
          }
        }
      );
      throw error;
    }

    this.scheduleSessionEvaluation(payload.sn, payload.session_id);
    return { record_id: recording.record_id, recording };
  }

  private sanitizeProcessingError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown recording processing error';
    const sensitiveValues = [process.env.R2_ACCESS_KEY_ID, process.env.R2_SECRET_ACCESS_KEY]
      .filter((value): value is string => Boolean(value));
    return sensitiveValues.reduce((sanitized, value) => sanitized.replaceAll(value, '[credential]'), message)
      .replaceAll(config.uploadDir, '[upload-dir]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 500);
  }

  public async evaluateSessionForProcessing(deviceSn: string, sessionId: string): Promise<SessionDecision> {
    const filter = this.sessionFilter(deviceSn, sessionId);
    const slices = await Recording.find(filter).sort({ slice_number: 1, created_at: 1 });
    const decision = assessSessionSlices(slices);

    if (decision.kind === 'RECEIVED') return decision;

    if (decision.kind === 'WAITING_SLICES' || decision.kind === 'PENDING_LZ4_CONFIRMATION') {
      await Recording.updateMany(filter, {
        $set: {
          status: decision.kind,
          missing_slices: decision.missingSlices,
          processing_error: decision.reason || null,
          wav_file_path: null,
          wav_object_key: null,
          updated_at: new Date()
        }
      });
      return decision;
    }

    const existingWav = slices.find((slice) => slice.wav_object_key || slice.wav_file_path);
    if (existingWav && await storageService.exists(
      existingWav.wav_object_key,
      existingWav.wav_file_path,
      45
    )) {
      return decision;
    }

    const sessionKey = `${deviceSn}\u0000${sessionId}`;
    if (this.processingSessions.has(sessionKey)) return decision;
    this.processingSessions.add(sessionKey);

    try {
      const finalSlice = slices.find((slice) =>
        (slice.is_last_slice ?? parseSerial(slice.serial).isLastSlice) === true
      );
      if (!finalSlice) return decision;

      const claimed = await Recording.findOneAndUpdate(
        {
          _id: finalSlice._id,
          ...filter,
          status: { $in: ['RECEIVED', 'WAITING_SLICES', 'FAILED', 'READY'] }
        },
        {
          $set: {
            status: 'PROCESSING',
            missing_slices: [],
            processing_error: null,
            wav_file_path: null,
            wav_object_key: null,
            updated_at: new Date()
          }
        },
        { new: true }
      );
      if (!claimed) return decision;

      await Recording.updateMany(filter, {
        $set: {
          status: 'PROCESSING',
          missing_slices: [],
          processing_error: null,
          wav_file_path: null,
          wav_object_key: null,
          updated_at: new Date()
        }
      });

      const sortedSlices = [...slices].sort((left, right) => {
        const leftNumber = left.slice_number ?? parseSerial(left.serial).sliceNumber;
        const rightNumber = right.slice_number ?? parseSerial(right.serial).sliceNumber;
        return leftNumber - rightNumber;
      });
      const firstSlice = sortedSlices[0];
      const wavDestination = path.join(this.sessionFolder(deviceSn, sessionId), `${claimed.record_id}.wav`);
      const wavObjectKey = recordingWavObjectKey(deviceSn, sessionId, claimed.record_id);

      try {
        const sliceBuffers = await Promise.all(sortedSlices.map((slice) =>
          storageService.read(slice.original_object_key, slice.original_file_path)
        ));
        const wavBuffer = await audioService.processBuffersToWav(
          sliceBuffers,
          {
            sampleRate: firstSlice.sample_rate || 16000,
            channels: firstSlice.channel?.toUpperCase() === 'STEREO' ? 2 : 1,
            compress: null
          }
        );
        const storedWav = await storageService.save(
          wavObjectKey,
          wavDestination,
          wavBuffer,
          'audio/wav'
        );
        if (!await storageService.exists(storedWav.objectKey, storedWav.localPath, 45)) {
          throw new Error('Generated WAV could not be verified after storage');
        }

        // A late concurrent upload must not let an obsolete slice set become READY.
        const currentSlices = await Recording.find(filter).sort({ slice_number: 1, created_at: 1 });
        const currentDecision = assessSessionSlices(currentSlices);
        if (currentDecision.kind !== 'READY_TO_PROCESS') {
          await storageService.remove(storedWav.objectKey, storedWav.localPath);
          await Recording.updateMany(filter, {
            $set: {
              wav_file_path: null,
              wav_object_key: null,
              status: currentDecision.kind === 'RECEIVED' ? 'WAITING_SLICES' : currentDecision.kind,
              missing_slices: currentDecision.missingSlices,
              processing_error: currentDecision.reason || 'Session changed while audio was processing',
              updated_at: new Date()
            }
          });
          return currentDecision;
        }

        await Recording.updateMany(filter, {
          $set: {
            wav_file_path: storedWav.localPath,
            wav_object_key: storedWav.objectKey,
            status: 'READY',
            processing_error: null,
            missing_slices: [],
            updated_at: new Date()
          }
        });
      } catch (error) {
        await Recording.updateMany(filter, {
          $set: {
            wav_file_path: null,
            wav_object_key: null,
            status: 'FAILED',
            processing_error: this.sanitizeProcessingError(error),
            updated_at: new Date()
          }
        });
      }

      return decision;
    } finally {
      this.processingSessions.delete(sessionKey);
    }
  }

  public async getAllRecordings() {
    const allSlices = await Recording.find().sort({ created_at: -1 }).lean();
    const sessionMap = new Map<string, {
      record_id: string;
      device_sn: string;
      session_id: string;
      file_name: string;
      duration_ms: number;
      status: RecordingStatus;
      created_at: Date;
      audio_type: string;
      channel: string;
      sample_rate: number;
      slice_count: number;
      wav_file_path?: string | null;
      wav_object_key?: string | null;
    }>();

    for (const slice of allSlices) {
      const key = `${slice.device_sn}\u0000${slice.session_id}`;
      const existing = sessionMap.get(key);
      if (!existing) {
        sessionMap.set(key, {
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
          wav_file_path: slice.wav_file_path,
          wav_object_key: slice.wav_object_key
        });
        continue;
      }

      existing.duration_ms += slice.duration_ms || 0;
      existing.slice_count += 1;
      if (slice.wav_file_path) existing.wav_file_path = slice.wav_file_path;
      if (slice.wav_object_key) existing.wav_object_key = slice.wav_object_key;
      const priority: RecordingStatus[] = [
        'READY',
        'PROCESSING',
        'PENDING_LZ4_CONFIRMATION',
        'WAITING_SLICES',
        'FAILED',
        'RECEIVED'
      ];
      if (priority.indexOf(slice.status) < priority.indexOf(existing.status)) {
        existing.status = slice.status;
      }
    }

    const sessions = Array.from(sessionMap.values());
    await Promise.all(sessions.map(async (session) => {
      if (session.status === 'READY' &&
          !await storageService.exists(session.wav_object_key, session.wav_file_path, 45)) {
        session.status = 'FAILED';
        session.wav_file_path = null;
        session.wav_object_key = null;
      }
    }));
    return sessions;
  }

  /** Public recording IDs remain supported; ambiguous session-only lookup is removed. */
  public async getRecordingById(recordId: string) {
    return Recording.findOne({ record_id: recordId }).lean();
  }

  public async isWavAvailable(recording: Pick<IRecording, 'wav_object_key' | 'wav_file_path'>): Promise<boolean> {
    return storageService.exists(recording.wav_object_key, recording.wav_file_path, 45);
  }

  public async openWav(recording: Pick<IRecording, 'wav_object_key' | 'wav_file_path'>): Promise<StoredDownload> {
    return storageService.openDownload(recording.wav_object_key, recording.wav_file_path);
  }
}

export const recordingService = new RecordingService();
