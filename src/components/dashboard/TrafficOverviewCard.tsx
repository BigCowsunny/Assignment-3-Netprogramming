import React, { useMemo } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { TrafficCanvas } from '../common/TrafficCanvas';
import { calculateStats, getAggregateTraffic } from '../../utils/trafficGenerator';
import { fmtRate } from '../../utils/formatters';

export const TrafficOverviewCard: React.FC = () => {
  const { devices } = useSnmp();

  const aggregatePoints = useMemo(() => {
    return getAggregateTraffic(devices);
  }, [devices]);

  const maxIn = useMemo(() => {
    return calculateStats(aggregatePoints, 'in');
  }, [aggregatePoints]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>ทราฟฟิกรวมทั้งระบบ · 24 ชั่วโมง</h3>
        <span className="hint mono">
          {maxIn ? `Peak In ${fmtRate(maxIn.max)}` : '—'}
        </span>
      </div>
      <div className="card-body">
        <TrafficCanvas points={aggregatePoints} range="day" />
      </div>
    </div>
  );
};
