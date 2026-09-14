import { FastifyPluginAsync } from 'fastify';
import { debugLogService } from '../services/debugLogService.js';
import { safeStorageFileName } from '../services/storageService.js';
import { setActivityRequestBody } from '../services/apiActivityService.js';

const ALLOWED_TEXT_FIELDS = new Set(['sn', 'ts', 'create_time']);

class DebugLogRequestError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'DebugLogRequestError';
  }
}

function requiredText(fields: Record<string, string>, name: string, maximum: number): string {
  const value = fields[name]?.trim();
  if (!value) throw new DebugLogRequestError(`${name} is required`);
  if (value.length > maximum) throw new DebugLogRequestError(`${name} is too long`);
  if (/[^\x20-\x7e]/.test(value)) {
    throw new DebugLogRequestError(`${name} contains unsupported characters`);
  }
  return value;
}

export const debugLogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/sca/device/debug_log', async (request, reply) => {
    const activityBody: Record<string, unknown> = {};
    try {
      const parts = request.parts({ limits: { files: 2, fields: 8, parts: 10 } });
      const fields: Record<string, string> = {};
      const seenFields = new Set<string>();
      let fileBuffer: Buffer | null = null;
      let fileName = '';

      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname !== 'log_file') {
            for await (const _chunk of part.file) { /* drain rejected file */ }
            throw new DebugLogRequestError(`Unexpected file field: ${part.fieldname}`);
          }
          if (fileBuffer !== null) {
            for await (const _chunk of part.file) { /* drain duplicate file */ }
            throw new DebugLogRequestError('Exactly one log_file is required');
          }

          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          if (part.file.truncated) {
            throw new DebugLogRequestError('log_file exceeds the upload-size limit', 413);
          }
          fileBuffer = Buffer.concat(chunks);
          fileName = safeStorageFileName(part.filename || 'debug.log');
          activityBody.log_file = {
            file_name: fileName,
            mime_type: part.mimetype,
            size: fileBuffer.length,
            content: '[binary omitted]'
          };
          continue;
        }

        if (!ALLOWED_TEXT_FIELDS.has(part.fieldname)) {
          throw new DebugLogRequestError(`Unexpected text field: ${part.fieldname}`);
        }
        if (seenFields.has(part.fieldname)) {
          throw new DebugLogRequestError(`Duplicate text field: ${part.fieldname}`);
        }
        seenFields.add(part.fieldname);
        fields[part.fieldname] = String(part.value);
        activityBody[part.fieldname] = fields[part.fieldname];
      }

      setActivityRequestBody(request, activityBody);

      const sn = requiredText(fields, 'sn', 128);
      const timestamp = requiredText(fields, 'ts', 13);
      if (!/^\d{13}$/.test(timestamp)) {
        throw new DebugLogRequestError('ts must contain exactly 13 decimal digits');
      }
      if (!fileBuffer) throw new DebugLogRequestError('Exactly one log_file is required');
      if (fileBuffer.length === 0) throw new DebugLogRequestError('log_file must not be empty');

      await debugLogService.save({ sn, timestamp, fileName, fileBuffer });
      return reply.status(200).send({ code: 0 });
    } catch (error) {
      setActivityRequestBody(request, activityBody);
      if (error instanceof DebugLogRequestError) {
        return reply.status(error.statusCode).send({ code: error.statusCode, msg: error.message });
      }

      const statusCode = typeof error === 'object' && error !== null &&
        'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
      request.log.error(error);
      return reply.status(statusCode >= 400 && statusCode < 500 ? statusCode : 500).send({
        code: statusCode >= 400 && statusCode < 500 ? statusCode : 500,
        msg: statusCode === 413 ? 'log_file exceeds the upload-size limit' : 'Failed to upload debug log'
      });
    }
  });
};
