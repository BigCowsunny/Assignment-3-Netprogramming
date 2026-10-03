import React, { useEffect, useRef, useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { fmtFull } from '../../utils/formatters';
import { BackendHealth, fetchBackendHealth, savePollingSettingsApi } from '../../services/api';
import { Icon } from '../common/Icons';
import { useDeviceDialog } from '../devices/useDeviceDialog';

export const SettingsView: React.FC = () => {
  const { events, devices, auditLogs, pollIntervalSeconds, setPollIntervalSeconds, addAuditLog } = useSnmp();
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(0);
  const [intervalDraft, setIntervalDraft] = useState(String(pollIntervalSeconds));
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isPollingDialogOpen, setIsPollingDialogOpen] = useState(false);
  const dirty = useRef(false);
  const closePollingDialog = () => {
    if (saving) return;
    dirty.current = false;
    setIsPollingDialogOpen(false);
  };
  const pollingDialog = useDeviceDialog(isPollingDialogOpen, closePollingDialog);
  const openPollingDialog = () => {
    dirty.current = false;
    setIntervalDraft(String(pollIntervalSeconds));
    setSaveError(''); setSaveMessage('');
    setIsPollingDialogOpen(true);
  };
  useEffect(() => {
    if (!dirty.current) setIntervalDraft(String(pollIntervalSeconds));
  }, [pollIntervalSeconds]);
  const saveInterval = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const seconds = Number(intervalDraft);
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) {
      setSaveError('กรุณาระบุจำนวนเต็มระหว่าง 10–3,600 วินาที');
      return;
    }
    setSaving(true); setSaveError(''); setSaveMessage('');
    try {
      const result = await savePollingSettingsApi(seconds);
      if (pollIntervalSeconds !== result.poll_interval) addAuditLog('ปรับรอบการอ่านข้อมูล SNMP', `${pollIntervalSeconds} → ${result.poll_interval} วินาที`, 'สำเร็จ');
      dirty.current = false;
      setIntervalDraft(String(result.poll_interval));
      setPollIntervalSeconds(result.poll_interval);
      setHealth(current => current ? { ...current, poll_interval: result.poll_interval } : current);
      setSaveMessage(`บันทึกแล้ว · อ่านข้อมูลทุก ${result.poll_interval} วินาที`);
      setIsPollingDialogOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'บันทึกการตั้งค่าไม่สำเร็จ');
    } finally { setSaving(false); }
  };
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const result = await fetchBackendHealth(); if(active) {setHealth(result); setError(''); if (result.poll_interval) setPollIntervalSeconds(result.poll_interval);} }
      catch(e) { if(active) { setHealth(null); setError(e instanceof Error ? e.message : 'บริการระบบไม่ตอบสนอง'); } }
      finally { if(active) setLoading(false); }
    };
    void load(); const timer = window.setInterval(load, 15000);
    return () => {active = false; window.clearInterval(timer);};
  }, [setPollIntervalSeconds]);
  const latest = events[0];
  const deviceName = latest ? devices.find(d => d.id === latest.dev)?.name || 'Unknown Source' : '';
  const receiverAvailable = !!health && (health.trap_port || 0) > 0;
  const status = loading ? 'กำลังตรวจสอบ' : health ? 'Connected' : 'Disconnected';
  const filteredAudit = auditLogs.filter(a => [a.user,a.action,a.target,a.result].join(' ').toLowerCase().includes(auditSearch.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filteredAudit.length / 10));
  const page = Math.min(auditPage, pages - 1);
  return <section className="view active settings-view">
    <div className="page-head"><div><h1>ตั้งค่าและสถานะระบบ</h1><p>บริการ Monitoring และประวัติการดำเนินการ</p></div><span className={'pill ' + (loading ? 'off' : health ? 'ok' : 'bad')}><i/>{status}</span></div>
    {error && <div className="notice warning" role="alert"><Icon name="i-triangle-alert" />{error}</div>}
    <div className="set-grid">
      <div className="card"><div className="card-head"><h3>SNMP Polling</h3><span className={'pill ' + (health?.poller === 'active' ? 'ok' : 'off')}>{health?.poller === 'active' ? 'Active' : loading ? 'กำลังตรวจสอบ' : 'ไม่มีข้อมูล'}</span></div><div className="card-body">
        <div className="service-value"><span>รอบการอ่านข้อมูลอุปกรณ์</span><div className="polling-summary-actions"><b>{pollIntervalSeconds} วินาที</b><button className="btn" type="button" onClick={openPollingDialog} disabled={loading || !health} aria-haspopup="dialog"><Icon name="i-cog" />ตั้งค่า</button></div></div>
        {saveMessage && <p className="polling-save-success" role="status">{saveMessage}</p>}
        <div className="service-value"><span>อุปกรณ์ที่จัดการผ่าน SNMP</span><b>{devices.filter(d => !d.discovery_only).length} อุปกรณ์</b></div>
        <div className="service-value"><span>ข้อมูลที่อ่าน</span><b>Interfaces / Traffic / Neighbors</b></div>
        <p className="service-note">อ่านสถานะและทราฟฟิกอัตโนมัติตามรอบที่กำหนด การรับ Trap ทำงานต่อเนื่อง</p>
      </div></div>
      <div className="card"><div className="card-head"><h3>Trap Receiver</h3><span className={'pill ' + (receiverAvailable ? 'ok' : 'off')}>{receiverAvailable ? 'UDP ' + health!.trap_port : loading ? 'กำลังตรวจสอบ' : 'ไม่มีข้อมูล'}</span></div><div className="card-body">
        <div className="service-value"><span>เหตุการณ์ล่าสุด</span><b>{latest ? fmtFull(latest.t) : 'ยังไม่ได้รับ Trap'}</b></div>
        <div className="service-value"><span>Unknown source</span><b>{events.filter(e => e.dev === 'unknown').length} เหตุการณ์</b></div>
        {latest && <><p className="service-note">{deviceName} · {latest.port} · {latest.type}</p><pre className="code">{'Source: ' + latest.src + '\nPort: ' + latest.port + '\nTrap OID: ' + latest.oid}</pre></>}
        <p className="service-note">แสดงเหตุการณ์ที่ได้รับจากอุปกรณ์และสถานะพอร์ต UDP ของบริการรับ Trap</p>
      </div></div>
      <div className="card audit-card"><div className="card-head"><h3>Audit log <span className="hint">/ {filteredAudit.length} รายการที่โหลดไว้</span></h3><label className="gsearch"><Icon name="i-search"/><input aria-label="ค้นหา Audit log" placeholder="ค้นหาการกระทำ / เป้าหมาย" value={auditSearch} onChange={e => {setAuditSearch(e.target.value);setAuditPage(0);}} /></label></div>{!!filteredAudit.length && <div className="tablewrap"><table className="data"><thead><tr><th>วัน / เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>เป้าหมาย</th><th>ผลลัพธ์</th></tr></thead><tbody>
        {filteredAudit.slice(page * 10,(page + 1) * 10).map(a => <tr key={a.id}><td className="mono">{fmtFull(a.t)}</td><td>{a.user}</td><td>{a.action}</td><td className="mono">{a.target}</td><td><span className={'pill ' + (String(a.result).includes('ล้มเหลว') ? 'bad' : a.result === 'สำเร็จ' ? 'ok' : 'off')}>{a.result}</span></td></tr>)}
      </tbody></table></div>}{!filteredAudit.length && <div className="empty">{auditSearch ? 'ไม่พบรายการที่ตรงกับคำค้นหา' : 'ยังไม่มีประวัติการดำเนินการ'}</div>}<div className="table-pagination"><span>หน้า {page + 1} / {pages}</span><div><button className="btn" disabled={page === 0} onClick={() => setAuditPage(page - 1)}>ก่อนหน้า</button><button className="btn" disabled={page + 1 >= pages} onClick={() => setAuditPage(page + 1)}>ถัดไป</button></div></div></div>
    </div>
    {isPollingDialogOpen && <div className="modal" onClick={closePollingDialog}>
      <div ref={pollingDialog} className="sheet" style={{maxWidth: '480px'}} role="dialog" aria-modal="true" aria-labelledby="polling-dialog-title" aria-busy={saving} onClick={e => e.stopPropagation()}>
        <div className="sheet-head"><h2 id="polling-dialog-title">ตั้งค่ารอบการอ่านข้อมูล</h2><button className="icon-btn" type="button" disabled={saving} onClick={closePollingDialog} aria-label="ปิด"><Icon name="i-x" /></button></div>
        <form onSubmit={saveInterval}>
          <div className="sheet-body">
            <div className="field"><label htmlFor="poll-interval">รอบการอ่านข้อมูลอุปกรณ์ (วินาที)</label><input id="poll-interval" type="number" min="10" max="3600" step="1" required value={intervalDraft} disabled={saving} aria-describedby="poll-interval-help" onChange={e => {dirty.current = true; setIntervalDraft(e.target.value); setSaveError('');}} /><small id="poll-interval-help" className="hint">กำหนดได้ 10–3,600 วินาที · ค่าปัจจุบัน {pollIntervalSeconds} วินาที</small></div>
            <p className="service-note">มีผลกับรอบอ่านถัดไปและเก็บค่าไว้หลังรีสตาร์ตระบบ หากกำลังอ่านข้อมูลอยู่ ระบบจะอ่านรอบนั้นให้เสร็จก่อนใช้ค่าใหม่</p>
            {saveError && <p className="polling-save-error" role="alert">{saveError}</p>}
          </div>
          <div className="sheet-foot"><button className="btn" type="button" disabled={saving} onClick={closePollingDialog}>ยกเลิก</button><button className="btn btn-primary" type="submit" disabled={!health || saving || Number(intervalDraft) === pollIntervalSeconds}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button></div>
        </form>
      </div>
    </div>}
  </section>;
};
