/**
 * API Service for communication between React Frontend and FastAPI Backend
 */

const API_BASE_URL = 'http://localhost:8000/api';
const WS_BASE_URL = 'ws://localhost:8000/ws/events';

export interface BackendHealth {
  status: string;
  service: string;
  trap_port: number | null;
  poller: string;
  poll_interval: number;
  timestamp: number;
}

export async function fetchBackendHealth(): Promise<BackendHealth> {
  const res = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error('ไม่สามารถตรวจสอบสถานะบริการระบบได้');
  return res.json();
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(1800) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'online';
  } catch {
    return false;
  }
}

export async function savePollingSettingsApi(pollInterval: number): Promise<{ poll_interval: number }> {
  const res = await fetch(`${API_BASE_URL}/settings/polling`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ poll_interval: pollInterval }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(res.status === 422
    ? 'กรุณาระบุจำนวนเต็มระหว่าง 10–3,600 วินาที'
    : 'บันทึกรอบการอ่านข้อมูลไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อบริการระบบ');
  return res.json();
}

export async function fetchDevicesApi() {
  const res = await fetch(`${API_BASE_URL}/devices`);
  if (!res.ok) throw new Error('Failed to fetch devices');
  return res.json();
}

export async function testConnectionApi(payload: {
  ip: string;
  snmp_version: string;
  community: string;
  port: number;
  device_type: string;
  name?: string;
}) {
  const res = await fetch(`${API_BASE_URL}/devices/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function createDeviceApi(payload: {
  name: string;
  ip: string;
  snmp_version: string;
  community: string;
  port: number;
  device_type: string;
}) {
  const res = await fetch(`${API_BASE_URL}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || 'Failed to add device');
  }
  return res.json();
}

export async function updateDeviceApi(
  deviceId: string,
  payload: {
    name: string;
    ip: string;
    snmp_version: string;
    community: string;
    port?: number;
    device_type: string;
    vendor?: string;
    status?: string;
  }
) {
  const res = await fetch(`${API_BASE_URL}/devices/${deviceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || 'Failed to update device');
  }
  return res.json();
}

export async function deleteDeviceApi(deviceId: string) {
  const res = await fetch(`${API_BASE_URL}/devices/${deviceId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete device');
  return res.json();
}

export async function setPortAdminApi(
  deviceId: string,
  portName: string,
  turnDown: boolean
) {
  const res = await fetch(
    `${API_BASE_URL}/interfaces/${encodeURIComponent(deviceId)}/${encodeURIComponent(portName)}/admin-status`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: turnDown ? 'down' : 'up' }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.detail || data.error || 'Failed to set port admin status');
  return data;
}

export async function fetchEventsApi(device?: string, type?: string) {
  let url = `${API_BASE_URL}/events?limit=80`;
  if (device && device !== 'all') url += `&device=${encodeURIComponent(device)}`;
  if (type && type !== 'all') url += `&type=${encodeURIComponent(type)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch events');
  return res.json();
}

export async function triggerBackendTestTrapApi() {
  const res = await fetch(`${API_BASE_URL}/events/test-trap`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to trigger test trap');
  return res.json();
}

export async function fetchAuditLogsApi() {
  const res = await fetch(`${API_BASE_URL}/audit-logs`);
  if (!res.ok) throw new Error('Failed to fetch audit logs');
  return res.json();
}

export async function fetchTopologyApi() {
  const res = await fetch(`${API_BASE_URL}/topology`);
  if (!res.ok) throw new Error('Failed to fetch topology');
  return res.json();
}

export async function fetchTrafficDataApi(
  deviceId: string,
  portName: string,
  range: string
) {
  const res = await fetch(
    `${API_BASE_URL}/interfaces/${encodeURIComponent(deviceId)}/${encodeURIComponent(portName)}/traffic?range=${range}`
  );
  if (!res.ok) throw new Error('Failed to fetch traffic samples');
  return res.json();
}

export async function fetchAggregateTrafficApi(range: string = 'day') {
  const res = await fetch(`${API_BASE_URL}/traffic/aggregate?range=${encodeURIComponent(range)}`);
  if (!res.ok) throw new Error('Failed to fetch aggregate traffic samples');
  return res.json();
}

export async function fetchLatestTrafficApi() {
  const res = await fetch(`${API_BASE_URL}/traffic/latest`);
  if (!res.ok) throw new Error('Failed to fetch latest traffic samples');
  return res.json();
}

export interface DiscoveryIssue {
  ip: string;
  name?: string;
  code: string;
  message: string;
}

export interface DiscoveryProgress {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  current_ip: string;
  current_name: string;
  checked: number;
  queued: number;
  devices_count: number;
  links_count: number;
  issues: DiscoveryIssue[];
  error?: string;
  result?: { devices: import('../types/snmp').Device[]; links: import('../types/snmp').TopologyLink[]; issues: DiscoveryIssue[] };
}

export async function runDiscoveryApi(
  target = '',
  communities: string[] = [],
  onProgress?: (progress: DiscoveryProgress) => void,
) {
  const input = target.trim();
  const request = input.includes('/') ? { subnet: input } : { seed_ip: input };
  const res = await fetch(`${API_BASE_URL}/discovery/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, communities }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(error?.detail || 'เริ่ม Discovery ไม่สำเร็จ');
  }
  let progress = await res.json() as DiscoveryProgress;
  onProgress?.(progress);
  while (progress.status === 'running') {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const status = await fetch(`${API_BASE_URL}/discovery/jobs/${progress.id}`);
    if (!status.ok) throw new Error('อ่านสถานะ Discovery ไม่สำเร็จ');
    progress = await status.json() as DiscoveryProgress;
    onProgress?.(progress);
  }
  if (progress.status !== 'completed' || !progress.result) {
    throw new Error(progress.error || 'Discovery ถูกยกเลิก');
  }
  return progress.result;
}

export function connectTrapWebSocket(
  onMessage: (data: any) => void,
  onOpen?: () => void,
  onClose?: () => void
): { close: () => void } {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let retry = 0;
  const schedule = () => {
    if (!stopped) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
  };
  const connect = () => {
    if (stopped) return;
    try {
      const ws = new WebSocket(WS_BASE_URL);
      socket = ws;
      ws.onopen = () => { retry = 0; onOpen?.(); };
      ws.onmessage = (event) => {
        try { onMessage(JSON.parse(event.data)); }
        catch (error) { console.error('Invalid live event:', error); }
      };
      ws.onclose = () => { onClose?.(); schedule(); };
      ws.onerror = () => ws.close();
    } catch { schedule(); }
  };
  connect();
  return { close: () => {
    stopped = true;
    clearTimeout(timer);
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  } };
}

export interface CdpCaptureStatus {
  status: 'stopped' | 'disabled' | 'starting' | 'listening' | 'unavailable';
  error: string;
  interfaces: string[];
}

export async function startCdpCaptureApi(): Promise<CdpCaptureStatus> {
  const response = await fetch(`${API_BASE_URL}/discovery/cdp/start`, { method: 'POST' });
  if (!response.ok) throw new Error('เริ่มตรวจจับ CDP/LLDP ไม่สำเร็จ');
  let status = await response.json() as CdpCaptureStatus;
  for (let attempt = 0; status.status === 'starting' && attempt < 5; attempt++) {
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const check = await fetch(`${API_BASE_URL}/discovery/cdp/status`);
    if (!check.ok) throw new Error('ตรวจสถานะ CDP/LLDP ไม่สำเร็จ');
    status = await check.json() as CdpCaptureStatus;
  }
  return status;
}
