import React, { useMemo } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { calculateStats, getSeriesFor } from '../../utils/trafficGenerator';
import { fmtRate, shortN } from '../../utils/formatters';

interface TalkerItem {
  deviceId: string;
  deviceName: string;
  portName: string;
  utilPercent: number;
  rate: number;
}

export const TopTalkersCard: React.FC = () => {
  const { devices, openTraffic } = useSnmp();

  const talkers = useMemo(() => {
    const rows: TalkerItem[] = [];

    devices.forEach((d) => {
      if (d.status !== 'online') return;
      d.ports.forEach((p) => {
        if (p.virtual || p.admin !== 'up' || p.oper !== 'up') return;
        const cap = p.speed * 1e6;
        if (!cap) return;

        const pts = getSeriesFor(d, p, 'day');
        const si = calculateStats(pts, 'in');
        const so = calculateStats(pts, 'out');
        const ai = si ? si.avg : 0;
        const ao = so ? so.avg : 0;
        const rate = Math.max(ai, ao);
        if (rate <= 0) return;

        rows.push({
          deviceId: d.id,
          deviceName: d.name,
          portName: p.name,
          utilPercent: (rate / cap) * 100,
          rate,
        });
      });
    });

    rows.sort((a, b) => b.utilPercent - a.utilPercent);
    return rows.slice(0, 6);
  }, [devices]);

  return (
    <div className="card mt12">
      <div className="card-head">
        <h3>Port ที่ใช้ทราฟฟิกสูงสุด · เฉลี่ย 24 ชั่วโมง</h3>
        <div className="legend-row">
          <span>
            <i className="k-warn"></i>≥ 40%
          </span>
          <span>
            <i className="k-down"></i>≥ 70%
          </span>
          <span className="hint">คลิกแถวเพื่อดูกราฟทราฟฟิก</span>
        </div>
      </div>
      <div className="card-body">
        <div
          className="tt"
          role="group"
          aria-label="อันดับ Port ที่ใช้ทราฟฟิกสูงสุด 24 ชั่วโมง"
        >
          {talkers.length ? (
            talkers.map((r, i) => {
              const u = Math.min(100, r.utilPercent);
              const trackClass = u >= 70 ? 'hot' : u >= 40 ? 'mid' : '';
              return (
                <button
                  key={`${r.deviceId}-${r.portName}-${i}`}
                  type="button"
                  className="tt-row"
                  onClick={() => openTraffic(r.deviceId, r.portName)}
                >
                  <span className="tt-name">
                    {r.deviceName}
                    <span>{shortN(r.portName)}</span>
                  </span>
                  <span className="tt-track">
                    <i
                      className={trackClass}
                      style={{ width: `${u.toFixed(1)}%` }}
                    ></i>
                  </span>
                  <span className="tt-val">
                    {Math.round(r.utilPercent)}% · {fmtRate(r.rate)}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="empty">ยังไม่มีข้อมูลทราฟฟิกในช่วง 24 ชั่วโมง</div>
          )}
        </div>
      </div>
    </div>
  );
};
