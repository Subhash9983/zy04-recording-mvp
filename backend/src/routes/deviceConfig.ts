import { FastifyPluginAsync } from 'fastify';
import { Device } from '../models/Device.js';
import { DeviceConfig } from '../models/DeviceConfig.js';

interface DeviceConfigRequestBody {
  product?: unknown;
  sn?: unknown;
  version?: unknown;
}

interface DeviceConfigStatusRequestBody {
  sn?: unknown;
  session_id?: unknown;
  status?: unknown;
}

export interface ValidDeviceConfigRequest {
  product: string;
  sn: string;
  version: string;
}

export interface ValidDeviceConfigStatusRequest {
  sn: string;
  sessionIds: Array<string | number>;
  acknowledgementStatus: string;
  succeeded: boolean;
}

export class DeviceConfigRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceConfigRequestError';
  }
}

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DeviceConfigRequestError(`${name} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new DeviceConfigRequestError(`${name} is too long`);
  }
  if (/[^\x20-\x7e]/.test(normalized)) {
    throw new DeviceConfigRequestError(`${name} contains unsupported characters`);
  }
  return normalized;
}

export function validateDeviceConfigRequest(body: unknown): ValidDeviceConfigRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DeviceConfigRequestError('JSON request body is required');
  }
  const candidate = body as DeviceConfigRequestBody;
  return {
    product: requiredText(candidate.product, 'product', 128),
    sn: requiredText(candidate.sn, 'sn', 128),
    version: requiredText(candidate.version, 'version', 128)
  };
}

export function validateDeviceConfigStatusRequest(body: unknown): ValidDeviceConfigStatusRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DeviceConfigRequestError('JSON request body is required');
  }
  const candidate = body as DeviceConfigStatusRequestBody;
  const sn = requiredText(candidate.sn, 'sn', 128);
  const acknowledgementStatus = requiredText(candidate.status, 'status', 64);
  const rawSessionId = candidate.session_id;
  let sessionId: string | number;

  if (typeof rawSessionId === 'number') {
    if (!Number.isSafeInteger(rawSessionId) || rawSessionId < 0) {
      throw new DeviceConfigRequestError('session_id must be a non-negative safe integer or string');
    }
    sessionId = rawSessionId;
  } else {
    sessionId = requiredText(rawSessionId, 'session_id', 128);
  }

  const sessionIds: Array<string | number> = [sessionId];
  if (typeof sessionId === 'number') {
    sessionIds.push(String(sessionId));
  } else if (/^(0|[1-9]\d*)$/.test(sessionId)) {
    const numericSessionId = Number(sessionId);
    if (Number.isSafeInteger(numericSessionId)) sessionIds.push(numericSessionId);
  }

  return {
    sn,
    sessionIds,
    acknowledgementStatus,
    succeeded: acknowledgementStatus.toLowerCase() === 'success'
  };
}

const RESERVED_VALUE_KEYS = new Set([
  'session_id',
  'device_model',
  '__proto__',
  'constructor',
  'prototype'
]);

export function flattenDeviceConfig(
  values: Record<string, unknown>,
  sessionId: string | number,
  deviceModel: string
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    for (const [key, value] of Object.entries(values)) {
      if (!RESERVED_VALUE_KEYS.has(key)) data[key] = value;
    }
  }
  data.session_id = sessionId;
  data.device_model = deviceModel;
  return data;
}

export const deviceConfigRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: DeviceConfigRequestBody }>('/sca/device/config', async (request, reply) => {
    try {
      const input = validateDeviceConfigRequest(request.body);
      const now = new Date();

      await Device.findOneAndUpdate(
        { sn: input.sn },
        {
          $set: {
            product: input.product,
            model: input.product,
            version: input.version,
            last_seen_at: now,
            updated_at: now
          },
          $setOnInsert: { created_at: now }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      const deviceConfig = await DeviceConfig.findOneAndUpdate(
        {
          device_sn: input.sn,
          device_model: input.product,
          status: { $in: ['PENDING', 'DELIVERED'] }
        },
        {
          $set: {
            status: 'DELIVERED',
            last_delivery_at: now,
            updated_at: now
          },
          $inc: { delivery_attempts: 1 }
        },
        {
          sort: { created_at: 1, _id: 1 },
          new: true
        }
      ).lean();

      if (!deviceConfig) {
        return reply.status(200).send({ code: 1 });
      }

      return reply.status(200).send({
        code: 0,
        data: flattenDeviceConfig(
          deviceConfig.values,
          deviceConfig.session_id,
          deviceConfig.device_model
        )
      });
    } catch (error) {
      if (error instanceof DeviceConfigRequestError) {
        return reply.status(400).send({ code: 400, msg: error.message });
      }
      request.log.error(error);
      return reply.status(500).send({ code: 500, msg: 'Failed to fetch device configuration' });
    }
  });

  fastify.post<{ Body: DeviceConfigStatusRequestBody }>(
    '/sca/device/config_status',
    async (request, reply) => {
      try {
        const input = validateDeviceConfigStatusRequest(request.body);
        const now = new Date();

        await Device.updateOne(
          { sn: input.sn },
          { $set: { last_seen_at: now, updated_at: now } }
        );

        const identity = {
          device_sn: input.sn,
          session_id: { $in: input.sessionIds }
        };
        const transitionFilter = input.succeeded
          ? { ...identity, status: { $ne: 'SUCCESS' } }
          : { ...identity, status: { $in: ['PENDING', 'DELIVERED'] } };

        const transitioned = await DeviceConfig.findOneAndUpdate(
          transitionFilter,
          {
            $set: {
              status: input.succeeded ? 'SUCCESS' : 'FAILED',
              acknowledgement_status: input.acknowledgementStatus,
              acknowledged_at: now,
              completed_at: now,
              updated_at: now
            }
          },
          { new: true }
        );

        if (!transitioned) {
          const existing = await DeviceConfig.exists(identity);
          if (!existing) return reply.status(200).send({ code: 1 });
        }

        return reply.status(200).send({ code: 0 });
      } catch (error) {
        if (error instanceof DeviceConfigRequestError) {
          return reply.status(400).send({ code: 400, msg: error.message });
        }
        request.log.error(error);
        return reply.status(500).send({ code: 500, msg: 'Failed to acknowledge device configuration' });
      }
    }
  );
};
