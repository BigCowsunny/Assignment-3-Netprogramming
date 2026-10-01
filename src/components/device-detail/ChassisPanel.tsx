import React, { useState } from 'react';
import { Device, Port } from '../../types/snmp';
import { useSnmp } from '../../context/SnmpContext';
import { PortContextMenu } from './PortContextMenu';
import { fmtSpeed } from '../../utils/formatters';

interface ChassisPanelProps {
  device: Device;
}

interface TooltipInfo {
  port: Port;
  x: number;
  y: number;
}

interface MenuInfo {
  port: Port;
  x: number;
  y: number;
}

export const ChassisPanel: React.FC<ChassisPanelProps> = ({ device }) => {
  const { showVirtual, setShowVirtual, openTraffic, setPortAdmin } = useSnmp();
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [menu, setMenu] = useState<MenuInfo | null>(null);

  const shownPorts = device.ports.filter((p) => showVirtual || !p.virtual);
  const isSwitch = device.type === 'switch';

  const mainPorts = isSwitch ? shownPorts.filter((p) => p.speed < 10000) : shownPorts;
  const uplinkPorts = shownPorts.filter((p) => isSwitch && p.speed >= 10000);

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>, p: Port) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = rect.left + 20;
    let y = rect.top - 80;
    if (x + 240 > window.innerWidth - 10) x = window.innerWidth - 260;
    if (y < 60) y = rect.bottom + 10;
    setTooltip({ port: p, x, y });
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLButtonElement>, p: Port) => {
    e.preventDefault();
    setTooltip(null);
    setMenu({ port: p, x: e.clientX, y: e.clientY });
  };

  const renderPortCell = (p: Port) => {
    let stateClass = 'p-up';
    let statusLabel = 'up';
    if (p.observed_only || p.admin === 'unknown' || p.oper === 'unknown') {
      stateClass = 'p-admin-down';
      statusLabel = 'ยังไม่ทราบสถานะ';
    } else if (p.admin === 'down' || p.oper === 'down') {
      stateClass = 'p-down';
      statusLabel = 'down';
    }

    return (
      <div key={p.name} className="port-cell">
        <button
          className={`port ${stateClass}`}
          onClick={() => openTraffic(device.id, p.name)}
          onMouseEnter={(e) => handleMouseEnter(e, p)}
          onMouseLeave={() => setTooltip(null)}
          onContextMenu={(e) => handleContextMenu(e, p)}
          aria-label={`${p.name} สถานะ ${statusLabel}`}
        />
        <span>{p.name}</span>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          Port Panel ·{' '}
          <span className="mono">
            {device.ports.filter((p) => !p.virtual).length} {device.discovery_only ? 'ports ที่ CDP/LLDP ประกาศ' : 'ports'} · {device.vendor}
          </span>
        </h3>
        <label className="sw-row" style={{ border: 0, padding: 0, gap: '9px' }}>
          <span className="txt" style={{ fontSize: '12.5px' }}>
            แสดง interface เสมือน
          </span>
          <button
            className={`sw ${showVirtual ? 'on' : ''}`}
            role="switch"
            aria-checked={showVirtual}
            aria-label="แสดง interface เสมือน"
            onClick={() => setShowVirtual(!showVirtual)}
          />
        </label>
      </div>

      <div className="card-body">
        <p className="hint mono" style={{ marginBottom: '12px' }}>
          sysDescr: {device.descr}
        </p>

        <div className="chassis">
          <div className="chassis-top">
            <span>
              {device.vendor} · {shownPorts.length} interfaces จาก {device.discovery_only ? (device.discovery_protocol || 'CDP/LLDP') : 'SNMP'}
            </span>
            <span className="leds">
              <span>
                <span className={`led ${device.status === 'online' ? '' : 'off'}`}></span>
                PWR
              </span>
              <span>
                <span className={`led ${device.status === 'online' ? '' : 'off'}`}></span>
                SYS
              </span>
              <span>
                <span className={`led ${device.status === 'online' ? '' : 'off'}`}></span>
                LINK
              </span>
            </span>
          </div>

          <div className={`ports ${isSwitch ? '' : 'rtr'}`}>
            {mainPorts.map(renderPortCell)}
          </div>

          {uplinkPorts.length > 0 && (
            <>
              <div className="sep">UPLINK · 10G</div>
              <div className="ports">{uplinkPorts.map(renderPortCell)}</div>
            </>
          )}
        </div>

        <div className="legend">
          <span>
            <i className="p-up"></i>up (เขียว)
          </span>
          <span>
            <i className="p-down"></i>down (แดง)
          </span>
          <span className="hint">
            คลิก Port เพื่อดูกราฟทราฟฟิก · คลิกขวาเพื่อสั่ง Up/Down
          </span>
        </div>
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="port-tooltip"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <b>{tooltip.port.name}</b>
          <div className="kv">
            <span>ifIndex</span>
            <span>{tooltip.port.idx}</span>
          </div>
          <div className="kv">
            <span>ความเร็ว</span>
            <span>{fmtSpeed(tooltip.port.speed)}</span>
          </div>
          <div className="kv">
            <span>Admin / Oper</span>
            <span>
              {tooltip.port.admin} / {tooltip.port.oper}
            </span>
          </div>
          <div className="kv">
            <span>MAC</span>
            <span>{tooltip.port.mac}</span>
          </div>
          <div className="kv">
            <span>Description</span>
            <span>{tooltip.port.alias}</span>
          </div>
          {tooltip.port.ip && (
            <div className="kv">
              <span>IP</span>
              <span>{tooltip.port.ip}</span>
            </div>
          )}
          {tooltip.port.errors > 0 && (
            <div className="kv">
              <span>ifInErrors</span>
              <span>{tooltip.port.errors}</span>
            </div>
          )}
        </div>
      )}

      {/* Right click menu */}
      {menu && (
        <PortContextMenu
          device={device}
          port={menu.port}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onViewTraffic={() => openTraffic(device.id, menu.port.name)}
          onToggleAdmin={(turnDown) => setPortAdmin(device.id, menu.port.name, turnDown)}
        />
      )}
    </div>
  );
};
