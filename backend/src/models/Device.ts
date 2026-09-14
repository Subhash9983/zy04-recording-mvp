import mongoose, { Schema } from 'mongoose';

export interface IDevice {
  sn: string;
  product: string;
  model: string;
  version: string;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

const DeviceSchema = new Schema<IDevice>(
  {
    sn: { type: String, required: true, unique: true, index: true },
    product: { type: String, required: true },
    model: { type: String, required: true, index: true },
    version: { type: String, required: true },
    last_seen_at: { type: Date, required: true, index: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

export const Device = mongoose.model<IDevice>('Device', DeviceSchema);
