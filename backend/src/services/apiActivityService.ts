import { EventEmitter } from 'events';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiActivity, IApiActivity } from '../models/ApiActivity.js';

const TRACKED_ROUTES = new Set([
  '/sca/device/cloud_time',
  '/sca/device/config',
  '/sca/device/config_status',
  '/sca/device/reportinfo',
  '/sca/device/debug_log',
  '/sca/recordupload',
  '/ota/v1/fetch_new_firmware'
]);

const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|api[_-]?key)/i;
const activityEvents = new EventEmitter();
activityEvents.setMaxListeners(0);

declare module 'fastify' {
  interface FastifyRequest {
    apiActivityStartedAt?: bigint;
    apiActivityEndpoint?: string;
    apiActivityRequestBody?: unknown;
  }
}

export interface ActivityEvent {
  id: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_code?: string | number | null;
  success: boolean;
  device_sn?: string | null;
  request_body: unknown;
  response_body: unknown;
  duration_ms: number;
  created_at: Date;
}

function boundedText(value: string): string {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  return normalized.length > 8_000 ? `${normalized.slice(0, 8_000)}[truncated]` : normalized;
}

export function sanitizeActivityValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth-limit]';
  if (value === null || value === undefined || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'string') return boundedText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `[binary omitted: ${value.length} bytes]`;
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => sanitizeActivityValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [rawKey, child] of Object.entries(value).slice(0, 500)) {
      const key = rawKey.replaceAll('.', '_').replace(/^\$/, '_').slice(0, 128) || '_';
      sanitized[key] = SENSITIVE_KEY.test(rawKey)
        ? '[redacted]'
        : sanitizeActivityValue(child, depth + 1);
    }
    return sanitized;
  }
  return boundedText(String(value));
}

function parseResponsePayload(payload: unknown): unknown {
  if (Buffer.isBuffer(payload)) return parseResponsePayload(payload.toString('utf8'));
  if (typeof payload !== 'string') return sanitizeActivityValue(payload);
  try {
    return sanitizeActivityValue(JSON.parse(payload));
  } catch {
    return boundedText(payload);
  }
}

function responseCodeOf(responseBody: unknown): string | number | null {
  if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) return null;
  const code = (responseBody as Record<string, unknown>).code;
  return typeof code === 'string' || typeof code === 'number' ? code : null;
}

function deviceSnOf(requestBody: unknown): string | null {
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) return null;
  const body = requestBody as Record<string, unknown>;
  const direct = body.sn ?? body.device_sn;
  if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 128);
  const common = body.common;
  if (common && typeof common === 'object' && !Array.isArray(common)) {
    const nested = (common as Record<string, unknown>).sn;
    if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 128);
  }
  return null;
}

export function setActivityRequestBody(request: FastifyRequest, body: unknown): void {
  request.apiActivityRequestBody = sanitizeActivityValue(body);
}

export function subscribeToActivity(listener: (activity: ActivityEvent) => void): () => void {
  activityEvents.on('activity', listener);
  return () => activityEvents.off('activity', listener);
}

export function installApiActivityTracking(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const endpoint = request.routeOptions.url;
    if (endpoint && TRACKED_ROUTES.has(endpoint)) {
      request.apiActivityStartedAt = process.hrtime.bigint();
      request.apiActivityEndpoint = endpoint;
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.apiActivityStartedAt === undefined || request.apiActivityEndpoint === undefined) return payload;

    const requestBody = sanitizeActivityValue(request.apiActivityRequestBody ?? request.body ?? null);
    const responseBody = parseResponsePayload(payload);
    const responseCode = responseCodeOf(responseBody);
    const statusCode = reply.statusCode;
    const successCode = responseCode === null || responseCode === 0 || responseCode === '0';
    const durationMs = Math.max(
      0,
      Number(process.hrtime.bigint() - request.apiActivityStartedAt) / 1_000_000
    );

    try {
      const stored = await ApiActivity.create({
        endpoint: request.apiActivityEndpoint,
        method: request.method,
        status_code: statusCode,
        response_code: responseCode,
        success: statusCode >= 200 && statusCode < 300 && successCode,
        device_sn: deviceSnOf(requestBody),
        request_body: requestBody,
        response_body: responseBody,
        duration_ms: Math.round(durationMs * 100) / 100,
        created_at: new Date()
      });
      const raw = typeof stored.toObject === 'function' ? stored.toObject() : stored;
      activityEvents.emit('activity', {
        id: String(raw._id),
        endpoint: raw.endpoint,
        method: raw.method,
        status_code: raw.status_code,
        response_code: raw.response_code,
        success: raw.success,
        device_sn: raw.device_sn,
        request_body: raw.request_body,
        response_body: raw.response_body,
        duration_ms: raw.duration_ms,
        created_at: raw.created_at
      } satisfies ActivityEvent);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to persist API activity');
    }

    return payload;
  });
}
