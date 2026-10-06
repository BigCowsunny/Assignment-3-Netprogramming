import React, { useState, useEffect } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { Device, DeviceType, SnmpVersion } from '../../types/snmp';
import { testConnectionApi } from '../../services/api';
import { useDeviceDialog } from './useDeviceDialog';

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
  const [community, setCommunity] = useState('public');
  const [snmpPort, setSnmpPort] = useState('161');

  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const dialog = useDeviceDialog(isOpen && !!device, onClose, device?.discovery_only ? '#ed-ip' : '#ed-name');
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
      setCommunity(device.community || 'public');
      setSnmpPort(String(device.snmp_port || device.port || 161));
      setTestResult(null);
    }
  // Live polling replaces device objects; preserve the user's unsaved credentials.
  }, [device?.id, isOpen]);

  if (!isOpen || !device) return null;

  const handleTestConnection = async () => {
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

    try {
      const result = await testConnectionApi({ ip: trimmedIp, snmp_version: version, community, port: Number(snmpPort), device_type: type, name });
      setTestResult({ status: result.status === 'ok' ? 'ok' : 'err', message: result.message || 'เชื่อมต่อไม่สำเร็จ', details: result.details });
    } catch (error) {
      setTestResult({ status: 'err', message: 'ทดสอบไม่สำเร็จ', details: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
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
      community,
      snmp_port: Number(snmpPort),
      port: Number(snmpPort),
      status: device.status,
    };

    setIsSaving(true);
    try {
      if (await updateDevice(updated)) onClose();
      else setTestResult({ status: 'err', message: 'บันทึกไม่สำเร็จ', details: 'ตรวจสอบ Management IP และ SNMP community; อุปกรณ์ยังคงสถานะเดิม' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div
        ref={dialog}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-device-title"
      >
        <div className="sheet-head">
          <div>
            <h2 id="edit-device-title">{device.discovery_only ? 'ตั้งค่า IP / SNMP' : 'แก้ไขอุปกรณ์'}</h2>
            <p>ข้อมูลอุปกรณ์และการเชื่อมต่อ SNMP</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">
            <Icon name="i-x" />
          </button>
        </div>

        <div className="sheet-body">
          {device.discovery_only && <div className="notice warning">{device.config_unavailable_reason} · ใส่ Management IP และ community เพื่อยืนยัน SNMP ก่อนใช้งาน</div>}
          <div className="fgrid"><div className="field">
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

          </div><div className="fgrid">
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
              <span className="device-field-label">สถานะจากการ Monitor</span>
              <div className="device-dialog-status">
                <span className={'pill ' + (device.discovery_only || device.status === 'discovered' ? 'warn' : device.status === 'online' ? 'ok' : 'bad')}>
                  <i aria-hidden="true" />{device.discovery_only || device.status === 'discovered' ? 'พบผ่าน CDP/LLDP' : device.status === 'online' ? 'ออนไลน์' : 'ออฟไลน์'}
                </span>
              </div>
            </div>
          </div>

          {ip !== 'Serial (COM)' && <div className="fgrid">
            <div className="field">
              <label htmlFor="ed-community">SNMP Community</label>
              <input id="ed-community" type="password" value={community} onChange={(e) => setCommunity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ed-snmp-port">UDP Port</label>
              <input id="ed-snmp-port" type="number" min="1" max="65535" value={snmpPort} onChange={(e) => setSnmpPort(e.target.value)} />
            </div>
          </div>}

          <div className="fgrid"><div className="field">
            <label htmlFor="ed-vendor">รุ่น / Vendor</label>
            <input
              id="ed-vendor"
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="เช่น Cisco C2960X-24TS-L"
            />
          </div>

            <div className="field">
              <label htmlFor="ed-ver">SNMP Version</label>
              <select
                id="ed-ver"
                value={version}
                onChange={(e) => setVersion(e.target.value as SnmpVersion)}
              >
                <option value="v2c">v2c</option>
              </select>
            </div>

          </div>

          {isTesting && (
            <div className="testbox on">
              กำลังทดสอบ SNMP GET ที่ <span className="mono">{ip.trim()}:{snmpPort}</span> …
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
            className="btn"
            onClick={handleTestConnection}
            disabled={isTesting || isSaving || !ip.trim() || !community.trim()}
          >
            <Icon name="i-refresh" className={isTesting ? 'ic spinning' : 'ic'} />
            Test Connection
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving || isTesting || !ip.trim() || (ip !== 'Serial (COM)' && !community.trim())}>
            {isSaving ? 'กำลังยืนยัน SNMP…' : 'บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  );
};
