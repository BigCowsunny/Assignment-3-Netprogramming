import { TimeRange, TrafficPoint, TrafficStats } from '../types/snmp';

export const TIME_RANGES: Record<TimeRange, { n: number; step: number; label: string }> = {
  live: { n: 120, step: 5, label: 'Live · จุดละ 5 วินาที' },
  day: { n: 288, step: 300, label: 'วันนี้ · จุดละ 5 นาที' },
  week: { n: 336, step: 1800, label: 'สัปดาห์ · จุดละ 30 นาที' },
  month: { n: 360, step: 7200, label: 'เดือน · จุดละ 2 ชั่วโมง' },
  year: { n: 365, step: 86400, label: 'ปี · จุดละ 1 วัน' },
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
