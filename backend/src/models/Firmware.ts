import mongoose, { Schema } from 'mongoose';

export type FirmwareUpdateType = 'force' | 'default';

export interface IFirmware {
  device_model: string;
  firmware_type: string;
  firmware_version: string;
  url: string;
  md5: string;
  update_type: FirmwareUpdateType;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

const FirmwareSchema = new Schema<IFirmware>(
  {
    device_model: { type: String, required: true, maxlength: 128, index: true },
    firmware_type: { type: String, required: true, maxlength: 32, lowercase: true, index: true },
    firmware_version: { type: String, required: true, maxlength: 64 },
    url: {
      type: String,
      required: true,
      maxlength: 2048,
      validate: {
        validator: isHttpUrl,
        message: 'Firmware URL must use HTTP or HTTPS'
      }
    },
    md5: {
      type: String,
      required: true,
      match: /^[a-fA-F0-9]{32}$/
    },
    update_type: {
      type: String,
      enum: ['force', 'default'],
      default: 'default',
      required: true
    },
    enabled: { type: Boolean, default: true, required: true, index: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

FirmwareSchema.index(
  { device_model: 1, firmware_type: 1, enabled: 1, created_at: -1 },
  { name: 'firmware_fetch_candidates' }
);
FirmwareSchema.index(
  { device_model: 1, firmware_type: 1, firmware_version: 1 },
  { unique: true, name: 'firmware_version_unique' }
);

export const Firmware = mongoose.model<IFirmware>('Firmware', FirmwareSchema);
