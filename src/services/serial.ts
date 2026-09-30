/**
 * Serial Port Communication for Console Cable
 */

let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

async function send(cmd: string): Promise<void> {
  if (!port?.writable) return;
  const writer = port.writable.getWriter();
  await writer.write(new TextEncoder().encode(cmd + '\r\n'));
  writer.releaseLock();
}

async function read(ms: number = 5000): Promise<string> {
  if (!port?.readable) return '';
  
  let output = '';
  
  // Release previous reader if exists
  if (reader) {
    try {
      reader.releaseLock();
    } catch (e) {}
  }
  
  reader = port.readable.getReader();
  const start = Date.now();
  let lastDataTime = Date.now();
  let consecutiveEmpty = 0;

  try {
    while (Date.now() - start < ms) {
      const readTimeout = 1500; // เพิ่ม timeout การอ่านแต่ละครั้ง
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<any>(r => setTimeout(() => r({ done: false, value: null }), readTimeout))
      ]);
      
      if (done) break;
      
      if (value && value.length > 0) {
        output += new TextDecoder().decode(value);
        lastDataTime = Date.now();
        consecutiveEmpty = 0;
      } else {
        consecutiveEmpty++;
        // ถ้าไม่มีข้อมูล 3 ครั้งติดกัน และเงียบมา 2 วินาที ให้หยุด
        if (consecutiveEmpty >= 3 && Date.now() - lastDataTime > 2000) {
          console.log('  📭 No more data, stopping read');
          break;
        }
      }
    }
  } catch (e) {
    console.log('Read error:', e);
  }

  try { 
    reader.releaseLock(); 
  } catch (e) {
    console.log('Reader release error:', e);
  }
  
  reader = null;
  return output;
}

export async function scanSerial(): Promise<{
  ok: boolean;
  name?: string;
  type?: string;
  interfaces?: string[];
  interfaceStatus?: Record<string, { admin: 'up' | 'down', oper: 'up' | 'down' }>;
  portName?: string;
  cdpNeighbors?: Array<{ localPort: string; remoteDevice: string; remotePort: string }>;
  error?: string;
}> {
  try {
    if (!('serial' in navigator)) {
      return { ok: false, error: 'ใช้ Chrome/Edge เท่านั้น' };
    }

    port = await navigator.serial.requestPort();
    if (!port) return { ok: false, error: 'ไม่ได้เลือก port' };

    // Release reader if exists
    if (reader) {
      try {
        await reader.cancel();
        reader.releaseLock();
      } catch (e) {
        console.log('Reader cleanup:', e);
      }
      reader = null;
    }

    // Check if port is already open
    if ((port as any).readable || (port as any).writable) {
      console.log('⚠️ Port already open, closing first...');
      try {
        await port.close();
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.log('Could not close port:', e);
      }
    }

    await port.open({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none'
    });

    console.log('✅ Connected');

    const result = await detectDevice();
    
    // Create COM port name from detected hostname
    if (result.ok && result.name) {
      const portName = createComPortName(result.name);
      console.log('📌 Port name:', portName, '(from hostname:', result.name, ')');
      return { ...result, portName };
    }

    return result;

  } catch (e: any) {
    console.error('❌ Error:', e);
    
    // Cleanup
    if (reader) {
      try {
        await reader.cancel();
        reader.releaseLock();
      } catch (x) {
        console.log('Reader cleanup error:', x);
      }
      reader = null;
    }
    
    if (port) {
      try {
        await port.close();
      } catch (x) {
        console.log('Port close error:', x);
      }
    }
    
    port = null;
    return { ok: false, error: e.message || 'Error' };
  }
}

// For auto-scan with existing port
export async function scanSerialWithPort(existingPort: SerialPort, portIndex: number): Promise<{
  ok: boolean;
  name?: string;
  type?: string;
  interfaces?: string[];
  interfaceStatus?: Record<string, { admin: 'up' | 'down', oper: 'up' | 'down' }>;
  portName?: string;
  cdpNeighbors?: Array<{ localPort: string; remoteDevice: string; remotePort: string }>;
  error?: string;
}> {
  try {
    port = existingPort;
    
    const result = await detectDevice();
    
    // Create COM port name from detected hostname
    if (result.ok && result.name) {
      const portName = createComPortName(result.name, portIndex);
      console.log('📌 Port name:', portName, '(from hostname:', result.name, ')');
      return { ...result, portName };
    }
    
    return result;
  } catch (e: any) {
    console.error('❌ Error:', e);
    
    // Cleanup
    if (reader) {
      try {
        await reader.cancel();
        reader.releaseLock();
      } catch (x) {}
      reader = null;
    }
    
    if (port) {
      try {
        await port.close();
      } catch (x) {}
    }
    
    port = null;
    return { ok: false, error: e.message || 'Error' };
  }
}

// Helper function to determine COM port number from scan
// Since Web Serial API doesn't expose actual COM port names,
// we'll use the hostname from the device and add COM prefix
function createComPortName(hostname: string, portIndex?: number): string {
  // If hostname looks like it already has COM prefix, use it
  if (/^COM\d+$/i.test(hostname)) {
    return hostname.toUpperCase();
  }
  
  // Create COM name from hostname
  // Examples: "Router" -> "Router-COM", "SW1" -> "SW1-COM"
  const baseName = hostname || 'Device';
  
  // If we have port index, add it
  if (portIndex !== undefined) {
    return `${baseName}-COM${portIndex + 1}`;
  }
  
  return `${baseName}-COM`;
}

async function detectDevice(): Promise<{
  ok: boolean;
  name?: string;
  type?: string;
  interfaces?: string[];
  interfaceStatus?: Record<string, { admin: 'up' | 'down', oper: 'up' | 'down' }>;
  cdpNeighbors?: Array<{ localPort: string; remoteDevice: string; remotePort: string }>;
  error?: string;
}> {

    // Wake up and exit config mode
    console.log('  📤 Sending wake up commands...');
    await send('');
    await new Promise(r => setTimeout(r, 1000));
    await send('end'); // Exit config mode if in config mode
    await new Promise(r => setTimeout(r, 1000));
    await send('');
    await new Promise(r => setTimeout(r, 1000));

    // Enable mode
    console.log('  📤 Entering enable mode...');
    await send('enable');
    await new Promise(r => setTimeout(r, 2000)); // เพิ่มเวลา

    // No paging
    console.log('  📤 Setting terminal length 0...');
    await send('terminal length 0');
    await new Promise(r => setTimeout(r, 1500));

    // Get interfaces
    console.log('  📤 Getting interfaces...');
    await send('show ip interface brief');
    await new Promise(r => setTimeout(r, 3000)); // เพิ่มเวลารอให้ Router ตอบ
    const output = await read(12000); // เพิ่มเวลาอ่าน

    console.log('📄 Output length:', output.length, 'chars');
    if (output.length < 50) {
      console.log('⚠️ Output too short, might be incomplete');
    }

    // Parse interfaces with status
    const lines = output.split(/[\r\n]+/);
    const interfaceMap = new Map<string, { admin: 'up' | 'down', oper: 'up' | 'down' }>();

    for (const line of lines) {
      const t = line.trim();
      if (!t || t.length < 3) continue;
      if (t.includes('Interface') || t.includes('---')) continue;

      // Parse line format: Interface IP-Address OK? Method Status Protocol
      // Example: GigabitEthernet0/0 unassigned YES unset administratively down down
      // Example: GigabitEthernet0/1 192.168.1.1 YES manual up up
      
      const parts = t.split(/\s+/);
      if (parts.length < 5) continue;

      const ifName = parts[0];
      const status = parts[4]?.toLowerCase() || 'down'; // Status (admin)
      const protocol = parts[5]?.toLowerCase() || 'down'; // Protocol (oper)

      const patterns = [
        /^(GigabitEthernet\d+\/\d+(?:\/\d+)?)/i,
        /^(Gi\d+\/\d+(?:\/\d+)?)/i,
        /^(FastEthernet\d+\/\d+(?:\/\d+)?)/i,
        /^(Fa\d+\/\d+(?:\/\d+)?)/i,
        /^(Ethernet\d+\/\d+(?:\/\d+)?)/i,
        /^(Serial\d+\/\d+(?:\/\d+)?)/i,
        /^(Vlan\d+)/i,
        /^(Loopback\d+)/i
      ];

      for (const pattern of patterns) {
        const m = ifName.match(pattern);
        if (m) {
          let name = m[1];
          name = name.replace(/^Gi(\d)/i, 'GigabitEthernet$1');
          name = name.replace(/^Fa(\d)/i, 'FastEthernet$1');
          
          // Determine admin and oper status
          let adminStatus: 'up' | 'down' = 'down';
          let operStatus: 'up' | 'down' = 'down';

          // Admin status
          if (status.includes('administratively')) {
            adminStatus = 'down'; // administratively down
          } else if (status === 'up') {
            adminStatus = 'up';
          } else {
            adminStatus = 'down';
          }

          // Oper status
          if (protocol === 'up') {
            operStatus = 'up';
          } else {
            operStatus = 'down';
          }

          interfaceMap.set(name, { admin: adminStatus, oper: operStatus });
          console.log(`  ✓ ${name}: admin=${adminStatus}, oper=${operStatus}`);
          break;
        }
      }
    }

    const interfaces = Array.from(interfaceMap.keys());
    const type = interfaces.some(i => i.startsWith('Vlan')) ? 'switch' : 'router';

    console.log(`📊 Total interfaces: ${interfaces.length}`);

    // Get CDP neighbors
    console.log('📡 Getting CDP neighbors...');
    await send('show cdp neighbors detail');
    await new Promise(r => setTimeout(r, 3000)); // เพิ่มเวลารอ CDP
    const cdpOutput = await read(15000); // เพิ่มเวลาอ่าน CDP
    console.log('📄 CDP Output length:', cdpOutput.length, 'chars');

    const cdpNeighbors: Array<{ localPort: string; remoteDevice: string; remotePort: string }> = [];
    
    // Parse CDP neighbors
    const cdpBlocks = cdpOutput.split(/Device ID:/i);
    for (let i = 1; i < cdpBlocks.length; i++) {
      const block = cdpBlocks[i];
      
      // Extract device name
      const deviceMatch = block.match(/^[\s]*([^\r\n]+)/);
      const remoteDevice = deviceMatch ? deviceMatch[1].trim() : '';
      
      // Extract local interface
      const localMatch = block.match(/Interface:\s*([^,\r\n]+)/i);
      const localPort = localMatch ? localMatch[1].trim() : '';
      
      // Extract remote port
      const remoteMatch = block.match(/Port ID \(outgoing port\):\s*([^\r\n]+)/i);
      const remotePort = remoteMatch ? remoteMatch[1].trim() : '';
      
      if (remoteDevice && localPort && remotePort) {
        // Normalize interface names
        let normLocal = localPort.replace(/^Gig\s*/i, 'GigabitEthernet')
                                  .replace(/^Fas\s*/i, 'FastEthernet')
                                  .replace(/^Eth\s*/i, 'Ethernet');
        let normRemote = remotePort.replace(/^Gig\s*/i, 'GigabitEthernet')
                                   .replace(/^Fas\s*/i, 'FastEthernet')
                                   .replace(/^Eth\s*/i, 'Ethernet');
        
        cdpNeighbors.push({
          localPort: normLocal,
          remoteDevice: remoteDevice,
          remotePort: normRemote
        });
        console.log(`  🔗 CDP: ${normLocal} <--> ${remoteDevice} ${normRemote}`);
      }
    }
    
    console.log(`📊 Total CDP neighbors: ${cdpNeighbors.length}`);

    // Get hostname - try multiple methods
    console.log('📤 Getting hostname...');
    
    // Method 1: show running-config | include hostname
    await send('show running-config | include hostname');
    await new Promise(r => setTimeout(r, 1500)); // เพิ่มเวลา
    const hostnameOut = await read(5000); // เพิ่มเวลาอ่าน
    
    let hostname = 'Router';
    const hm = hostnameOut.match(/hostname\s+(\S+)/i);
    if (hm && hm[1]) {
      hostname = hm[1];
      console.log('✅ Hostname from config:', hostname);
    } else {
      // Method 2: Try to extract from prompt in previous output
      console.log('⚠️ Trying to get hostname from prompt...');
      const promptMatch = output.match(/\r?\n([A-Za-z0-9_-]+)[#>]/);
      if (promptMatch && promptMatch[1]) {
        hostname = promptMatch[1];
        console.log('✅ Hostname from prompt:', hostname);
      } else {
        // Method 3: Send show version and look for hostname
        console.log('⚠️ Trying show version...');
        await send('show version | include uptime');
        await new Promise(r => setTimeout(r, 1500)); // เพิ่มเวลา
        const versionOut = await read(5000); // เพิ่มเวลาอ่าน
        const vm = versionOut.match(/(\S+)\s+uptime/i);
        if (vm && vm[1]) {
          hostname = vm[1];
          console.log('✅ Hostname from version:', hostname);
        } else {
          // Method 4: Just send Enter and capture prompt
          console.log('⚠️ Trying to capture prompt...');
          await send('');
          await new Promise(r => setTimeout(r, 1000)); // เพิ่มเวลา
          const promptOut = await read(3000); // เพิ่มเวลาอ่าน
          const pm = promptOut.match(/\r?\n([A-Za-z0-9_-]+)[#>]\s*$/);
          if (pm && pm[1]) {
            hostname = pm[1];
            console.log('✅ Hostname from final prompt:', hostname);
          } else {
            console.log('⚠️ Could not determine hostname, using default');
            hostname = `Router-${Date.now().toString().slice(-6)}`;
          }
        }
      }
    }

    // Close properly
    try {
      if (reader) {
        await reader.cancel();
        reader.releaseLock();
        reader = null;
      }
    } catch (e) {
      console.log('Reader cleanup:', e);
    }
    
    try {
      if (port) {
        await port.close();
        port = null;
      }
    } catch (e) {
      console.log('Port close error:', e);
    }

    console.log(`✅ Final: ${hostname} (${type}) - ${interfaces.length} interfaces, ${cdpNeighbors.length} CDP neighbors`);

    if (interfaces.length === 0) {
      return { ok: false, error: 'ไม่เจอ interface' };
    }

    return {
      ok: true,
      name: hostname, // ชื่อจาก Router (เก็บไว้สำหรับ reference)
      type: type,
      interfaces: interfaces,
      interfaceStatus: Object.fromEntries(interfaceMap),
      cdpNeighbors: cdpNeighbors
    };
}
