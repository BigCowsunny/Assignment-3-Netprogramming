import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { ViewName } from '../../types/snmp';
const navigation: {key: ViewName; label: string; icon: string}[] = [
  {key:'dashboard',label:'ภาพรวม',icon:'i-grid'}, {key:'devices',label:'อุปกรณ์',icon:'i-server'},
  {key:'events',label:'เหตุการณ์ (Trap)',icon:'i-bell'}, {key:'topology',label:'โทโพโลยี',icon:'i-topo'},
  {key:'settings',label:'ตั้งค่า',icon:'i-cog'},
];
export const Sidebar: React.FC = () => {
  const {view,setView,devices,isBackendConnected} = useSnmp();
  return <nav className="sidenav" aria-label="เมนูหลัก">
    <div className="nav-cap lbl">Monitor</div>
    {navigation.map(item => {
      const active = view === item.key || (item.key === 'devices' && (view === 'device' || view === 'traffic'));
      return <React.Fragment key={item.key}>{item.key === 'settings' && <div className="nav-cap lbl">ระบบ</div>}
        <button className={'nav-item ' + (active ? 'active' : '')} aria-label={item.label} aria-current={active ? 'page' : undefined} title={item.label} onClick={() => setView(item.key)}><Icon name={item.icon}/><span>{item.label}</span></button>
      </React.Fragment>;
    })}
    <div className="nav-foot"><div className="row"><span>บริการระบบ</span><span>{isBackendConnected ? 'พร้อมใช้งาน' : 'ขาดการเชื่อมต่อ'}</span></div><div className="row"><span>โปรโตคอล</span><span>SNMP</span></div><div className="row"><span>อุปกรณ์ออนไลน์</span><span>{devices.filter(d => d.status === 'online').length}/{devices.length}</span></div></div>
  </nav>;
};
