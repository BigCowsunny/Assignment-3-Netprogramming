import { AuditLogItem, Device, Port, TopologyLink, TopologyNodePos, TrapEvent } from '../types/snmp';
import { generateMAC } from '../utils/formatters';

export function createSwitchPorts(
  seed: number,
  options: { down?: string[]; admin?: string[]; err?: string[] } = {}
): Port[] {
  const ports: Port[] = [];

  for (let i = 1; i <= 24; i++) {
    ports.push({
      idx: i,
      name: `Fa0/${i}`,
      speed: 1000,
      admin: 'up',
      oper: 'up',
      errors: 0,
      mac: generateMAC(seed + i),
      alias: i <= 4 ? 'Trunk หลัก' : `Access port ${i}`,
      virtual: false,
      ip: '',
    });
  }

  [25, 26].forEach((n, k) => {
    ports.push({
      idx: n,
      name: `Gi0/${k + 1}`,
      speed: 10000,
      admin: 'up',
      oper: 'up',
      errors: 0,
      mac: generateMAC(seed + n),
      alias: k ? 'Uplink สำรอง' : 'Uplink หลัก 10G',
      virtual: false,
      ip: '',
    });
  });

  ports.push({
    idx: 101,
    name: 'Vlan1',
    speed: 1000,
    admin: 'up',
    oper: 'up',
    errors: 0,
    mac: generateMAC(seed + 101),
    alias: 'Management VLAN',
    virtual: true,
    ip: `10.255.0.${seed % 200}/32`,
  });

  (options.down || []).forEach((name) => {
    const p = ports.find((x) => x.name === name);
    if (p) p.oper = 'down';
  });

  (options.admin || []).forEach((name) => {
    const p = ports.find((x) => x.name === name);
    if (p) {
      p.admin = 'down';
      p.oper = 'down';
    }
  });

  (options.err || []).forEach((name) => {
    const p = ports.find((x) => x.name === name);
    if (p) p.errors = 9 + p.idx;
  });

  return ports;
}

export function createRouterPorts(seed: number, isOffline = false): Port[] {
  const oper = isOffline ? 'down' : 'up';
  return [
    {
      idx: 1,
      name: 'GigabitEthernet0/0',
      speed: 1000,
      admin: 'up',
      oper,
      errors: 0,
      mac: generateMAC(seed + 1),
      alias: 'Uplink หลัก ไป Core-SW-01',
      virtual: false,
      ip: '192.168.10.1/24',
    },
    {
      idx: 2,
      name: 'GigabitEthernet0/1',
      speed: 1000,
      admin: 'up',
      oper: 'down',
      errors: 0,
      mac: generateMAC(seed + 2),
      alias: 'LAN สำรอง (ไม่ได้ใช้งาน)',
      virtual: false,
      ip: '192.168.20.1/24',
    },
    {
      idx: 3,
      name: 'Serial0/0/0',
      speed: 2,
      admin: 'down',
      oper: 'down',
      errors: 0,
      mac: '-',
      alias: 'WAN ไซต์สาขา (E1 · 2 Mbps)',
      virtual: false,
      ip: '',
    },
    {
      idx: 4,
      name: 'Loopback0',
      speed: 1000,
      admin: 'up',
      oper,
      errors: 0,
      mac: '-',
      alias: 'Management',
      virtual: true,
      ip: `10.255.0.${seed % 200}/32`,
    },
    {
      idx: 5,
      name: 'Null0',
      speed: 1000,
      admin: 'up',
      oper,
      errors: 0,
      mac: '-',
      alias: 'Sinkhole',
      virtual: true,
      ip: '',
    },
  ];
}

export const INITIAL_DEVICES: Device[] = [
  {
    id: 'd1',
    name: 'Core-SW-01',
    ip: '192.168.10.11',
    type: 'switch',
    vendor: 'Cisco C2960X-24TS-L',
    descr: 'Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(4)E10',
    ver: 'v2c',
    rw: true,
    status: 'online',
    up: '42 วัน 03:11:52',
    ports: createSwitchPorts(11, { admin: ['Fa0/5'], down: ['Fa0/12'], err: ['Fa0/19'] }),
  },
  {
    id: 'd2',
    name: 'Dist-SW-02',
    ip: '192.168.10.12',
    type: 'switch',
    vendor: 'Cisco C3560X-48P',
    descr: 'Cisco IOS Software, C3560X Software (C3560X-UNIVERSALK9-M), Version 15.0(2)SE11',
    ver: 'v2c',
    rw: true,
    status: 'online',
    up: '108 วัน 21:40:07',
    ports: createSwitchPorts(22, {
      down: ['Fa0/1', 'Fa0/18'],
      admin: ['Fa0/20', 'Fa0/21', 'Fa0/22'],
    }),
  },
  {
    id: 'd3',
    name: 'Edge-RTR-01',
    ip: '192.168.10.1',
    type: 'router',
    vendor: 'Cisco IOSv 15.6',
    descr: 'Cisco IOS Software, IOSv Software (IOSV-ADVENTERENTERPRISEK9-M), Version 15.6(2)T',
    ver: 'v3',
    rw: true,
    status: 'online',
    up: '17 วัน 09:02:31',
    ports: createRouterPorts(31, false),
  },
  {
    id: 'd4',
    name: 'Access-SW-03',
    ip: '192.168.10.13',
    type: 'switch',
    vendor: 'Huawei S5730-28C-HI',
    descr: 'Huawei Versatile Routing Platform Software, VRP (R) Software, Version 5.170 (S5730 V200R010C10)',
    ver: 'v2c',
    rw: false,
    status: 'online',
    up: '5 วัน 14:26:19',
    ports: createSwitchPorts(44, { down: ['Fa0/6'], err: ['Fa0/3'] }),
  },
  {
    id: 'd5',
    name: 'Lab-RTR-EVE',
    ip: '192.168.56.101',
    type: 'router',
    vendor: 'IOL · EVE-NG Lab',
    descr: 'Cisco IOL Software, L2 Plus Service Image, Version 15.2 (Build 280)',
    ver: 'v2c',
    rw: true,
    status: 'offline',
    up: '—',
    ports: createRouterPorts(55, true),
  },
  {
    id: 'd6',
    name: 'IoT-SW-04',
    ip: '192.168.10.14',
    type: 'switch',
    vendor: 'Cisco C1000-24T',
    descr: 'Cisco IOS Software, C1000 Software (C1000-LANBASEK9-M), Version 15.2(7)E7',
    ver: 'v2c',
    rw: true,
    status: 'online',
    up: '73 วัน 01:55:44',
    ports: createSwitchPorts(66, { admin: ['Fa0/23', 'Fa0/24'] }),
  },
];

export const INITIAL_EVENTS: TrapEvent[] = [
  {
    id: 'e1',
    t: new Date(Date.now() - 4 * 60000),
    dev: 'd2',
    src: '192.168.10.12',
    port: 'Fa0/1',
    type: 'linkDown',
    oid: '1.3.6.1.6.3.1.1.5.3',
  },
  {
    id: 'e2',
    t: new Date(Date.now() - 19 * 60000),
    dev: 'd4',
    src: '192.168.10.13',
    port: 'Fa0/6',
    type: 'linkDown',
    oid: '1.3.6.1.6.3.1.1.5.3',
  },
  {
    id: 'e3',
    t: new Date(Date.now() - 46 * 60000),
    dev: 'unknown',
    src: '10.9.9.9',
    port: 'ifIndex 3',
    type: 'linkDown',
    oid: '1.3.6.1.6.3.1.1.5.3',
  },
  {
    id: 'e4',
    t: new Date(Date.now() - 72 * 60000),
    dev: 'd1',
    src: '192.168.10.11',
    port: 'Fa0/12',
    type: 'linkDown',
    oid: '1.3.6.1.6.3.1.1.5.3',
  },
  {
    id: 'e5',
    t: new Date(Date.now() - 95 * 60000),
    dev: 'd1',
    src: '192.168.10.11',
    port: 'Fa0/7',
    type: 'linkUp',
    oid: '1.3.6.1.6.3.1.1.5.4',
  },
  {
    id: 'e6',
    t: new Date(Date.now() - 140 * 60000),
    dev: 'd3',
    src: '192.168.10.1',
    port: 'GigabitEthernet0/1',
    type: 'linkDown',
    oid: '1.3.6.1.6.3.1.1.5.3',
  },
  {
    id: 'e7',
    t: new Date(Date.now() - 260 * 60000),
    dev: 'd6',
    src: '192.168.10.14',
    port: 'Fa0/9',
    type: 'linkUp',
    oid: '1.3.6.1.6.3.1.1.5.4',
  },
  {
    id: 'e8',
    t: new Date(Date.now() - 430 * 60000),
    dev: 'd2',
    src: '192.168.10.12',
    port: 'Fa0/22',
    type: 'linkDown',
    oid: '1.3.6.1.6.3.1.1.5.3',
  },
  {
    id: 'e9',
    t: new Date(Date.now() - 700 * 60000),
    dev: 'd4',
    src: '192.168.10.13',
    port: 'Fa0/3',
    type: 'linkUp',
    oid: '1.3.6.1.6.3.1.1.5.4',
  },
];

export const INITIAL_AUDIT: AuditLogItem[] = [
  {
    id: 'a1',
    t: new Date(Date.now() - 26 * 3600000),
    user: 'admin',
    action: 'สั่ง Shutdown Fa0/7',
    target: 'Core-SW-01',
    result: 'สำเร็จ',
  },
  {
    id: 'a2',
    t: new Date(Date.now() - 27 * 3600000),
    user: 'admin',
    action: 'เพิ่มอุปกรณ์',
    target: '192.168.10.14',
    result: 'สำเร็จ',
  },
  {
    id: 'a3',
    t: new Date(Date.now() - 30 * 3600000),
    user: 'viewer',
    action: 'เข้าสู่ระบบ',
    target: '—',
    result: 'สำเร็จ',
  },
];

export const INITIAL_TOPOLOGY_POS: Record<string, TopologyNodePos> = {
  d3: { x: 378, y: 66 },
  d1: { x: 378, y: 196 },
  d2: { x: 662, y: 196 },
  d4: { x: 662, y: 330 },
  d6: { x: 116, y: 196 },
  d5: { x: 116, y: 66 },
};

export const INITIAL_TOPOLOGY_LINKS: TopologyLink[] = [
  { a: 'd3', pa: 'GigabitEthernet0/0', b: 'd1', pb: 'Gi0/1' },
  { a: 'd1', pa: 'Gi0/2', b: 'd2', pb: 'Gi0/1' },
  { a: 'd2', pa: 'Fa0/1', b: 'd4', pb: 'Fa0/1' },
  { a: 'd1', pa: 'Fa0/23', b: 'd6', pb: 'Fa0/1' },
  { a: 'd3', pa: 'GigabitEthernet0/1', b: 'd5', pb: 'GigabitEthernet0/0' },
];
