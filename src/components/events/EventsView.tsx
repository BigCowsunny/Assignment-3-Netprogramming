import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { fmtFull } from '../../utils/formatters';
import { trapDeviceName } from '../../utils/trapEvents';

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

  const filteredEvents = events.filter((e) => {
    const q = searchQuery.trim().toLowerCase();
    const devName = trapDeviceName(e, devices).toLowerCase();

    const matchesDev = filterDev === 'all' || e.dev === filterDev;
    const matchesType = filterType === 'all' || e.type === filterType;
    const matchesQuery =
      !q ||
      e.port.toLowerCase().includes(q) ||
      e.src.includes(q) ||
      !!e.agent_ip?.includes(q) ||
      devName.includes(q);

    return matchesDev && matchesType && matchesQuery;
  });

  const handleClearFilters = () => {
    setFilterDev('all');
    setFilterType('all');
    setSearchQuery('');
  };

  return (
    <section className="view active events-view">
      <div className="page-head">
        <div>
          <h1>เหตุการณ์ (Trap)</h1>
          <p>เหตุการณ์ Link up / down ที่อุปกรณ์ส่งผ่าน SNMP Trap</p>
        </div>

        <label className="sw-row" style={{ border: 0, padding: 0, gap: '9px' }}>
          <span className="txt" style={{ fontSize: '13px' }}>
            แสดงผลสด
            <span className="hint">ระบบรับ Trap ต่อเนื่อง แม้พักการแสดงผลสด</span>
          </span>
          <button
            className={`sw ${isRealtime ? 'on' : ''}`}
            role="switch"
            aria-checked={isRealtime}
            aria-label="แสดงผลสด"
            onClick={() => setIsRealtime(!isRealtime)}
          />
        </label>
      </div>

      <div className="card">
      <div className="event-summary"><span><b>{events.length}</b>เหตุการณ์</span><span><i className="status-dot up" /> Link up <b>{events.filter(e => e.type === 'linkUp').length}</b></span><span><i className="status-dot down" /> Link down <b>{events.filter(e => e.type === 'linkDown').length}</b></span><span>Unknown source <b>{events.filter(e => e.dev === 'unknown').length}</b></span></div>
      {events.some(e => e.dev === 'unknown') && <p className="hint" style={{ padding: '0 20px' }}>
        ชื่อจะอัปเดตเมื่อจับคู่กับอุปกรณ์ได้ หากหลายอุปกรณ์ส่งผ่าน Source IP เดียวกัน ต้องมี Agent IP หรือชื่ออุปกรณ์แนบมากับ Trap
      </p>}
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
            placeholder="ค้นหาอุปกรณ์ / Port / IP"
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

        {!!filteredEvents.length && <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>อุปกรณ์</th>
                <th>Port</th>
                <th>ชนิด</th>
                <th>Source IP</th>
                <th>Agent IP</th>
                <th>OID (TRAP-TYPE)</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length ? (
                filteredEvents.map((e) => {
                  const isUnknown = e.dev === 'unknown';
                  return (
                    <tr key={e.id} className={e.isNew ? 'fresh' : ''}>
                      <td className="mono">{fmtFull(e.t)}</td>
                      <td>
                        {isUnknown ? (
                          <span className="pill warn">
                            <i></i>{trapDeviceName(e, devices)}
                          </span>
                        ) : (
                          <button
                            className="devlink"
                            onClick={() => openDevice(e.dev)}
                          >
                            {trapDeviceName(e, devices)}
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
                      <td className="mono">{e.agent_ip || '—'}</td>
                      <td className="mono hint">{e.oid}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    <Icon name="i-bell" size={24} /><p><b>{events.length ? 'ไม่มีเหตุการณ์ที่ตรงกับตัวกรอง' : 'ยังไม่ได้รับ Trap'}</b></p><p>{events.length ? 'ลองเปลี่ยนหรือล้างตัวกรอง' : 'ตั้งค่าอุปกรณ์ให้ส่ง Link up / down Trap มาที่เครื่องนี้'}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>}
        {!filteredEvents.length && <div className="empty"><Icon name="i-bell" size={24}/><p><b>{events.length ? 'ไม่มีเหตุการณ์ที่ตรงกับตัวกรอง' : 'ยังไม่ได้รับ Trap'}</b></p><p>{events.length ? 'ลองเปลี่ยนหรือล้างตัวกรอง' : 'ตั้งค่าอุปกรณ์ให้ส่ง Link up / down Trap มาที่เครื่องนี้'}</p></div>}
      </div>
    </section>
  );
};
