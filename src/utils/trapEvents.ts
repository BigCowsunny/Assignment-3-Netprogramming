import { Device, TrapEvent } from '../types/snmp';

export function trapEventDevice(event: TrapEvent, devices: Device[]): Device | undefined {
  const byId = devices.find((device) => device.id === event.dev);
  if (byId) return byId;
  const byManagementIp = devices.filter((device) => device.ip && device.ip === event.src);
  if (byManagementIp.length === 1) return byManagementIp[0];
  if (byManagementIp.length > 1) return undefined;
  const byInterfaceIp = devices.filter((device) => device.ports.some((port) => port.ip && port.ip === event.src));
  return byInterfaceIp.length === 1 ? byInterfaceIp[0] : undefined;
}

export function trapEventDeviceName(event: TrapEvent, devices: Device[]): string {
  return trapEventDevice(event, devices)?.name || event.dev_name || event.src || 'Unknown Source';
}

export function isUnknownTrapSource(event: TrapEvent, devices: Device[]): boolean {
  return !event.is_test && !trapEventDevice(event, devices);
}
