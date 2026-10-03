import { useEffect, useState } from 'react';
import { fetchLatestTrafficApi } from '../services/api';
import { useSnmp } from '../context/SnmpContext';

export interface LatestTraffic {
  device_id: string;
  port_name: string;
  timestamp: number;
  in_bps: number;
  out_bps: number;
}

export function useLatestTraffic(): LatestTraffic[] {
  const { pollIntervalSeconds } = useSnmp();
  const [rows, setRows] = useState<LatestTraffic[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const latest = await fetchLatestTrafficApi();
        if (active) setRows(latest as LatestTraffic[]);
      } catch {
        if (active) setRows([]);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, pollIntervalSeconds * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pollIntervalSeconds]);
  return rows;
}
