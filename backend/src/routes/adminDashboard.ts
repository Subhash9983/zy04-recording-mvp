import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ApiActivity } from '../models/ApiActivity.js';
import { AuditLog } from '../models/AuditLog.js';
import { DebugLog } from '../models/DebugLog.js';
import { Device } from '../models/Device.js';
import { DeviceAlert } from '../models/DeviceAlert.js';
import { DeviceConfig } from '../models/DeviceConfig.js';
import { DeviceLog } from '../models/DeviceLog.js';
import { Firmware } from '../models/Firmware.js';
import { Recording } from '../models/Recording.js';
import { requireAdmin } from '../services/adminAuthService.js';
import { ActivityEvent, subscribeToActivity } from '../services/apiActivityService.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

interface PaginationQuery {
  page?: string;
  limit?: string;
}

interface DeviceActivityQuery extends PaginationQuery {
  success?: string;
}

interface AlertQuery extends PaginationQuery {
  status?: string;
  sn?: string;
}

interface RecordingQuery extends PaginationQuery {
  sn?: string;
  status?: string;
}

interface FirmwareQuery extends PaginationQuery {
  device_model?: string;
  enabled?: string;
}

export interface ParsedPagination {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(query: PaginationQuery): ParsedPagination {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('page must be a positive integer');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  return { page, limit, skip: (page - 1) * limit };
}

function boundedFilter(value: unknown, maximum = 128): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[^\x20-\x7e]/.test(normalized)) {
    throw new Error('Invalid filter value');
  }
  return normalized;
}

function booleanFilter(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Boolean filter must be true or false');
}

function paginated(data: unknown[], total: number, pagination: ParsedPagination) {
  return {
    items: data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit)
    }
  };
}

function safeId(document: Record<string, unknown>): Record<string, unknown> {
  const { _id, __v: _version, ...rest } = document;
  return { id: String(_id), ...rest };
}

async function listQuery(
  model: { countDocuments: (filter: object) => { exec?: () => Promise<number> } | Promise<number> },
  filter: Record<string, unknown>,
  query: { lean: () => Promise<unknown[]> },
  pagination: ParsedPagination
) {
  const countResult = model.countDocuments(filter);
  const executable = countResult as { exec?: () => Promise<number> };
  const totalPromise: Promise<number> = typeof executable.exec === 'function'
    ? executable.exec()
    : Promise.resolve(countResult as Promise<number>);
  const [total, rows] = await Promise.all([totalPromise, query.lean()]);
  return paginated(
    rows.map((row) => safeId(row as Record<string, unknown>)),
    total,
    pagination
  );
}

function handleAdminError(request: FastifyRequest, error: unknown) {
  request.log.error(error);
  const invalid = error instanceof Error && (
    error.message.startsWith('page ') ||
    error.message.startsWith('limit ') ||
    error.message.startsWith('Invalid filter') ||
    error.message.startsWith('Boolean filter')
  );
  return {
    status: invalid ? 400 : 500,
    body: { code: invalid ? 400 : 500, msg: invalid ? error.message : 'Admin request failed' }
  };
}

export const adminDashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  fastify.get('/api/admin/activity/stream', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    reply.raw.write('event: ready\ndata: {"connected":true}\n\n');

    const sendActivity = (activity: ActivityEvent) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`id: ${activity.id}\nevent: activity\ndata: ${JSON.stringify(activity)}\n\n`);
      }
    };
    const unsubscribe = subscribeToActivity(sendActivity);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': keep-alive\n\n');
    }, 15_000);
    heartbeat.unref();

    request.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  fastify.get('/api/admin/overview', async (request, reply) => {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const [devices, alerts, recordings, recentActivity, failedActivity] = await Promise.all([
        Device.countDocuments({}),
        DeviceAlert.countDocuments({ status: 'ACTIVE' }),
        Recording.countDocuments({}),
        ApiActivity.countDocuments({ created_at: { $gte: since } }),
        ApiActivity.countDocuments({ created_at: { $gte: since }, success: false })
      ]);
      return reply.send({
        code: 0,
        data: {
          counts: {
            devices,
            alerts,
            recordings,
            recent_activity: recentActivity,
            failed_activity: failedActivity
          },
          activity_window_hours: 24,
          generated_at: new Date()
        }
      });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Querystring: PaginationQuery }>('/api/admin/devices', async (request, reply) => {
    try {
      const pagination = parsePagination(request.query);
      const data = await listQuery(
        Device,
        {},
        Device.find({}).select('-__v').sort({ last_seen_at: -1 }).skip(pagination.skip).limit(pagination.limit),
        pagination
      );
      return reply.send({ code: 0, data });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Params: { sn: string } }>('/api/admin/devices/:sn', async (request, reply) => {
    try {
      const sn = boundedFilter(request.params.sn);
      if (!sn) throw new Error('Invalid filter value');
      const [device, activeAlerts, configs, recordingCount, logCount] = await Promise.all([
        Device.findOne({ sn }).select('-__v').lean(),
        DeviceAlert.find({ device_sn: sn, status: 'ACTIVE' }).select('-__v').sort({ opened_at: -1 }).lean(),
        DeviceConfig.find({ device_sn: sn }).select('-__v').sort({ created_at: -1 }).limit(25).lean(),
        Recording.countDocuments({ device_sn: sn }),
        DeviceLog.countDocuments({ device_sn: sn })
      ]);
      if (!device) return reply.status(404).send({ code: 404, msg: 'Device not found' });
      return reply.send({
        code: 0,
        data: {
          device: safeId(device as unknown as Record<string, unknown>),
          active_alerts: activeAlerts.map((item) => safeId(item as unknown as Record<string, unknown>)),
          recent_configs: configs.map((item) => safeId(item as unknown as Record<string, unknown>)),
          counts: { recordings: recordingCount, logs: logCount }
        }
      });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Params: { sn: string }; Querystring: DeviceActivityQuery }>(
    '/api/admin/devices/:sn/activity',
    async (request, reply) => {
      try {
        const sn = boundedFilter(request.params.sn);
        if (!sn) throw new Error('Invalid filter value');
        const pagination = parsePagination(request.query);
        const success = booleanFilter(request.query.success);
        const filter: Record<string, unknown> = { device_sn: sn };
        if (success !== undefined) filter.success = success;
        const data = await listQuery(
          ApiActivity,
          filter,
          ApiActivity.find(filter).select('-__v').sort({ created_at: -1 }).skip(pagination.skip).limit(pagination.limit),
          pagination
        );
        return reply.send({ code: 0, data });
      } catch (error) {
        const response = handleAdminError(request, error);
        return reply.status(response.status).send(response.body);
      }
    }
  );

  fastify.get<{ Querystring: AlertQuery }>('/api/admin/alerts', async (request, reply) => {
    try {
      const pagination = parsePagination(request.query);
      const status = boundedFilter(request.query.status, 32)?.toUpperCase();
      if (status && !['ACTIVE', 'RESOLVED'].includes(status)) throw new Error('Invalid filter value');
      const sn = boundedFilter(request.query.sn);
      const filter: Record<string, unknown> = {};
      if (status) filter.status = status;
      if (sn) filter.device_sn = sn;
      const data = await listQuery(
        DeviceAlert,
        filter,
        DeviceAlert.find(filter).select('-__v').sort({ opened_at: -1 }).skip(pagination.skip).limit(pagination.limit),
        pagination
      );
      return reply.send({ code: 0, data });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Querystring: PaginationQuery }>('/api/admin/audit-logs', async (request, reply) => {
    try {
      const pagination = parsePagination(request.query);
      const data = await listQuery(
        AuditLog,
        {},
        AuditLog.find({}).select('-__v').sort({ created_at: -1 }).skip(pagination.skip).limit(pagination.limit),
        pagination
      );
      return reply.send({ code: 0, data });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Querystring: RecordingQuery }>('/api/admin/recordings', async (request, reply) => {
    try {
      const pagination = parsePagination(request.query);
      const sn = boundedFilter(request.query.sn);
      const status = boundedFilter(request.query.status, 64)?.toUpperCase();
      const filter: Record<string, unknown> = {};
      if (sn) filter.device_sn = sn;
      if (status) filter.status = status;
      const selection = [
        'record_id device_sn esp_version dsp_version session_id file_name serial slice_number',
        'is_last_slice create_time duration_ms audio_type channel sample_rate frame_size_ms',
        'frame_rate sig_type compress status missing_slices created_at updated_at'
      ].join(' ');
      const data = await listQuery(
        Recording,
        filter,
        Recording.find(filter).select(selection).sort({ created_at: -1 }).skip(pagination.skip).limit(pagination.limit),
        pagination
      );
      return reply.send({ code: 0, data });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  async function deviceLogs(request: FastifyRequest<{ Querystring: PaginationQuery }>, type: 'STATUS' | 'REPORT') {
    const pagination = parsePagination(request.query);
    const filter = { log_type: type };
    return listQuery(
      DeviceLog,
      filter,
      DeviceLog.find(filter).select('-__v').sort({ received_at: -1 }).skip(pagination.skip).limit(pagination.limit),
      pagination
    );
  }

  fastify.get<{ Querystring: PaginationQuery }>('/api/admin/logs/status', async (request, reply) => {
    try {
      return reply.send({ code: 0, data: await deviceLogs(request, 'STATUS') });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Querystring: PaginationQuery }>('/api/admin/logs/report', async (request, reply) => {
    try {
      return reply.send({ code: 0, data: await deviceLogs(request, 'REPORT') });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Querystring: PaginationQuery }>('/api/admin/logs/debug', async (request, reply) => {
    try {
      const pagination = parsePagination(request.query);
      const filter = { deleted_at: null };
      const data = await listQuery(
        DebugLog,
        filter,
        DebugLog.find(filter)
          .select('sn ts file_name size storage_mode uploaded_at deleted_at')
          .sort({ uploaded_at: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit),
        pagination
      );
      return reply.send({ code: 0, data });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });

  fastify.get<{ Querystring: FirmwareQuery }>('/api/admin/firmware', async (request, reply) => {
    try {
      const pagination = parsePagination(request.query);
      const model = boundedFilter(request.query.device_model);
      const enabled = booleanFilter(request.query.enabled);
      const filter: Record<string, unknown> = {};
      if (model) filter.device_model = model;
      if (enabled !== undefined) filter.enabled = enabled;
      const data = await listQuery(
        Firmware,
        filter,
        Firmware.find(filter).select('-__v').sort({ created_at: -1 }).skip(pagination.skip).limit(pagination.limit),
        pagination
      );
      return reply.send({ code: 0, data });
    } catch (error) {
      const response = handleAdminError(request, error);
      return reply.status(response.status).send(response.body);
    }
  });
};
