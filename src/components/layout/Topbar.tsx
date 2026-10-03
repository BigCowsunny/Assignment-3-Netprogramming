import React, { useEffect, useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { pad } from '../../utils/formatters';
import netsmonitorLogo from '../../assets/netsmonitor-logo.png';

export const Topbar: React.FC = () => {
  const { searchQuery, setSearchQuery, setView, isBackendConnected } = useSnmp();
  const [time, setTime] = useState<string>('00:00:00');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setView('devices');
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src={netsmonitorLogo} width="34" height="34" alt="" />
        <span>NetSmonitor <small>v1.0</small></span>
      </div>

      <span className="demo-badge">SNMP · CDP · LLDP</span>

      <div className="spacer"></div>

      <label className="gsearch">
        <Icon name="i-search" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ค้นหาชื่อ / IP อุปกรณ์"
          aria-label="ค้นหาอุปกรณ์"
        />
      </label>

      <span className="live-chip">
        <span className={isBackendConnected ? 'dot' : 'connection-off'}></span>{isBackendConnected ? 'บริการระบบพร้อมใช้งาน' : 'ขาดการเชื่อมต่อกับบริการระบบ'}
      </span>

      <span id="clock">{time}</span>
    </header>
  );
};
