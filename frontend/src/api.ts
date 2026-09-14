import {
  AdminUser,
  ApiActivity,
  DebugLog,
  DeviceAlert,
  DeviceDetailData,
  DeviceItem,
  DeviceLog,
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

export function getAdminRecordings(sn?: string): Promise<Paginated<RecordingItem>> {
  const query = new URLSearchParams({ limit: '100' });
  if (sn) query.set('sn', sn);
  return request(`/api/admin/recordings?${query}`);
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
