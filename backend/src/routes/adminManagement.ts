import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { DebugLog } from '../models/DebugLog.js';
import { Firmware } from '../models/Firmware.js';
import { Recording } from '../models/Recording.js';
import { requireAdmin } from '../services/adminAuthService.js';
import {
  adminManagementService,
  AdminManagementValidationError,
  requiresFirmwareConfirmation,
  validateCreateConfigBody,
  validateCreateFirmwareBody,
  validateFirmwareUpdateBody
} from '../services/adminManagementService.js';
import { writeAuditLog } from '../services/auditService.js';
import { assessSessionSlices, recordingService } from '../services/recordingService.js';
import { storageService } from '../services/storageService.js';

class AdminActionError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'AdminActionError';
  }
}

function requestContext(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent
  };
}

function safeDownloadName(value: string, fallback: string): string {
  const leaf = value.replace(/\\/g, '/').split('/').pop() || fallback;
  return leaf.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || fallback;
}

function objectId(value: string): string {
  if (!mongoose.isValidObjectId(value)) throw new AdminActionError('Resource not found', 404);
  return value;
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

async function audit(
  request: FastifyRequest,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  await writeAuditLog({
    actor: { id: request.admin!.id, email: request.admin!.email },
    action,
    targetType,
    targetId,
    metadata,
    context: requestContext(request)
  });
}

function actionError(request: FastifyRequest, error: unknown) {
  if (error instanceof AdminManagementValidationError) {
    return { status: 400, body: { code: 400, msg: error.message } };
  }
  if (error instanceof AdminActionError) {
    return { status: error.statusCode, body: { code: error.statusCode, msg: error.message } };
  }
  if (duplicateKey(error)) {
    return { status: 409, body: { code: 409, msg: 'A matching resource already exists' } };
  }
  request.log.error(error);
  return { status: 500, body: { code: 500, msg: 'Admin action failed' } };
}

export const adminManagementRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.post('/api/admin/configs', { bodyLimit: 128 * 1024 }, async (request, reply) => {
    try {
      const input = validateCreateConfigBody(request.body);
      await audit(request, 'ADMIN_CONFIG_CREATE', 'DEVICE_CONFIG_BATCH', null, {
        device_sns: input.deviceSns,
        setting_keys: input.settingKeys,
        device_count: input.deviceSns.length
      });
      const created = await adminManagementService.createConfigs(input);
      return reply.status(201).send({ code: 0, data: { created } });
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.post('/api/admin/firmware', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    try {
      const input = validateCreateFirmwareBody(request.body);
      await audit(request, 'ADMIN_FIRMWARE_CREATE', 'FIRMWARE_BATCH', null, {
        device_models: input.deviceModels,
        firmware_type: input.firmwareType,
        firmware_version: input.firmwareVersion,
        update_type: input.updateType,
        enabled: input.enabled,
        explicit_confirmation: input.confirmed
      });
      const created = await adminManagementService.createFirmware(input);
      return reply.status(201).send({
        code: 0,
        data: {
          created: created.map((firmware) => ({
            id: String(firmware._id),
            device_model: firmware.device_model,
            firmware_type: firmware.firmware_type,
            firmware_version: firmware.firmware_version,
            url: firmware.url,
            md5: firmware.md5,
            update_type: firmware.update_type,
            enabled: firmware.enabled,
            created_at: firmware.created_at,
            updated_at: firmware.updated_at
          }))
        }
      });
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.put<{ Params: { id: string } }>('/api/admin/firmware/:id', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    try {
      const id = objectId(request.params.id);
      const input = validateFirmwareUpdateBody(request.body);
      const existing = await Firmware.findById(id).lean();
      if (!existing) throw new AdminActionError('Firmware not found', 404);
      if (requiresFirmwareConfirmation(existing.firmware_version, existing.update_type, input) && !input.confirmed) {
        throw new AdminManagementValidationError('Force/downgrade firmware requires explicit confirmation');
      }
      await audit(request, 'ADMIN_FIRMWARE_UPDATE', 'FIRMWARE', id, {
        changed_fields: Object.keys(input.values).sort(),
        explicit_confirmation: input.confirmed
      });
      const updated = await Firmware.findByIdAndUpdate(
        id,
        { $set: { ...input.values, updated_at: new Date() } },
        { new: true, runValidators: true }
      ).lean();
      if (!updated) throw new AdminActionError('Firmware not found', 404);
      const { _id, __v: _version, ...safe } = updated as unknown as Record<string, unknown>;
      return reply.send({ code: 0, data: { id: String(_id), ...safe } });
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/admin/firmware/:id/disable', async (request, reply) => {
    try {
      const id = objectId(request.params.id);
      const existing = await Firmware.findById(id).lean();
      if (!existing) throw new AdminActionError('Firmware not found', 404);
      await audit(request, 'ADMIN_FIRMWARE_DISABLE', 'FIRMWARE', id, {
        device_model: existing.device_model,
        firmware_type: existing.firmware_type,
        firmware_version: existing.firmware_version,
        already_disabled: !existing.enabled
      });
      if (existing.enabled) {
        await Firmware.updateOne({ _id: id }, { $set: { enabled: false, updated_at: new Date() } });
      }
      return reply.send({ code: 0, data: { id, enabled: false } });
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/admin/recordings/:id/wav', async (request, reply) => {
    try {
      const recording = await recordingService.getRecordingById(request.params.id);
      if (!recording) throw new AdminActionError('Recording not found', 404);
      if (recording.status !== 'READY' || !await recordingService.isWavAvailable(recording)) {
        throw new AdminActionError('Decoded WAV is unavailable', 409);
      }
      await audit(request, 'ADMIN_RECORDING_WAV_DOWNLOAD', 'RECORDING', recording.record_id, {
        device_sn: recording.device_sn,
        session_id: recording.session_id
      });
      const download = await recordingService.openWav(recording);
      const fileName = safeDownloadName(`${recording.record_id}.wav`, 'recording.wav');
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', download.contentLength);
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      return reply.send(download.stream);
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/admin/recordings/:id/original', async (request, reply) => {
    try {
      const recording = await recordingService.getRecordingById(request.params.id);
      if (!recording) throw new AdminActionError('Recording not found', 404);
      if (!await storageService.exists(recording.original_object_key, recording.original_file_path)) {
        throw new AdminActionError('Original slice is unavailable', 404);
      }
      await audit(request, 'ADMIN_RECORDING_ORIGINAL_DOWNLOAD', 'RECORDING', recording.record_id, {
        device_sn: recording.device_sn,
        session_id: recording.session_id,
        serial: recording.serial
      });
      const download = await storageService.openDownload(recording.original_object_key, recording.original_file_path);
      const fileName = safeDownloadName(recording.file_name || `${recording.record_id}.opus`, 'recording-slice.opus');
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', download.contentLength);
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      return reply.send(download.stream);
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/admin/recordings/:id/retry', async (request, reply) => {
    try {
      const recording = await recordingService.getRecordingById(request.params.id);
      if (!recording) throw new AdminActionError('Recording not found', 404);
      const slices = await Recording.find({
        device_sn: recording.device_sn,
        session_id: recording.session_id
      }).sort({ slice_number: 1, created_at: 1 });
      if (slices.some((slice) => slice.status === 'PROCESSING')) {
        throw new AdminActionError('Recording session is already processing', 409);
      }
      const decision = assessSessionSlices(slices);
      if (decision.kind !== 'READY_TO_PROCESS') {
        throw new AdminActionError(
          decision.kind === 'PENDING_LZ4_CONFIRMATION'
            ? 'LZ4 framing confirmation is required before retrying'
            : 'Recording session is not complete enough to retry',
          409
        );
      }
      const existingWav = slices.find((slice) => slice.wav_object_key || slice.wav_file_path);
      if (existingWav && await recordingService.isWavAvailable(existingWav)) {
        throw new AdminActionError('A valid WAV already exists', 409);
      }
      await audit(request, 'ADMIN_RECORDING_RETRY', 'RECORDING_SESSION', recording.record_id, {
        device_sn: recording.device_sn,
        session_id: recording.session_id,
        slice_count: slices.length
      });
      await recordingService.evaluateSessionForProcessing(recording.device_sn, recording.session_id);
      const refreshed = await Recording.findOne({
        device_sn: recording.device_sn,
        session_id: recording.session_id
      }).sort({ is_last_slice: -1 }).lean();
      return reply.send({
        code: 0,
        data: {
          record_id: recording.record_id,
          device_sn: recording.device_sn,
          session_id: recording.session_id,
          status: refreshed?.status || 'FAILED'
        }
      });
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/admin/logs/debug/:id/download', async (request, reply) => {
    try {
      const id = objectId(request.params.id);
      const debugLog = await DebugLog.findById(id).lean();
      if (!debugLog || debugLog.deleted_at) throw new AdminActionError('Debug log not found', 404);
      if (!await storageService.exists(debugLog.object_key, debugLog.local_path)) {
        throw new AdminActionError('Debug log file is unavailable', 404);
      }
      await audit(request, 'ADMIN_DEBUG_LOG_DOWNLOAD', 'DEBUG_LOG', id, {
        device_sn: debugLog.sn,
        timestamp: debugLog.ts,
        file_name: debugLog.file_name
      });
      const download = await storageService.openDownload(debugLog.object_key, debugLog.local_path);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', download.contentLength);
      reply.header('Content-Disposition', `attachment; filename="${safeDownloadName(debugLog.file_name, 'debug.log')}"`);
      return reply.send(download.stream);
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/admin/logs/debug/:id/delete', async (request, reply) => {
    try {
      const id = objectId(request.params.id);
      const debugLog = await DebugLog.findById(id).lean();
      if (!debugLog) throw new AdminActionError('Debug log not found', 404);
      await audit(request, 'ADMIN_DEBUG_LOG_SOFT_DELETE', 'DEBUG_LOG', id, {
        device_sn: debugLog.sn,
        timestamp: debugLog.ts,
        file_name: debugLog.file_name,
        already_deleted: Boolean(debugLog.deleted_at)
      });
      const deletedAt = debugLog.deleted_at || new Date();
      if (!debugLog.deleted_at) {
        await DebugLog.updateOne({ _id: id, deleted_at: null }, { $set: { deleted_at: deletedAt } });
      }
      return reply.send({ code: 0, data: { id, deleted_at: deletedAt } });
    } catch (error) {
      const response = actionError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });
};
