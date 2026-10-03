export const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export const pad = (n: number | string): string => String(n).padStart(2, '0');

export function fmtRate(b: number | null | undefined): string {
  if (b == null || isNaN(b)) return '—';
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' Gbps';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' Mbps';
  if (b >= 1e3) return Math.round(b / 1e3) + ' Kbps';
  return Math.round(b) + ' bps';
}

export function fmtSpeed(mbps: number): string {
  return mbps >= 1000 ? mbps / 1000 + ' Gbps' : mbps + ' Mbps';
}

export function fmtPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value > 0 && value < 1 ? '<1%' : Math.round(value) + '%';
}

export function fmtHM(t: Date | number | string): string {
  const d = new Date(t);
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function fmtFull(t: Date | number | string): string {
  const d = new Date(t);
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortN(n: string): string {
  return n
    .replace('GigabitEthernet', 'Gi')
    .replace('FastEthernet', 'Fa')
    .replace('Serial', 'Se')
    .replace('Loopback', 'Lo');
}

export const hx = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

export const generateMAC = (i: number) =>
  `00:1A:2B:${hx((i * 7) % 256)}:${hx((i * 13) % 256)}:${hx((i * 29) % 256)}`;

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createPseudoRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function niceMax(m: number): number {
  if (m <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(m)));
  const f = m / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

export function xfmt(t: number, range: string): string {
  const d = new Date(t);
  if (range === 'live' || range === 'day') return pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (range === 'week') return TH_DAYS[d.getDay()] + ' ' + d.getDate();
  if (range === 'month') return d.getDate() + ' ' + TH_MONTHS[d.getMonth()];
  return TH_MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
}
