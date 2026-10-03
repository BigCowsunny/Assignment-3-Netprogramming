import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { Device, DeviceType, SnmpVersion } from '../../types/snmp';
import { createDeviceApi, testConnectionApi } from '../../services/api';
import { useDeviceDialog } from './useDeviceDialog';

interface AddDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const IP_REGEX = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;

export const AddDeviceModal: React.FC<AddDeviceModalProps> = ({ isOpen, onClose }) => {
  const { addDevice } = useSnmp();

  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [type, setType] = useState<DeviceType>('switch');
  const [version, setVersion] = useState<SnmpVersion>('v2c');
  const [community, setCommunity] = useState('private');
  const [port, setPort] = useState('161');

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'ok' | 'err';
    message: string;
    details?: string;
  } | null>(null);
  const [testedIp, setTestedIp] = useState<string | null>(null);
  const dialog = useDeviceDialog(isOpen, onClose, '#ad-ip');

  if (!isOpen) return null;

  const probeSignature = (candidateIp = ip.trim()) => `${candidateIp}|${community}|${port}|${type}|${version}`;

  const handleTestConnection = async () => {
    const trimmedIp = ip.trim();
    if (!IP_REGEX.test(trimmedIp)) {
      setTestResult({
        status: 'err',
        message: 'รูปแบบ IP ไม่ถูกต้อง',
        details: 'ตัวอย่างที่ถูก: 192.168.10.16',
      });
      setTestedIp(null);
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnectionApi({
        ip: trimmedIp,
        snmp_version: version,
        community,
        port: Number(port),
        device_type: type,
        name: name.trim(),
      });
      setTestResult({
        status: result.status === 'ok' ? 'ok' : 'err',
        message: result.message || 'เชื่อมต่อไม่สำเร็จ',
        details: result.details,
      });
      setTestedIp(result.status === 'ok' ? probeSignature(trimmedIp) : null);
    } catch (error) {
      setTestedIp(null);
      setTestResult({ status: 'err', message: 'ไม่สามารถเชื่อมต่อบริการระบบได้', details: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const trimmedIp = ip.trim();
    if (!testedIp || testedIp !== probeSignature(trimmedIp)) return;
    setIsTesting(true);
    try {
      const device = await createDeviceApi({ name: name.trim(), ip: trimmedIp, snmp_version: version, community, port: Number(port), device_type: type });
      addDevice(device as Device);
      onClose();
    } catch (error) {
      setTestResult({ status: 'err', message: 'เพิ่มอุปกรณ์ไม่สำเร็จ', details: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div ref={dialog} className="sheet" role="dialog" aria-modal="true" aria-labelledby="add-device-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="add-device-title">เพิ่มอุปกรณ์ใหม่</h2>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">
            <Icon name="i-x" />
          </button>
        </div>

        <div className="sheet-body">
          <div className="fgrid">
            <div className="field">
              <label htmlFor="ad-name">ชื่ออุปกรณ์ (ไม่บังคับ)</label>
              <input
                id="ad-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น Access-SW-05"
              />
            </div>

            <div className="field">
              <label htmlFor="ad-ip">IP Address *</label>
              <input
                id="ad-ip"
                value={ip}
                onChange={(e) => {
                  setIp(e.target.value);
                  setTestedIp(null);
                  setTestResult(null);
                }}
                placeholder="Management IP ของอุปกรณ์ เช่น 192.168.10.16"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="ad-type">ประเภท</label>
              <select
                id="ad-type"
                value={type}
                onChange={(e) => { setType(e.target.value as DeviceType); setTestedIp(null); }}
              >
                <option value="switch">Switch</option>
                <option value="router">Router</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ad-ver">SNMP Version</label>
              <select
                id="ad-ver"
                value={version}
                onChange={(e) => { setVersion(e.target.value as SnmpVersion); setTestedIp(null); }}
              >
                <option value="v2c">v2c (community)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ad-com">Community / Key</label>
              <input
                id="ad-com"
                type="password"
                value={community}
                onChange={(e) => { setCommunity(e.target.value); setTestedIp(null); }}
                placeholder="SNMP community ที่ตั้งบนอุปกรณ์"
              />
            </div>

            <div className="field">
              <label htmlFor="ad-port">UDP Port</label>
              <input
                id="ad-port"
                type="number"
                value={port}
                onChange={(e) => { setPort(e.target.value); setTestedIp(null); }}
                min="1"
                max="65535"
              />
            </div>
          </div>

          <p className="hint">
            ระบุ Management IP ที่ระบบเข้าถึงได้ สำหรับ EVE-NG ใช้ IP ของอุปกรณ์ภายใน Lab · เปิด SNMP v2c และกำหนดสิทธิ์ให้ community นี้
          </p>

          {isTesting && (
            <div className="testbox on">
              กำลัง SNMP GET <span className="mono">sysDescr</span> ที่ {ip.trim()}:{port} …
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
            disabled={isTesting || !ip.trim() || !community.trim()}
          >
            <Icon name="i-refresh" className={isTesting ? 'ic spinning' : 'ic'} />
            Test Connection
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isTesting || !testedIp || testedIp !== probeSignature()}
          >
            บันทึกอุปกรณ์
          </button>
        </div>
      </div>
    </div>
  );
};
