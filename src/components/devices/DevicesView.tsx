import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { AddDeviceModal } from './AddDeviceModal';
import { EditDeviceModal } from './EditDeviceModal';
import { Device } from '../../types/snmp';
import { scanSerial, scanSerialWithPort } from '../../services/serial';
import { scanEveNGLab, scanNetwork } from '../../services/eveng';

export const DevicesView: React.FC = () => {
  const {
    devices,
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filterStatus,
    setFilterStatus,
    openDevice,
    deleteDevice,
    addDevice,
    addToast,
    addTopologyLink,
    refreshDeviceData,
  } = useSnmp();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [scanning, setScanning] = useState(false);
  const [autoScanned, setAutoScanned] = useState(false);
  const [showEveNGModal, setShowEveNGModal] = useState(false);
  const [eveNGHost, setEveNGHost] = useState('192.168.213.1');
  const [eveNGNetwork, setEveNGNetwork] = useState('192.168.213.0/24');
  const [eveNGStartPort, setEveNGStartPort] = useState(32768);
  const [eveNGEndPort, setEveNGEndPort] = useState(32775);
  const [eveNGUser, setEveNGUser] = useState('admin');
  const [eveNGPass, setEveNGPass] = useState('eve');
  const [scanMode, setScanMode] = useState<'api' | 'telnet' | 'network'>('api');

  const handleAutoScanAll = async () => {
    setScanning(true);
    addToast('', 'Auto Scan All...', 'กำลังค้นหาอุปกรณ์ทุกประเภท');
    
    let totalFound = 0;
    
    // 1. Scan Serial COM Ports
    console.log('🔍 Step 1: Scanning Serial COM ports...');
    try {
      if ('serial' in navigator) {
        const ports = await navigator.serial.getPorts();
        
        if (ports.length > 0) {
          console.log(`📡 Found ${ports.length} COM port(s), scanning...`);
          
          for (let i = 0; i < ports.length; i++) {
            const port = ports[i];
            console.log(`\n📡 Scanning COM port ${i + 1}/${ports.length}...`);
            
            try {
              const isOpen = (port as any).readable || (port as any).writable;
              if (isOpen) {
                await port.close();
                await new Promise(r => setTimeout(r, 1000));
              }
              
              await port.open({
                baudRate: 9600,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
              });

              await new Promise(r => setTimeout(r, 500));

              const result = await scanSerialWithPort(port, i);
              
              if (result.ok && result.portName && result.interfaces) {
                if (!devices.some(d => d.name === result.portName)) {
                  const portsList = result.interfaces.map((name: string, idx: number) => {
                    const status = result.interfaceStatus?.[name] || { admin: 'up', oper: 'up' };
                    return {
                      idx: idx + 1,
                      name: name,
                      speed: name.includes('Gigabit') ? 1000 : name.includes('Fast') ? 100 : 10,
                      admin: status.admin,
                      oper: status.oper,
                      errors: 0,
                      mac: `00:1a:${idx.toString(16).padStart(2, '0')}:2b:3c:4d`,
                      alias: name,
                      virtual: name.includes('Vlan') || name.includes('Loopback'),
                      ip: '',
                    };
                  });

                  const dev: Device = {
                    id: `s${Date.now()}_${i}`,
                    name: result.portName,
                    ip: 'Serial (COM)',
                    ver: 'v2c',
                    rw: false,
                    type: (result.type || 'router') as 'router' | 'switch',
                    vendor: 'Cisco',
                    descr: 'Console Cable',
                    status: 'online',
                    up: '0d 0h',
                    ports: portsList,
                  };

                  addDevice(dev);
                  totalFound++;
                  console.log(`  ✅ Found: ${result.portName}`);
                }
              }
            } catch (e: any) {
              console.log(`  ⚠️ COM ${i + 1}: ${e.message}`);
              try { await port.close(); } catch {}
            }
            
            await new Promise(r => setTimeout(r, 1000));
          }
        } else {
          console.log('ℹ️ No authorized COM ports');
        }
      }
    } catch (error) {
      console.error('Serial scan error:', error);
    }
    
    // 2. Scan Network (SNMP)
    console.log('\n🔍 Step 2: Scanning network via SNMP...');
    try {
      const results = await scanNetwork(eveNGNetwork, ['public', 'private']);
      
      for (const result of results) {
        if (!result.name) continue;
        
        if (!devices.some(d => d.name === result.name || d.ip === result.ip)) {
          addDevice(result as Device);
          totalFound++;
          console.log(`  ✅ Found: ${result.name} (${result.ip})`);
        }
      }
    } catch (error) {
      console.error('Network scan error:', error);
    }
    
    setScanning(false);
    
    if (totalFound > 0) {
      addToast('ok', `พบ ${totalFound} อุปกรณ์!`, 'เพิ่มเข้าระบบเรียบร้อย');
    } else {
      addToast('', 'ไม่พบอุปกรณ์ใหม่', 'อุปกรณ์ที่มีอยู่ในระบบครบแล้ว');
    }
    
    console.log(`\n✅ Auto Scan Complete: ${totalFound} devices found`);
  };

  const handleAutoScan = async () => {
    if (scanning || autoScanned) return;
    setAutoScanned(true);

    try {
      // Get previously authorized ports
      const ports = await navigator.serial.getPorts();
      
      if (ports.length === 0) {
        console.log('ℹ️ No authorized COM ports. Click "Scan COM Port" to authorize.');
        return;
      }

      console.log(`🔍 Auto-scanning ${ports.length} COM port(s)...`);
      setScanning(true);
      addToast('', 'Auto-scanning...', `ตรวจสอบ ${ports.length} COM ports`);

      let foundCount = 0;

      // Try each port
      for (let i = 0; i < ports.length; i++) {
        const port = ports[i];
        console.log(`\n📡 Scanning port ${i + 1}/${ports.length}...`);
        
        try {
          // Check if port is already open
          const portInfo = (port as any).getInfo?.() || {};
          console.log(`  ℹ️ Port info:`, portInfo);
          
          const isOpen = (port as any).readable || (port as any).writable;
          if (isOpen) {
            console.log(`  ⚠️ Port ${i + 1} already open, closing first...`);
            try {
              await port.close();
              await new Promise(r => setTimeout(r, 1000)); // รอให้ปิดสมบูรณ์
            } catch (closeErr) {
              console.log(`  ⚠️ Could not close port ${i + 1}:`, closeErr);
              // ถ้าปิดไม่ได้ ข้ามไป port ถัดไป
              continue;
            }
          }
          
          // Try to open port
          console.log(`  🔌 Opening port ${i + 1}...`);
          await port.open({
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
          });

          console.log(`  ✅ Port ${i + 1} connected`);
          
          // Give device time to stabilize
          await new Promise(r => setTimeout(r, 500));

          // Detect device
          console.log(`  🔍 Detecting device on port ${i + 1}...`);
          const result = await scanSerialWithPort(port, i);
          
          if (result.ok && result.portName && result.interfaces) {
            // Check if device already exists (by port name)
            const existingDevice = devices.find(d => d.name === result.portName);
            if (existingDevice) {
              console.log(`  ⚠️ Device "${result.portName}" already exists, skipping`);
              continue;
            }

            // Create device
            const portsList = result.interfaces.map((name: string, idx: number) => {
              const status = result.interfaceStatus?.[name] || { admin: 'up', oper: 'up' };
              
              return {
                idx: idx + 1,
                name: name,
                speed: name.includes('Gigabit') ? 1000 : name.includes('Fast') ? 100 : 10,
                admin: status.admin,
                oper: status.oper,
                errors: 0,
                mac: `00:1a:${idx.toString(16).padStart(2, '0')}:2b:3c:4d`,
                alias: name,
                virtual: name.includes('Vlan') || name.includes('Loopback'),
                ip: '',
              };
            });

            const dev: Device = {
              id: `s${Date.now()}_${i}`,
              name: result.portName, // ใช้ชื่อ COM port
              ip: 'Serial (COM)',
              ver: 'v2c',
              rw: false,
              type: (result.type || 'router') as 'router' | 'switch',
              vendor: 'Cisco',
              descr: 'Console Cable',
              status: 'online',
              up: '0d 0h',
              ports: portsList,
            };

            addDevice(dev);
            foundCount++;
            
            const upCount = portsList.filter(p => p.oper === 'up').length;
            console.log(`  🎉 Found: ${result.portName} (${upCount}/${portsList.length} up)`);
            
            // Add CDP topology links
            if (result.cdpNeighbors && result.cdpNeighbors.length > 0) {
              console.log(`  🔗 Processing ${result.cdpNeighbors.length} CDP neighbors...`);
              for (const neighbor of result.cdpNeighbors) {
                // Find neighbor device by hostname
                const neighborDevice = devices.find(d => 
                  d.name === neighbor.remoteDevice || 
                  d.name.includes(neighbor.remoteDevice) ||
                  neighbor.remoteDevice.includes(d.name)
                );
                
                if (neighborDevice) {
                  addTopologyLink({
                    a: dev.id,
                    pa: neighbor.localPort,
                    b: neighborDevice.id,
                    pb: neighbor.remotePort
                  });
                  console.log(`    ✓ Link: ${result.portName}[${neighbor.localPort}] <--> ${neighborDevice.name}[${neighbor.remotePort}]`);
                } else {
                  console.log(`    ⚠️ Neighbor device "${neighbor.remoteDevice}" not found in devices list`);
                }
              }
            }
          } else {
            console.log(`  ❌ Port ${i + 1}: No device detected - ${result.error || 'Unknown error'}`);
            console.log(`  💡 Possible reasons:`);
            console.log(`     - Device not booted completely`);
            console.log(`     - Cable not connected properly`);
            console.log(`     - Device in bootloader/ROMMON mode`);
            console.log(`     - Incorrect baud rate (current: 9600)`);
          }
        } catch (e: any) {
          console.error(`  ❌ Port ${i + 1} error:`, e);
          if (e.message?.includes('Failed to open')) {
            console.log(`  ⚠️ Port ${i + 1}: Already open or in use (close PuTTY/TeraTerm)`);
          } else if (e.message?.includes('The device has been lost')) {
            console.log(`  ⚠️ Port ${i + 1}: Device disconnected`);
          } else if (e.message?.includes('already open')) {
            console.log(`  ⚠️ Port ${i + 1}: Port is locked by another process`);
          } else {
            console.log(`  ⚠️ Port ${i + 1}: ${e.message}`);
          }
          
          // Try to close port if error
          try {
            await port.close();
          } catch (closeErr) {
            console.log(`  ⚠️ Could not close port ${i + 1}`);
          }
        }
        
        // Add delay between ports
        if (i < ports.length - 1) {
          console.log(`  ⏳ Waiting 2 seconds before next port...`);
          await new Promise(r => setTimeout(r, 2000)); // เพิ่มเวลารอ
        }
      }

      setScanning(false);

      // Summary
      if (foundCount > 0) {
        addToast('ok', `เจอ ${foundCount} อุปกรณ์`, `จาก ${ports.length} COM ports`);
      } else {
        addToast('', 'ไม่เจออุปกรณ์', `สแกน ${ports.length} COM ports แล้ว`);
      }

      console.log(`\n✅ Scan complete: ${foundCount} devices found from ${ports.length} ports`);

    } catch (error) {
      console.log('Auto-scan error:', error);
      setScanning(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    addToast('', 'Scanning...', 'เลือก COM port');

    const result = await scanSerial();

    if (result.ok && result.portName && result.interfaces) {
      // Check duplicate
      if (devices.some(d => d.name === result.portName)) {
        addToast('', 'มีอยู่แล้ว', result.portName);
        setScanning(false);
        return;
      }

      // Create device with real status
      const ports = result.interfaces.map((name: string, i: number) => {
        const status = result.interfaceStatus?.[name] || { admin: 'up', oper: 'up' };
        
        return {
          idx: i + 1,
          name: name,
          speed: name.includes('Gigabit') ? 1000 : name.includes('Fast') ? 100 : 10,
          admin: status.admin,
          oper: status.oper,
          errors: 0,
          mac: `00:1a:${i.toString(16).padStart(2, '0')}:2b:3c:4d`,
          alias: name,
          virtual: name.includes('Vlan') || name.includes('Loopback'),
          ip: '',
        };
      });

      const dev: Device = {
        id: `s${Date.now()}`,
        name: result.portName, // ใช้ชื่อ COM port
        ip: 'Serial (COM)',
        ver: 'v2c',
        rw: false,
        type: (result.type || 'router') as 'router' | 'switch',
        vendor: 'Cisco',
        descr: 'Console Cable',
        status: 'online',
        up: '0d 0h',
        ports: ports,
      };

      addDevice(dev);
      
      const upCount = ports.filter(p => p.oper === 'up').length;
      const downCount = ports.filter(p => p.oper === 'down').length;
      addToast('ok', 'เจอแล้ว!', `${result.portName}: ${upCount} up, ${downCount} down (${ports.length} total)`);
    } else {
      addToast('bad', 'ไม่เจอ', result.error || '');
    }

    setScanning(false);
  };

  const handleRefresh = () => {
    refreshDeviceData();
  };

  const handleEveNGScan = async () => {
    setScanning(true);
    setShowEveNGModal(false);
    
    if (scanMode === 'network') {
      // Network scan mode
      addToast('', 'Scanning Network...', `${eveNGNetwork}`);
      
      try {
        const results = await scanNetwork(eveNGNetwork, ['public', 'private']);
        
        if (results.length === 0) {
          addToast('', 'ไม่เจออุปกรณ์', 'ตรวจสอบว่า network และ SNMP community ถูกต้อง');
          setScanning(false);
          return;
        }
        
        let addedCount = 0;
        
        for (const result of results) {
          if (!result.name) continue;
          
          if (devices.some(d => d.name === result.name || d.ip === result.ip)) {
            console.log(`Device "${result.name}" (${result.ip}) already exists, skipping`);
            continue;
          }
          
          addDevice(result as Device);
          addedCount++;
        }
        
        if (addedCount > 0) {
          addToast('ok', `เจอ ${addedCount} อุปกรณ์!`, `จาก network ${eveNGNetwork}`);
        } else {
          addToast('', 'ไม่มีอุปกรณ์ใหม่', 'อุปกรณ์ที่เจอมีอยู่ในระบบแล้ว');
        }
        refreshDeviceData();
        
      } catch (error: any) {
        console.error('Network scan error:', error);
        addToast('bad', 'Scan ล้มเหลว', error.message || 'ไม่สามารถ scan network ได้');
      }
      
    } else {
      // EVE-NG API / Telnet scan mode
      const modeLabel = scanMode === 'api' ? 'EVE-NG REST API' : 'EVE-NG Telnet';
      addToast('', `Scanning ${modeLabel}...`, `${eveNGHost}`);
      
      try {
        const results = await scanEveNGLab(
          eveNGHost,
          eveNGStartPort,
          eveNGEndPort,
          eveNGUser,
          eveNGPass,
          false
        );
        
        if (results.length === 0) {
          addToast('', 'ไม่พบอุปกรณ์ใน EVE-NG', 'ตรวจสอบว่า EVE-NG ทำงาน และ Node เปิดอยู่ (Running state)');
          setScanning(false);
          return;
        }
        
        const names = results.map((result: any) => result.name).filter(Boolean);
        addToast('ok', `พบ ${names.length} Node ใน EVE-NG`, names.length
          ? `${names.join(', ')} · ใช้ management IP ใน “เพิ่มด้วย IP” หรือสแกน management subnet เพื่ออ่านพอร์ตด้วย SNMP`
          : 'ไม่พบ Node ที่กำลังทำงานใน Lab');
        
      } catch (error: any) {
        console.error('EVE-NG scan error:', error);
        addToast('bad', 'Scan ล้มเหลว', error.message || 'ไม่สามารถเชื่อมต่อ EVE-NG');
      }
    }
    
    setScanning(false);
  };

  const filteredDevices = devices.filter((d) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q || d.name.toLowerCase().includes(q) || d.ip.includes(q);
    const matchesType = filterType === 'all' || d.type === filterType;
    const matchesStatus = filterStatus === 'all' || d.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const getPortRatio = (d: (typeof devices)[0]) => {
    const ps = d.ports.filter((p) => !p.virtual);
    const u = ps.filter((p) => p.admin === 'up' && p.oper === 'up').length;
    return `${u}/${ps.length}`;
  };

  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h1>อุปกรณ์</h1>
          <p>จัดการ Router/Switch ที่ลงทะเบียนไว้ในระบบ monitor</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-ghost" onClick={handleRefresh} disabled={scanning}>
            <Icon name="i-refresh" />
            Refresh
          </button>
          <button className="btn btn-ghost" onClick={() => setShowEveNGModal(true)} disabled={scanning}>
            <Icon name="i-topo" />
            Network Scan
          </button>
          <button className="btn btn-ghost" onClick={handleScan} disabled={scanning}>
            <Icon name="i-server" />
            COM Port
          </button>
          <button className="btn btn-ghost" onClick={() => setIsAddModalOpen(true)}>
            <Icon name="i-plus" />
            เพิ่มด้วย IP
          </button>
        </div>
      </div>

      <div className="toolbar">
        <label className="gsearch">
          <Icon name="i-search" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อ / IP"
            aria-label="ค้นหา"
          />
        </label>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          aria-label="กรองประเภท"
        >
          <option value="all">ประเภท: ทั้งหมด</option>
          <option value="router">Router</option>
          <option value="switch">Switch</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="กรองสถานะ"
        >
          <option value="all">สถานะ: ทั้งหมด</option>
          <option value="online">ออนไลน์</option>
          <option value="offline">ออฟไลน์</option>
        </select>

        <span className="spacer"></span>
        <span className="count">
          แสดง {filteredDevices.length} / {devices.length} อุปกรณ์
        </span>
      </div>

      <div className="card">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>สถานะ</th>
                <th>อุปกรณ์</th>
                <th>ประเภท</th>
                <th>รุ่น</th>
                <th>Uptime</th>
                <th>Port (up/total)</th>
                <th>SNMP</th>
                <th className="r">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.length ? (
                filteredDevices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.status === 'online' ? (
                        <span className="pill ok">
                          <i></i>ออนไลน์
                        </span>
                      ) : (
                        <span className="pill bad">
                          <i></i>ออฟไลน์
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="devlink"
                        onClick={() => openDevice(d.id)}
                      >
                        {d.name}
                      </button>
                      <div className="sub">{d.ip}</div>
                    </td>
                    <td>{d.type === 'switch' ? 'Switch' : 'Router'}</td>
                    <td className="hint">{d.vendor}</td>
                    <td className="mono">{d.up}</td>
                    <td className="mono">{getPortRatio(d)}</td>
                    <td className="mono">
                      {d.ver} · SET ตรวจที่อุปกรณ์
                    </td>
                    <td className="r">
                      <button
                        className="btn btn-ghost"
                        onClick={() => openDevice(d.id)}
                      >
                        ดูพอร์ต
                      </button>{' '}
                      <button
                        className="btn btn-ghost"
                        onClick={() => setEditingDevice(d)}
                        title="แก้ไขอุปกรณ์"
                      >
                        <Icon name="i-set" />
                        แก้ไข
                      </button>{' '}
                      <button
                        className="btn btn-ghost danger-txt"
                        onClick={() => deleteDevice(d.id)}
                      >
                        <Icon name="i-trash" />
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="empty">
                    ไม่พบอุปกรณ์ที่ตรงกับตัวกรอง
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddDeviceModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />
      <EditDeviceModal
        device={editingDevice}
        isOpen={!!editingDevice}
        onClose={() => setEditingDevice(null)}
      />
      
      {/* EVE-NG Scan Modal */}
      {showEveNGModal && (
        <div className="modal-backdrop" onClick={() => setShowEveNGModal(false)}>
          <div
            className="sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '650px' }}
          >
            <div className="sheet-head">
              <div>
                <h2>Auto-Discovery EVE-NG / Network</h2>
                <p>สแกนหาอุปกรณ์อัตโนมัติผ่าน SNMP หรือ Telnet</p>
              </div>
              <button className="icon-btn" onClick={() => setShowEveNGModal(false)}>
                <Icon name="i-x" />
              </button>
            </div>

            <div className="sheet-body">
              {/* Scan Mode Selector */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button
                  className={`btn ${scanMode === 'api' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setScanMode('api')}
                  style={{ flex: 1 }}
                >
                  <Icon name="i-server" />
                  EVE-NG REST API
                </button>
                <button
                  className={`btn ${scanMode === 'telnet' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setScanMode('telnet')}
                  style={{ flex: 1 }}
                >
                  <Icon name="i-radar" />
                  Telnet Console
                </button>
                <button
                  className={`btn ${scanMode === 'network' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setScanMode('network')}
                  style={{ flex: 1 }}
                >
                  <Icon name="i-topo" />
                  SNMP Sweep
                </button>
              </div>

              {scanMode === 'api' ? (
                <>
                  <div className="field">
                    <label>EVE-NG Host IP</label>
                    <input
                      type="text"
                      value={eveNGHost}
                      onChange={(e) => setEveNGHost(e.target.value)}
                      placeholder="192.168.213.1 หรือ 192.168.1.100"
                    />
                    <small className="hint">IP Address ของ EVE-NG Server</small>
                  </div>

                  <div className="fgrid">
                    <div className="field">
                      <label>Username</label>
                      <input
                        type="text"
                        value={eveNGUser}
                        onChange={(e) => setEveNGUser(e.target.value)}
                        placeholder="admin"
                      />
                    </div>
                    <div className="field">
                      <label>Password</label>
                      <input
                        type="password"
                        value={eveNGPass}
                        onChange={(e) => setEveNGPass(e.target.value)}
                        placeholder="eve"
                      />
                    </div>
                  </div>

                  <div className="testbox on" style={{ background: '#e8f5e9', borderColor: '#4caf50' }}>
                    <b>⚡ EVE-NG REST API (แนะนำ)</b>
                    <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '13px' }}>
                      <li>เชื่อมต่อ EVE-NG API อัตโนมัติ</li>
                      <li>ดึง Router / Switch จาก Lab ที่เปิดอยู่ออกมาแสดงผล</li>
                      <li>ไม่ต้องสแกนสุ่ม IP หรือ Telnet Port</li>
                    </ul>
                  </div>
                </>
              ) : scanMode === 'telnet' ? (
                <>
                  <div className="field">
                    <label>EVE-NG Host IP</label>
                    <input
                      type="text"
                      value={eveNGHost}
                      onChange={(e) => setEveNGHost(e.target.value)}
                      placeholder="192.168.213.1"
                    />
                  </div>

                  <div className="fgrid">
                    <div className="field">
                      <label>Start Port</label>
                      <input
                        type="number"
                        value={eveNGStartPort}
                        onChange={(e) => setEveNGStartPort(parseInt(e.target.value))}
                        placeholder="32768"
                      />
                    </div>
                    <div className="field">
                      <label>End Port</label>
                      <input
                        type="number"
                        value={eveNGEndPort}
                        onChange={(e) => setEveNGEndPort(parseInt(e.target.value))}
                        placeholder="32775"
                      />
                    </div>
                  </div>

                  <div className="testbox on">
                    <b>💡 EVE-NG Telnet Console Ports</b>
                    <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '13px' }}>
                      <li>สแกนพอร์ต Telnet ใน EVE-NG (ปกติ 32768-32775)</li>
                      <li>ระบบจะส่งสัญญาณ `\r\n` เพื่ออ่าน hostname และชนิดอุปกรณ์ (Router/Switch)</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label>Network CIDR</label>
                    <input
                      type="text"
                      value={eveNGNetwork}
                      onChange={(e) => setEveNGNetwork(e.target.value)}
                      placeholder="192.168.213.0/24"
                    />
                    <small className="hint">
                      ใส่ network ที่ต้องการ scan (เช่น VMnet8: 192.168.213.0/24)
                    </small>
                  </div>

                  <div className="testbox on" style={{ background: '#e3f2fd', borderColor: '#2196f3' }}>
                    <b>🌐 Network SNMP Sweep</b>
                    <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '13px' }}>
                      <li>Scan ทั้ง subnet หาอุปกรณ์ที่เปิด SNMP</li>
                      <li>ลอง SNMP community: public, private</li>
                      <li>ดึง sysName, sysDescr และ Interfaces จริง</li>
                    </ul>
                  </div>
                </>
              )}
            </div>

            <div className="sheet-foot">
              <button className="btn" onClick={() => setShowEveNGModal(false)}>
                ยกเลิก
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleEveNGScan}
                disabled={scanning}
              >
                <Icon name="i-radar" />
                {scanning ? 'Connecting & Fetching...' : 'เชื่อมต่อ & ดึงอุปกรณ์'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
