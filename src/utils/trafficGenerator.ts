import { Device, Port, TimeRange, TrafficPoint, TrafficStats } from '../types/snmp';
import { createPseudoRandom, hashString } from './formatters';

export const TIME_RANGES: Record<TimeRange, { n: number; step: number; label: string }> = {
  live: { n: 120, step: 5, label: 'Live · จุดละ 5 วินาที' },
  day: { n: 288, step: 300, label: 'วันนี้ · จุดละ 5 นาที' },
  week: { n: 336, step: 1800, label: 'สัปดาห์ · จุดละ 30 นาที' },
  month: { n: 360, step: 7200, label: 'เดือน · จุดละ 2 ชั่วโมง' },
  year: { n: 365, step: 86400, label: 'ปี · จุดละ 1 วัน' },
};

const seriesCache: Record<string, { pts: TrafficPoint[] }> = {};

export function getSeriesFor(
  device: Device | undefined,
  port: Port | undefined,
  range: TimeRange
): TrafficPoint[] {
  if (!device || !port) return [];
  const key = `${device.id}|${port.name}|${range}`;
  if (seriesCache[key]) return seriesCache[key].pts;

  const cfg = TIME_RANGES[range];
  const pts: TrafficPoint[] = [];
  const isOff = device.status === 'offline';
  const r = createPseudoRandom(hashString(key));
  const cap = port.speed * 1e6; // bps
  const u0 = 0.16 + r() * 0.44;
  const ph = r() * 6.28;
  const now = Date.now();

  for (let i = 0; i < cfg.n; i++) {
    const t = now - (cfg.n - 1 - i) * cfg.step * 1000;
    let v: number | null = null;
    if (!isOff) {
      const hr = new Date(t).getHours() + new Date(t).getMinutes() / 60;
      let busy = 1;
      if (range === 'live') {
        busy = 0.5 + 0.45 * Math.sin(i / 7 + ph) + (r() < 0.05 ? 0.45 : 0);
      } else if (range === 'day') {
        busy = Math.max(0.12, Math.sin(((hr - 6) / 12) * Math.PI));
      } else if (range === 'year') {
        busy = 0.6 + 0.3 * Math.sin(i / 23 + ph);
      } else {
        busy = 0.55 + 0.4 * Math.sin(i / 11 + ph);
      }

      if (port.admin === 'down' || port.oper === 'down') {
        busy = 0.015;
      }

      v = Math.max(0, cap * u0 * busy * (0.84 + 0.32 * r()));
      if (range === 'week' && i >= 150 && i <= 166) {
        v = null; // simulate maintenance gap
      }
    }

    pts.push({
      t,
      in: v == null ? null : v * (0.72 + 0.5 * r()),
      out: v == null ? null : v * (0.26 + 0.44 * r()),
    });
  }

  seriesCache[key] = { pts };
  return pts;
}

export function getAggregateTraffic(devices: Device[]): TrafficPoint[] {
  const sources: [string, string][] = [
    ['d1', 'Gi0/1'],
    ['d1', 'Fa0/1'],
    ['d2', 'Gi0/1'],
    ['d3', 'GigabitEthernet0/0'],
    ['d4', 'Fa0/2'],
    ['d6', 'Fa0/2'],
  ];

  const seriesArrays = sources
    .map(([did, pname]) => {
      const d = devices.find((x) => x.id === did);
      const p = d?.ports.find((x) => x.name === pname);
      return d && p ? getSeriesFor(d, p, 'day') : null;
    })
    .filter((s): s is TrafficPoint[] => s !== null);

  if (!seriesArrays.length) return [];

  return seriesArrays[0].map((_, i) => {
    let sumIn = 0;
    let countIn = 0;
    let sumOut = 0;
    let countOut = 0;

    seriesArrays.forEach((arr) => {
      const pt = arr[i];
      if (pt?.in != null) {
        sumIn += pt.in;
        countIn++;
      }
      if (pt?.out != null) {
        sumOut += pt.out;
        countOut++;
      }
    });

    return {
      t: seriesArrays[0][i].t,
      in: countIn ? sumIn : null,
      out: countOut ? sumOut : null,
    };
  });
}

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
