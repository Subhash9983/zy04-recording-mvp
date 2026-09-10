import { FastifyPluginAsync } from 'fastify';
import { recordingService, SaveUploadPayload } from '../services/recordingService.js';

export const recordUploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/sca/recordupload', async (request, reply) => {
    try {
      const parts = request.parts();

      const fields: Record<string, string> = {};
      let fileBuffer: Buffer | null = null;
      let originalFilename: string | undefined;

      for await (const part of parts) {
        if (part.type === 'file') {
          originalFilename = part.filename;
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
        } else {
          // Normal field
          fields[part.fieldname] = String(part.value);
        }
      }

      const sn = fields.sn || 'UNKNOWN_SN';
      const sessionId = fields.session_id || 'UNKNOWN_SESSION';
      const serial = fields.serial || '1';

      if (!fileBuffer) {
        return reply.status(400).send({
          code: 400,
          msg: 'Missing record_file upload'
        });
      }

      const payload: SaveUploadPayload = {
        sn,
        esp_version: fields.esp_version,
        dsp_version: fields.dsp_version,
        file_name: fields.file_name || originalFilename,
        mac: fields.mac,
        session_id: sessionId,
        create_time: fields.create_time,
        duration: fields.duration,
        audio_type: fields.audio_type,
        channel: fields.channel,
        sample_rate: fields.sample_rate,
        frame_size_ms: fields.frame_size_ms,
        frame_rate: fields.frame_rate,
        sig_type: fields.sig_type,
        compress: fields.compress || null,
        serial,
        fileBuffer
      };

      const { record_id } = await recordingService.handleUpload(payload);

      return reply.status(200).send({
        code: 0,
        data: {
          record_id
        }
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        code: 500,
        msg: 'Failed to process record upload'
      });
    }
  });
};
