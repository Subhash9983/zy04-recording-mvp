import { FastifyPluginAsync } from 'fastify';
import { recordingService, SaveUploadPayload } from '../services/recordingService.js';
import { parseSerial, SerialValidationError } from '../utils/serial.js';
import { setActivityRequestBody } from '../services/apiActivityService.js';

const REQUIRED_FIELDS = [
  'sn',
  'esp_version',
  'dsp_version',
  'file_name',
  'mac',
  'session_id',
  'create_time',
  'duration',
  'audio_type',
  'channel',
  'sample_rate',
  'frame_rate',
  'sig_type',
  'serial'
] as const;

class UploadRequestError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'UploadRequestError';
  }
}

function boundedField(fields: Record<string, string>, name: string, maximum: number): string {
  const value = fields[name]?.trim();
  if (!value) throw new UploadRequestError(`Missing required field: ${name}`);
  if (value.length > maximum) throw new UploadRequestError(`${name} is too long`);
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new UploadRequestError(`${name} contains unsafe characters`);
  }
  return value;
}

function safeMetadataFilename(value: string): string {
  const leaf = value.replace(/\\/g, '/').split('/').pop()?.trim() || '';
  const sanitized = leaf.replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_');
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new UploadRequestError('file_name is invalid');
  }
  return sanitized.slice(0, 255);
}

function validateFields(fields: Record<string, string>, fileBuffer: Buffer): SaveUploadPayload {
  for (const name of REQUIRED_FIELDS) {
    if (!fields[name]?.trim()) throw new UploadRequestError(`Missing required field: ${name}`);
  }
  if (fileBuffer.length === 0) throw new UploadRequestError('record_file must not be empty');

  const sn = boundedField(fields, 'sn', 128);
  const sessionId = boundedField(fields, 'session_id', 128);
  const fileName = safeMetadataFilename(boundedField(fields, 'file_name', 512));
  const mac = boundedField(fields, 'mac', 64);
  const espVersion = boundedField(fields, 'esp_version', 64);
  const dspVersion = boundedField(fields, 'dsp_version', 64);
  const createTime = boundedField(fields, 'create_time', 13);
  const duration = boundedField(fields, 'duration', 20);

  if (!/^\d{13}$/.test(createTime)) {
    throw new UploadRequestError('create_time must contain exactly 13 decimal digits');
  }
  if (!/^\d+$/.test(duration) || !Number.isSafeInteger(Number(duration))) {
    throw new UploadRequestError('duration must be a non-negative integer string');
  }

  const audioType = boundedField(fields, 'audio_type', 16).toUpperCase();
  const channel = boundedField(fields, 'channel', 16).toUpperCase();
  if (audioType !== 'OPUS') throw new UploadRequestError('audio_type must be OPUS');
  if (channel !== 'STEREO') throw new UploadRequestError('channel must be STEREO');
  if (fields.sample_rate.trim() !== '16000') throw new UploadRequestError('sample_rate must be 16000');
  const frameSizeMs = fields.frame_size_ms?.trim() || '20';
  if (frameSizeMs !== '20') throw new UploadRequestError('frame_size_ms must be 20');
  if (fields.frame_rate.trim() !== '8') throw new UploadRequestError('frame_rate must be 8');
  if (fields.sig_type.trim() !== '2') throw new UploadRequestError('sig_type must be 2');

  let compress: 'lz4' | null = null;
  if (Object.prototype.hasOwnProperty.call(fields, 'compress')) {
    if (fields.compress.trim().toLowerCase() !== 'lz4') {
      throw new UploadRequestError('compress must be omitted or lz4');
    }
    compress = 'lz4';
  }

  try {
    parseSerial(fields.serial);
  } catch (error) {
    if (error instanceof SerialValidationError) {
      throw new UploadRequestError(error.message);
    }
    throw error;
  }

  return {
    sn,
    esp_version: espVersion,
    dsp_version: dspVersion,
    file_name: fileName,
    mac,
    session_id: sessionId,
    create_time: createTime,
    duration,
    audio_type: 'OPUS',
    channel: 'STEREO',
    sample_rate: '16000',
    frame_size_ms: '20',
    frame_rate: '8',
    sig_type: '2',
    compress,
    serial: fields.serial.trim(),
    fileBuffer
  };
}

export const recordUploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/sca/recordupload', async (request, reply) => {
    const activityBody: Record<string, unknown> = {};
    try {
      const parts = request.parts({ limits: { files: 2, fields: 32, parts: 34 } });
      const fields: Record<string, string> = {};
      const seenTextFields = new Set<string>();
      let fileBuffer: Buffer | null = null;

      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname !== 'record_file') {
            for await (const _chunk of part.file) { /* drain rejected part */ }
            throw new UploadRequestError(`Unexpected file field: ${part.fieldname}`);
          }
          if (fileBuffer !== null) {
            for await (const _chunk of part.file) { /* drain duplicate part */ }
            throw new UploadRequestError('Exactly one record_file is required');
          }

          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          if (part.file.truncated) {
            throw new UploadRequestError('record_file exceeds the upload-size limit', 413);
          }
          fileBuffer = Buffer.concat(chunks);
          activityBody.record_file = {
            file_name: part.filename || null,
            mime_type: part.mimetype,
            size: fileBuffer.length,
            content: '[binary omitted]'
          };
          continue;
        }

        if (seenTextFields.has(part.fieldname)) {
          throw new UploadRequestError(`Duplicate text field: ${part.fieldname}`);
        }
        seenTextFields.add(part.fieldname);
        fields[part.fieldname] = String(part.value);
        activityBody[part.fieldname] = fields[part.fieldname];
      }

      setActivityRequestBody(request, activityBody);

      if (!fileBuffer) throw new UploadRequestError('Exactly one record_file is required');
      const payload = validateFields(fields, fileBuffer);
      const { record_id } = await recordingService.handleUpload(payload);

      return reply.status(200).send({ code: 0, data: { record_id } });
    } catch (error) {
      setActivityRequestBody(request, activityBody);
      if (error instanceof UploadRequestError) {
        return reply.status(error.statusCode).send({ code: error.statusCode, msg: error.message });
      }

      const statusCode = typeof error === 'object' && error !== null &&
        'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
      request.log.error(error);
      return reply.status(statusCode >= 400 && statusCode < 500 ? statusCode : 500).send({
        code: statusCode >= 400 && statusCode < 500 ? statusCode : 500,
        msg: statusCode === 413 ? 'record_file exceeds the upload-size limit' : 'Failed to process record upload'
      });
    }
  });
};
