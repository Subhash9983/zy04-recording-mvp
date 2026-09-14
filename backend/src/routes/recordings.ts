import { FastifyPluginAsync } from 'fastify';
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
      const wavAvailable = recording.status === 'READY' &&
        await recordingService.isWavAvailable(recording);

      return reply.send({
        data: {
          record_id: recording.record_id,
          device_sn: recording.device_sn,
          esp_version: recording.esp_version,
          dsp_version: recording.dsp_version,
          mac: recording.mac,
          session_id: recording.session_id,
          file_name: recording.file_name,
          serial: recording.serial,
          slice_number: recording.slice_number,
          is_last_slice: recording.is_last_slice,
          create_time: recording.create_time,
          duration_ms: recording.duration_ms,
          audio_type: recording.audio_type,
          channel: recording.channel,
          sample_rate: recording.sample_rate,
          frame_size_ms: recording.frame_size_ms,
          frame_rate: recording.frame_rate,
          sig_type: recording.sig_type,
          compress: recording.compress,
          status: wavAvailable ? recording.status : recording.status === 'READY' ? 'FAILED' : recording.status,
          missing_slices: recording.missing_slices || [],
          created_at: recording.created_at,
          updated_at: recording.updated_at
        }
      });
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

      if (recording.status !== 'READY') {
        return reply.status(409).send({ error: 'Decoded audio is not ready' });
      }

      const wavAvailable = await recordingService.isWavAvailable(recording);
      if (!wavAvailable) {
        if (!recording.wav_object_key && !recording.wav_file_path) {
          return reply.status(404).send({ error: 'Decoded WAV is missing from storage' });
        }
        return reply.status(404).send({ error: 'Decoded WAV is unavailable' });
      }

      const playableWav = await recordingService.openWav(recording);

      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', playableWav.contentLength);
      reply.header('Accept-Ranges', 'bytes');
      return reply.send(playableWav.stream);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to stream audio file' });
    }
  });
};
