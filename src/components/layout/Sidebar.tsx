import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { ViewName } from '../../types/snmp';

export const Sidebar: React.FC = () => {
  const { view, setView, devices } = useSnmp();

  const onlineCount = devices.filter((d) => d.status === 'online').length;

  const isNavActive = (itemKey: ViewName) => {
    if (itemKey === 'devices' && (view === 'device' || view === 'traffic')) {
      return true;
    }
    return view === itemKey;
  };

  return (
    <nav className="sidenav" aria-label="เมนูหลัก">
      <div className="nav-cap lbl">Monitor</div>

      <button
        className={`nav-item ${isNavActive('dashboard') ? 'active' : ''}`}
        onClick={() => setView('dashboard')}
      >
        <Icon name="i-grid" />
        <span>ภาพรวม</span>
      </button>

      <button
        className={`nav-item ${isNavActive('devices') ? 'active' : ''}`}
        onClick={() => setView('devices')}
      >
        <Icon name="i-server" />
        <span>อุปกรณ์</span>
      </button>

      <button
        className={`nav-item ${isNavActive('events') ? 'active' : ''}`}
        onClick={() => setView('events')}
      >
        <Icon name="i-bell" />
        <span>เหตุการณ์ (Trap)</span>
      </button>

      <button
        className={`nav-item ${isNavActive('topology') ? 'active' : ''}`}
        onClick={() => setView('topology')}
      >
        <Icon name="i-topo" />
        <span>โทโพโลยี</span>
      </button>

      <div className="nav-cap lbl">ระบบ</div>

      <button
        className={`nav-item ${isNavActive('settings') ? 'active' : ''}`}
        onClick={() => setView('settings')}
      >
        <Icon name="i-cog" />
        <span>ตั้งค่า</span>
      </button>

      <div className="nav-foot">
        <div className="row">
          <span>Trap listener</span>
          <span className="ok">UDP 162</span>
        </div>
        <div className="row">
          <span>Poller</span>
          <span className="mono">60 วิ</span>
        </div>
        <div className="row">
          <span>อุปกรณ์ออนไลน์</span>
          <span className="mono">
            {onlineCount}/{devices.length}
          </span>
        </div>
      </div>
    </nav>
  );
};
