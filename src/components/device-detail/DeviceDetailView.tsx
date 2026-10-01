import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { ChassisPanel } from './ChassisPanel';
import { EditDeviceModal } from '../devices/EditDeviceModal';
import { configurationWarning } from '../../utils/deviceManagement';

export const DeviceDetailView: React.FC = () => {
  const { activeDevice, setView, refreshDeviceData, pollingCountdown } = useSnmp();
  const [isEditOpen, setIsEditOpen] = useState(false);

  if (!activeDevice) {
    return (
      <section className="view active">
        <p className="empty">ไม่พบอุปกรณ์ที่เลือก</p>
        <button className="btn" onClick={() => setView('devices')}>
          กลับไปที่หน้ารายการอุปกรณ์
        </button>
      </section>
    );
  }

  const physicalPorts = activeDevice.ports.filter((p) => !p.virtual);
  const upCount = physicalPorts.filter((p) => p.admin === 'up' && p.oper === 'up').length;
  const downCount = physicalPorts.length - upCount;

  return (
    <section className="view active">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={() => setView('devices')}>
          <Icon name="i-back" />
          กลับไปที่รายการอุปกรณ์
        </button>
      </div>

      <div className="page-head">
        <div className="device-hero">
          <div>
            <div style={{ display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap' }}>
              <h1>{activeDevice.name}</h1>
              <span className="pill off">
                {activeDevice.type === 'switch' ? 'Switch' : 'Router'}
              </span>
              <span className={`pill ${activeDevice.status === 'online' ? 'ok' : activeDevice.status === 'discovered' ? 'warn' : 'bad'}`}>
                <i></i>
                {activeDevice.status === 'online' ? 'ออนไลน์' : activeDevice.status === 'discovered' ? 'พบผ่าน CDP/LLDP' : 'ออฟไลน์'}
              </span>
            </div>
            <p className="mono">
              {activeDevice.ip || 'ไม่มี IP'} · {activeDevice.vendor}{!activeDevice.discovery_only && ` · SNMP ${activeDevice.ver} · ตรวจสิทธิ์ SET ที่อุปกรณ์ตอนสั่ง · uptime ${activeDevice.up}`}
            </p>
            {configurationWarning(activeDevice) && <p className="hint" role="alert">{configurationWarning(activeDevice)} · แสดงเฉพาะพอร์ตที่ CDP/LLDP ประกาศ ยังไม่ใช่พอร์ตทั้งหมด</p>}
          </div>
        </div>

        <div className="hero-stats">
          <div className="hint mono">รีเฟรชถัดไปใน {pollingCountdown} วิ</div>
          <button className="btn" onClick={() => setIsEditOpen(true)}>
            <Icon name="i-set" />
            {activeDevice.discovery_only ? 'ตั้งค่า IP/SNMP' : 'แก้ไขอุปกรณ์'}
          </button>
          <button className="btn" onClick={refreshDeviceData}>
            <Icon name="i-refresh" />
            รีเฟรช
          </button>
        </div>
      </div>

      <ChassisPanel device={activeDevice} />

      <div className="summary-grid">
        <div className="sum">
          <div className="lbl">up</div>
          <div className="v" style={{ color: 'oklch(45% 0.13 150)' }}>
            {activeDevice.discovery_only ? '—' : upCount}
          </div>
        </div>
        <div className="sum">
          <div className="lbl">down</div>
          <div className="v" style={{ color: 'oklch(47% 0.17 25)' }}>
            {activeDevice.discovery_only ? '—' : downCount}
          </div>
        </div>
      </div>

      <EditDeviceModal
        device={activeDevice}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
      />
    </section>
  );
};
