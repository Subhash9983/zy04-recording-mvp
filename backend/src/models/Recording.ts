import mongoose, { Document, Schema } from 'mongoose';

export type RecordingStatus = 'RECEIVED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface IRecording extends Document {
  record_id: string;
  device_sn: string;
  mac: string;
  session_id: string;
  file_name: string;
  serial: string;
  create_time: string;
  duration_ms: number;
  audio_type: string;
  channel: string;
  sample_rate: number;
  frame_size_ms: number;
  frame_rate: number;
  sig_type: string;
  compress?: string | null;
  original_file_path: string;
  wav_file_path?: string | null;
  status: RecordingStatus;
  created_at: Date;
}

const RecordingSchema: Schema = new Schema<IRecording>(
  {
    record_id: { type: String, required: true, unique: true, index: true },
    device_sn: { type: String, required: true, index: true },
    mac: { type: String, default: '' },
    session_id: { type: String, required: true, index: true },
    file_name: { type: String, default: '' },
    serial: { type: String, required: true },
    create_time: { type: String, default: '' },
    duration_ms: { type: Number, default: 0 },
    audio_type: { type: String, default: 'OPUS' },
    channel: { type: String, default: 'STEREO' },
    sample_rate: { type: Number, default: 16000 },
    frame_size_ms: { type: Number, default: 20 },
    frame_rate: { type: Number, default: 8 },
    sig_type: { type: String, default: '2' },
    compress: { type: String, default: null },
    original_file_path: { type: String, required: true },
    wav_file_path: { type: String, default: null },
    status: {
      type: String,
      enum: ['RECEIVED', 'PROCESSING', 'READY', 'FAILED'],
      default: 'RECEIVED',
      index: true
    },
    created_at: { type: Date, default: Date.now, index: true }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

RecordingSchema.index({ session_id: 1, serial: 1 });
RecordingSchema.index({ device_sn: 1, created_at: -1 });

export const Recording = mongoose.model<IRecording>('Recording', RecordingSchema);
