import React, { useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { Device, DeviceType, SnmpVersion } from '../../types/snmp';
import { createRouterPorts, createSwitchPorts } from '../../data/initialData';

interface AddDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const IP_REGEX = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;

function probeDevice(ip: string, ty: DeviceType) {
  const isEve = ip.split('.').slice(0, 3).join('.') === '192.168.56';
  if (isEve) {
    return {
      eve: true,
      up: '0 วัน 00:03:12',
      vendor: ty === 'switch' ? 'IOL L2 · EVE-NG Lab' : 'IOSv · EVE-NG Lab',
      descr:
        ty === 'switch'
          ? 'Cisco IOL Software, L2 Plus Service Image, Version 15.2 (Build 280)'
          : 'Cisco IOSv Software (IOSV-ADVENTERENTERPRISEK9-M), Version 15.6(2)T',
    };
  }
  return {
    eve: false,
    up: '0 วัน 00:03:12',
    vendor: ty === 'switch' ? 'Cisco C2960X-24TS-L' : 'Cisco ISR 4331',
    descr:
      ty === 'switch'
        ? 'Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(4)E10'
        : 'Cisco IOS XE Software, Version 16.06.05 (c4300e-universalk9.16.06.05)',
  };
}

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

  if (!isOpen) return null;

  const handleTestConnection = () => {
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

    setTimeout(() => {
      setIsTesting(false);

      if (trimmedIp.split('.')[3] === '254') {
        setTestResult({
          status: 'err',
          message: 'การเชื่อมต่อล้มเหลว',
          details: `SNMP Timeout (2s) — ไม่มีอุปกรณ์ตอบกลับที่ ${trimmedIp} · ตรวจ IP/Firewall UDP 161`,
        });
        setTestedIp(null);
        return;
      }

      const devName = name.trim() || (type === 'switch' ? 'SW-' : 'RTR-') + trimmedIp.split('.')[3];
      const pr = probeDevice(trimmedIp, type);

      setTestResult({
        status: 'ok',
        message: 'เชื่อมต่อสำเร็จ · ได้ข้อมูล sysDescr',
        details: `source = ${
          pr.eve
            ? 'EVE-NG Lab (192.168.56.0/24) — virtual IOL/vIOS'
            : 'Physical device — SNMP via UDP 161'
        }\nsysName = ${devName}\nsysDescr = ${pr.descr}\nsysUpTime = ${pr.up}`,
      });
      setTestedIp(trimmedIp);
    }, 1100);
  };

  const handleSave = () => {
    const trimmedIp = ip.trim();
    if (!testedIp || testedIp !== trimmedIp) return;

    const devName = name.trim() || (type === 'switch' ? 'SW-' : 'RTR-') + trimmedIp.split('.')[3];
    const pr = probeDevice(trimmedIp, type);

    const newDev: Device = {
      id: 'n_' + Date.now().toString(36),
      name: devName,
      ip: trimmedIp,
      type,
      vendor: pr.vendor,
      descr: pr.descr,
      ver: version,
      rw: community !== 'public',
      status: 'online',
      up: pr.up,
      ports: type === 'switch' ? createSwitchPorts(88, {}) : createRouterPorts(88, false),
    };

    addDevice(newDev);
    onClose();
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>เพิ่มอุปกรณ์ใหม่</h2>
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
                onChange={(e) => {
                  setName(e.target.value);
                  setTestedIp(null);
                }}
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
                placeholder="192.168.10.16 · EVE-NG: 192.168.56.101"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="ad-type">ประเภท</label>
              <select
                id="ad-type"
                value={type}
                onChange={(e) => setType(e.target.value as DeviceType)}
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
                onChange={(e) => setVersion(e.target.value as SnmpVersion)}
              >
                <option value="v2c">v2c (community)</option>
                <option value="v3">v3 (credentials)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ad-com">Community / Key</label>
              <input
                id="ad-com"
                type="password"
                value={community}
                onChange={(e) => setCommunity(e.target.value)}
                placeholder="เก็บแบบเข้ารหัส ไม่แสดงกลับบนเว็บ"
              />
            </div>

            <div className="field">
              <label htmlFor="ad-port">UDP Port</label>
              <input
                id="ad-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                min="1"
                max="65535"
              />
            </div>
          </div>

          <p className="hint">
            ระบบจะ SNMP GET <span className="mono">sysDescr</span> (FR-1.2) ก่อนบันทึก —
            ถ้า Timeout จะไม่บันทึกอุปกรณ์
          </p>

          {isTesting && (
            <div className="testbox on">
              กำลัง SNMP GET <span className="mono">sysDescr</span> ที่ {ip.trim()}:161 …
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
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!testedIp || testedIp !== ip.trim()}
          >
            บันทึกอุปกรณ์
          </button>
        </div>
      </div>
    </div>
  );
};
