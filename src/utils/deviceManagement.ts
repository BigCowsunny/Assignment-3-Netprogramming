import { Device } from '../types/snmp';

export function configurationWarning(device: Device): string {
  if (!device.discovery_only && device.ip) return '';
  return device.config_unavailable_reason || 'ไม่มี Management IP จึงไม่สามารถ Config หรืออ่าน Traffic ผ่าน SNMP ได้';
}

export function mergeDevices(current: Device[], incoming: Device[]): Device[] {
  const byId = new Map(current.map((device) => [device.id, device]));
  for (const device of incoming) byId.set(device.id, device);
  return [...byId.values()];
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}
