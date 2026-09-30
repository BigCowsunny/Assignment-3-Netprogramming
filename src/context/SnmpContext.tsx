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
  fetchTopologyApi,
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
  const [isBootstrapped, setIsBootstrapped] = useState<boolean>(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [topologyLinks, setTopologyLinks] = useState<TopologyLink[]>([]);

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

  useEffect(() => {
    let active = true;
    const loadBackendState = async () => {
      const healthy = await checkBackendHealth();
      if (!active) return;
      setIsBackendConnected(healthy);
      if (!healthy) {
        setIsBootstrapped(true);
        return;
      }

      const [deviceResult, eventResult, auditResult, topologyResult] = await Promise.allSettled([
        fetchDevicesApi(), fetchEventsApi(), fetchAuditLogsApi(), fetchTopologyApi(),
      ]);
      if (!active) return;
      if (deviceResult.status === 'fulfilled') {
        const loadedDevices = deviceResult.value as Device[];
        setDevices(loadedDevices);
        setSelectedDeviceId((current) => loadedDevices.some((device) => device.id === current) ? current : (loadedDevices[0]?.id || ''));
      }
      if (eventResult.status === 'fulfilled') setEvents((eventResult.value as any[]).map((event) => ({ ...event, t: new Date(event.t) })));
      if (auditResult.status === 'fulfilled') setAuditLogs((auditResult.value as any[]).map((item) => ({
        id: item.id, t: new Date(item.timestamp), user: item.user, action: item.action, target: item.target, result: item.result,
      })));
      if (topologyResult.status === 'fulfilled') {
        const topology = topologyResult.value as { devices: Device[]; links: TopologyLink[] };
        setTopologyLinks(topology.links || []);
        setTopologyPos((saved) => {
          const next = { ...saved };
          (topology.devices || []).forEach((device, index) => {
            if (!next[device.id]) next[device.id] = { x: 150 + (index % 4) * 190, y: 100 + (Math.floor(index / 4) % 3) * 130 };
          });
          try { localStorage.setItem('od-topo', JSON.stringify(next)); } catch {}
          return next;
        });
      }
      setIsBootstrapped(true);
    };
    void loadBackendState();
    return () => { active = false; };
  }, []);

  // Clean up topology positions for deleted devices after backend state has been loaded.
  useEffect(() => {
    if (!isBootstrapped || !isBackendConnected) return;
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
  }, [devices, isBootstrapped, isBackendConnected]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const [pollingCountdown, setPollingCountdown] = useState<number>(60);

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

  const updateDevice = async (updatedDevice: Device) => {
    try {
      const saved = updatedDevice.ip === 'Serial (COM)' ? updatedDevice : await updateDeviceApi(updatedDevice.id, {
        name: updatedDevice.name,
        ip: updatedDevice.ip,
        snmp_version: updatedDevice.ver,
        community: updatedDevice.community || 'public',
        port: updatedDevice.snmp_port || updatedDevice.port || 161,
        device_type: updatedDevice.type,
        vendor: updatedDevice.vendor,
        status: updatedDevice.status,
      });
      setDevices((prev) => prev.map((d) => (d.id === updatedDevice.id ? saved as Device : d)));
      addAuditLog(`แก้ไขอุปกรณ์ ${updatedDevice.name}`, updatedDevice.ip, 'สำเร็จ');
      addToast('ok', 'แก้ไขอุปกรณ์แล้ว', `${updatedDevice.name} (${updatedDevice.ip})`);
    } catch (error) {
      addToast('bad', 'แก้ไขอุปกรณ์ไม่สำเร็จ', error instanceof Error ? error.message : String(error));
    }
  };

  const deleteDevice = (deviceId: string) => {
    const target = devices.find((d) => d.id === deviceId);
    if (!target) return;

    openConfirm({
      title: 'ยืนยันการลบอุปกรณ์',
      body: `ลบ <b>${target.name}</b> <span class="mono">${target.ip}</span> ออกจากตาราง monitor?<br><span class="hint">ข้อมูลทราฟฟิกย้อนหลังของอุปกรณ์นี้จะถูกลบด้วย</span>`,
      okText: 'ลบอุปกรณ์',
      danger: true,
      onConfirm: async () => {
        try {
          if (target.ip !== 'Serial (COM)') await deleteDeviceApi(deviceId);
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
        setTopologyLinks((prev) => prev.filter((link) => link.a !== deviceId && link.b !== deviceId));
        
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
        } catch (error) {
          addToast('bad', 'ลบอุปกรณ์ไม่สำเร็จ', error instanceof Error ? error.message : String(error));
          closeConfirm();
        }
      },
    });
  };

  const setPortAdmin = (deviceId: string, portName: string, turnDown: boolean) => {
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return;
    const port = dev.ports.find((p) => p.name === portName);
    if (!port) return;
    if (dev.ip === 'Serial (COM)') {
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
          `ifAdminStatus.${port.idx} = ${turnDown ? 2 : 1} → ${dev.ip}:${dev.snmp_port || dev.port || 161}`
        );

        void setPortAdminApi(deviceId, portName, turnDown).then((result) => {
          setDevices((prev) =>
            prev.map((d) => {
              if (d.id !== deviceId) return d;
              return {
                ...d,
                ports: d.ports.map((p) => {
                  if (p.name !== portName) return p;
                  return {
                    ...p,
                    admin: result.admin,
                    oper: result.oper,
                  };
                }),
              };
            })
          );
          addAuditLog(`สั่ง ${turnDown ? 'Shutdown' : 'No Shutdown'} ${port.name}`, dev.name, 'สำเร็จ');
          addToast(
            'ok',
            'SNMP SET สำเร็จ · อ่านค่าจากอุปกรณ์แล้ว',
            `${dev.name} · ${port.name} · admin ${result.admin}, oper ${result.oper}`
          );
        }).catch((error) => {
          addAuditLog(`สั่ง ${turnDown ? 'Shutdown' : 'No Shutdown'} ${port.name}`, dev.name, 'ล้มเหลว');
          addToast('bad', 'SNMP SET ล้มเหลว', error instanceof Error ? error.message : String(error));
        });
      },
    });
  };

  const triggerTestTrap = () => {
    void triggerBackendTestTrapApi().then((result) => {
      if (!result.ok) throw new Error(result.error || 'ส่ง SNMP Trap ไม่สำเร็จ');
      addToast('', 'ส่ง SNMP Test Trap แล้ว', 'รอรับ packet จาก Trap Receiver ผ่าน UDP');
    }).catch((error) => addToast('bad', 'ส่ง Test Trap ไม่สำเร็จ', error instanceof Error ? error.message : String(error)));
  };

  const runDiscovery = async (options: { mode: 'network' | 'eveng'; network?: string; host?: string; communities?: string; username?: string; password?: string } = { mode: 'network' }): Promise<void> => {
    try {
      const found = options.mode === 'eveng'
        ? await scanEveNGLab(options.host?.trim() || '', 32768, 32775, options.username || 'admin', options.password || 'eve', true)
        : await scanNetwork(options.network?.trim() || '192.168.1.0/24', (options.communities || 'public').split(',').map((value) => value.trim()).filter(Boolean));

      if (options.mode === 'eveng') {
        const names = found.map((node: any) => node.name).filter(Boolean);
        setDiscoveryFound(true);
        addAuditLog('EVE-NG Lab Inventory', options.host || '', 'สำเร็จ');
        addToast('ok', `พบ ${names.length} Node ใน EVE-NG`, names.length
          ? `${names.join(', ')} · ใส่ management IP ของ node ใน “เพิ่มด้วย IP” หรือสแกน management subnet เพื่อดึงพอร์ตผ่าน SNMP`
          : 'ไม่พบ Node ที่กำลังทำงานใน Lab');
        return;
      }

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
      const topology = await fetchTopologyApi().catch(() => null);
      if (topology) setTopologyLinks(topology.links || []);
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
    setPollingCountdown(60);
    void fetchDevicesApi().then((freshDevices: Device[]) => {
      setDevices(freshDevices);
      addToast('', 'รีเฟรชแล้ว', 'อ่านสถานะและ interface ล่าสุดจาก Backend/SNMP');
    }).catch((error) => addToast('bad', 'รีเฟรชไม่สำเร็จ', error instanceof Error ? error.message : String(error)));
  };

  // Poller countdown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setPollingCountdown((prev) => {
        if (prev <= 1) {
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Receive only actual backend trap/status events over the WebSocket.
  useEffect(() => {
    if (!isRealtime || !isBackendConnected) return;
    const socket = connectTrapWebSocket((message) => {
      if (message.type === 'TRAP_EVENT' && message.event) {
        const event = { ...message.event, t: new Date(message.event.t) } as TrapEvent;
        setEvents((prev) => [event, ...prev.filter((item) => item.id !== event.id)].slice(0, 80));
        if (event.dev !== 'unknown') {
          setDevices((prev) => prev.map((device) => device.id !== event.dev ? device : {
            ...device,
            ports: device.ports.map((port) => port.name === event.port ? { ...port, oper: event.type === 'linkDown' ? 'down' : 'up' } : port),
          }));
        }
        addToast(event.type === 'linkDown' ? 'bad' : 'ok', event.type === 'linkDown' ? 'Link Down (SNMP Trap)' : 'Link Up (SNMP Trap)', `${event.src} · ${event.port}`);
      } else if (message.type === 'PORT_STATUS_CHANGE') {
        setDevices((prev) => prev.map((device) => device.id !== message.device_id ? device : {
          ...device,
          ports: device.ports.map((port) => port.name === message.port_name ? { ...port, admin: message.admin, oper: message.oper } : port),
        }));
      } else if (message.type === 'DEVICE_STATUS_CHANGE') {
        setDevices((prev) => prev.map((device) => device.id === message.device_id ? { ...device, status: message.status, up: message.uptime || device.up } : device));
      }
    });
    return () => socket?.close();
  }, [isRealtime, isBackendConnected]);

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
