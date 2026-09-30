/**
 * EVE-NG Device Discovery via Backend API
 * Scans EVE-NG console ports through backend network scanner
 */

export interface EveNGScanResult {
  ok: boolean;
  name?: string;
  type?: string;
  host?: string;
  port?: number;
  interfaces?: string[];
  interfaceStatus?: Record<string, { admin: 'up' | 'down', oper: 'up' | 'down' }>;
  cdpNeighbors?: Array<{ localPort: string; remoteDevice: string; remotePort: string }>;
  error?: string;
}

/**
 * Scan network for devices via Backend API
 */
export async function scanNetwork(network: string = "192.168.1.0/24", communities: string[] = ["public"]): Promise<any[]> {
  console.log(`🔍 Scanning network: ${network}...`);
  
  try {
    const response = await fetch('http://localhost:8000/api/network/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network, communities, max_concurrent: 50 })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`✅ Network scan complete: ${data.count} devices found`);
    return data.devices || [];
    
  } catch (e: any) {
    console.error('❌ Network scan error:', e);
    throw e;
  }
}

/**
 * Scan EVE-NG lab for devices via Backend API
 */
export async function scanEveNGLab(
  host: string,
  startPort: number = 32768,
  endPort: number = 32775,
  username: string = 'admin',
  password: string = 'eve',
  autoSave: boolean = false
): Promise<any[]> {
  console.log(`🔍 Scanning EVE-NG: ${host}:${startPort}-${endPort}...`);
  
  try {
    const response = await fetch('http://localhost:8000/api/eveng/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        start_port: startPort,
        end_port: endPort,
        username,
        password,
        auto_save: autoSave
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`✅ EVE-NG scan complete: ${data.count} devices found`);
    return data.devices || [];
    
  } catch (e: any) {
    console.error('❌ EVE-NG scan error:', e);
    throw e;
  }
}

