import mongoose, { Schema } from 'mongoose';

export interface IApiActivity {
  endpoint: string;
  method: string;
  status_code: number;
  response_code?: string | number | null;
  success: boolean;
  device_sn?: string | null;
  request_body: unknown;
  response_body: unknown;
  duration_ms: number;
  created_at: Date;
}

const ApiActivitySchema = new Schema<IApiActivity>(
  {
    endpoint: { type: String, required: true, maxlength: 256, index: true },
    method: { type: String, required: true, maxlength: 16 },
    status_code: { type: Number, required: true, min: 100, max: 599 },
    response_code: { type: Schema.Types.Mixed, default: null },
    success: { type: Boolean, required: true, index: true },
    device_sn: { type: String, maxlength: 128, default: null, index: true },
    request_body: { type: Schema.Types.Mixed, default: null },
    response_body: { type: Schema.Types.Mixed, default: null },
    duration_ms: { type: Number, required: true, min: 0 },
    created_at: { type: Date, default: Date.now, required: true }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

ApiActivitySchema.index(
  { created_at: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'api_activity_30_day_ttl' }
);
ApiActivitySchema.index(
  { device_sn: 1, created_at: -1 },
  { name: 'api_activity_device_timeline' }
);

export const ApiActivity = mongoose.model<IApiActivity>('ApiActivity', ApiActivitySchema);
