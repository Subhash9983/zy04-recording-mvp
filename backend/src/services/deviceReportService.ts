import { Device } from '../models/Device.js';
import { DeviceAlert, DeviceAlertType } from '../models/DeviceAlert.js';
import { DeviceLog, DeviceLogType } from '../models/DeviceLog.js';

const MAX_RAW_LOG_BYTES = 1_000_000;

type JsonObject = Record<string, unknown>;

export interface ParsedReportInfo {
  product: string;
  sn: string;
  espVersion: string;
  dspVersion: string;
  logType: DeviceLogType;
  rawPayload: string;
  parsed: JsonObject;
  health: JsonObject;
  alerts: AlertObservation[];
}

export interface AlertObservation {
  type: DeviceAlertType;
  active: boolean;
  details: JsonObject;
}

export class ReportInfoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportInfoValidationError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ReportInfoValidationError(`${name} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) throw new ReportInfoValidationError(`${name} is too long`);
  if (/[^\x20-\x7e]/.test(normalized)) {
    throw new ReportInfoValidationError(`${name} contains unsupported characters`);
  }
  return normalized;
}

function finiteNumber(value: unknown, minimum?: number, maximum?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (minimum !== undefined && value < minimum) return undefined;
  if (maximum !== undefined && value > maximum) return undefined;
  return value;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[^\x20-\x7e]/.test(normalized)) return undefined;
  return normalized;
}

function assignDefined(target: JsonObject, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function parseStatusLog(devInfo: JsonObject): {
  parsed: JsonObject;
  health: JsonObject;
  alerts: AlertObservation[];
} {
  const status = asObject(devInfo.status);
  if (!status) throw new ReportInfoValidationError('dev_info.status must be an object');

  const health: JsonObject = {};
  const power = finiteNumber(status.power, 0, 100);
  const storageTotal = finiteNumber(status.storage_space, 0);
  const storageFree = finiteNumber(status.free_space, 0);
  const storageUsed = finiteNumber(status.used_space, 0);
  const debugCount = finiteNumber(status.debug_count, 0);
  const reportCount = finiteNumber(status.report_count, 0);
  const wifi = asObject(status.wifi);
  const hub = asObject(status.hub);
  const current = typeof status.current === 'string'
    ? optionalText(status.current, 64)
    : finiteNumber(status.current);

  assignDefined(health, 'power', power);
  assignDefined(health, 'current_status', current);
  assignDefined(health, 'storage_total', storageTotal);
  assignDefined(health, 'storage_free', storageFree);
  assignDefined(health, 'storage_used', storageUsed);
  assignDefined(health, 'wifi_ssid', optionalText(wifi?.ssid, 128));
  assignDefined(health, 'wifi_rssi', finiteNumber(wifi?.rssi));
  assignDefined(health, 'local_file_count', Array.isArray(devInfo.local_files) ? devInfo.local_files.length : undefined);
  assignDefined(health, 'debug_count', debugCount);
  assignDefined(health, 'report_count', reportCount);
  assignDefined(health, 'hub_sn', optionalText(hub?.sn, 128));

  const alerts: AlertObservation[] = [];
  if (power !== undefined) {
    alerts.push({ type: 'LOW_BATTERY', active: power <= 20, details: { power } });
  }
  if (storageTotal !== undefined && storageTotal > 0 && storageFree !== undefined) {
    alerts.push({
      type: 'STORAGE_ALMOST_FULL',
      active: storageFree <= storageTotal * 0.1,
      details: {
        storage_total: storageTotal,
        storage_free: storageFree,
        free_ratio: storageFree / storageTotal
      }
    });
  }

  return { parsed: { ...health }, health, alerts };
}

function parseReportLog(devInfo: JsonObject): {
  parsed: JsonObject;
  health: JsonObject;
  alerts: AlertObservation[];
} {
  const parsed: JsonObject = {};
  const countArray = (key: string, outputKey: string): unknown[] | undefined => {
    const value = devInfo[key];
    if (!Array.isArray(value)) return undefined;
    parsed[outputKey] = value.length;
    return value;
  };

  countArray('wifi_history', 'wifi_history_count');
  countArray('audio_list', 'audio_file_count');
  countArray('ble_history', 'ble_history_count');
  const uploadHistory = countArray('upload_history', 'upload_history_count');
  const alerts: AlertObservation[] = [];

  if (uploadHistory) {
    const results = uploadHistory
      .map((entry) => optionalText(asObject(entry)?.result, 32)?.toLowerCase())
      .filter((result): result is string => Boolean(result));
    const failures = results.filter((result) => result === 'fail').length;
    parsed.upload_failure_count = failures;
    if (results.length) parsed.last_upload_result = results[results.length - 1];

    if (failures > 0) {
      alerts.push({
        type: 'RECORDING_UPLOAD_FAILED',
        active: true,
        details: { failure_count: failures, upload_count: uploadHistory.length }
      });
    } else if (results.some((result) => result === 'success' || result === 'ok')) {
      alerts.push({
        type: 'RECORDING_UPLOAD_FAILED',
        active: false,
        details: { upload_count: uploadHistory.length }
      });
    }
  }

  return { parsed, health: {}, alerts };
}

export function parseReportInfo(body: unknown): ParsedReportInfo {
  const root = asObject(body);
  if (!root) throw new ReportInfoValidationError('JSON request body is required');
  const common = asObject(root.common);
  if (!common) throw new ReportInfoValidationError('common must be an object');
  const devInfo = asObject(root.dev_info);
  if (!devInfo) throw new ReportInfoValidationError('dev_info must be an object');

  const rawPayload = JSON.stringify(root);
  if (Buffer.byteLength(rawPayload, 'utf8') > MAX_RAW_LOG_BYTES) {
    throw new ReportInfoValidationError('Report payload is too large');
  }

  const product = requiredText(common.product, 'common.product', 128);
  const sn = requiredText(common.sn, 'common.sn', 128);
  const espVersion = requiredText(common.esp_version, 'common.esp_version', 128);
  const dspVersion = requiredText(common.dsp_version, 'common.dsp_version', 128);
  const isStatusLog = Object.prototype.hasOwnProperty.call(devInfo, 'status');
  const result = isStatusLog ? parseStatusLog(devInfo) : parseReportLog(devInfo);

  return {
    product,
    sn,
    espVersion,
    dspVersion,
    logType: isStatusLog ? 'STATUS' : 'REPORT',
    rawPayload,
    parsed: result.parsed,
    health: result.health,
    alerts: result.alerts
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export class DeviceReportService {
  private async activateAlert(
    deviceSn: string,
    observation: AlertObservation,
    now: Date
  ): Promise<void> {
    const filter = { device_sn: deviceSn, type: observation.type, status: 'ACTIVE' };
    const update = {
      $set: {
        details: observation.details,
        last_observed_at: now,
        updated_at: now
      },
      $setOnInsert: {
        opened_at: now,
        created_at: now,
        resolved_at: null
      }
    };
    try {
      await DeviceAlert.findOneAndUpdate(filter, update, { upsert: true, new: true });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      await DeviceAlert.updateOne(filter, update);
    }
  }

  private async applyAlert(deviceSn: string, observation: AlertObservation, now: Date): Promise<void> {
    if (observation.active) {
      await this.activateAlert(deviceSn, observation, now);
      return;
    }
    await DeviceAlert.updateMany(
      { device_sn: deviceSn, type: observation.type, status: 'ACTIVE' },
      {
        $set: {
          status: 'RESOLVED',
          details: observation.details,
          last_observed_at: now,
          resolved_at: now,
          updated_at: now
        }
      }
    );
  }

  public async ingest(input: ParsedReportInfo): Promise<void> {
    const now = new Date();
    const deviceUpdates: JsonObject = {
      product: input.product,
      model: input.product,
      esp_version: input.espVersion,
      dsp_version: input.dspVersion,
      last_seen_at: now,
      updated_at: now
    };
    if (input.logType === 'STATUS') {
      for (const [key, value] of Object.entries(input.health)) {
        deviceUpdates[`health.${key}`] = value;
      }
      deviceUpdates['health.updated_at'] = now;
    }

    await Device.findOneAndUpdate(
      { sn: input.sn },
      {
        $set: deviceUpdates,
        $setOnInsert: {
          version: input.espVersion,
          created_at: now
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await DeviceLog.create({
      device_sn: input.sn,
      product: input.product,
      esp_version: input.espVersion,
      dsp_version: input.dspVersion,
      log_type: input.logType,
      raw_payload: input.rawPayload,
      parsed: input.parsed,
      received_at: now
    });

    for (const observation of input.alerts) {
      await this.applyAlert(input.sn, observation, now);
    }
  }
}

export const deviceReportService = new DeviceReportService();
