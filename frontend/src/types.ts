export type RecordingStatus = 'RECEIVED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface RecordingItem {
  record_id: string;
  device_sn: string;
  session_id: string;
  file_name?: string;
  duration_ms: number;
  status: RecordingStatus;
  created_at: string;
  audio_type?: string;
  channel?: string;
  sample_rate?: number;
}
