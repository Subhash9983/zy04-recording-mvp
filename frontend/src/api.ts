import { RecordingItem } from './types';

const API_BASE = (((import.meta as any).env?.VITE_API_URL as string) || '').replace(/\/$/, '');

export async function fetchRecordings(): Promise<RecordingItem[]> {
  const res = await fetch(`${API_BASE}/api/recordings`);
  if (!res.ok) {
    throw new Error(`Failed to fetch recordings: ${res.statusText}`);
  }
  const json = await res.json();
  return json.data || [];
}

export function getAudioUrl(recordId: string): string {
  return `${API_BASE}/api/recordings/${encodeURIComponent(recordId)}/audio`;
}
