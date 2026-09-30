/** Discover managed devices through the backend's SNMP scanner. */
export async function scanNetwork(
  network = '192.168.1.0/24',
  communities: string[] = ['public'],
): Promise<any[]> {
  const response = await fetch('http://localhost:8000/api/network/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ network, communities, max_concurrent: 50 }),
  });

  if (!response.ok) {
    throw new Error(`SNMP scan failed: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.devices || [];
}
