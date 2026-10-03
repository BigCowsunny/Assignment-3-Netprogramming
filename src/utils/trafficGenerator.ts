import { TimeRange, TrafficPoint, TrafficStats } from '../types/snmp';

export const TIME_RANGES: Record<TimeRange, { n: number; step: number; label: string }> = {
  live: { n: 120, step: 5, label: '10 นาทีล่าสุด' },
  day: { n: 288, step: 300, label: '24 ชั่วโมงล่าสุด · เฉลี่ยทุก 5 นาที' },
  week: { n: 336, step: 1800, label: '7 วันล่าสุด · เฉลี่ยทุก 30 นาที' },
  month: { n: 360, step: 7200, label: '30 วันล่าสุด · เฉลี่ยทุก 2 ชั่วโมง' },
  year: { n: 365, step: 86400, label: '365 วันล่าสุด · เฉลี่ยรายวัน' },
};

export function calculateStats(pts: TrafficPoint[], key: 'in' | 'out'): TrafficStats | null {
  const vs = pts.map((p) => p[key]).filter((v): v is number => v != null);
  if (!vs.length) return null;
  return {
    min: Math.min(...vs),
    max: Math.max(...vs),
    avg: vs.reduce((a, b) => a + b, 0) / vs.length,
    cur: vs[vs.length - 1],
  };
}
