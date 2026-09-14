export interface AdminUser {
  id: string;
  email: string;
  expires_at: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface DeviceHealth {
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
  updated_at?: string;
}

export interface DeviceItem {
  id: string;
  sn: string;
  product: string;
  model: string;
  version: string;
  esp_version?: string;
  dsp_version?: string;
  health?: DeviceHealth;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceAlert {
  id: string;
  device_sn: string;
  type: 'LOW_BATTERY' | 'STORAGE_ALMOST_FULL' | 'RECORDING_UPLOAD_FAILED';
  status: 'ACTIVE' | 'RESOLVED';
  details: Record<string, unknown>;
  opened_at: string;
  last_observed_at: string;
  resolved_at?: string | null;
}

export interface ApiActivity {
  id: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_code?: string | number | null;
  success: boolean;
  device_sn?: string | null;
  request_body: unknown;
  response_body: unknown;
  duration_ms: number;
  created_at: string;
}

export type RecordingStatus =
  | 'RECEIVED'
  | 'WAITING_SLICES'
  | 'PROCESSING'
  | 'PENDING_LZ4_CONFIRMATION'
  | 'READY'
  | 'FAILED';

export interface RecordingItem {
  id?: string;
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
  serial?: string;
  slice_number?: number;
  compress?: string | null;
}

export interface FirmwareItem {
  id: string;
  device_model: string;
  firmware_type: 'esp' | 'dsp';
  firmware_version: string;
  url: string;
  md5: string;
  update_type: 'force' | 'default';
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type ConfigValue = string | number;

export interface CreateConfigInput {
  device_sns: string[];
  common_settings: Record<string, ConfigValue>;
  advanced_settings: Record<string, ConfigValue>;
}

export interface FirmwareInput {
  device_models?: string[];
  device_model?: string;
  firmware_type: 'esp' | 'dsp';
  firmware_version: string;
  url: string;
  md5: string;
  update_type: 'force' | 'default';
  enabled: boolean;
  confirm_force_or_downgrade: boolean;
}

export interface DeviceLog {
  id: string;
  device_sn: string;
  product: string;
  log_type: 'STATUS' | 'REPORT';
  raw_payload: string;
  parsed: Record<string, unknown>;
  received_at: string;
}

export interface DebugLog {
  id: string;
  sn: string;
  ts: string;
  file_name: string;
  size: number;
  storage_mode: 'R2' | 'LOCAL';
  uploaded_at: string;
}

export interface OverviewData {
  counts: {
    devices: number;
    alerts: number;
    recordings: number;
    recent_activity: number;
    failed_activity: number;
  };
  activity_window_hours: number;
  generated_at: string;
}

export interface DeviceDetailData {
  device: DeviceItem;
  active_alerts: DeviceAlert[];
  recent_configs: unknown[];
  counts: { recordings: number; logs: number };
}
