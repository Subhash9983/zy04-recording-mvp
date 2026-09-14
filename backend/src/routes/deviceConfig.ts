import { FastifyPluginAsync } from 'fastify';
import { Device } from '../models/Device.js';
import { DeviceConfig } from '../models/DeviceConfig.js';

interface DeviceConfigRequestBody {
  product?: unknown;
  sn?: unknown;
  version?: unknown;
}

export interface ValidDeviceConfigRequest {
  product: string;
  sn: string;
  version: string;
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
};
