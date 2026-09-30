import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { fmtFull, fmtHM } from '../../utils/formatters';

export const SettingsView: React.FC = () => {
  const {
    events,
    devices,
    auditLogs,
    addToast,
    addAuditLog,
  } = useSnmp();

  const [pollInterval, setPollInterval] = useState('60 วินาที');
  const [retryEnabled, setRetryEnabled] = useState(true);
  const [downsamplingEnabled, setDownsamplingEnabled] = useState(true);

  const handleSaveSettings = () => {
    addAuditLog('เปลี่ยนรอบ Poll', pollInterval, 'สำเร็จ');
    addToast(
      'ok',
      'บันทึกการตั้งค่าแล้ว',
      `Poll ทุก ${pollInterval} · Retry 2 ครั้ง`
    );
  };

  const latestEvent = events[0];
  const getDeviceName = (devId: string) => {
    if (devId === 'unknown') return 'Unknown Source';
    const found = devices.find((d) => d.id === devId);
    return found ? found.name : devId;
  };

  const unknownCount = events.filter((e) => e.dev === 'unknown').length;

  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h1>ตั้งค่า</h1>
          <p>รอบการ Poll, Trap listener และ Audit log</p>
        </div>
      </div>

      <div className="set-grid">
        {/* Polling Card */}
        <div className="card">
          <div className="card-head">
            <h3>การ Poll (SNMP GET)</h3>
          </div>
          <div className="card-body">
            <div className="field">
              <label htmlFor="set-int">รอบ Poll ทุก ๆ</label>
              <select
                id="set-int"
                value={pollInterval}
                onChange={(e) => setPollInterval(e.target.value)}
              >
                <option value="15 วินาที">15 วินาที</option>
                <option value="30 วินาที">30 วินาที</option>
                <option value="60 วินาที">60 วินาที</option>
                <option value="300 วินาที">300 วินาที</option>
              </select>
            </div>

            <div className="sw-row">
              <span className="txt">
                Retry เมื่อ Timeout
                <span className="hint">
                  ลองซ้ำ 2 ครั้งก่อน mark อุปกรณ์เป็นออฟไลน์
                </span>
              </span>
              <button
                className={`sw ${retryEnabled ? 'on' : ''}`}
                role="switch"
                aria-checked={retryEnabled}
                aria-label="Retry"
                onClick={() => setRetryEnabled(!retryEnabled)}
              />
            </div>

            <div className="sw-row">
              <span className="txt">
                Downsampling กราฟรายปี
                <span className="hint">
                  ยุบจุดเป็นรายวันเพื่อไม่ให้ DB โต
                </span>
              </span>
              <button
                className={`sw ${downsamplingEnabled ? 'on' : ''}`}
                role="switch"
                aria-checked={downsamplingEnabled}
                aria-label="Downsampling"
                onClick={() => setDownsamplingEnabled(!downsamplingEnabled)}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '14px',
              }}
            >
              <button className="btn btn-primary" onClick={handleSaveSettings}>
                บันทึกการตั้งค่า
              </button>
            </div>
          </div>
        </div>

        {/* Trap Receiver Card */}
        <div className="card">
          <div className="card-head">
            <h3>Trap Receiver</h3>
            <span className="pill ok">
              <i></i>ทำงานอยู่
            </span>
          </div>
          <div className="card-body">
            <div className="trap-ok">
              <span className="dot"></span>กำลังฟัง UDP 162
            </div>

            <div className="sw-row">
              <span className="txt">
                เหตุการณ์ล่าสุด
                <span className="hint">
                  {latestEvent
                    ? `${fmtFull(latestEvent.t)} · ${getDeviceName(latestEvent.dev)} ${latestEvent.port}`
                    : '—'}
                </span>
              </span>
              {latestEvent && (
                <span
                  className={`pill ${latestEvent.type === 'linkDown' ? 'bad' : 'ok'}`}
                >
                  <i></i>
                  {latestEvent.type === 'linkDown' ? 'Link Down' : 'Link Up'}
                </span>
              )}
            </div>

            <div className="sw-row">
              <span className="txt">
                แหล่งที่ไม่รู้จัก
                <span className="hint">เก็บเป็น Unknown Source ไม่ทิ้ง</span>
              </span>
              <span className="mono">{unknownCount}</span>
            </div>

            <p className="lbl" style={{ margin: '14px 0 0' }}>
              Raw varbind ล่าสุด
            </p>
            <pre className="code">
              {latestEvent
                ? `${latestEvent.oid}\n  ifIndex.0        = ${latestEvent.port}\n  ifAdminStatus.0  = 1\n  ifOperStatus.0   = ${latestEvent.type === 'linkDown' ? '2' : '1'}\n  source           = ${latestEvent.src}`
                : '—'}
            </pre>
          </div>
        </div>

        {/* Audit Log Card */}
        <div className="card">
          <div className="card-head">
            <h3>Audit log</h3>
            <span className="hint">ใคร สั่งอะไร เมื่อไร ผลเป็นอย่างไร</span>
          </div>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ผู้ใช้</th>
                  <th>การกระทำ</th>
                  <th>เป้าหมาย</th>
                  <th>ผลลัพธ์</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.slice(0, 10).map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{fmtHM(a.t)}</td>
                    <td className="mono">{a.user}</td>
                    <td>{a.action}</td>
                    <td className="mono">{a.target}</td>
                    <td>
                      <span
                        className={`pill ${a.result === 'สำเร็จ' ? 'ok' : 'bad'}`}
                      >
                        <i></i>
                        {a.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
