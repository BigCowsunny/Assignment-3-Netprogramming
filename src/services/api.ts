/**
 * API Service for communication between React Frontend and FastAPI Backend
 */

const API_BASE_URL = 'http://localhost:8000/api';
const WS_BASE_URL = 'ws://localhost:8000/ws/events';

export interface BackendHealth {
  status: string;
  service: string;
  trap_port: number;
  poller: string;
  timestamp: number;
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

export async function runDiscoveryApi(seedIp?: string, community = 'public', subnet = '') {
  const res = await fetch(`${API_BASE_URL}/discovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed_ip: seedIp, community, subnet }),
  });
  if (!res.ok) throw new Error('Failed to run discovery');
  return res.json();
}

export function connectTrapWebSocket(
  onMessage: (data: any) => void,
  onOpen?: () => void,
  onClose?: () => void
): WebSocket | null {
  try {
    const ws = new WebSocket(WS_BASE_URL);
    ws.onopen = () => {
      if (onOpen) onOpen();
    };
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessage(parsed);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };
    ws.onclose = () => {
      if (onClose) onClose();
    };
    ws.onerror = (err) => {
      console.warn('WebSocket error:', err);
    };
    return ws;
  } catch (err) {
    console.warn('Could not establish WebSocket connection:', err);
    return null;
  }
}
