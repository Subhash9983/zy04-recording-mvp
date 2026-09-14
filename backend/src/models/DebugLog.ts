import mongoose, { Schema } from 'mongoose';

export type DebugLogStorageMode = 'R2' | 'LOCAL';

export interface IDebugLog {
  sn: string;
  ts: string;
  file_name: string;
  size: number;
  object_key?: string | null;
  local_path?: string | null;
  storage_mode: DebugLogStorageMode;
  uploaded_at: Date;
  deleted_at?: Date | null;
}

const DebugLogSchema = new Schema<IDebugLog>(
  {
    sn: { type: String, required: true, index: true },
    ts: { type: String, required: true },
    file_name: { type: String, required: true, maxlength: 180 },
    size: { type: Number, required: true, min: 1 },
    object_key: { type: String, default: null },
    local_path: { type: String, default: null },
    storage_mode: { type: String, enum: ['R2', 'LOCAL'], required: true },
    uploaded_at: { type: Date, default: Date.now, index: true },
    deleted_at: { type: Date, default: null }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

DebugLogSchema.index(
  { sn: 1, ts: 1, file_name: 1 },
  { unique: true, name: 'debug_log_identity_unique' }
);
DebugLogSchema.index(
  { sn: 1, uploaded_at: -1 },
  { name: 'debug_log_timeline' }
);

export const DebugLog = mongoose.model<IDebugLog>('DebugLog', DebugLogSchema);
