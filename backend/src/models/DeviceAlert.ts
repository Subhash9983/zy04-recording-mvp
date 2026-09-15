import mongoose, { Schema } from 'mongoose';

export type DeviceAlertType = 'LOW_BATTERY' | 'STORAGE_ALMOST_FULL' | 'RECORDING_UPLOAD_FAILED';
export type DeviceAlertStatus = 'ACTIVE' | 'RESOLVED';

export interface IDeviceAlert {
  device_sn: string;
  type: DeviceAlertType;
  status: DeviceAlertStatus;
  details: Record<string, unknown>;
  opened_at: Date;
  last_observed_at: Date;
  resolved_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const DeviceAlertSchema = new Schema<IDeviceAlert>(
  {
    device_sn: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['LOW_BATTERY', 'STORAGE_ALMOST_FULL', 'RECORDING_UPLOAD_FAILED'],
      required: true,
      index: true
    },
    status: { type: String, enum: ['ACTIVE', 'RESOLVED'], required: true, index: true },
    details: { type: Schema.Types.Mixed, required: true, default: {} },
    opened_at: { type: Date, required: true },
    last_observed_at: { type: Date, required: true },
    resolved_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

DeviceAlertSchema.index(
  { device_sn: 1, type: 1 },
  {
    unique: true,
    name: 'device_active_alert_unique',
    partialFilterExpression: { status: 'ACTIVE' }
  }
);
DeviceAlertSchema.index(
  { device_sn: 1, opened_at: -1 },
  { name: 'device_alert_history' }
);

export const DeviceAlert = mongoose.model<IDeviceAlert>('DeviceAlert', DeviceAlertSchema);
