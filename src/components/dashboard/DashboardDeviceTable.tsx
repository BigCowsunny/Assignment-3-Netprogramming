import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { useLatestTraffic } from '../../hooks/useLatestTraffic';
import { fmtPercent, shortN } from '../../utils/formatters';

export const DashboardDeviceTable: React.FC = () => {
  const { devices, openDevice, setView } = useSnmp();
  const latestTraffic = useLatestTraffic();

  const getPortRatio = (d: (typeof devices)[0]) => {
    if (d.discovery_only) return `${d.ports.length} พบผ่าน CDP/LLDP`;
    const ps = d.ports.filter((p) => !p.virtual);
    const u = ps.filter((p) => p.admin === 'up' && p.oper === 'up').length;
    return `${u}/${ps.length}`;
  };

  const getUtilBar = (d: (typeof devices)[0]) => {
    const p = d.ports.find((x) => !x.virtual && x.admin === 'up' && x.oper === 'up');
    if (!p || d.status !== 'online') {
      return (
        <>
          <div className="bar">
            <i style={{ width: '0%' }}></i>
          </div>
          <div className="sub">—</div>
        </>
      );
    }

    const sample = latestTraffic.find((row) => row.device_id === d.id && row.port_name === p.name);
    if (!sample) return <><div className="bar"><i style={{ width: '0%' }}></i></div><div className="sub">รอ sample SNMP</div></>;
    const v = p.speed > 0 ? (sample.in_bps / (p.speed * 1e6)) * 100 : 0;
    const val = Math.min(100, Math.round(v));
    return (
      <>
        <div className="bar">
          <i style={{ width: `${val}%` }}></i>
        </div>
        <div className="sub">
          {fmtPercent(v)} · {shortN(p.name)}
        </div>
      </>
    );
  };

  return (
    <div className="card mt12">
      <div className="card-head">
        <h3>อุปกรณ์ทั้งหมด</h3>
        <button className="btn btn-ghost" onClick={() => setView('devices')}>
          จัดการอุปกรณ์
          <Icon name="i-arrow-right" />
        </button>
      </div>
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>อุปกรณ์</th>
              <th>IP</th>
              <th>ประเภท</th>
              <th>สถานะ</th>
              <th>Port</th>
              <th>ทราฟฟิก</th>
              <th className="r"></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>
                  <button className="devlink" onClick={() => openDevice(d.id)}>
                    {d.name}
                  </button>
                </td>
                <td className="mono">{d.ip || 'ไม่มี IP'}{d.discovery_only && <div className="hint">Config ไม่ได้</div>}</td>
                <td>{d.type === 'switch' ? 'Switch' : 'Router'}</td>
                <td>
                  {d.status === 'online' ? (
                    <span className="pill ok">
                      <i></i>ออนไลน์
                    </span>
                  ) : d.status === 'discovered' ? (
                    <span className="pill warn"><i></i>พบผ่าน CDP/LLDP</span>
                  ) : (
                    <span className="pill bad">
                      <i></i>ออฟไลน์
                    </span>
                  )}
                </td>
                <td className="mono">{getPortRatio(d)}</td>
                <td>{getUtilBar(d)}</td>
                <td className="r">
                  <button
                    className="btn btn-ghost"
                    onClick={() => openDevice(d.id)}
                  >
                    เปิด Port Panel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
