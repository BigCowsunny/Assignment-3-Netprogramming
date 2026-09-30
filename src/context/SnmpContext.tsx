import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  AuditLogItem,
  ConfirmDialogOptions,
  Device,
  Port,
  TimeRange,
  ToastMessage,
  TopologyLink,
  TopologyNodePos,
  TrapEvent,
  ViewName,
} from '../types/snmp';
import { fmtHM } from '../utils/formatters';
import { scanEveNGLab, scanNetwork } from '../services/eveng';
import {
  checkBackendHealth,
  fetchDevicesApi,
  createDeviceApi,
  updateDeviceApi,
  deleteDeviceApi,
  setPortAdminApi,
  fetchEventsApi,
  fetchAuditLogsApi,
  triggerBackendTestTrapApi,
  connectTrapWebSocket,
} from '../services/api';

interface SnmpContextType {
  // State
  isBackendConnected: boolean;
  devices: Device[];
  events: TrapEvent[];
  auditLogs: AuditLogItem[];
  view: ViewName;
  selectedDeviceId: string;
  selectedPortName: string | null;
  timeRange: TimeRange;
  showVirtual: boolean;
  isRealtime: boolean;
  discoveryFound: boolean;
  topologyZoom: number;
  topologyPos: Record<string, TopologyNodePos>;
  topologyLinks: TopologyLink[];
  searchQuery: string;
  filterType: string;
  filterStatus: string;
  toasts: ToastMessage[];
  confirmDialog: ConfirmDialogOptions | null;
  pollingCountdown: number;

  // Active items
  activeDevice: Device | undefined;
  activePort: Port | undefined;

  // Actions
  setView: (view: ViewName) => void;
  openDevice: (deviceId: string) => void;
  openTraffic: (deviceId: string, portName: string) => void;
  setTimeRange: (range: TimeRange) => void;
  setShowVirtual: (show: boolean) => void;
  setIsRealtime: (realtime: boolean) => void;
  setSearchQuery: (q: string) => void;
  setFilterType: (t: string) => void;
  setFilterStatus: (s: string) => void;
  addDevice: (device: Device) => void;
  updateDevice: (device: Device) => void;
  deleteDevice: (deviceId: string) => void;
  setPortAdmin: (deviceId: string, portName: string, turnDown: boolean) => void;
  addToast: (kind: 'ok' | 'bad' | '', title: string, body?: string) => void;
  removeToast: (id: string) => void;
  openConfirm: (options: ConfirmDialogOptions) => void;
  closeConfirm: () => void;
  triggerTestTrap: () => void;
  runDiscovery: (options?: { mode: 'network' | 'eveng'; network?: string; host?: string; communities?: string; username?: string; password?: string }) => Promise<void>;
  updateTopologyPos: (id: string, x: number, y: number) => void;
  setTopologyZoom: (zoom: number | ((prev: number) => number)) => void;
  refreshDeviceData: () => void;
  addAuditLog: (action: string, target: string, result: 'สำเร็จ' | 'ล้มเหลว' | 'ล้มเหลว (RO)') => void;
  connectBackend: () => Promise<boolean>;
  addTopologyLink: (link: TopologyLink) => void;
}

const SnmpContext = createContext<SnmpContextType | null>(null);

export const SnmpProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [devices, setDevices] = useState<Device[]>([]);

  const [events, setEvents] = useState<TrapEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [view, setView] = useState<ViewName>('dashboard');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('d1');
  const [selectedPortName, setSelectedPortName] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [showVirtual, setShowVirtual] = useState<boolean>(false);
  const [isRealtime, setIsRealtime] = useState<boolean>(true);
  const [discoveryFound, setDiscoveryFound] = useState<boolean>(() => {
    try {
      return localStorage.getItem('od-found') === 'true';
    } catch {
      return false;
    }
  });

  const [topologyZoom, setTopologyZoom] = useState<number>(1);
  const [topologyPos, setTopologyPos] = useState<Record<string, TopologyNodePos>>(() => {
    try {
      const saved = localStorage.getItem('od-topo');
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log('📂 Loaded topology positions from localStorage:', parsed);
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  });

  // Clean up topology positions for deleted devices on mount
  useEffect(() => {
    setTopologyPos((prev) => {
      const deviceIds = devices.map(d => d.id);
      const cleaned: Record<string, TopologyNodePos> = {};
      let hasChanged = false;
      
      for (const [id, pos] of Object.entries(prev)) {
        if (deviceIds.includes(id)) {
          cleaned[id] = pos;
        } else {
          hasChanged = true;
          console.log('🧹 Removing stale topology position:', id);
        }
      }
      
      if (hasChanged) {
        try {
          localStorage.setItem('od-topo', JSON.stringify(cleaned));
          console.log('💾 Cleaned topology positions saved');
        } catch {}
        return cleaned;
      }
      
      return prev;
    });
  }, [devices]);

  const [topologyLinks, setTopologyLinks] = useState<TopologyLink[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const [pollingCountdown, setPollingCountdown] = useState<number>(15);

  const activeDevice = devices.find((d) => d.id === selectedDeviceId);
  const activePort = activeDevice?.ports.find((p) => p.name === selectedPortName);

  const addToast = (kind: 'ok' | 'bad' | '', title: string, body?: string) => {
    const id = 't_' + Math.random().toString(36).slice(2, 8);
    setToasts((prev) => [...prev, { id, kind, title, body }]);
    setTimeout(() => {
      removeToast(id);
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const openConfirm = (options: ConfirmDialogOptions) => {
    setConfirmDialog(options);
  };

  const closeConfirm = () => {
    setConfirmDialog(null);
  };

  const addAuditLog = (action: string, target: string, result: 'สำเร็จ' | 'ล้มเหลว' | 'ล้มเหลว (RO)') => {
    const item: AuditLogItem = {
      id: 'a_' + Date.now().toString(36),
      t: new Date(),
      user: 'admin',
      action,
      target,
      result,
    };
    setAuditLogs((prev) => [item, ...prev.slice(0, 39)]);
  };

  const openDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setSelectedPortName(null);
    setView('device');
    window.scrollTo(0, 0);
  };

  const openTraffic = (deviceId: string, portName: string) => {
    setSelectedDeviceId(deviceId);
    setSelectedPortName(portName);
    setTimeRange('day');
    setView('traffic');
    window.scrollTo(0, 0);
  };

  const addDevice = (newDevice: Device) => {
    console.log('🆕 Adding device:', newDevice.id, newDevice.name);
    setDevices((prev) => [...prev, newDevice]);
    
    // Auto add to topology
    setTopologyPos((prev) => {
      if (prev[newDevice.id]) {
        console.log('⚠️ Device already has position:', newDevice.id);
        return prev; // Already has position
      }
      
      // Calculate new position
      const existingCount = Object.keys(prev).length;
      const x = 200 + (existingCount % 3) * 250;
      const y = 200 + Math.floor(existingCount / 3) * 150;
      
      console.log(`📍 Adding topology position for ${newDevice.id}:`, { x, y });
      
      const newPos = { ...prev, [newDevice.id]: { x, y } };
      try {
        localStorage.setItem('od-topo', JSON.stringify(newPos));
        console.log('💾 Saved to localStorage:', newPos);
      } catch (e) {
        console.error('❌ Failed to save to localStorage:', e);
      }
      return newPos;
    });
    
    addAuditLog('เพิ่มอุปกรณ์', newDevice.ip, 'สำเร็จ');
    addToast(
      'ok',
      'เพิ่มอุปกรณ์แล้ว',
      `${newDevice.name} · ดึงข้อมูล interface ครบ ${newDevice.ports.filter((p) => !p.virtual).length} ports`
    );
    setSelectedDeviceId(newDevice.id);
    setSelectedPortName(null);
    setView('devices');
  };

  const updateDevice = (updatedDevice: Device) => {
    setDevices((prev) => prev.map((d) => (d.id === updatedDevice.id ? updatedDevice : d)));
    addAuditLog(`แก้ไขอุปกรณ์ ${updatedDevice.name}`, updatedDevice.ip, 'สำเร็จ');
    addToast('ok', 'แก้ไขอุปกรณ์แล้ว', `${updatedDevice.name} (${updatedDevice.ip})`);
  };

  const deleteDevice = (deviceId: string) => {
    const target = devices.find((d) => d.id === deviceId);
    if (!target) return;

    openConfirm({
      title: 'ยืนยันการลบอุปกรณ์',
      body: `ลบ <b>${target.name}</b> <span class="mono">${target.ip}</span> ออกจากตาราง monitor?<br><span class="hint">ข้อมูลทราฟฟิกย้อนหลังของอุปกรณ์นี้จะถูกลบด้วย</span>`,
      okText: 'ลบอุปกรณ์',
      danger: true,
      onConfirm: () => {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
        
        // Remove from topology positions
        setTopologyPos((prev) => {
          const newPos = { ...prev };
          delete newPos[deviceId];
          try {
            localStorage.setItem('od-topo', JSON.stringify(newPos));
          } catch {}
          return newPos;
        });
        
        if (selectedDeviceId === deviceId) {
          const remaining = devices.filter((d) => d.id !== deviceId);
          setSelectedDeviceId(remaining[0]?.id || '');
        }
        addAuditLog(`ลบอุปกรณ์ ${target.name}`, target.ip, 'สำเร็จ');
        addToast('ok', 'ลบอุปกรณ์แล้ว', target.name);
        closeConfirm();
      },
    });
  };

  const setPortAdmin = (deviceId: string, portName: string, turnDown: boolean) => {
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return;
    const port = dev.ports.find((p) => p.name === portName);
    if (!port) return;

    // Check if this is a Serial device
    const isSerial = dev.ip === 'Serial (COM)';

    if (!isSerial && !dev.rw) {
      addToast(
        'bad',
        'SNMP SET ล้มเหลว',
        `community เป็น read-only · noSuchName · ifAdminStatus.${port.idx}`
      );
      addAuditLog(`สั่ง ${turnDown ? 'Shutdown' : 'No Shutdown'} ${port.name}`, dev.name, 'ล้มเหลว (RO)');
      return;
    }

    if (isSerial) {
      addToast(
        'bad',
        'ไม่รองรับ',
        'ไม่สามารถควบคุม port ผ่าน Serial connection ได้ - ใช้ได้เฉพาะ SNMP'
      );
      return;
    }

    const isUplink = port.speed >= 10000 || /Gi0\/[12]$/.test(port.name);

    openConfirm({
      title: turnDown ? 'ยืนยันการปิดพอร์ต' : 'ยืนยันการเปิดพอร์ต',
      body: `อุปกรณ์ <b>${dev.name}</b> <span class="mono">${dev.ip}</span><br>พอร์ต <b class="mono">${port.name}</b> · ifAdminStatus.${port.idx} → ${turnDown ? '2 (down)' : '1 (up)'}${
        isUplink
          ? '<br><br><span class="hint">หมายเหตุ: พอร์ตนี้เป็น Uplink — ถ้าปิด การเชื่อมต่อชั้นเหนือขึ้นไปจะขาดทันที</span>'
          : ''
      }<br><br><span class="hint">ระบบจะส่ง SNMP SET แล้วอ่านค่ากลับมาตรวจ (FR-3.4) และบันทึก Audit log</span>`,
      okText: turnDown ? 'สั่ง Shutdown' : 'สั่ง No Shutdown',
      danger: turnDown,
      onConfirm: () => {
        closeConfirm();
        addToast(
          '',
          'กำลังส่ง SNMP SET',
          `ifAdminStatus.${port.idx} = ${turnDown ? 2 : 1} → ${dev.ip}:161`
        );

        setTimeout(() => {
          setDevices((prev) =>
            prev.map((d) => {
              if (d.id !== deviceId) return d;
              return {
                ...d,
                ports: d.ports.map((p) => {
                  if (p.name !== portName) return p;
                  return {
                    ...p,
                    admin: turnDown ? 'down' : 'up',
                    oper: turnDown ? 'down' : 'up',
                  };
                }),
              };
            })
          );

          const trapType = turnDown ? 'linkDown' : 'linkUp';
          const newEvent: TrapEvent = {
            id: 'e_' + Math.random().toString(36).slice(2, 8),
            t: new Date(),
            dev: dev.id,
            src: dev.ip,
            port: port.name,
            type: trapType,
            oid: trapType === 'linkDown' ? '1.3.6.1.6.3.1.1.5.3' : '1.3.6.1.6.3.1.1.5.4',
            isNew: true,
          };
          setEvents((prev) => [newEvent, ...prev.slice(0, 79)]);

          addAuditLog(`สั่ง ${turnDown ? 'Shutdown' : 'No Shutdown'} ${port.name}`, dev.name, 'สำเร็จ');
          addToast(
            'ok',
            'SNMP SET สำเร็จ · อ่านค่ากลับแล้ว',
            `${dev.name} · ${port.name} → ${turnDown ? 'down' : 'up'}`
          );
        }, 750);
      },
    });
  };

  let testSeq = 0;
  const triggerTestTrap = () => {
    const onlines = devices.filter((d) => d.status === 'online');
    if (!onlines.length) {
      addToast('bad', 'ส่ง Test Trap ไม่ได้', 'ไม่มีอุปกรณ์ออนไลน์');
      return;
    }

    const d = onlines[testSeq % onlines.length];
    const candidatePorts = d.ports.filter((p) => !p.virtual && p.admin === 'up');
    const p = candidatePorts.length ? candidatePorts[testSeq % candidatePorts.length] : null;
    testSeq++;

    const trapType = testSeq % 2 ? 'linkDown' : 'linkUp';

    if (p) {
      setDevices((prev) =>
        prev.map((item) => {
          if (item.id !== d.id) return item;
          return {
            ...item,
            ports: item.ports.map((portItem) => {
              if (portItem.name !== p.name) return portItem;
              return { ...portItem, oper: trapType === 'linkDown' ? 'down' : 'up' };
            }),
          };
        })
      );
    }

    const newEvent: TrapEvent = {
      id: 'e_' + Math.random().toString(36).slice(2, 8),
      t: new Date(),
      dev: d.id,
      src: d.ip,
      port: p ? p.name : 'ifIndex 1',
      type: trapType,
      oid: trapType === 'linkDown' ? '1.3.6.1.6.3.1.1.5.3' : '1.3.6.1.6.3.1.1.5.4',
      isNew: true,
    };

    setEvents((prev) => [newEvent, ...prev.slice(0, 79)]);
    addToast(
      trapType === 'linkDown' ? 'bad' : 'ok',
      `Test Trap: ${trapType}`,
      `${d.ip}:162 → ${d.name} · OID ${newEvent.oid}`
    );
  };

  const runDiscovery = async (options: { mode: 'network' | 'eveng'; network?: string; host?: string; communities?: string; username?: string; password?: string } = { mode: 'network' }): Promise<void> => {
    try {
      const found = options.mode === 'eveng'
        ? await scanEveNGLab(options.host?.trim() || '', 32768, 32775, options.username || 'admin', options.password || 'eve', true)
        : await scanNetwork(options.network?.trim() || '192.168.1.0/24', (options.communities || 'public').split(',').map((value) => value.trim()).filter(Boolean));

      const normalized = found as Device[];
      const knownIps = new Set(devices.map((device) => device.ip));
      const added = normalized.filter((device) => !knownIps.has(device.ip));
      setDevices((prev) => {
        const byIp = new Map(prev.map((device) => [device.ip, device]));
        for (const device of normalized) {
          if (!byIp.has(device.ip)) byIp.set(device.ip, device);
        }
        return [...byIp.values()];
      });
      setTopologyPos((prev) => {
        const next = { ...prev };
        added.forEach((device, index) => {
          if (!next[device.id]) next[device.id] = { x: 150 + ((Object.keys(next).length + index) % 4) * 190, y: 100 + (Math.floor((Object.keys(next).length + index) / 4) % 3) * 130 };
        });
        try { localStorage.setItem('od-topo', JSON.stringify(next)); } catch {}
        return next;
      });
      setDiscoveryFound(true);
      addAuditLog(`Auto Discovery (${options.mode === 'eveng' ? 'EVE-NG' : 'SNMP'})`, options.mode === 'eveng' ? options.host || '' : options.network || '', 'สำเร็จ');
      addToast('ok', 'Discovery เสร็จสิ้น', `พบ ${normalized.length} อุปกรณ์ · เพิ่มใหม่ ${added.length} อุปกรณ์`);
    } catch (error) {
      addAuditLog('Auto Discovery', options.mode === 'eveng' ? options.host || '' : options.network || '', 'ล้มเหลว');
      addToast('bad', 'Discovery ล้มเหลว', error instanceof Error ? error.message : 'ตรวจสอบ Backend และข้อมูลการเชื่อมต่อ');
    }
  };

  const updateTopologyPos = (id: string, x: number, y: number) => {
    setTopologyPos((prev) => {
      const next = { ...prev, [id]: { x, y } };
      try {
        localStorage.setItem('od-topo', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const addTopologyLink = (link: TopologyLink) => {
    setTopologyLinks((prev) => {
      // Check if link already exists
      const exists = prev.some(l => 
        (l.a === link.a && l.b === link.b && l.pa === link.pa && l.pb === link.pb) ||
        (l.a === link.b && l.b === link.a && l.pa === link.pb && l.pb === link.pa)
      );
      
      if (exists) {
        console.log('🔗 Link already exists:', link);
        return prev;
      }
      
      console.log('🔗 Adding topology link:', link);
      return [...prev, link];
    });
  };

  const refreshDeviceData = () => {
    setPollingCountdown(15);
    // random jitter errors
    if (selectedDeviceId) {
      setDevices((prev) =>
        prev.map((d) => {
          if (d.id !== selectedDeviceId) return d;
          const upPorts = d.ports.filter((p) => !p.virtual && p.oper === 'up');
          if (!upPorts.length) return d;
          const chosen = upPorts[Math.floor(Math.random() * upPorts.length)];
          return {
            ...d,
            ports: d.ports.map((p) =>
              p.name === chosen.name
                ? { ...p, errors: p.errors > 0 ? 0 : 6 + Math.floor(Math.random() * 20) }
                : p
            ),
          };
        })
      );
    }
    addToast('', 'รีเฟรชแล้ว', 'SNMP GET sysUpTime + ifTable ล่าสุด');
  };

  // Poller countdown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setPollingCountdown((prev) => {
        if (prev <= 1) {
          return 15;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time random SNMP Trap simulation
  useEffect(() => {
    if (!isRealtime) return;

    const interval = setInterval(() => {
      if (Math.random() < 0.65) return; // 35% chance to toggle
      const switchDevices = devices.filter((d) => d.status === 'online' && d.type === 'switch');
      if (!switchDevices.length) return;

      const randomDev = switchDevices[Math.floor(Math.random() * switchDevices.length)];
      const activePorts = randomDev.ports.filter((p) => !p.virtual && p.admin === 'up');
      if (!activePorts.length) return;

      const randomPort = activePorts[Math.floor(Math.random() * activePorts.length)];
      const nextOper = randomPort.oper === 'up' ? 'down' : 'up';
      const trapType: TrapEvent['type'] = nextOper === 'up' ? 'linkUp' : 'linkDown';

      setDevices((prev) =>
        prev.map((d) => {
          if (d.id !== randomDev.id) return d;
          return {
            ...d,
            ports: d.ports.map((p) => {
              if (p.name !== randomPort.name) return p;
              return { ...p, oper: nextOper };
            }),
          };
        })
      );

      const newTrap: TrapEvent = {
        id: 'e_' + Math.random().toString(36).slice(2, 8),
        t: new Date(),
        dev: randomDev.id,
        src: randomDev.ip,
        port: randomPort.name,
        type: trapType,
        oid: trapType === 'linkDown' ? '1.3.6.1.6.3.1.1.5.3' : '1.3.6.1.6.3.1.1.5.4',
        isNew: true,
      };

      setEvents((prev) => [newTrap, ...prev.slice(0, 79)]);
      addToast(
        trapType === 'linkDown' ? 'bad' : 'ok',
        trapType === 'linkDown' ? 'Link Down (TRAP)' : 'Link Up (TRAP)',
        `${randomDev.name} · ${randomPort.name} · ${fmtHM(new Date())}`
      );
    }, 6500);

    return () => clearInterval(interval);
  }, [isRealtime, devices]);

  const connectBackend = async (): Promise<boolean> => {
    const isOk = await checkBackendHealth();
    setIsBackendConnected(isOk);
    return isOk;
  };

  return (
    <SnmpContext.Provider
      value={{
        isBackendConnected,
        connectBackend,
        devices,
        events,
        auditLogs,
        view,
        selectedDeviceId,
        selectedPortName,
        timeRange,
        showVirtual,
        isRealtime,
        discoveryFound,
        topologyZoom,
        topologyPos,
        topologyLinks,
        searchQuery,
        filterType,
        filterStatus,
        toasts,
        confirmDialog,
        pollingCountdown,
        activeDevice,
        activePort,
        setView,
        openDevice,
        openTraffic,
        setTimeRange,
        setShowVirtual,
        setIsRealtime,
        setSearchQuery,
        setFilterType,
        setFilterStatus,
        addDevice,
        updateDevice,
        deleteDevice,
        setPortAdmin,
        addToast,
        removeToast,
        openConfirm,
        closeConfirm,
        triggerTestTrap,
        runDiscovery,
        updateTopologyPos,
        setTopologyZoom,
        refreshDeviceData,
        addAuditLog,
        addTopologyLink,
      }}
    >
      {children}
    </SnmpContext.Provider>
  );
};

export const useSnmp = (): SnmpContextType => {
  const context = useContext(SnmpContext);
  if (!context) {
    throw new Error('useSnmp must be used within an SnmpProvider');
  }
  return context;
};
