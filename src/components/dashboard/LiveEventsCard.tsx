import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { fmtHM } from '../../utils/formatters';

export const LiveEventsCard: React.FC = () => {
  const { events, devices, setView } = useSnmp();

  const getDeviceName = (devId: string) => {
    if (devId === 'unknown') return 'Unknown Source';
    const found = devices.find((d) => d.id === devId);
    return found ? found.name : devId;
  };

  const latestEvents = events.slice(0, 7);

  return (
    <div className="card">
      <div className="card-head">
        <h3>เหตุการณ์ล่าสุด</h3>
        <button className="btn btn-ghost" onClick={() => setView('events')}>
          ดูทั้งหมด
          <Icon name="i-arrow-right" />
        </button>
      </div>
      <div className="ev-list">
        {latestEvents.length ? (
          latestEvents.map((e) => (
            <div key={e.id} className="ev">
              <span className="t">{fmtHM(e.t)}</span>
              <span>
                <b>{getDeviceName(e.dev)}</b>{' '}
                <span className="where">· {e.port}</span>
              </span>
              {e.type === 'linkDown' ? (
                <span className="pill bad">
                  <i></i>Down
                </span>
              ) : (
                <span className="pill ok">
                  <i></i>Up
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="empty"><Icon name="i-bell" size={24} /><p><b>ยังไม่มีเหตุการณ์</b></p><p>Link up / down จะปรากฏเมื่อได้รับ Trap</p></div>
        )}
      </div>
    </div>
  );
};
