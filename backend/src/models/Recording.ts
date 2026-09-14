import mongoose, { Document, Schema } from 'mongoose';

export type RecordingStatus =
  | 'RECEIVED'
  | 'WAITING_SLICES'
  | 'PROCESSING'
  | 'PENDING_LZ4_CONFIRMATION'
  | 'READY'
  | 'FAILED';

export interface IRecording extends Document {
  record_id: string;
  device_sn: string;
  esp_version?: string;
  dsp_version?: string;
  mac: string;
  session_id: string;
  file_name: string;
  serial: string;
  slice_number?: number;
  is_last_slice?: boolean;
  create_time: string;
  duration_ms: number;
  audio_type: string;
  channel: string;
  sample_rate: number;
  frame_size_ms: number;
  frame_rate: number;
  sig_type: string;
  compress?: string | null;
  original_file_path?: string | null;
  original_object_key?: string | null;
  decompressed_file_path?: string | null;
  wav_file_path?: string | null;
  wav_object_key?: string | null;
  status: RecordingStatus;
  missing_slices: number[];
  processing_error?: string | null;
  created_at: Date;
  updated_at: Date;
}

const RecordingSchema: Schema = new Schema<IRecording>(
  {
    record_id: { type: String, required: true, unique: true, index: true },
    device_sn: { type: String, required: true, index: true },
    esp_version: { type: String, default: '' },
    dsp_version: { type: String, default: '' },
    mac: { type: String, default: '' },
    session_id: { type: String, required: true, index: true },
    file_name: { type: String, default: '' },
    serial: { type: String, required: true },
    // Optional at schema level so existing production documents remain readable.
    slice_number: { type: Number, min: 1, max: 0xffff },
    is_last_slice: { type: Boolean },
    create_time: { type: String, default: '' },
    duration_ms: { type: Number, default: 0 },
    audio_type: { type: String, default: 'OPUS' },
    channel: { type: String, default: 'STEREO' },
    sample_rate: { type: Number, default: 16000 },
    frame_size_ms: { type: Number, default: 20 },
    frame_rate: { type: Number, default: 8 },
    sig_type: { type: String, default: '2' },
    compress: { type: String, default: null },
    original_file_path: { type: String, default: null },
    original_object_key: { type: String, default: null },
    decompressed_file_path: { type: String, default: null },
    wav_file_path: { type: String, default: null },
    wav_object_key: { type: String, default: null },
    status: {
      type: String,
      enum: [
        'RECEIVED',
        'WAITING_SLICES',
        'PROCESSING',
        'PENDING_LZ4_CONFIRMATION',
        'READY',
        'FAILED'
      ],
      default: 'RECEIVED',
      index: true
    },
    missing_slices: { type: [Number], default: [] },
    processing_error: { type: String, default: null },
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

// Legacy informational index is retained for compatibility.
RecordingSchema.index({ session_id: 1, serial: 1 });
RecordingSchema.index({ device_sn: 1, created_at: -1 });

// Only new parsed documents participate, so legacy duplicates cannot block startup.
RecordingSchema.index(
  { device_sn: 1, session_id: 1, serial: 1 },
  {
    unique: true,
    name: 'device_session_serial_unique',
    partialFilterExpression: { slice_number: { $exists: true } }
  }
);

export const Recording = mongoose.model<IRecording>('Recording', RecordingSchema);
