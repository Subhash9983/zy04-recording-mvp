import mongoose, { Document, Schema } from 'mongoose';

export type DeviceConfigStatus = 'PENDING' | 'DELIVERED' | 'SUCCESS' | 'FAILED';

export interface IDeviceConfig extends Document {
  session_id: string | number;
  device_sn: string;
  device_model: string;
  values: Record<string, unknown>;
  status: DeviceConfigStatus;
  delivery_attempts: number;
  last_delivery_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const DeviceConfigSchema = new Schema<IDeviceConfig>(
  {
    session_id: { type: Schema.Types.Mixed, required: true },
    device_sn: { type: String, required: true, index: true },
    device_model: { type: String, required: true, index: true },
    values: { type: Schema.Types.Mixed, required: true, default: {} },
    status: {
      type: String,
      enum: ['PENDING', 'DELIVERED', 'SUCCESS', 'FAILED'],
      default: 'PENDING',
      required: true,
      index: true
    },
    delivery_attempts: { type: Number, default: 0, min: 0 },
    last_delivery_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

DeviceConfigSchema.index(
  { device_sn: 1, device_model: 1, status: 1, created_at: 1 },
  { name: 'device_config_delivery_queue' }
);
DeviceConfigSchema.index(
  { device_sn: 1, session_id: 1 },
  { unique: true, name: 'device_config_session_unique' }
);

export const DeviceConfig = mongoose.model<IDeviceConfig>('DeviceConfig', DeviceConfigSchema);
