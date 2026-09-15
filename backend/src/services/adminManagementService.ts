import crypto from 'crypto';
import { Device } from '../models/Device.js';
import { DeviceConfig } from '../models/DeviceConfig.js';
import { Firmware, FirmwareUpdateType } from '../models/Firmware.js';
import { compareFirmwareVersions } from './otaService.js';

export class AdminManagementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminManagementValidationError';
  }
}

type Settings = Record<string, unknown>;

const BINARY_KEYS = new Set([
  'record_mode', 'duor', 'no_switch', 's3_callback', 'snapshot_status', 'disable_tls'
]);
const INTEGER_RANGES: Record<string, [number, number]> = {
  record_mode: [0, 1],
  record_time: [600, 7200],
  record_ignore_time: [0, 600],
  retry_delay: [0, 86_400],
  duor: [0, 1],
  no_switch: [0, 1],
  s3_callback: [0, 1],
  snapshot_status: [0, 1],
  disable_tls: [0, 1]
};
const STRING_LIMITS: Record<string, number> = {
  domain: 255,
  domain_apm: 255,
  domain_config: 255,
  s3_config: 2_048,
  tz: 128,
  compress: 16,
  http_proxy: 2_048,
  extra_headers: 8_192,
  modem_apn: 128,
  preferred_network: 32
};

export const DOCUMENTED_CONFIG_KEYS = new Set([
  ...Object.keys(INTEGER_RANGES),
  ...Object.keys(STRING_LIMITS)
]);

function objectValue(value: unknown, name: string): Settings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AdminManagementValidationError(`${name} must be an object`);
  }
  return value as Settings;
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminManagementValidationError(`${name} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum || /[^\x20-\x7e]/.test(normalized)) {
    throw new AdminManagementValidationError(`${name} is invalid`);
  }
  return normalized;
}

function assertOnlyKeys(candidate: Settings, allowed: Set<string>, name: string): void {
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) throw new AdminManagementValidationError(`${name}.${key} is not supported`);
  }
}

export function validateConfigValues(value: unknown, section: string): Settings {
  const candidate = objectValue(value, section);
  const result: Settings = {};
  for (const [key, raw] of Object.entries(candidate)) {
    if (!DOCUMENTED_CONFIG_KEYS.has(key)) {
      throw new AdminManagementValidationError(`Unsupported configuration key: ${key}`);
    }
    if (key in INTEGER_RANGES) {
      const [minimum, maximum] = INTEGER_RANGES[key];
      if (!Number.isInteger(raw) || (raw as number) < minimum || (raw as number) > maximum) {
        throw new AdminManagementValidationError(`${key} must be an integer from ${minimum} to ${maximum}`);
      }
      if (BINARY_KEYS.has(key) && raw !== 0 && raw !== 1) {
        throw new AdminManagementValidationError(`${key} must be 0 or 1`);
      }
      result[key] = raw;
      continue;
    }
    if (typeof raw !== 'string' || raw.length > STRING_LIMITS[key] || /[\u0000\u007f]/.test(raw)) {
      throw new AdminManagementValidationError(`${key} must be a valid string`);
    }
    if (key === 'compress' && !['', 'lz4'].includes(raw.toLowerCase())) {
      throw new AdminManagementValidationError('compress must be empty or lz4');
    }
    if (key === 'preferred_network' && !['wifi', 'lte', 'only_wifi', 'only_lte'].includes(raw)) {
      throw new AdminManagementValidationError('preferred_network is invalid');
    }
    result[key] = key === 'compress' ? raw.toLowerCase() : raw;
  }
  return result;
}

export interface ValidCreateConfig {
  deviceSns: string[];
  values: Settings;
  settingKeys: string[];
}

export function validateCreateConfigBody(body: unknown): ValidCreateConfig {
  const candidate = objectValue(body, 'body');
  assertOnlyKeys(candidate, new Set(['device_sn', 'device_sns', 'common_settings', 'advanced_settings']), 'body');
  if (candidate.device_sn !== undefined && candidate.device_sns !== undefined) {
    throw new AdminManagementValidationError('Use device_sn or device_sns, not both');
  }
  const rawDevices = candidate.device_sns ?? (candidate.device_sn === undefined ? undefined : [candidate.device_sn]);
  if (!Array.isArray(rawDevices) || rawDevices.length === 0 || rawDevices.length > 500) {
    throw new AdminManagementValidationError('One to 500 device serial numbers are required');
  }
  const deviceSns = [...new Set(rawDevices.map((sn, index) => text(sn, `device_sns[${index}]`, 128)))];
  const common = validateConfigValues(candidate.common_settings ?? {}, 'common_settings');
  const advanced = validateConfigValues(candidate.advanced_settings ?? {}, 'advanced_settings');
  const duplicates = Object.keys(common).filter((key) => Object.prototype.hasOwnProperty.call(advanced, key));
  if (duplicates.length) throw new AdminManagementValidationError(`Duplicate configuration key: ${duplicates[0]}`);
  const values = { ...common, ...advanced };
  const settingKeys = Object.keys(values).sort();
  if (!settingKeys.length) throw new AdminManagementValidationError('At least one configuration setting is required');
  return { deviceSns, values, settingKeys };
}

const FIRMWARE_CREATE_KEYS = new Set([
  'device_model', 'device_models', 'firmware_type', 'firmware_version', 'url', 'md5',
  'update_type', 'enabled', 'confirm_force_or_downgrade'
]);
const FIRMWARE_UPDATE_KEYS = new Set([
  'device_model', 'firmware_type', 'firmware_version', 'url', 'md5', 'update_type',
  'enabled', 'confirm_force_or_downgrade'
]);

function firmwareVersion(value: unknown): string {
  const normalized = text(value, 'firmware_version', 64);
  if (!/^[a-zA-Z0-9._+-]+$/.test(normalized)) {
    throw new AdminManagementValidationError('firmware_version is invalid');
  }
  return normalized;
}

function firmwareUrl(value: unknown): string {
  const normalized = text(value, 'url', 2_048);
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
  } catch {
    throw new AdminManagementValidationError('url must be a valid HTTP(S) URL');
  }
  return normalized;
}

function firmwareType(value: unknown): string {
  const normalized = text(value, 'firmware_type', 32).toLowerCase();
  if (!['esp', 'dsp'].includes(normalized)) {
    throw new AdminManagementValidationError('firmware_type must be esp or dsp');
  }
  return normalized;
}

function md5(value: unknown): string {
  const normalized = text(value, 'md5', 32).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) throw new AdminManagementValidationError('md5 must contain 32 hexadecimal characters');
  return normalized;
}

function updateType(value: unknown): FirmwareUpdateType {
  const normalized = value === undefined ? 'default' : text(value, 'update_type', 16).toLowerCase();
  if (normalized !== 'default' && normalized !== 'force') {
    throw new AdminManagementValidationError('update_type must be default or force');
  }
  return normalized;
}

function explicitConfirmation(candidate: Settings): boolean {
  return candidate.confirm_force_or_downgrade === true;
}

export interface ValidCreateFirmware {
  deviceModels: string[];
  firmwareType: string;
  firmwareVersion: string;
  url: string;
  md5: string;
  updateType: FirmwareUpdateType;
  enabled: boolean;
  confirmed: boolean;
}

export function validateCreateFirmwareBody(body: unknown): ValidCreateFirmware {
  const candidate = objectValue(body, 'body');
  assertOnlyKeys(candidate, FIRMWARE_CREATE_KEYS, 'body');
  if (candidate.confirm_force_or_downgrade !== undefined &&
      typeof candidate.confirm_force_or_downgrade !== 'boolean') {
    throw new AdminManagementValidationError('confirm_force_or_downgrade must be boolean');
  }
  if (candidate.device_model !== undefined && candidate.device_models !== undefined) {
    throw new AdminManagementValidationError('Use device_model or device_models, not both');
  }
  const rawModels = candidate.device_models ?? (candidate.device_model === undefined ? undefined : [candidate.device_model]);
  if (!Array.isArray(rawModels) || rawModels.length === 0 || rawModels.length > 100) {
    throw new AdminManagementValidationError('One to 100 device models are required');
  }
  const deviceModels = [...new Set(rawModels.map((model, index) => text(model, `device_models[${index}]`, 128)))];
  const type = updateType(candidate.update_type);
  const confirmed = explicitConfirmation(candidate);
  if (type === 'force' && !confirmed) {
    throw new AdminManagementValidationError('Force/downgrade firmware requires explicit confirmation');
  }
  if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') {
    throw new AdminManagementValidationError('enabled must be boolean');
  }
  return {
    deviceModels,
    firmwareType: firmwareType(candidate.firmware_type),
    firmwareVersion: firmwareVersion(candidate.firmware_version),
    url: firmwareUrl(candidate.url),
    md5: md5(candidate.md5),
    updateType: type,
    enabled: candidate.enabled === undefined ? true : candidate.enabled,
    confirmed
  };
}

export interface ValidFirmwareUpdate {
  values: Settings;
  confirmed: boolean;
}

export function validateFirmwareUpdateBody(body: unknown): ValidFirmwareUpdate {
  const candidate = objectValue(body, 'body');
  assertOnlyKeys(candidate, FIRMWARE_UPDATE_KEYS, 'body');
  if (candidate.confirm_force_or_downgrade !== undefined &&
      typeof candidate.confirm_force_or_downgrade !== 'boolean') {
    throw new AdminManagementValidationError('confirm_force_or_downgrade must be boolean');
  }
  const values: Settings = {};
  if (candidate.device_model !== undefined) values.device_model = text(candidate.device_model, 'device_model', 128);
  if (candidate.firmware_type !== undefined) values.firmware_type = firmwareType(candidate.firmware_type);
  if (candidate.firmware_version !== undefined) values.firmware_version = firmwareVersion(candidate.firmware_version);
  if (candidate.url !== undefined) values.url = firmwareUrl(candidate.url);
  if (candidate.md5 !== undefined) values.md5 = md5(candidate.md5);
  if (candidate.update_type !== undefined) values.update_type = updateType(candidate.update_type);
  if (candidate.enabled !== undefined) {
    if (typeof candidate.enabled !== 'boolean') throw new AdminManagementValidationError('enabled must be boolean');
    values.enabled = candidate.enabled;
  }
  if (!Object.keys(values).length) throw new AdminManagementValidationError('At least one firmware field is required');
  return { values, confirmed: explicitConfirmation(candidate) };
}

export function requiresFirmwareConfirmation(
  currentVersion: string,
  currentUpdateType: FirmwareUpdateType,
  update: ValidFirmwareUpdate
): boolean {
  const nextType = (update.values.update_type as FirmwareUpdateType | undefined) ?? currentUpdateType;
  const nextVersion = update.values.firmware_version as string | undefined;
  return nextType === 'force' || Boolean(nextVersion && compareFirmwareVersions(nextVersion, currentVersion) < 0);
}

export class AdminManagementService {
  public async createConfigs(input: ValidCreateConfig) {
    const devices = await Device.find({ sn: { $in: input.deviceSns } }).select('sn model product').lean();
    const found = new Map(devices.map((device) => [device.sn, device]));
    const missing = input.deviceSns.filter((sn) => !found.has(sn));
    if (missing.length) throw new AdminManagementValidationError(`Unknown device serial number: ${missing[0]}`);
    const now = new Date();
    const documents = input.deviceSns.map((sn) => {
      const device = found.get(sn)!;
      return {
        session_id: `cfg_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`,
        device_sn: sn,
        device_model: device.model || device.product,
        values: input.values,
        status: 'PENDING',
        delivery_attempts: 0,
        created_at: now,
        updated_at: now
      };
    });
    const created = await DeviceConfig.insertMany(documents, { ordered: true });
    return created.map((config) => ({
      id: String(config._id),
      session_id: config.session_id,
      device_sn: config.device_sn,
      device_model: config.device_model,
      status: config.status,
      created_at: config.created_at
    }));
  }

  public async createFirmware(input: ValidCreateFirmware) {
    const now = new Date();
    const created = await Firmware.insertMany(input.deviceModels.map((deviceModel) => ({
      device_model: deviceModel,
      firmware_type: input.firmwareType,
      firmware_version: input.firmwareVersion,
      url: input.url,
      md5: input.md5,
      update_type: input.updateType,
      enabled: input.enabled,
      created_at: now,
      updated_at: now
    })), { ordered: true });
    return created;
  }
}

export const adminManagementService = new AdminManagementService();
