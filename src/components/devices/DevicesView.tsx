import React, { useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { DeviceActionMenu } from './DeviceActionMenu';
import './devices.css';
import { useDeviceDialog } from './useDeviceDialog';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { CiscoDeviceIcon } from '../common/CiscoDeviceIcon';
import { AddDeviceModal } from './AddDeviceModal';
import { EditDeviceModal } from './EditDeviceModal';
import { Device } from '../../types/snmp';
import { scanSerial, scanSerialWithPort } from '../../services/serial';
import { scanNetwork } from '../../services/networkDiscovery';
import { startCdpCaptureApi } from '../../services/api';
import { configurationWarning } from '../../utils/deviceManagement';

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
  const [scanNetworkCidr, setScanNetworkCidr] = useState('192.168.213.0/24');
  const [scanCommunities, setScanCommunities] = useState('public,private');
  const scanDialog = useDeviceDialog(showEveNGModal, () => setShowEveNGModal(false));

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
      const results = await scanNetwork(scanNetworkCidr, scanCommunities.split(',').map((community) => community.trim()).filter(Boolean));
      
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

  const handleCdpCapture = async () => {
    setScanning(true);
    try {
      const status = await startCdpCaptureApi();
      if (status.status === 'unavailable' || status.status === 'disabled') {
        addToast('bad', 'ยังตรวจจับ CDP/LLDP ไม่ได้', status.error || 'บริการรับข้อมูล CDP/LLDP ยังไม่ได้เปิดใช้งาน');
      } else {
        addToast('', status.status === 'listening' ? 'กำลังรับ CDP/LLDP จากสายเครือข่าย' : 'กำลังเริ่มตัวรับ CDP/LLDP', 'รออุปกรณ์ส่ง CDP/LLDP; อุปกรณ์ที่ไม่มี IP จะแสดงพร้อมคำเตือนว่า Config ไม่ได้');
      }
      refreshDeviceData();
    } catch (error) {
      addToast('bad', 'ตรวจจับ CDP/LLDP ไม่สำเร็จ', error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
    }
  };

  const handleNetworkScan = async () => {
    setScanning(true);
    setShowEveNGModal(false);
    addToast('', 'กำลังสแกน SNMP', scanNetworkCidr);
    try {
      const results = await scanNetwork(
        scanNetworkCidr,
        scanCommunities.split(',').map((community) => community.trim()).filter(Boolean),
      );
      let addedCount = 0;
      for (const result of results) {
        if (!result.name || devices.some((device) => device.id === result.id)) continue;
        addDevice(result as Device);
        addedCount++;
      }
      addToast(
        addedCount ? 'ok' : '',
        addedCount ? `พบอุปกรณ์ใหม่ ${addedCount} เครื่อง` : 'ไม่พบอุปกรณ์ใหม่',
        `ตรวจ SNMP ใน ${scanNetworkCidr} และอ่าน CDP neighbor จากอุปกรณ์ที่ Monitor`,
      );
      refreshDeviceData();
    } catch (error) {
      addToast('bad', 'SNMP scan ล้มเหลว', error instanceof Error ? error.message : 'ตรวจสอบสถานะบริการระบบและการเชื่อมต่อเครือข่าย');
    }
    setScanning(false);
  };

  const [sortAscending, setSortAscending] = useState(true);
  const hasFilters = !!searchQuery.trim() || filterType !== 'all' || filterStatus !== 'all';
  const clearFilters = () => {
    setSearchQuery('');
    setFilterType('all');
    setFilterStatus('all');
  };
  const statusOf = (device: Device) => device.discovery_only ? 'discovered' : device.status;
  const filteredDevices = devices.filter((device) => {
    const q = searchQuery.trim().toLowerCase();
    return (!q || device.name.toLowerCase().includes(q) || device.ip.toLowerCase().includes(q)) &&
      (filterType === 'all' || device.type === filterType) &&
      (filterStatus === 'all' || statusOf(device) === filterStatus);
  }).sort((a, b) => (sortAscending ? 1 : -1) * a.name.localeCompare(b.name, 'th', { numeric: true }));

  const summary = [
    { key: 'all', label: 'อุปกรณ์ทั้งหมด', count: devices.length, tone: 'neutral' },
    { key: 'online', label: 'ออนไลน์', count: devices.filter((device) => statusOf(device) === 'online').length, tone: 'online' },
    { key: 'offline', label: 'ออฟไลน์', count: devices.filter((device) => statusOf(device) === 'offline').length, tone: 'offline' },
    { key: 'discovered', label: 'พบผ่าน CDP/LLDP', count: devices.filter((device) => statusOf(device) === 'discovered').length, tone: 'discovered' },
  ];
  const vendorLabel = (device: Device) => {
    const vendor = device.vendor.trim();
    return vendor.match(/^(Cisco|Juniper|Arista|MikroTik|Ubiquiti|Huawei|HPE|HP|Dell)\b/i)?.[0] || vendor;
  };

  return (
    <section className="view active devices-view">
      <div className="page-head devices-page-head">
        <div>
          <h1>อุปกรณ์</h1>
          <p>ติดตามสถานะและจัดการพอร์ตของ Router / Switch</p>
        </div>
        <div className="devices-page-actions">
          <button className="icon-btn device-refresh" onClick={handleRefresh} disabled={scanning}
            aria-label="รีเฟรชอุปกรณ์" title="รีเฟรชอุปกรณ์">
            <Icon name="i-refresh" />
          </button>
          <DeviceActionMenu label="วิธีค้นหาเพิ่มเติม" text="เพิ่มเติม" disabled={scanning} actions={[
            { label: 'ตรวจจับ CDP/LLDP', icon: 'i-radar', description: 'รับประกาศจากอุปกรณ์ในเครือข่าย', onSelect: handleCdpCapture },
            { label: 'เชื่อมต่อ COM Port', icon: 'i-server', description: 'ค้นหาอุปกรณ์ผ่านสาย Console', onSelect: handleScan },
          ]} />
          <button className="btn" onClick={() => setShowEveNGModal(true)} disabled={scanning}>
            <Icon name="i-radar" />{scanning ? 'กำลังค้นหา…' : 'ค้นหาอุปกรณ์'}
          </button>
          <button className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
            <Icon name="i-plus" />เพิ่มด้วย IP
          </button>
        </div>
      </div>

      <div className="device-status-summary" aria-label="สรุปสถานะอุปกรณ์">
        {summary.map((item) => <button key={item.key}
          className={'device-summary-item ' + item.tone + (filterStatus === item.key ? ' selected' : '')}
          aria-pressed={filterStatus === item.key}
          aria-label={item.label + ' ' + item.count + ' อุปกรณ์'}
          onClick={() => setFilterStatus(item.key)}>
          <span className="device-summary-label"><i aria-hidden="true" />{item.label}</span>
          <strong>{item.count}<small>อุปกรณ์</small></strong>
        </button>)}
      </div>

      <div className="card devices-inventory">
        <div className="devices-list-heading">
          <h2>รายการอุปกรณ์</h2>
          <span aria-live="polite">แสดง <b>{filteredDevices.length}</b> จาก {devices.length} อุปกรณ์</span>
        </div>
        <div className="devices-filters">
          <label className="device-search">
            <Icon name="i-search" aria-hidden="true" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="ค้นหาชื่ออุปกรณ์หรือ IP address" aria-label="ค้นหาชื่ออุปกรณ์หรือ IP" />
            {searchQuery && <button className="icon-btn" aria-label="ล้างคำค้นหา" onClick={() => setSearchQuery('')}>
              <Icon name="i-x" />
            </button>}
          </label>
          <select value={filterType} onChange={(event) => setFilterType(event.target.value)} aria-label="กรองประเภท">
            <option value="all">ประเภท: ทั้งหมด</option>
            <option value="router">Router</option>
            <option value="switch">Switch</option>
          </select>
          <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} aria-label="กรองสถานะ">
            <option value="all">สถานะ: ทั้งหมด</option>
            <option value="online">ออนไลน์</option>
            <option value="offline">ออฟไลน์</option>
            <option value="discovered">พบผ่าน CDP/LLDP</option>
          </select>
          {hasFilters && <button className="btn btn-ghost device-clear-filters" onClick={clearFilters}>
            <Icon name="i-x" />ล้างตัวกรอง
          </button>}
        </div>

        {!!filteredDevices.length && <div className="tablewrap">
          <table className="data devices-table" aria-label="รายการอุปกรณ์เครือข่าย">
            <colgroup>
              <col className="device-col-name" />
              <col className="device-col-status" />
              <col className="device-col-ip" />
              <col className="device-col-ports" />
              <col className="device-col-uptime" />
              <col className="device-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" aria-sort={sortAscending ? 'ascending' : 'descending'}>
                  <button className="device-sort" onClick={() => setSortAscending(!sortAscending)}
                    title="สลับลำดับชื่ออุปกรณ์">
                    อุปกรณ์{sortAscending ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />}
                  </button>
                </th>
                <th scope="col">สถานะ</th>
                <th scope="col">IP / SNMP</th>
                <th scope="col" title="พอร์ต Up / พอร์ตจริงทั้งหมด">Ports Up / Total</th>
                <th scope="col" className="device-col-uptime">Uptime</th>
                <th scope="col" className="r">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((device) => {
                const pending = statusOf(device) === 'discovered';
                const physicalPorts = device.ports.filter((port) => !port.virtual);
                const upPorts = physicalPorts.filter((port) => port.admin === 'up' && port.oper === 'up').length;
                const warning = configurationWarning(device);
                const statusClass = pending ? 'warn' : device.status === 'online' ? 'ok' : 'bad';
                const uptime = device.up && device.up !== '—' ? device.up : '—';
                return <tr key={device.id}>
                  <td>
                    <div className="device-identity">
                      <span className={'device-type-icon ' + device.type} aria-hidden="true">
                        <CiscoDeviceIcon deviceType={device.type} size={34} />
                      </span>
                      <div className="device-identity-copy">
                        <button className="devlink device-name" title={device.name} onClick={() => openDevice(device.id)}>
                          {device.name}
                        </button>
                        <span className="device-row-meta" title={device.vendor + (device.descr ? ' · ' + device.descr : '')}>
                          {device.type === 'switch' ? 'Switch' : 'Router'}{vendorLabel(device) && ' · ' + vendorLabel(device)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={'pill ' + statusClass}><i aria-hidden="true" />
                      {pending ? 'พบผ่าน CDP/LLDP' : device.status === 'online' ? 'ออนไลน์' : 'ออฟไลน์'}
                    </span>
                    {warning && <span className="device-config-warning" title={warning} aria-label={warning}>
                      <Icon name="i-triangle-alert" size={12} aria-hidden="true" />Config ไม่ได้
                    </span>}
                  </td>
                  <td>
                    <span className={device.ip ? 'device-address mono' : 'device-address missing-ip'}>{device.ip || 'ไม่มี IP'}</span>
                    <span className="device-row-meta">
                      {pending ? (device.discovery_protocol || 'CDP/LLDP') : device.ip === 'Serial (COM)' ? 'Console' : 'SNMP ' + device.ver}
                    </span>
                  </td>
                  <td>
                    {pending ? <><span className="device-port-count mono">{device.ports.length}<small> พอร์ต</small></span>
                      <span className="device-row-meta">จาก {device.discovery_protocol || 'neighbor'}</span></> :
                      <div title="สถานะพอร์ตจริงจากข้อมูล SNMP ล่าสุด">
                        <span className="device-port-count mono">{upPorts}<span> / {physicalPorts.length}</span></span>
                        <div className={'device-port-track' + (device.status !== 'online' ? ' inactive' : '')} aria-hidden="true">
                          <i style={{ width: (physicalPorts.length ? upPorts / physicalPorts.length * 100 : 0) + '%' }} />
                        </div>
                      </div>}
                  </td>
                  <td className="device-col-uptime">
                    <span className="device-uptime mono" title={pending ? 'ยังไม่มีข้อมูล SNMP' : uptime}>
                      {pending ? '—' : uptime}
                    </span>
                  </td>
                  <td className="r">
                    <div className="device-row-actions">
                      <button className="btn device-ports-button" onClick={() => openDevice(device.id)}
                        aria-label={'ดูพอร์ต ' + device.name}>ดูพอร์ต</button>
                      <DeviceActionMenu label={'จัดการ ' + device.name} actions={[
                        { label: pending ? 'ตั้งค่า IP/SNMP' : 'แก้ไขอุปกรณ์', icon: 'i-cog', onSelect: () => setEditingDevice(device) },
                        { label: 'ลบอุปกรณ์', icon: 'i-trash', danger: true, onSelect: () => deleteDevice(device.id) },
                      ]} />
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
        {!filteredDevices.length && <div className="devices-empty">
          <span className="devices-empty-icon"><Icon name={hasFilters ? 'i-search' : 'i-server'} size={24} /></span>
          <h3>{hasFilters ? 'ไม่พบอุปกรณ์ที่ตรงกับตัวกรอง' : 'ยังไม่มีอุปกรณ์ในระบบ'}</h3>
          <p>{hasFilters ? 'ลองเปลี่ยนคำค้นหา หรือแสดงอุปกรณ์ทั้งหมด' : 'เพิ่มอุปกรณ์ด้วย IP หรือค้นหาอุปกรณ์ที่เปิด SNMP'}</p>
          <button className="btn" onClick={hasFilters ? clearFilters : () => setIsAddModalOpen(true)}>{hasFilters ? 'ล้างตัวกรอง' : 'เพิ่มด้วย IP'}</button>
        </div>}
        <div className="devices-list-footer">
          <Icon name="i-circle-check" size={14} aria-hidden="true" />
          <span>คลิกชื่ออุปกรณ์เพื่อดูพอร์ตและทราฟฟิก · อุปกรณ์ที่พบผ่าน CDP/LLDP ต้องยืนยัน SNMP ก่อน Config</span>
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
      
      {/* SNMP network scan modal */}
      {showEveNGModal && (
        <div className="modal" onClick={() => setShowEveNGModal(false)}>
          <div
            ref={scanDialog}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-device-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '650px' }}
          >
            <div className="sheet-head">
              <div>
                <h2 id="scan-device-title">ค้นหาอุปกรณ์ด้วย SNMP</h2>
                <p>ค้นหาอุปกรณ์จริงหรือ node ใน EVE-NG ที่เปิด SNMP และมี Management IP</p>
              </div>
              <button className="icon-btn" onClick={() => setShowEveNGModal(false)} aria-label="ปิด">
                <Icon name="i-x" />
              </button>
            </div>

            <div className="sheet-body">
              <div className="field">
                <label htmlFor="device-scan-cidr">Network CIDR</label>
                <input
                  id="device-scan-cidr"
                  type="text"
                  value={scanNetworkCidr}
                  onChange={(e) => setScanNetworkCidr(e.target.value)}
                  placeholder="192.168.213.0/24"
                />
                <small className="hint">ระบุ subnet ของ Management IP ที่ระบบเข้าถึงได้</small>
              </div>
              <div className="field">
                <label htmlFor="device-scan-communities">SNMP communities</label>
                <input
                  id="device-scan-communities"
                  type="text"
                  value={scanCommunities}
                  onChange={(e) => setScanCommunities(e.target.value)}
                  placeholder="public,private"
                />
                <small className="hint">ใส่ community คั่นด้วย comma; ระบบจะแสดงอุปกรณ์เมื่ออ่าน SNMP และ IF-MIB ได้</small>
              </div>
              <div className="testbox device-scan-note">
                <b>ค้นพบผ่าน SNMP เท่านั้น</b>
                <p>อุปกรณ์จริงและอุปกรณ์ใน EVE-NG ต้องมี Management IP เปิด SNMP และอนุญาตให้ระบบเข้าถึงได้</p>
              </div>
            </div>

            <div className="sheet-foot">
              <button className="btn" onClick={() => setShowEveNGModal(false)}>
                ยกเลิก
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleNetworkScan}
                disabled={scanning || !scanNetworkCidr.trim() || !scanCommunities.trim()}
              >
                <Icon name="i-radar" />
                {scanning ? 'กำลังสแกน...' : 'สแกนด้วย SNMP'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
