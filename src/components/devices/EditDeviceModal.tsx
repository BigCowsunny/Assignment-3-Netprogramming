import React, { useState, useEffect } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { Device, DeviceType, SnmpVersion } from '../../types/snmp';

interface EditDeviceModalProps {
  device: Device | null;
  isOpen: boolean;
  onClose: () => void;
}

const IP_REGEX = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;

export const EditDeviceModal: React.FC<EditDeviceModalProps> = ({
  device,
  isOpen,
  onClose,
}) => {
  const { updateDevice } = useSnmp();

  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [type, setType] = useState<DeviceType>('switch');
  const [vendor, setVendor] = useState('');
  const [version, setVersion] = useState<SnmpVersion>('v2c');
  const [rw, setRw] = useState(true);
  const [status, setStatus] = useState<'online' | 'offline'>('online');

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'ok' | 'err';
    message: string;
    details?: string;
  } | null>(null);

  useEffect(() => {
    if (device) {
      setName(device.name);
      setIp(device.ip);
      setType(device.type);
      setVendor(device.vendor);
      setVersion(device.ver);
      setRw(device.rw);
      setStatus(device.status);
      setTestResult(null);
    }
  }, [device, isOpen]);

  if (!isOpen || !device) return null;

  const handleTestConnection = () => {
    const trimmedIp = ip.trim();
    
    // Skip validation for Serial devices
    if (trimmedIp === 'Serial (COM)') {
      setTestResult({
        status: 'ok',
        message: 'Serial Device',
        details: 'อุปกรณ์นี้เชื่อมต่อผ่าน Console Cable (COM port)\nไม่สามารถใช้ SNMP ได้',
      });
      return;
    }
    
    if (!IP_REGEX.test(trimmedIp)) {
      setTestResult({
        status: 'err',
        message: 'รูปแบบ IP ไม่ถูกต้อง',
        details: 'ตัวอย่างที่ถูก: 192.168.10.16',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    setTimeout(() => {
      setIsTesting(false);
      setTestResult({
        status: 'ok',
        message: 'เชื่อมต่อสำเร็จ · sysDescr ตอบกลับ',
        details: `sysName = ${name}\nsysDescr = ${device.descr}\nuptime = ${device.up}`,
      });
    }, 800);
  };

  const handleSave = () => {
    const trimmedIp = ip.trim();
    
    // Skip validation for Serial devices
    if (trimmedIp !== 'Serial (COM)' && !IP_REGEX.test(trimmedIp)) {
      setTestResult({
        status: 'err',
        message: 'รูปแบบ IP ไม่ถูกต้อง',
      });
      return;
    }

    const updated: Device = {
      ...device,
      name: name.trim() || device.name,
      ip: trimmedIp,
      type,
      vendor: vendor.trim() || device.vendor,
      ver: version,
      rw,
      status,
    };

    updateDevice(updated);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sheet-head">
          <div>
            <h2>แก้ไขอุปกรณ์</h2>
            <p>ปรับปรุงข้อมูลอุปกรณ์และการตั้งค่า SNMP (FR-1.4)</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">
            <Icon name="i-close" />
          </button>
        </div>

        <div className="sheet-body">
          <div className="field">
            <label htmlFor="ed-name">ชื่ออุปกรณ์ (sysName)</label>
            <input
              id="ed-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น Core-SW-01, RTR-Campus-01"
            />
          </div>

          <div className="field">
            <label htmlFor="ed-ip">IP Address</label>
            <input
              id="ed-ip"
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.10.1"
              disabled={ip === 'Serial (COM)'}
              title={ip === 'Serial (COM)' ? 'ไม่สามารถแก้ไข IP ของ Serial device ได้' : ''}
            />
            {ip === 'Serial (COM)' && (
              <small className="hint">อุปกรณ์นี้เชื่อมต่อผ่าน Console Cable (COM port)</small>
            )}
          </div>

          <div className="fgrid">
            <div className="field">
              <label htmlFor="ed-type">ประเภทอุปกรณ์</label>
              <select
                id="ed-type"
                value={type}
                onChange={(e) => setType(e.target.value as DeviceType)}
              >
                <option value="switch">Switch</option>
                <option value="router">Router</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ed-status">สถานะ</label>
              <select
                id="ed-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'online' | 'offline')}
              >
                <option value="online">ออนไลน์ (Online)</option>
                <option value="offline">ออฟไลน์ (Offline)</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="ed-vendor">รุ่น / Vendor</label>
            <input
              id="ed-vendor"
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="เช่น Cisco C2960X-24TS-L"
            />
          </div>

          <div className="fgrid">
            <div className="field">
              <label htmlFor="ed-ver">SNMP Version</label>
              <select
                id="ed-ver"
                value={version}
                onChange={(e) => setVersion(e.target.value as SnmpVersion)}
              >
                <option value="v2c">v2c</option>
                <option value="v3">v3</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ed-rw">สิทธิ์ SNMP</label>
              <select
                id="ed-rw"
                value={rw ? 'rw' : 'ro'}
                onChange={(e) => setRw(e.target.value === 'rw')}
              >
                <option value="rw">Read-Write (สั่ง Up/Down ได้)</option>
                <option value="ro">Read-Only (ดูได้อย่างเดียว)</option>
              </select>
            </div>
          </div>

          {isTesting && (
            <div className="testbox on">
              กำลังทดสอบ SNMP GET ที่ <span className="mono">{ip.trim()}:161</span> …
            </div>
          )}

          {testResult && (
            <div className={`testbox on ${testResult.status}`}>
              <b>{testResult.message}</b>
              {testResult.details && (
                <span className="mono" style={{ whiteSpace: 'pre-line' }}>
                  {testResult.details}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="sheet-foot">
          <button className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            className={`btn ${isTesting ? 'spinning' : ''}`}
            onClick={handleTestConnection}
            disabled={isTesting}
          >
            <Icon name="i-refresh" />
            Test Connection
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            บันทึกการแก้ไข
          </button>
        </div>
      </div>
    </div>
  );
};
