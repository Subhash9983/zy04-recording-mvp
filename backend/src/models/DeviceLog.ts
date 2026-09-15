import mongoose, { Schema } from 'mongoose';

export type DeviceLogType = 'STATUS' | 'REPORT';

export interface IDeviceLog {
  device_sn: string;
  product: string;
  esp_version: string;
  dsp_version: string;
  log_type: DeviceLogType;
  raw_payload: string;
  parsed: Record<string, unknown>;
  received_at: Date;
}

const DeviceLogSchema = new Schema<IDeviceLog>(
  {
    device_sn: { type: String, required: true, index: true },
    product: { type: String, required: true },
    esp_version: { type: String, required: true },
    dsp_version: { type: String, required: true },
    log_type: { type: String, enum: ['STATUS', 'REPORT'], required: true, index: true },
    // Stored as bounded JSON text so supplier-controlled keys cannot become MongoDB operators/paths.
    raw_payload: { type: String, required: true, maxlength: 1_000_000 },
    parsed: { type: Schema.Types.Mixed, required: true, default: {} },
    received_at: { type: Date, default: Date.now, index: true }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

DeviceLogSchema.index(
  { device_sn: 1, received_at: -1 },
  { name: 'device_log_timeline' }
);

export const DeviceLog = mongoose.model<IDeviceLog>('DeviceLog', DeviceLogSchema);
