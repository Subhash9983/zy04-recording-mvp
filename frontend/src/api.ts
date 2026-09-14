import {
  AdminUser,
  ApiActivity,
  DebugLog,
  DeviceAlert,
  DeviceDetailData,
  DeviceItem,
  DeviceLog,
  CreateConfigInput,
  FirmwareInput,
  FirmwareItem,
  OverviewData,
  Paginated,
  RecordingItem
} from './types';

const API_BASE = (((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_URL) || '')
  .replace(/\/$/, '');

interface ApiEnvelope<T> {
  code: number;
  data: T;
  msg?: string;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    }
  });
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = await response.json() as ApiEnvelope<T>;
  } catch {
    // Preserve a safe generic error when a proxy returns a non-JSON response.
  }
  if (!response.ok || !payload || payload.code !== 0) {
    if (response.status === 401) window.dispatchEvent(new Event('admin-unauthorized'));
    throw new ApiError(response.status, payload?.msg || `Request failed (${response.status})`);
  }
  return payload.data;
}

export function login(email: string, password: string): Promise<AdminUser> {
  return request('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

export function getCurrentAdmin(): Promise<AdminUser> {
  return request('/api/admin/auth/me');
}

export async function logout(): Promise<void> {
  await request<undefined>('/api/admin/auth/logout', { method: 'POST' });
}

export function getOverview(): Promise<OverviewData> {
  return request('/api/admin/overview');
}

export function getDevices(limit = 100): Promise<Paginated<DeviceItem>> {
  return request(`/api/admin/devices?limit=${limit}`);
}

export function getDevice(sn: string): Promise<DeviceDetailData> {
  return request(`/api/admin/devices/${encodeURIComponent(sn)}`);
}

export function getDeviceActivity(sn: string): Promise<Paginated<ApiActivity>> {
  return request(`/api/admin/devices/${encodeURIComponent(sn)}/activity?limit=100`);
}

export function getAlerts(status?: 'ACTIVE' | 'RESOLVED'): Promise<Paginated<DeviceAlert>> {
  const query = status ? `?limit=100&status=${status}` : '?limit=100';
  return request(`/api/admin/alerts${query}`);
}

export function getAdminRecordings(sn?: string, page = 1): Promise<Paginated<RecordingItem>> {
  const query = new URLSearchParams({ limit: '100', page: String(page) });
  if (sn) query.set('sn', sn);
  return request(`/api/admin/recordings?${query}`);
}

export async function getAllAdminRecordings(): Promise<RecordingItem[]> {
  const first = await getAdminRecordings();
  if (first.pagination.pages <= 1) return first.items;
  const remaining = await Promise.all(
    Array.from({ length: first.pagination.pages - 1 }, (_, index) => getAdminRecordings(undefined, index + 2))
  );
  return [first, ...remaining].flatMap((page) => page.items);
}

export function getStatusLogs(): Promise<Paginated<DeviceLog>> {
  return request('/api/admin/logs/status?limit=100');
}

export function getReportLogs(): Promise<Paginated<DeviceLog>> {
  return request('/api/admin/logs/report?limit=100');
}

export function getDebugLogs(): Promise<Paginated<DebugLog>> {
  return request('/api/admin/logs/debug?limit=100');
}

export function createConfigs(input: CreateConfigInput): Promise<{ created: Array<{ id: string; device_sn: string; session_id: string }> }> {
  return request('/api/admin/configs', { method: 'POST', body: JSON.stringify(input) });
}

export function getFirmware(): Promise<Paginated<FirmwareItem>> {
  return request('/api/admin/firmware?limit=100');
}

export function createFirmware(input: FirmwareInput): Promise<{ created: FirmwareItem[] }> {
  return request('/api/admin/firmware', { method: 'POST', body: JSON.stringify(input) });
}

export function updateFirmware(id: string, input: Partial<FirmwareInput>): Promise<FirmwareItem> {
  return request(`/api/admin/firmware/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function disableFirmware(id: string): Promise<{ id: string; enabled: false }> {
  return request(`/api/admin/firmware/${encodeURIComponent(id)}/disable`, { method: 'POST' });
}

export function retryRecording(id: string): Promise<{ record_id: string; status: string }> {
  return request(`/api/admin/recordings/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export function softDeleteDebugLog(id: string): Promise<{ id: string; deleted_at: string }> {
  return request(`/api/admin/logs/debug/${encodeURIComponent(id)}/delete`, { method: 'POST' });
}

async function download(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('admin-unauthorized'));
    let message = `Download failed (${response.status})`;
    try {
      const error = await response.json() as { msg?: string };
      if (error.msg) message = error.msg;
    } catch { /* keep generic message */ }
    throw new ApiError(response.status, message);
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fallbackName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
}

export function downloadRecordingWav(id: string): Promise<void> {
  return download(`/api/admin/recordings/${encodeURIComponent(id)}/wav`, `${id}.wav`);
}

export function downloadRecordingOriginal(id: string, fileName: string): Promise<void> {
  return download(`/api/admin/recordings/${encodeURIComponent(id)}/original`, fileName || `${id}.opus`);
}

export function downloadDebugLog(id: string, fileName: string): Promise<void> {
  return download(`/api/admin/logs/debug/${encodeURIComponent(id)}/download`, fileName || 'debug.log');
}

export function activityStreamUrl(): string {
  return `${API_BASE}/api/admin/activity/stream`;
}

// Kept for the legacy recording components; admin screens never receive filesystem paths.
export async function fetchRecordings(): Promise<RecordingItem[]> {
  const response = await fetch(`${API_BASE}/api/recordings`);
  if (!response.ok) throw new Error(`Failed to fetch recordings: ${response.statusText}`);
  const json = await response.json();
  return json.data || [];
}

export function getAudioUrl(recordId: string): string {
  return `${API_BASE}/api/recordings/${encodeURIComponent(recordId)}/audio`;
}
