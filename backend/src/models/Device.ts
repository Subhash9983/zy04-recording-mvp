import mongoose, { Schema } from 'mongoose';

export interface IDevice {
  sn: string;
  product: string;
  model: string;
  version: string;
  esp_version?: string;
  dsp_version?: string;
  health?: {
    power?: number;
    current_status?: string | number;
    storage_total?: number;
    storage_free?: number;
    storage_used?: number;
    wifi_ssid?: string;
    wifi_rssi?: number;
    local_file_count?: number;
    debug_count?: number;
    report_count?: number;
    hub_sn?: string;
    updated_at?: Date;
  };
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
    esp_version: { type: String, default: '' },
    dsp_version: { type: String, default: '' },
    health: {
      power: { type: Number, min: 0, max: 100 },
      current_status: { type: Schema.Types.Mixed },
      storage_total: { type: Number, min: 0 },
      storage_free: { type: Number, min: 0 },
      storage_used: { type: Number, min: 0 },
      wifi_ssid: { type: String },
      wifi_rssi: { type: Number },
      local_file_count: { type: Number, min: 0 },
      debug_count: { type: Number, min: 0 },
      report_count: { type: Number, min: 0 },
      hub_sn: { type: String },
      updated_at: { type: Date }
    },
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
