import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { getSeriesFor } from '../../utils/trafficGenerator';

export const KpiGrid: React.FC = () => {
  const { devices, events } = useSnmp();

  const onlineCount = devices.filter((d) => d.status === 'online').length;
  let totalPorts = 0;
  let upPorts = 0;
  let errorPorts = 0;

  devices.forEach((d) => {
    d.ports.forEach((p) => {
      if (p.virtual) return;
      totalPorts++;
      if (p.admin === 'up' && p.oper === 'up') upPorts++;
      if (p.errors > 0) errorPorts++;
    });
  });

  const downEventsCount = events.filter((e) => e.type === 'linkDown').length;

  let sumUtil = 0;
  let sampleCount = 0;

  devices.forEach((d) => {
    if (d.status !== 'online') return;
    d.ports
      .filter((p) => !p.virtual && p.admin === 'up' && p.oper === 'up')
      .slice(0, 3)
      .forEach((p) => {
        const pts = getSeriesFor(d, p, 'live');
        for (let i = pts.length - 1; i >= 0; i--) {
          if (pts[i].in != null) {
            sumUtil += (pts[i].in! / (p.speed * 1e6)) * 100;
            sampleCount++;
            break;
          }
        }
      });
  });

  const avgLoad = sampleCount ? Math.round(sumUtil / sampleCount) : 0;

  return (
    <div className="grid4">
      <div className="card kpi">
        <div className="lbl">อุปกรณ์</div>
        <div className="v">
          {onlineCount}/{devices.length}
        </div>
        <div className="s">
          ออนไลน์ {onlineCount} · ออฟไลน์ {devices.length - onlineCount}
        </div>
      </div>

      <div className="card kpi">
        <div className="lbl">พอร์ตใช้งาน</div>
        <div className="v">
          {upPorts}/{totalPorts}
        </div>
        <div className="s">
          ปิดอยู่ {totalPorts - upPorts} · error {errorPorts}
        </div>
      </div>

      <div className="card kpi">
        <div className="lbl">เหตุการณ์ 24 ชม.</div>
        <div className="v">{events.length}</div>
        <div className="s">
          linkDown {downEventsCount} · linkUp {events.length - downEventsCount}
        </div>
      </div>

      <div className="card kpi">
        <div className="lbl">โหลดเฉลี่ย</div>
        <div className="v">{avgLoad}%</div>
        <div className="s">เฉลี่ยจากพอร์ตที่เปิดใช้งาน</div>
      </div>
    </div>
  );
};
