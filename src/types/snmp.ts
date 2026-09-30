export type DeviceType = 'switch' | 'router';
export type DeviceStatus = 'online' | 'offline';
export type AdminStatus = 'up' | 'down';
export type OperStatus = 'up' | 'down';
export type SnmpVersion = 'v2c' | 'v3';
export type TrapType = 'linkUp' | 'linkDown';
export type TimeRange = 'live' | 'day' | 'week' | 'month' | 'year';
export type ViewName = 'dashboard' | 'devices' | 'device' | 'traffic' | 'events' | 'topology' | 'settings';

export interface Port {
  idx: number;
  name: string;
  speed: number; // in Mbps
  admin: AdminStatus;
  oper: OperStatus;
  errors: number;
  mac: string;
  alias: string;
  virtual: boolean;
  ip: string;
}

export interface Device {
  id: string;
  name: string;
  ip: string;
  type: DeviceType;
  vendor: string;
  descr: string;
  ver: SnmpVersion;
  community?: string;
  port?: number;
  snmp_port?: number;
  rw: boolean;
  status: DeviceStatus;
  up: string;
  ports: Port[];
}

export interface TrapEvent {
  id: string;
  t: Date;
  dev: string; // device id or 'unknown'
  src: string;
  port: string;
  type: TrapType;
  oid: string;
  isNew?: boolean;
}

export interface AuditLogItem {
  id: string;
  t: Date;
  user: string;
  action: string;
  target: string;
  result: 'สำเร็จ' | 'ล้มเหลว' | 'ล้มเหลว (RO)';
}

export interface TopologyNodePos {
  x: number;
  y: number;
}

export interface TopologyLink {
  a: string; // device A id
  pa: string; // port A name
  b: string; // device B id
  pb: string; // port B name
}

export interface TrafficPoint {
  t: number;
  in: number | null;
  out: number | null;
}

export interface TrafficStats {
  min: number;
  max: number;
  avg: number;
  cur: number;
}

export interface ToastMessage {
  id: string;
  kind: 'ok' | 'bad' | '';
  title: string;
  body?: string;
}

export interface ConfirmDialogOptions {
  title: string;
  body: string;
  okText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}
