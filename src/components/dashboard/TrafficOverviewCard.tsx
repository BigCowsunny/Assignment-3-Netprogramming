import React, { useEffect, useMemo, useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { TrafficCanvas } from '../common/TrafficCanvas';
import { calculateStats } from '../../utils/trafficGenerator';
import { fmtRate } from '../../utils/formatters';
import { TrafficPoint } from '../../types/snmp';
import { fetchAggregateTrafficApi } from '../../services/api';

export const TrafficOverviewCard: React.FC = () => {
  const { pollIntervalSeconds } = useSnmp();
  const [aggregatePoints, setAggregatePoints] = useState<TrafficPoint[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await fetchAggregateTrafficApi('day');
        if (active) setAggregatePoints((rows as any[]).map((point) => ({ t: Number(point.t), in: point.in == null ? null : Number(point.in), out: point.out == null ? null : Number(point.out) })));
      } catch {
        if (active) setAggregatePoints([]);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, pollIntervalSeconds * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pollIntervalSeconds]);

  const maxIn = useMemo(() => {
    return calculateStats(aggregatePoints, 'in');
  }, [aggregatePoints]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>ทราฟฟิกรวม <span className="hint">/ 24 ชั่วโมง</span></h3>
        <span className="hint mono">
          {maxIn ? `Peak In ${fmtRate(maxIn.max)}` : '—'}
        </span>
      </div>
      <div className="card-body">
        <TrafficCanvas points={aggregatePoints} range="day" pollIntervalSeconds={pollIntervalSeconds} />
      </div>
    </div>
  );
};
