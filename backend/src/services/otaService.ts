import { Device } from '../models/Device.js';
import { Firmware, FirmwareUpdateType, IFirmware } from '../models/Firmware.js';

const SUPPORTED_FIRMWARE_TYPES = new Set(['esp', 'dsp']);

interface OtaRequestItemBody {
  firmware_type?: unknown;
  firmware_version?: unknown;
}

interface OtaRequestBody {
  sn?: unknown;
  device_model?: unknown;
  fetch_firmware?: unknown;
}

export interface CurrentFirmware {
  firmware_type: string;
  firmware_version: string;
}

export interface ValidOtaRequest {
  sn: string;
  deviceModel: string;
  currentFirmware: CurrentFirmware[];
}

export interface LatestFirmware {
  firmware_version: string;
  firmware_type: string;
  url: string;
  md5: string;
  update_type: FirmwareUpdateType;
}

export class OtaRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtaRequestValidationError';
  }
}

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OtaRequestValidationError(`${name} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) throw new OtaRequestValidationError(`${name} is too long`);
  if (/[^\x20-\x7e]/.test(normalized)) {
    throw new OtaRequestValidationError(`${name} contains unsupported characters`);
  }
  return normalized;
}

export function validateOtaRequest(body: unknown): ValidOtaRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new OtaRequestValidationError('JSON request body is required');
  }
  const candidate = body as OtaRequestBody;
  const sn = requiredText(candidate.sn, 'sn', 128);
  const deviceModel = requiredText(candidate.device_model, 'device_model', 128);
  if (!Array.isArray(candidate.fetch_firmware)) {
    throw new OtaRequestValidationError('fetch_firmware must be an array');
  }
  if (candidate.fetch_firmware.length > 32) {
    throw new OtaRequestValidationError('fetch_firmware contains too many items');
  }

  const currentFirmware = candidate.fetch_firmware.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new OtaRequestValidationError(`fetch_firmware[${index}] must be an object`);
    }
    const firmware = item as OtaRequestItemBody;
    const firmwareType = requiredText(
      firmware.firmware_type,
      `fetch_firmware[${index}].firmware_type`,
      32
    ).toLowerCase();
    const firmwareVersion = requiredText(
      firmware.firmware_version,
      `fetch_firmware[${index}].firmware_version`,
      64
    );
    if (!/^[a-zA-Z0-9._+-]+$/.test(firmwareVersion)) {
      throw new OtaRequestValidationError(`fetch_firmware[${index}].firmware_version is invalid`);
    }
    return { firmware_type: firmwareType, firmware_version: firmwareVersion };
  });

  return { sn, deviceModel, currentFirmware };
}

function compareNumericText(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '');
  const normalizedRight = right.replace(/^0+(?=\d)/, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  }
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/** Compare dotted supplier versions without converting large segments to unsafe numbers. */
export function compareFirmwareVersions(left: string, right: string): number {
  const leftParts = left.split(/[._+-]/);
  const rightParts = right.split(/[._+-]/);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || '0';
    const rightPart = rightParts[index] || '0';
    const comparison = /^\d+$/.test(leftPart) && /^\d+$/.test(rightPart)
      ? compareNumericText(leftPart, rightPart)
      : leftPart.toLowerCase().localeCompare(rightPart.toLowerCase());
    if (comparison !== 0) return comparison > 0 ? 1 : -1;
  }
  return 0;
}

function isSafeCandidate(candidate: IFirmware): boolean {
  return candidate.enabled === true &&
    isHttpUrl(candidate.url) &&
    /^[a-fA-F0-9]{32}$/.test(candidate.md5) &&
    (candidate.update_type === 'force' || candidate.update_type === 'default');
}

function newestCreated(left: IFirmware, right: IFirmware): IFirmware {
  return left.created_at >= right.created_at ? left : right;
}

export function selectLatestFirmware(
  currentFirmware: CurrentFirmware[],
  candidates: IFirmware[]
): LatestFirmware[] {
  const selected: LatestFirmware[] = [];
  const handledTypes = new Set<string>();

  for (const current of currentFirmware) {
    const type = current.firmware_type.toLowerCase();
    if (!SUPPORTED_FIRMWARE_TYPES.has(type) || handledTypes.has(type)) continue;
    handledTypes.add(type);

    const matching = candidates.filter((candidate) =>
      candidate.firmware_type.toLowerCase() === type && isSafeCandidate(candidate)
    );
    const forced = matching.filter((candidate) => candidate.update_type === 'force');
    let chosen: IFirmware | undefined;

    if (forced.length) {
      chosen = forced.reduce(newestCreated);
    } else {
      const upgrades = matching.filter((candidate) =>
        compareFirmwareVersions(candidate.firmware_version, current.firmware_version) > 0
      );
      chosen = upgrades.reduce<IFirmware | undefined>((best, candidate) => {
        if (!best) return candidate;
        const versionComparison = compareFirmwareVersions(candidate.firmware_version, best.firmware_version);
        return versionComparison > 0 ||
          (versionComparison === 0 && candidate.created_at > best.created_at)
          ? candidate
          : best;
      }, undefined);
    }

    if (chosen) {
      selected.push({
        firmware_version: chosen.firmware_version,
        firmware_type: chosen.firmware_type,
        url: chosen.url,
        md5: chosen.md5,
        update_type: chosen.update_type
      });
    }
  }

  return selected;
}

export class OtaService {
  public async fetch(input: ValidOtaRequest): Promise<LatestFirmware[]> {
    const now = new Date();
    const supportedCurrent = input.currentFirmware.filter((item) =>
      SUPPORTED_FIRMWARE_TYPES.has(item.firmware_type)
    );

    await Device.findOneAndUpdate(
      { sn: input.sn },
      {
        $set: {
          model: input.deviceModel,
          last_seen_at: now,
          updated_at: now
        },
        $setOnInsert: {
          product: input.deviceModel,
          version: supportedCurrent[0]?.firmware_version || 'UNKNOWN',
          created_at: now
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!supportedCurrent.length) return [];
    const requestedTypes = [...new Set(supportedCurrent.map((item) => item.firmware_type))];
    const candidates = await Firmware.find({
      device_model: input.deviceModel,
      firmware_type: { $in: requestedTypes },
      enabled: true
    }).lean();

    return selectLatestFirmware(input.currentFirmware, candidates as IFirmware[]);
  }
}

export const otaService = new OtaService();
