import { Device, TrapEvent } from '../types/snmp';

const address = (value?: string) => (value || '').trim().split('/')[0];

export function resolveTrapEvent(event: TrapEvent, devices: Device[]): TrapEvent {
  const unique = (matches: Device[]) => matches.length === 1 ? matches[0] : undefined;
  const byAddress = (ip?: string) => ip && unique(devices.filter(device =>
    address(device.ip) === address(ip) || device.ports.some(port => address(port.ip) === address(ip))));
  let device = devices.find(item => item.id === event.dev) || byAddress(event.agent_ip) || undefined;
  const name = event.agent_name?.trim().toLowerCase();
  if (!device && name) {
    const exact = devices.filter(item => item.name.toLowerCase() === name);
    device = unique(exact.length ? exact : devices.filter(item =>
      item.name.toLowerCase().split('.')[0] === name.split('.')[0]));
  }
  if (!device && !event.agent_ip && !name) device = byAddress(event.src) || undefined;
  if (!device) return event;
  const port = !device.discovery_only && event.if_index
    ? device.ports.find(item => item.idx === event.if_index)?.name : undefined;
  return { ...event, dev: device.id, dev_name: device.name, port: port || event.port };
}

export function trapDeviceName(event: TrapEvent, devices: Device[]): string {
  return devices.find(device => device.id === event.dev)?.name || event.dev_name || event.agent_name ||
    (event.is_test ? 'NetSmonitor (Test Trap)' : '') ||
    (event.dev === 'unknown' ? 'Unknown Source' : event.dev);
}

export function trapEventDevice(event: TrapEvent, devices: Device[]): Device | undefined {
  const resolved = resolveTrapEvent(event, devices);
  return devices.find(device => device.id === resolved.dev);
}

export function trapEventDeviceName(event: TrapEvent, devices: Device[]): string {
  return trapDeviceName(resolveTrapEvent(event, devices), devices);
}

export function isUnknownTrapSource(event: TrapEvent, devices: Device[]): boolean {
  return !event.is_test && !trapEventDevice(event, devices);
}

export function mergeTrapEvents(previous: TrapEvent[], incoming: TrapEvent[]): TrapEvent[] {
  const merged = new Map(previous.map(event => [event.id, event]));
  incoming.forEach(event => {
    const old = merged.get(event.id);
    merged.set(event.id, { ...old, ...event, t: new Date(event.t), isNew: old?.isNew ?? event.isNew });
  });
  return [...merged.values()].sort((a, b) => b.t.getTime() - a.t.getTime()).slice(0, 80);
}
