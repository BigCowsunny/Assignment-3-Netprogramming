import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { useLatestTraffic } from '../../hooks/useLatestTraffic';
import { fmtPercent } from '../../utils/formatters';

export const KpiGrid: React.FC = () => {
  const { devices, events } = useSnmp();
  const latestTraffic = useLatestTraffic();

  const onlineCount = devices.filter((d) => d.status === 'online').length;
  let totalPorts = 0;
  let upPorts = 0;
  let errorPorts = 0;

  devices.forEach((d) => {
    if (d.discovery_only) return;
    d.ports.forEach((p) => {
      if (p.virtual) return;
      totalPorts++;
      if (p.admin === 'up' && p.oper === 'up') upPorts++;
      if (p.errors > 0) errorPorts++;
    });
  });

  const recentEvents = events.filter(e => e.t.getTime() >= Date.now() - 86400000);
  const downEventsCount = recentEvents.filter((e) => e.type === 'linkDown').length;
  const discoveredCount = devices.filter(d => d.discovery_only || d.status === 'discovered').length;
  const offlineCount = devices.filter(d => !d.discovery_only && d.status === 'offline').length;
  const unknownPorts = devices.filter(d => !d.discovery_only).flatMap(d => d.ports)
    .filter(p => !p.virtual && (p.oper === 'unknown' || p.admin === 'unknown')).length;

  let sumUtil = 0;
  let sampleCount = 0;

  devices.forEach((d) => {
    if (d.status !== 'online') return;
    d.ports
      .filter((p) => !p.virtual && p.admin === 'up' && p.oper === 'up')
      .forEach((p) => {
        const sample = latestTraffic.find((row) => row.device_id === d.id && row.port_name === p.name);
        if (sample && p.speed > 0) {
          sumUtil += (sample.in_bps / (p.speed * 1e6)) * 100;
          sampleCount++;
        }
      });
  });

  const avgLoad = sampleCount ? sumUtil / sampleCount : null;

  return (
    <div className="grid4">
      <div className="card kpi">
        <div className="lbl">อุปกรณ์</div>
        <div className="v">
          {onlineCount}/{devices.length}
        </div>
        <div className="s">
          Offline {offlineCount} · Discovered {discoveredCount}
        </div>
      </div>

      <div className="card kpi">
        <div className="lbl">พอร์ตใช้งาน</div>
        <div className="v">
          {upPorts}/{totalPorts}
        </div>
        <div className="s">
          Down {totalPorts - upPorts - unknownPorts} · Unknown {unknownPorts} · Errors {errorPorts}
        </div>
      </div>

      <div className="card kpi">
        <div className="lbl">เหตุการณ์ 24 ชม.</div>
        <div className="v">{recentEvents.length}</div>
        <div className="s">
          Link down {downEventsCount} · Link up {recentEvents.length - downEventsCount}
        </div>
      </div>

      <div className="card kpi">
        <div className="lbl">โหลดเฉลี่ย</div>
        <div className="v">{fmtPercent(avgLoad)}</div>
        <div className="s">{sampleCount ? 'จาก sample SNMP ล่าสุด' : 'รอ sample SNMP จาก poller'}</div>
      </div>
    </div>
  );
};
