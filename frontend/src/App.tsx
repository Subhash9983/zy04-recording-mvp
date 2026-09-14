import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activityStreamUrl,
  ApiError,
  createConfigs,
  createFirmware,
  disableFirmware,
  downloadDebugLog,
  downloadRecordingOriginal,
  downloadRecordingWav,
  getAdminRecordings,
  getAlerts,
  getCurrentAdmin,
  getDebugLogs,
  getDevice,
  getDeviceActivity,
  getDevices,
  getFirmware,
  getOverview,
  getReportLogs,
  getStatusLogs,
  login,
  logout,
  retryRecording,
  softDeleteDebugLog,
  updateFirmware
} from './api';
import {
  AdminUser,
  ApiActivity,
  DebugLog,
  DeviceAlert,
  DeviceDetailData,
  DeviceItem,
  DeviceLog,
  FirmwareInput,
  FirmwareItem,
  OverviewData,
  RecordingItem
} from './types';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const ENDPOINTS = [
  '/sca/device/cloud_time',
  '/sca/device/config',
  '/sca/device/config_status',
  '/sca/device/reportinfo',
  '/sca/device/debug_log',
  '/sca/recordupload',
  '/ota/v1/fetch_new_firmware'
] as const;

function routeFromHash(): string {
  const route = window.location.hash.replace(/^#/, '');
  return route.startsWith('/') ? route : '/overview';
}

function useRoute(): string {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const update = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

function navigate(route: string): void {
  window.location.hash = route;
}

export function authRedirectRoute(admin: AdminUser | null, checking: boolean, route: string): string | null {
  if (checking) return null;
  if (!admin && route !== '/login') return '/login';
  if (admin && route === '/login') return '/overview';
  return null;
}

function formatTime(value?: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function relativeTime(value?: string | null): string {
  if (!value) return 'never seen';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function isOnline(device: DeviceItem): boolean {
  const seen = new Date(device.last_seen_at).getTime();
  return Number.isFinite(seen) && Date.now() - seen <= ONLINE_WINDOW_MS;
}

function storagePercent(device: DeviceItem): number | null {
  const total = device.health?.storage_total;
  const free = device.health?.storage_free;
  if (typeof total !== 'number' || typeof free !== 'number' || total <= 0) return null;
  return Math.max(0, Math.min(100, ((total - free) / total) * 100));
}

function alertLabel(type: DeviceAlert['type']): string {
  const labels: Record<DeviceAlert['type'], string> = {
    LOW_BATTERY: 'Low battery',
    STORAGE_ALMOST_FULL: 'Storage almost full',
    RECORDING_UPLOAD_FAILED: 'Recording upload failed'
  };
  return labels[type];
}

function endpointLabel(endpoint: string): string {
  return endpoint.split('/').filter(Boolean).pop()?.replace(/_/g, ' ') || endpoint;
}

function statusTone(success: boolean): string {
  return success ? 'success' : 'danger';
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div><h1>{title}</h1><p>{description}</p></div>
      {action && <div>{action}</div>}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><div className="empty-icon">○</div><h3>{title}</h3><p>{detail}</p></div>;
}

function ErrorBanner({ message }: { message: string | null }) {
  return message ? <div className="error-banner" role="alert">{message}</div> : null;
}

function ActionNotice({ notice }: { notice: { tone: 'success' | 'error'; message: string } | null }) {
  return notice ? <div className={notice.tone === 'success' ? 'success-banner' : 'error-banner'} role="status">{notice.message}</div> : null;
}

function LoadingBlock() {
  return <div className="loading-block"><span className="spinner" />Loading…</div>;
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function LoginPage({ onAuthenticated }: { onAuthenticated: (admin: AdminUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const admin = await login(email, password);
      onAuthenticated(admin);
      navigate('/overview');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-mark" aria-hidden="true">Z4</div>
        <p className="eyebrow">ZY04 CONTROL</p>
        <h1>Admin sign in</h1>
        <p className="login-copy">Monitor badge health, recordings, alerts, and supplier API traffic.</p>
        <ErrorBanner message={error} />
        <form onSubmit={submit} className="login-form">
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="security-note">Secure 24-hour administrator session</p>
      </section>
    </main>
  );
}

function OverviewPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewData, deviceData, alertData] = await Promise.all([
        getOverview(), getDevices(), getAlerts('ACTIVE')
      ]);
      setOverview(overviewData);
      setDevices(deviceData.items);
      setAlerts(alertData.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const active = devices.filter(isOnline).length;
  const offline = Math.max(0, devices.length - active);

  return (
    <>
      <PageHeader title="Overview" description="Live operational state across the ZY04 fleet." action={<button className="secondary-button" onClick={() => void load()}>Refresh</button>} />
      <ErrorBanner message={error} />
      {loading ? <LoadingBlock /> : <>
        <section className="section-block urgent-section">
          <div className="section-heading"><div><p className="eyebrow danger-text">NEEDS ATTENTION</p><h2>Urgent problems</h2></div><Pill tone={alerts.length ? 'danger' : 'success'}>{alerts.length} active</Pill></div>
          {alerts.length === 0 ? <EmptyState title="No active alerts" detail="All observed devices are currently within configured health thresholds." /> : (
            <div className="alert-grid">{alerts.slice(0, 6).map((alert) => <a className="alert-card" href={`#/devices/${encodeURIComponent(alert.device_sn)}`} key={alert.id}><span className="alert-dot" /><div><strong>{alertLabel(alert.type)}</strong><p>{alert.device_sn} · observed {relativeTime(alert.last_observed_at)}</p></div><span aria-hidden="true">→</span></a>)}</div>
          )}
        </section>
        <section className="metric-grid" aria-label="Fleet totals">
          <div className="metric-card"><span>Total devices</span><strong>{overview?.counts.devices ?? devices.length}</strong><small>registered badges</small></div>
          <div className="metric-card"><span>Active now</span><strong>{active}</strong><small>seen within 5 minutes</small></div>
          <div className="metric-card"><span>Offline</span><strong>{offline}</strong><small>not recently seen</small></div>
          <div className="metric-card"><span>Recordings</span><strong>{overview?.counts.recordings ?? 0}</strong><small>uploaded slices</small></div>
        </section>
        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">LAST 24 HOURS</p><h2>API activity</h2></div><a className="text-link" href="#/activity">Open live activity →</a></div>
          <div className="activity-summary">
            <div><strong>{overview?.counts.recent_activity ?? 0}</strong><span>Total requests</span></div>
            <div><strong className="danger-text">{overview?.counts.failed_activity ?? 0}</strong><span>Failed responses</span></div>
            <div><strong>{Math.max(0, (overview?.counts.recent_activity ?? 0) - (overview?.counts.failed_activity ?? 0))}</strong><span>Successful responses</span></div>
          </div>
        </section>
      </>}
    </>
  );
}

function DevicesPage() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getDevices(), getAlerts('ACTIVE')])
      .then(([deviceData, alertData]) => { setDevices(deviceData.items); setAlerts(alertData.items); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load devices'))
      .finally(() => setLoading(false));
  }, []);

  const alertSns = useMemo(() => new Set(alerts.map((alert) => alert.device_sn)), [alerts]);
  const sorted = useMemo(() => [...devices].sort((a, b) => {
    const priority = (device: DeviceItem) => (alertSns.has(device.sn) ? 4 : 0) + (!isOnline(device) ? 2 : 0) + ((device.health?.power ?? 100) <= 20 ? 1 : 0);
    return priority(b) - priority(a) || new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
  }), [devices, alertSns]);

  return (
    <>
      <PageHeader title="Devices" description="Attention-needed badges are sorted to the top." />
      <ErrorBanner message={error} />
      {loading ? <LoadingBlock /> : sorted.length === 0 ? <EmptyState title="No devices yet" detail="Devices will appear after their first supplier API request." /> : (
        <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Device</th><th>Last seen</th><th>Battery</th><th>Storage used</th><th>Current status</th><th>Alert</th></tr></thead><tbody>{sorted.map((device) => {
          const percent = storagePercent(device);
          const hasAlert = alertSns.has(device.sn);
          return <tr key={device.id}><td><a className="device-link" href={`#/devices/${encodeURIComponent(device.sn)}`}>{device.sn}</a><small>{device.model || device.product || 'Unknown model'} · {device.product || 'Unknown product'}</small></td><td><Pill tone={isOnline(device) ? 'success' : 'neutral'}>{isOnline(device) ? 'Active' : 'Offline'}</Pill><small>{relativeTime(device.last_seen_at)}</small></td><td>{device.health?.power === undefined ? '—' : `${device.health.power}%`}</td><td>{percent === null ? '—' : `${Math.round(percent)}%`}</td><td>{String(device.health?.current_status ?? 'Unknown')}</td><td>{hasAlert ? <Pill tone="danger">Needs attention</Pill> : <Pill tone="success">Clear</Pill>}</td></tr>;
        })}</tbody></table></div></div>
      )}
    </>
  );
}

type DetailTab = 'Activity' | 'Recordings' | 'Status Logs' | 'Report Logs' | 'Debug Logs';

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function DeviceDetailPage({ sn }: { sn: string }) {
  const [detail, setDetail] = useState<DeviceDetailData | null>(null);
  const [activity, setActivity] = useState<ApiActivity[]>([]);
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [statusLogs, setStatusLogs] = useState<DeviceLog[]>([]);
  const [reportLogs, setReportLogs] = useState<DeviceLog[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [tab, setTab] = useState<DetailTab>('Activity');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getDevice(sn), getDeviceActivity(sn), getAdminRecordings(sn), getStatusLogs(), getReportLogs(), getDebugLogs()])
      .then(([deviceData, activityData, recordingData, statuses, reports, debug]) => {
        setDetail(deviceData);
        setActivity(activityData.items);
        setRecordings(recordingData.items);
        setStatusLogs(statuses.items.filter((item) => item.device_sn === sn));
        setReportLogs(reports.items.filter((item) => item.device_sn === sn));
        setDebugLogs(debug.items.filter((item) => item.sn === sn));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load device'))
      .finally(() => setLoading(false));
  }, [sn]);

  const device = detail?.device;
  const percent = device ? storagePercent(device) : null;
  const tabs: DetailTab[] = ['Activity', 'Recordings', 'Status Logs', 'Report Logs', 'Debug Logs'];

  const runAction = async (key: string, action: () => Promise<void>, successMessage: string) => {
    setBusyAction(key);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: 'success', message: successMessage });
    } catch (reason) {
      setNotice({ tone: 'error', message: reason instanceof Error ? reason.message : 'Action failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const renderTab = () => {
    if (tab === 'Activity') return activity.length ? <ActivityTable items={activity} compact /> : <EmptyState title="No activity" detail="No retained supplier API activity exists for this device." />;
    if (tab === 'Recordings') return recordings.length ? <div className="compact-list">{recordings.map((item) => <div className="list-row action-row" key={item.record_id}><div><strong>{item.file_name || item.record_id}</strong><span>Session {item.session_id} · slice {item.slice_number ?? '—'}</span></div><div className="row-actions"><Pill tone={item.status === 'FAILED' ? 'danger' : item.status === 'READY' ? 'success' : 'neutral'}>{item.status}</Pill>{item.status === 'READY' && <button disabled={busyAction !== null} onClick={() => void runAction(`wav-${item.record_id}`, () => downloadRecordingWav(item.record_id), 'WAV download started and was added to the audit trail.')}>WAV</button>}<button disabled={busyAction !== null} onClick={() => void runAction(`original-${item.record_id}`, () => downloadRecordingOriginal(item.record_id, item.file_name || `${item.record_id}.opus`), 'Original-slice download started and was added to the audit trail.')}>Original</button>{item.status === 'FAILED' && item.compress?.toLowerCase() !== 'lz4' && <button className="warning-button" disabled={busyAction !== null} onClick={() => { if (window.confirm('Retry safe processing for this complete, uncompressed session?')) void runAction(`retry-${item.record_id}`, async () => { const result = await retryRecording(item.record_id); setRecordings((current) => current.map((entry) => entry.session_id === item.session_id ? { ...entry, status: result.status as RecordingItem['status'] } : entry)); }, 'Processing retry completed and was recorded in the audit trail.'); }}>Retry</button>}</div></div>)}</div> : <EmptyState title="No recordings" detail="No recording slices have been received for this device." />;
    if (tab === 'Status Logs') return statusLogs.length ? <LogList items={statusLogs} /> : <EmptyState title="No status logs" detail="Status reports will appear after the device reports health." />;
    if (tab === 'Report Logs') return reportLogs.length ? <LogList items={reportLogs} /> : <EmptyState title="No report logs" detail="Operational reports will appear here when received." />;
    return debugLogs.length ? <div className="compact-list">{debugLogs.map((item) => <div className="list-row action-row" key={item.id}><div><strong>{item.file_name}</strong><span>{formatTime(item.uploaded_at)} · {Math.ceil(item.size / 1024)} KB</span></div><div className="row-actions"><Pill>{item.storage_mode}</Pill><button disabled={busyAction !== null} onClick={() => void runAction(`debug-download-${item.id}`, () => downloadDebugLog(item.id, item.file_name), 'Debug-log download started and was added to the audit trail.')}>Download</button><button className="danger-button" disabled={busyAction !== null} onClick={() => { if (window.confirm(`Soft delete ${item.file_name}? The stored file will be retained.`)) void runAction(`debug-delete-${item.id}`, async () => { await softDeleteDebugLog(item.id); setDebugLogs((current) => current.filter((entry) => entry.id !== item.id)); }, 'Debug log was hidden with a recoverable soft delete and audited.'); }}>Delete</button></div></div>)}</div> : <EmptyState title="No debug logs" detail="No debug log files have been uploaded for this device." />;
  };

  return (
    <>
      <a className="back-link" href="#/devices">← All devices</a>
      <PageHeader title={sn} description={device ? `${device.model || device.product} · last seen ${relativeTime(device.last_seen_at)}` : 'Device details'} />
      <ErrorBanner message={error} />
      <ActionNotice notice={notice} />
      {loading ? <LoadingBlock /> : !device ? <EmptyState title="Device unavailable" detail="The device could not be found or loaded." /> : <>
        {detail.active_alerts.length > 0 && <div className="inline-alerts">{detail.active_alerts.map((alert) => <div key={alert.id}><span className="alert-dot" /><strong>{alertLabel(alert.type)}</strong><span>Observed {relativeTime(alert.last_observed_at)}</span></div>)}</div>}
        <section className="health-grid">
          <div><span>Connection</span><strong>{isOnline(device) ? 'Active' : 'Offline'}</strong><small>{formatTime(device.last_seen_at)}</small></div>
          <div><span>Battery</span><strong>{device.health?.power === undefined ? '—' : `${device.health.power}%`}</strong><small>latest reported charge</small></div>
          <div><span>Storage</span><strong>{percent === null ? '—' : `${Math.round(percent)}% used`}</strong><small>{device.health?.storage_free ?? '—'} free of {device.health?.storage_total ?? '—'}</small></div>
          <div><span>Status</span><strong>{String(device.health?.current_status ?? 'Unknown')}</strong><small>Wi-Fi {device.health?.wifi_ssid || 'not reported'} · {device.health?.wifi_rssi ?? '—'} RSSI</small></div>
        </section>
        <section className="section-block tab-panel"><div className="tabs" role="tablist">{tabs.map((item) => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} role="tab" aria-selected={tab === item} key={item}>{item}</button>)}</div>{renderTab()}</section>
      </>}
    </>
  );
}

function LogList({ items }: { items: DeviceLog[] }) {
  return <div className="compact-list">{items.map((item) => <details className="log-row" key={item.id}><summary><div><strong>{item.log_type} report</strong><span>{formatTime(item.received_at)}</span></div><span>View payload</span></summary><JsonPreview value={item.parsed} /></details>)}</div>;
}

function ActivityTable({ items, onSelect, compact = false }: { items: ApiActivity[]; onSelect?: (item: ApiActivity) => void; compact?: boolean }) {
  return <div className="table-scroll"><table className={compact ? 'compact-table' : ''}><thead><tr><th>Endpoint</th><th>Device</th><th>Result</th><th>Time</th><th>Duration</th></tr></thead><tbody>{items.map((item) => <tr className={onSelect ? 'clickable-row' : ''} onClick={() => onSelect?.(item)} key={item.id}><td><code>{endpointLabel(item.endpoint)}</code></td><td>{item.device_sn || '—'}</td><td><Pill tone={statusTone(item.success)}>{item.status_code} {item.success ? 'OK' : 'Failed'}</Pill></td><td>{relativeTime(item.created_at)}</td><td>{Math.round(item.duration_ms)} ms</td></tr>)}</tbody></table></div>;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export function sseReconnectDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, attempt - 1)));
}

function ActivityPage() {
  const [events, setEvents] = useState<ApiActivity[]>([]);
  const [endpoint, setEndpoint] = useState<string>('ALL');
  const [selected, setSelected] = useState<ApiActivity | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const retries = useRef(0);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: number | null = null;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      setConnection('connecting');
      source = new EventSource(activityStreamUrl(), { withCredentials: true });
      source.addEventListener('ready', () => { retries.current = 0; setConnection('connected'); });
      source.addEventListener('activity', (event) => {
        try {
          const activity = JSON.parse((event as MessageEvent<string>).data) as ApiActivity;
          setEvents((current) => [activity, ...current.filter((item) => item.id !== activity.id)].slice(0, 250));
          setConnection('connected');
        } catch {
          // Ignore a malformed event without dropping the stream.
        }
      });
      source.onerror = () => {
        source?.close();
        setConnection('disconnected');
        retries.current += 1;
        const delay = sseReconnectDelay(retries.current);
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => { disposed = true; source?.close(); if (timer !== null) window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected]);

  const visible = endpoint === 'ALL' ? events : events.filter((item) => item.endpoint === endpoint);
  return (
    <>
      <PageHeader title="API Activity" description="Live, sanitized supplier request and response traffic." action={<div className={`connection-state ${connection}`}><span />{connection}</div>} />
      <section className="section-block tab-panel">
        <div className="tabs endpoint-tabs"><button className={endpoint === 'ALL' ? 'active' : ''} onClick={() => setEndpoint('ALL')}>All</button>{ENDPOINTS.map((item) => <button className={endpoint === item ? 'active' : ''} onClick={() => setEndpoint(item)} key={item}>{endpointLabel(item)}</button>)}</div>
        {visible.length ? <ActivityTable items={visible} onSelect={setSelected} /> : <EmptyState title="Waiting for API activity" detail={connection === 'disconnected' ? 'The live connection is unavailable. Reconnecting automatically…' : 'New supplier requests will appear here in real time.'} />}
      </section>
      {selected && <div className="modal-backdrop" onMouseDown={() => setSelected(null)}><section className="detail-modal" role="dialog" aria-modal="true" aria-label="API activity details" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">SANITIZED ACTIVITY</p><h2>{selected.method} {selected.endpoint}</h2><p>{formatTime(selected.created_at)} · {selected.duration_ms} ms</p></div><button className="icon-button" aria-label="Close details" onClick={() => setSelected(null)}>×</button></header><div className="modal-meta"><Pill tone={statusTone(selected.success)}>{selected.status_code} {selected.success ? 'Success' : 'Failed'}</Pill><span>Device {selected.device_sn || 'not supplied'}</span><span>Response code {selected.response_code ?? 'none'}</span></div><div className="payload-grid"><div><h3>Request</h3><JsonPreview value={selected.request_body} /></div><div><h3>Response</h3><JsonPreview value={selected.response_body} /></div></div></section></div>}
    </>
  );
}

function AlertsPage() {
  const [active, setActive] = useState<DeviceAlert[]>([]);
  const [resolved, setResolved] = useState<DeviceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([getAlerts('ACTIVE'), getAlerts('RESOLVED')])
      .then(([activeData, resolvedData]) => { setActive(activeData.items); setResolved(resolvedData.items); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load alerts'))
      .finally(() => setLoading(false));
  }, []);

  const list = (items: DeviceAlert[], empty: string) => items.length ? <div className="compact-list">{items.map((alert) => <div className="list-row alert-history-row" key={alert.id}><div><strong>{alertLabel(alert.type)}</strong><span><a href={`#/devices/${encodeURIComponent(alert.device_sn)}`}>{alert.device_sn}</a> · opened {formatTime(alert.opened_at)}</span></div><div className="align-right"><Pill tone={alert.status === 'ACTIVE' ? 'danger' : 'success'}>{alert.status}</Pill><small>{alert.status === 'RESOLVED' ? `Resolved ${relativeTime(alert.resolved_at)}` : `Seen ${relativeTime(alert.last_observed_at)}`}</small></div></div>)}</div> : <EmptyState title={empty} detail="Nothing to review in this category." />;

  return <><PageHeader title="Alerts" description="Current device problems and preserved resolution history." /><ErrorBanner message={error} />{loading ? <LoadingBlock /> : <div className="stack"><section className="section-block"><div className="section-heading"><h2>Active alerts</h2><Pill tone={active.length ? 'danger' : 'success'}>{active.length}</Pill></div>{list(active, 'No active alerts')}</section><section className="section-block"><div className="section-heading"><h2>Resolved history</h2><Pill>{resolved.length}</Pill></div>{list(resolved, 'No resolved alerts')}</section></div>}</>;
}

function ConfigManagementPage() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [common, setCommon] = useState({ record_mode: '0', record_time: '7200', record_ignore_time: '10', retry_delay: '0', duor: false, no_switch: false });
  const [advanced, setAdvanced] = useState({ domain: '', domain_apm: '', domain_config: '', s3_config: '', s3_callback: false, snapshot_status: false, tz: 'UTC-8', compress: '', disable_tls: false, http_proxy: '', extra_headers: '', modem_apn: '', preferred_network: 'wifi' });

  useEffect(() => {
    getDevices().then((result) => setDevices(result.items)).catch((reason) => setNotice({ tone: 'error', message: reason instanceof Error ? reason.message : 'Unable to load devices' }));
  }, []);

  const toggleDevice = (sn: string) => setSelected((current) => current.includes(sn) ? current.filter((item) => item !== sn) : [...current, sn]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    if (!selected.length) return setNotice({ tone: 'error', message: 'Select at least one device.' });
    if (!window.confirm(`Queue this configuration for ${selected.length} device${selected.length === 1 ? '' : 's'}? It will be redelivered until acknowledged.`)) return;
    const advancedStrings = Object.fromEntries(
      (['domain', 'domain_apm', 'domain_config', 's3_config', 'tz', 'http_proxy', 'extra_headers', 'modem_apn', 'preferred_network'] as const)
        .filter((key) => advanced[key] !== '')
        .map((key) => [key, advanced[key]])
    );
    setBusy(true);
    try {
      const result = await createConfigs({
        device_sns: selected,
        common_settings: {
          record_mode: Number(common.record_mode), record_time: Number(common.record_time),
          record_ignore_time: Number(common.record_ignore_time), retry_delay: Number(common.retry_delay),
          duor: common.duor ? 1 : 0, no_switch: common.no_switch ? 1 : 0
        },
        advanced_settings: {
          ...advancedStrings,
          compress: advanced.compress,
          s3_callback: advanced.s3_callback ? 1 : 0,
          snapshot_status: advanced.snapshot_status ? 1 : 0,
          disable_tls: advanced.disable_tls ? 1 : 0
        }
      });
      setNotice({ tone: 'success', message: `${result.created.length} configuration${result.created.length === 1 ? '' : 's'} queued and written to the audit trail.` });
    } catch (reason) {
      setNotice({ tone: 'error', message: reason instanceof Error ? reason.message : 'Configuration creation failed' });
    } finally { setBusy(false); }
  };

  return <><PageHeader title="Configuration" description="Queue documented badge settings for one or several devices." /><ActionNotice notice={notice} /><form className="management-form" onSubmit={submit}><section className="section-block"><div className="section-heading"><div><p className="eyebrow">TARGETS</p><h2>Select devices</h2></div><button type="button" className="text-button" onClick={() => setSelected(selected.length === devices.length ? [] : devices.map((device) => device.sn))}>{selected.length === devices.length && devices.length ? 'Clear all' : 'Select all'}</button></div>{devices.length ? <div className="selection-grid">{devices.map((device) => <label className={selected.includes(device.sn) ? 'selected' : ''} key={device.id}><input type="checkbox" checked={selected.includes(device.sn)} onChange={() => toggleDevice(device.sn)} /><span><strong>{device.sn}</strong><small>{device.model || device.product}</small></span></label>)}</div> : <EmptyState title="No devices" detail="A device must check in before a configuration can be queued." />}</section><section className="section-block"><div className="section-heading"><div><p className="eyebrow">COMMON SETTINGS</p><h2>Recording behavior</h2></div></div><div className="form-grid"><label>Record mode<select value={common.record_mode} onChange={(event) => setCommon({ ...common, record_mode: event.target.value })}><option value="0">Normal</option><option value="1">Wearer only</option></select></label><label>Segment duration (seconds)<input type="number" min="600" max="7200" value={common.record_time} onChange={(event) => setCommon({ ...common, record_time: event.target.value })} required /></label><label>Minimum recording (seconds)<input type="number" min="0" max="600" value={common.record_ignore_time} onChange={(event) => setCommon({ ...common, record_ignore_time: event.target.value })} required /></label><label>Retry delay (seconds)<input type="number" min="0" max="86400" value={common.retry_delay} onChange={(event) => setCommon({ ...common, retry_delay: event.target.value })} required /></label></div><div className="toggle-row"><label><input type="checkbox" checked={common.duor} onChange={(event) => setCommon({ ...common, duor: event.target.checked })} /> No upload during recording</label><label><input type="checkbox" checked={common.no_switch} onChange={(event) => setCommon({ ...common, no_switch: event.target.checked })} /> Disable physical switch</label></div></section><section className="section-block"><button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}><span><span className="eyebrow">ADVANCED</span><strong>Network, storage, and transport</strong></span><span>{advancedOpen ? '−' : '+'}</span></button>{advancedOpen && <div className="advanced-fields"><div className="form-grid">{(['domain', 'domain_apm', 'domain_config'] as const).map((key) => <label key={key}>{key.replace(/_/g, ' ')}<input value={advanced[key]} onChange={(event) => setAdvanced({ ...advanced, [key]: event.target.value })} placeholder="Host name" /></label>)}<label>Timezone<input value={advanced.tz} onChange={(event) => setAdvanced({ ...advanced, tz: event.target.value })} /></label><label>Compression<select value={advanced.compress} onChange={(event) => setAdvanced({ ...advanced, compress: event.target.value })}><option value="">Off</option><option value="lz4">LZ4 (supplier framing pending)</option></select></label><label>Preferred network<select value={advanced.preferred_network} onChange={(event) => setAdvanced({ ...advanced, preferred_network: event.target.value })}><option value="wifi">Wi-Fi</option><option value="lte">LTE</option><option value="only_wifi">Wi-Fi only</option><option value="only_lte">LTE only</option></select></label><label>HTTP proxy<input value={advanced.http_proxy} onChange={(event) => setAdvanced({ ...advanced, http_proxy: event.target.value })} /></label><label>Mobile APN<input value={advanced.modem_apn} onChange={(event) => setAdvanced({ ...advanced, modem_apn: event.target.value })} /></label><label className="span-2">S3 configuration<input type="password" autoComplete="off" value={advanced.s3_config} onChange={(event) => setAdvanced({ ...advanced, s3_config: event.target.value })} placeholder="Credentials are never included in audit metadata" /></label><label className="span-2">Extra headers<textarea value={advanced.extra_headers} onChange={(event) => setAdvanced({ ...advanced, extra_headers: event.target.value })} /></label></div><div className="toggle-row"><label><input type="checkbox" checked={advanced.s3_callback} onChange={(event) => setAdvanced({ ...advanced, s3_callback: event.target.checked })} /> S3 callback</label><label><input type="checkbox" checked={advanced.snapshot_status} onChange={(event) => setAdvanced({ ...advanced, snapshot_status: event.target.checked })} /> Segment status reports</label><label><input type="checkbox" checked={advanced.disable_tls} onChange={(event) => setAdvanced({ ...advanced, disable_tls: event.target.checked })} /> Disable TLS</label></div></div>}</section><div className="form-actions"><span>{selected.length} device{selected.length === 1 ? '' : 's'} selected</span><button className="primary-button" disabled={busy || !devices.length}>{busy ? 'Queueing…' : 'Review and queue'}</button></div></form></>;
}

const EMPTY_FIRMWARE: FirmwareInput = { device_models: [], firmware_type: 'esp', firmware_version: '', url: '', md5: '', update_type: 'default', enabled: true, confirm_force_or_downgrade: false };

export function compareFirmwareVersions(left: string, right: string): number {
  const leftParts = left.split(/[._+-]/);
  const rightParts = right.split(/[._+-]/);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] || '0';
    const rightPart = rightParts[index] || '0';
    const comparison = /^\d+$/.test(leftPart) && /^\d+$/.test(rightPart)
      ? (BigInt(leftPart) > BigInt(rightPart) ? 1 : BigInt(leftPart) < BigInt(rightPart) ? -1 : 0)
      : leftPart.toLowerCase().localeCompare(rightPart.toLowerCase());
    if (comparison !== 0) return comparison > 0 ? 1 : -1;
  }
  return 0;
}

function FirmwareManagementPage() {
  const [items, setItems] = useState<FirmwareItem[]>([]);
  const [form, setForm] = useState<FirmwareInput>(EMPTY_FIRMWARE);
  const [modelsText, setModelsText] = useState('');
  const [editing, setEditing] = useState<FirmwareItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const load = useCallback(() => getFirmware().then((result) => setItems(result.items)).catch((reason) => setNotice({ tone: 'error', message: reason instanceof Error ? reason.message : 'Unable to load firmware' })), []);
  useEffect(() => { void load(); }, [load]);

  const reset = () => { setEditing(null); setModelsText(''); setForm(EMPTY_FIRMWARE); };
  const beginEdit = (item: FirmwareItem) => {
    setEditing(item); setModelsText(item.device_model);
    setForm({ device_model: item.device_model, firmware_type: item.firmware_type, firmware_version: item.firmware_version, url: item.url, md5: item.md5, update_type: item.update_type, enabled: item.enabled, confirm_force_or_downgrade: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setNotice(null);
    const models = modelsText.split(',').map((item) => item.trim()).filter(Boolean);
    if (!models.length) return setNotice({ tone: 'error', message: 'Enter at least one device model.' });
    const sensitive = form.update_type === 'force' || Boolean(
      editing && compareFirmwareVersions(form.firmware_version, editing.firmware_version) < 0
    );
    if (sensitive && !form.confirm_force_or_downgrade) return setNotice({ tone: 'error', message: 'Confirm the force/downgrade acknowledgement before submitting.' });
    if (!window.confirm(`${editing ? 'Update' : 'Create'} firmware ${form.firmware_version} for ${models.join(', ')}?`)) return;
    setBusy(true);
    try {
      if (editing) {
        await updateFirmware(editing.id, { ...form, device_model: models[0], device_models: undefined });
        setNotice({ tone: 'success', message: 'Firmware updated and written to the audit trail.' });
      } else {
        const result = await createFirmware({ ...form, device_models: models, device_model: undefined });
        setNotice({ tone: 'success', message: `${result.created.length} model-wide firmware assignment${result.created.length === 1 ? '' : 's'} created and audited.` });
      }
      reset(); await load();
    } catch (reason) { setNotice({ tone: 'error', message: reason instanceof Error ? reason.message : 'Firmware action failed' }); }
    finally { setBusy(false); }
  };
  const setEnabled = async (item: FirmwareItem, enabled: boolean) => {
    if (!window.confirm(`${enabled ? 'Enable' : 'Disable'} ${item.firmware_type.toUpperCase()} ${item.firmware_version} for ${item.device_model}?`)) return;
    setBusy(true); setNotice(null);
    try {
      if (enabled) {
        await updateFirmware(item.id, {
          enabled: true,
          confirm_force_or_downgrade: item.update_type === 'force'
        });
      } else await disableFirmware(item.id);
      setNotice({ tone: 'success', message: `Firmware ${enabled ? 'enabled' : 'disabled'} and written to the audit trail.` });
      await load();
    } catch (reason) { setNotice({ tone: 'error', message: reason instanceof Error ? reason.message : 'Firmware action failed' }); }
    finally { setBusy(false); }
  };

  return <><PageHeader title="Firmware" description="Manage URL-based ESP and DSP packages by device model." /><ActionNotice notice={notice} /><form className="section-block management-form" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">{editing ? 'UPDATE PACKAGE' : 'NEW PACKAGE'}</p><h2>{editing ? `Editing ${editing.device_model}` : 'Model-wide assignment'}</h2></div>{editing && <button type="button" className="text-button" onClick={reset}>Cancel edit</button>}</div><div className="form-grid"><label>Device model{!editing && 's (comma separated)'}<input value={modelsText} onChange={(event) => setModelsText(event.target.value)} required /></label><label>Firmware type<select value={form.firmware_type} onChange={(event) => setForm({ ...form, firmware_type: event.target.value as 'esp' | 'dsp' })}><option value="esp">ESP</option><option value="dsp">DSP</option></select></label><label>Version<input value={form.firmware_version} onChange={(event) => setForm({ ...form, firmware_version: event.target.value })} required /></label><label>MD5<input value={form.md5} pattern="[a-fA-F0-9]{32}" onChange={(event) => setForm({ ...form, md5: event.target.value })} required /></label><label className="span-2">Firmware URL<input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} required /></label><label>Update policy<select value={form.update_type} onChange={(event) => setForm({ ...form, update_type: event.target.value as 'force' | 'default' })}><option value="default">Newer versions only</option><option value="force">Force / allow downgrade</option></select></label><label className="confirmation-check"><input type="checkbox" checked={form.confirm_force_or_downgrade} onChange={(event) => setForm({ ...form, confirm_force_or_downgrade: event.target.checked })} /><span>I explicitly confirm force or downgrade risk</span></label></div><div className="form-actions"><span>URL packages only</span><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : editing ? 'Confirm update' : 'Confirm and add'}</button></div></form><section className="section-block firmware-list"><div className="section-heading"><h2>Firmware catalog</h2><Pill>{items.length}</Pill></div>{items.length ? <div className="table-scroll"><table><thead><tr><th>Model</th><th>Type / version</th><th>Policy</th><th>State</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.device_model}</strong></td><td>{item.firmware_type.toUpperCase()} {item.firmware_version}<small className="truncate" title={item.url}>{item.url}</small></td><td><Pill tone={item.update_type === 'force' ? 'warning' : 'neutral'}>{item.update_type}</Pill></td><td><Pill tone={item.enabled ? 'success' : 'neutral'}>{item.enabled ? 'Enabled' : 'Disabled'}</Pill></td><td><div className="row-actions"><button onClick={() => beginEdit(item)}>Edit</button><button disabled={busy} className={item.enabled ? 'danger-button' : ''} onClick={() => void setEnabled(item, !item.enabled)}>{item.enabled ? 'Disable' : 'Enable'}</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="No firmware" detail="Add the first URL-based firmware package above." />}</section></>;
}

function Dashboard({ admin, route, onLogout }: { admin: AdminUser; route: string; onLogout: () => void }) {
  const detailMatch = route.match(/^\/devices\/(.+)$/);
  const page = detailMatch ? <DeviceDetailPage sn={decodeURIComponent(detailMatch[1])} />
    : route === '/devices' ? <DevicesPage />
      : route === '/activity' ? <ActivityPage />
        : route === '/alerts' ? <AlertsPage />
          : route === '/configuration' ? <ConfigManagementPage />
            : route === '/firmware' ? <FirmwareManagementPage />
          : <OverviewPage />;
  const activeRoute = detailMatch ? '/devices' : route;
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark small">Z4</div><div><strong>ZY04 Control</strong><span>Admin console</span></div></div>
        <nav aria-label="Primary navigation">
          {[['/overview', 'Overview'], ['/devices', 'Devices'], ['/activity', 'API Activity'], ['/alerts', 'Alerts'], ['/configuration', 'Configuration'], ['/firmware', 'Firmware']].map(([path, label]) => <a className={activeRoute === path ? 'active' : ''} href={`#${path}`} key={path}><span className="nav-dot" />{label}</a>)}
        </nav>
        <div className="sidebar-account"><span>Signed in as</span><strong title={admin.email}>{admin.email}</strong><button onClick={onLogout}>Sign out</button></div>
      </aside>
      <main className="content-area">{page}</main>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getCurrentAdmin().then(setAdmin).catch(() => setAdmin(null)).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const unauthorized = () => { setAdmin(null); navigate('/login'); };
    window.addEventListener('admin-unauthorized', unauthorized);
    return () => window.removeEventListener('admin-unauthorized', unauthorized);
  }, []);

  useEffect(() => {
    const target = authRedirectRoute(admin, checking, route);
    if (target) navigate(target);
  }, [admin, checking, route]);

  const signOut = async () => {
    try { await logout(); } catch (reason) {
      if (!(reason instanceof ApiError) || reason.status !== 401) console.error('Logout failed');
    } finally {
      setAdmin(null);
      navigate('/login');
    }
  };

  if (checking) return <main className="app-loading"><div className="brand-mark">Z4</div><LoadingBlock /></main>;
  if (!admin) return <LoginPage onAuthenticated={setAdmin} />;
  return <Dashboard admin={admin} route={route} onLogout={() => void signOut()} />;
}

export default App;
