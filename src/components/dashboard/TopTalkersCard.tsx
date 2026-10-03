import React, { useMemo } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { useLatestTraffic } from '../../hooks/useLatestTraffic';
import { fmtRate, fmtPercent, shortN } from '../../utils/formatters';

interface TalkerItem {
  deviceId: string;
  deviceName: string;
  portName: string;
  utilPercent: number;
  rate: number;
}

export const TopTalkersCard: React.FC = () => {
  const { devices, openTraffic } = useSnmp();
  const latestTraffic = useLatestTraffic();

  const talkers = useMemo(() => {
    const rows: TalkerItem[] = [];

    devices.forEach((d) => {
      if (d.status !== 'online') return;
      d.ports.forEach((p) => {
        if (p.virtual || p.admin !== 'up' || p.oper !== 'up') return;
        const cap = p.speed * 1e6;
        if (!cap) return;

        const sample = latestTraffic.find((row) => row.device_id === d.id && row.port_name === p.name);
        const rate = sample ? Math.max(sample.in_bps, sample.out_bps) : 0;
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
  }, [devices, latestTraffic]);

  return (
    <div className="card mt12">
      <div className="card-head">
        <h3>พอร์ตที่ใช้งานสูงสุด</h3>
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
          aria-label="อันดับพอร์ตตาม Utilization ล่าสุดจาก SNMP"
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
                    {fmtPercent(r.utilPercent)} · {fmtRate(r.rate)}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="empty"><b>ยังไม่มีพอร์ตที่มีทราฟฟิก</b><p>อันดับจะปรากฏเมื่อได้รับค่า SNMP ล่าสุด</p></div>
          )}
        </div>
      </div>
    </div>
  );
};
