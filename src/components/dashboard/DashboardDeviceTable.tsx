import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { getSeriesFor } from '../../utils/trafficGenerator';
import { shortN } from '../../utils/formatters';

export const DashboardDeviceTable: React.FC = () => {
  const { devices, openDevice, setView } = useSnmp();

  const getPortRatio = (d: (typeof devices)[0]) => {
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

    const pts = getSeriesFor(d, p, 'live');
    let v = 0;
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].in != null) {
        v = (pts[i].in! / (p.speed * 1e6)) * 100;
        break;
      }
    }
    const val = Math.min(100, Math.round(v));
    return (
      <>
        <div className="bar">
          <i style={{ width: `${val}%` }}></i>
        </div>
        <div className="sub">
          {val}% · {shortN(p.name)}
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
                <td className="mono">{d.ip}</td>
                <td>{d.type === 'switch' ? 'Switch' : 'Router'}</td>
                <td>
                  {d.status === 'online' ? (
                    <span className="pill ok">
                      <i></i>ออนไลน์
                    </span>
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
