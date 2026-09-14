import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activityStreamUrl,
  ApiError,
  getAdminRecordings,
  getAlerts,
  getCurrentAdmin,
  getDebugLogs,
  getDevice,
  getDeviceActivity,
  getDevices,
  getOverview,
  getReportLogs,
  getStatusLogs,
  login,
  logout
} from './api';
import {
  AdminUser,
  ApiActivity,
  DebugLog,
  DeviceAlert,
  DeviceDetailData,
  DeviceItem,
  DeviceLog,
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

  const renderTab = () => {
    if (tab === 'Activity') return activity.length ? <ActivityTable items={activity} compact /> : <EmptyState title="No activity" detail="No retained supplier API activity exists for this device." />;
    if (tab === 'Recordings') return recordings.length ? <div className="compact-list">{recordings.map((item) => <div className="list-row" key={item.record_id}><div><strong>{item.file_name || item.record_id}</strong><span>Session {item.session_id} · slice {item.slice_number ?? '—'}</span></div><Pill tone={item.status === 'FAILED' ? 'danger' : item.status === 'READY' ? 'success' : 'neutral'}>{item.status}</Pill></div>)}</div> : <EmptyState title="No recordings" detail="No recording slices have been received for this device." />;
    if (tab === 'Status Logs') return statusLogs.length ? <LogList items={statusLogs} /> : <EmptyState title="No status logs" detail="Status reports will appear after the device reports health." />;
    if (tab === 'Report Logs') return reportLogs.length ? <LogList items={reportLogs} /> : <EmptyState title="No report logs" detail="Operational reports will appear here when received." />;
    return debugLogs.length ? <div className="compact-list">{debugLogs.map((item) => <div className="list-row" key={item.id}><div><strong>{item.file_name}</strong><span>{formatTime(item.uploaded_at)} · {Math.ceil(item.size / 1024)} KB</span></div><Pill>{item.storage_mode}</Pill></div>)}</div> : <EmptyState title="No debug logs" detail="No debug log files have been uploaded for this device." />;
  };

  return (
    <>
      <a className="back-link" href="#/devices">← All devices</a>
      <PageHeader title={sn} description={device ? `${device.model || device.product} · last seen ${relativeTime(device.last_seen_at)}` : 'Device details'} />
      <ErrorBanner message={error} />
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

function Dashboard({ admin, route, onLogout }: { admin: AdminUser; route: string; onLogout: () => void }) {
  const detailMatch = route.match(/^\/devices\/(.+)$/);
  const page = detailMatch ? <DeviceDetailPage sn={decodeURIComponent(detailMatch[1])} />
    : route === '/devices' ? <DevicesPage />
      : route === '/activity' ? <ActivityPage />
        : route === '/alerts' ? <AlertsPage />
          : <OverviewPage />;
  const activeRoute = detailMatch ? '/devices' : route;
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark small">Z4</div><div><strong>ZY04 Control</strong><span>Admin console</span></div></div>
        <nav aria-label="Primary navigation">
          {[['/overview', 'Overview'], ['/devices', 'Devices'], ['/activity', 'API Activity'], ['/alerts', 'Alerts']].map(([path, label]) => <a className={activeRoute === path ? 'active' : ''} href={`#${path}`} key={path}><span className="nav-dot" />{label}</a>)}
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
