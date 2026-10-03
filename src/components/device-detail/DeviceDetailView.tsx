import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { CiscoDeviceIcon } from '../common/CiscoDeviceIcon';
import { ChassisPanel } from './ChassisPanel';
import { EditDeviceModal } from '../devices/EditDeviceModal';
import { configurationWarning } from '../../utils/deviceManagement';

export const DeviceDetailView: React.FC = () => {
  const { activeDevice: device, setView, refreshDeviceData, pollingCountdown } = useSnmp();
  const [isEditOpen, setIsEditOpen] = useState(false);
  if (!device) return <section className="view active"><div className="empty">ไม่พบอุปกรณ์ที่เลือก</div><button className="btn" onClick={() => setView('devices')}>กลับไปที่อุปกรณ์</button></section>;
  const physical = device.ports.filter(p => !p.virtual);
  const unknown = physical.filter(p => p.observed_only || p.admin === 'unknown' || p.oper === 'unknown').length;
  const up = physical.filter(p => !p.observed_only && p.admin === 'up' && p.oper === 'up').length;
  const warning = configurationWarning(device);
  return <section className="view active detail-view">
    <div className="back-row"><button className="btn btn-ghost" onClick={() => setView('devices')}><Icon name="i-back" />อุปกรณ์ / รายละเอียด</button></div>
    <div className="page-head">
      <div><div className="title-line"><span className="device-avatar"><CiscoDeviceIcon deviceType={device.type} size={38} /></span><h1>{device.name}</h1><span className={'pill ' + (device.discovery_only ? 'warn' : device.status === 'online' ? 'ok' : 'bad')}><i />{device.discovery_only ? 'Discovered' : device.status === 'online' ? 'Online' : 'Offline'}</span></div>
        <p>{device.type === 'switch' ? 'Switch' : 'Router'} <span className="separator">/</span> <span className="mono">{device.ip || 'ไม่มี Management IP'}</span><span className="separator">/</span>{device.discovery_only ? device.discovery_protocol || 'CDP/LLDP' : 'SNMP ' + device.ver}</p>
      </div>
      <div className="hero-stats"><span className="hint">รีเฟรชใน {pollingCountdown} วิ</span><button className="btn" onClick={refreshDeviceData}><Icon name="i-refresh" />รีเฟรช</button><button className="btn btn-primary" onClick={() => setIsEditOpen(true)}><Icon name="i-cog" />{device.discovery_only ? 'ตั้งค่า IP / SNMP' : 'แก้ไขอุปกรณ์'}</button></div>
    </div>
    {warning && <div className="notice warning"><Icon name="i-triangle-alert" /><div><b>Config ไม่ได้</b><p>{warning} แสดงเฉพาะพอร์ตที่เพื่อนบ้านประกาศ ยังไม่ใช่พอร์ตทั้งหมด</p></div></div>}
    <div className="grid4 port-summary">
      {[[device.discovery_only ? 'พอร์ตที่เพื่อนบ้านประกาศ' : 'Physical ports', physical.length, ''], ['Link up', up, 'positive'], ['Link down', physical.length - up - unknown, 'negative'], ['ยังไม่ทราบสถานะ', unknown, '']].map(([label, value, tone]) => <div className="card kpi" key={label}><div className="lbl">{label}</div><div className={'v ' + tone}>{value}</div></div>)}
    </div>
    <ChassisPanel device={device} />
    <details className="card device-information"><summary>ข้อมูลอุปกรณ์ <span className="hint">System description / Uptime</span></summary><div className="card-body"><dl className="detail-list"><dt>Uptime</dt><dd>{device.discovery_only ? '—' : device.up || '—'}</dd><dt>System description</dt><dd>{device.descr || device.vendor || '—'}</dd></dl></div></details>
    <EditDeviceModal device={device} isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} />
  </section>;
};
