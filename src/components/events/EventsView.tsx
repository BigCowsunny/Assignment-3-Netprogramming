import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { fmtHM } from '../../utils/formatters';

export const EventsView: React.FC = () => {
  const {
    events,
    devices,
    isRealtime,
    setIsRealtime,
    triggerTestTrap,
    openDevice,
  } = useSnmp();

  const [filterDev, setFilterDev] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const getDeviceName = (devId: string) => {
    if (devId === 'unknown') return 'Unknown Source';
    const found = devices.find((d) => d.id === devId);
    return found ? found.name : devId;
  };

  const filteredEvents = events.filter((e) => {
    const q = searchQuery.trim().toLowerCase();
    const devName = getDeviceName(e.dev).toLowerCase();

    const matchesDev = filterDev === 'all' || e.dev === filterDev;
    const matchesType = filterType === 'all' || e.type === filterType;
    const matchesQuery =
      !q ||
      e.port.toLowerCase().includes(q) ||
      e.src.includes(q) ||
      devName.includes(q);

    return matchesDev && matchesType && matchesQuery;
  });

  const handleClearFilters = () => {
    setFilterDev('all');
    setFilterType('all');
    setSearchQuery('');
  };

  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h1>เหตุการณ์ (Trap)</h1>
          <p>รายการ linkUp · linkDown ที่ได้รับจาก Trap Receiver (UDP 162) แบบเรียลไทม์</p>
        </div>

        <label className="sw-row" style={{ border: 0, padding: 0, gap: '9px' }}>
          <span className="txt" style={{ fontSize: '13px' }}>
            รับ Trap แบบเรียลไทม์
            <span className="hint">WebSocket</span>
          </span>
          <button
            className={`sw ${isRealtime ? 'on' : ''}`}
            role="switch"
            aria-checked={isRealtime}
            aria-label="รับ Trap แบบเรียลไทม์"
            onClick={() => setIsRealtime(!isRealtime)}
          />
        </label>
      </div>

      <div className="toolbar">
        <select
          value={filterDev}
          onChange={(e) => setFilterDev(e.target.value)}
          aria-label="กรองอุปกรณ์"
        >
          <option value="all">อุปกรณ์: ทั้งหมด</option>
          <option value="unknown">Unknown Source</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          aria-label="กรองชนิด"
        >
          <option value="all">ชนิด: ทั้งหมด</option>
          <option value="linkDown">Link Down</option>
          <option value="linkUp">Link Up</option>
        </select>

        <label className="gsearch">
          <Icon name="i-search" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหา Port / Source IP"
            aria-label="ค้นหา"
          />
        </label>

        <button className="btn btn-ghost" onClick={handleClearFilters}>
          <Icon name="i-rotate-ccw" />
          ล้างตัวกรอง
        </button>

        <button className="btn" onClick={triggerTestTrap}>
          <Icon name="i-bell" />
          ส่ง Test Trap
        </button>

        <span className="spacer"></span>
        <span className="count">
          แสดง {filteredEvents.length} / {events.length} เหตุการณ์
        </span>
      </div>

      <div className="card">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>อุปกรณ์</th>
                <th>Port</th>
                <th>ชนิด</th>
                <th>Source IP</th>
                <th>OID (TRAP-TYPE)</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length ? (
                filteredEvents.map((e) => {
                  const isUnknown = e.dev === 'unknown';
                  return (
                    <tr key={e.id} className={e.isNew ? 'fresh' : ''}>
                      <td className="mono">{fmtHM(e.t)}</td>
                      <td>
                        {isUnknown ? (
                          <span className="pill warn">
                            <i></i>Unknown Source
                          </span>
                        ) : (
                          <button
                            className="devlink"
                            onClick={() => openDevice(e.dev)}
                          >
                            {getDeviceName(e.dev)}
                          </button>
                        )}
                      </td>
                      <td className="mono">{e.port}</td>
                      <td>
                        {e.type === 'linkDown' ? (
                          <span className="pill bad">
                            <i></i>Link Down
                          </span>
                        ) : (
                          <span className="pill ok">
                            <i></i>Link Up
                          </span>
                        )}
                      </td>
                      <td className="mono">{e.src}</td>
                      <td className="mono hint">{e.oid}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="empty">
                    ไม่มีเหตุการณ์ที่ตรงกับตัวกรอง
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
