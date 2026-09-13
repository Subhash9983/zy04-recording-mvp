import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { recordingService } from '../services/recordingService.js';

export const recordingRoutes: FastifyPluginAsync = async (fastify) => {
  // List all recordings
  fastify.get('/api/recordings', async (request, reply) => {
    try {
      const recordings = await recordingService.getAllRecordings();
      return reply.send({
        data: recordings.map((rec) => ({
          record_id: rec.record_id,
          device_sn: rec.device_sn,
          session_id: rec.session_id,
          file_name: rec.file_name,
          duration_ms: rec.duration_ms,
          status: rec.status,
          created_at: rec.created_at,
          audio_type: rec.audio_type,
          channel: rec.channel,
          sample_rate: rec.sample_rate
        }))
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch recordings' });
    }
  });

  // Get recording detail
  fastify.get<{ Params: { id: string } }>('/api/recordings/:id', async (request, reply) => {
    try {
      const recording = await recordingService.getRecordingById(request.params.id);
      if (!recording) {
        return reply.status(404).send({ error: 'Recording not found' });
      }
      return reply.send({ data: recording });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch recording details' });
    }
  });

  // Stream WAV audio for playback
  fastify.get<{ Params: { id: string } }>('/api/recordings/:id/audio', async (request, reply) => {
    try {
      const recording = await recordingService.getRecordingById(request.params.id);
      if (!recording) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      let filePath = recording.wav_file_path || recording.original_file_path;
      if (filePath && !fs.existsSync(filePath)) {
        // Fallback: resolve relative to config.uploadDir
        const sn = recording.device_sn.replace(/[^a-zA-Z0-9_-]/g, '_');
        const session = recording.session_id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const altWav = path.join(config.uploadDir, sn, session, 'recording.wav');
        if (fs.existsSync(altWav)) {
          filePath = altWav;
        } else {
          const altOpus = path.join(config.uploadDir, sn, session, path.basename(filePath));
          if (fs.existsSync(altOpus)) {
            filePath = altOpus;
          }
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return reply.status(404).send({ error: 'Audio file not found on disk' });
      }

      const isWav = filePath.endsWith('.wav');
      reply.header('Content-Type', isWav ? 'audio/wav' : 'audio/ogg');
      reply.header('Accept-Ranges', 'bytes');

      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to stream audio file' });
    }
  });
};
