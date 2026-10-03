import React, { useState } from 'react';
import { Device, Port } from '../../types/snmp';
import { useSnmp } from '../../context/SnmpContext';
import { PortContextMenu } from './PortContextMenu';
import { fmtSpeed, shortN } from '../../utils/formatters';
import { configurationWarning } from '../../utils/deviceManagement';

export const ChassisPanel: React.FC<{ device: Device }> = ({ device }) => {
  const { showVirtual, setShowVirtual, openTraffic, setPortAdmin } = useSnmp();
  const [menu, setMenu] = useState<{port: Port; x: number; y: number} | null>(null);
  const warning = configurationWarning(device);
  const shown = device.ports.filter(p => showVirtual || !p.virtual);
  const showMenu = (element: HTMLElement, port: Port) => { const rect = element.getBoundingClientRect(); setMenu({port, x: rect.left, y: rect.bottom + 6}); };
  return <div className="card port-panel">
    <div className="card-head"><div><h3>Port Panel</h3><p className="hint">{shown.length} interfaces · {device.discovery_only ? 'ข้อมูลจากเพื่อนบ้าน' : 'ข้อมูลจาก SNMP'}</p></div><label className="sw-row compact-switch"><span>Virtual interfaces</span><button className={'sw ' + (showVirtual ? 'on' : '')} role="switch" aria-checked={showVirtual} aria-label="แสดง interface เสมือน" onClick={() => setShowVirtual(!showVirtual)} /></label></div>
    <div className="card-body">
      <div className="port-grid">{shown.map(p => {
        const unknown = p.observed_only || p.admin === 'unknown' || p.oper === 'unknown';
        const state = unknown ? 'unknown' : p.admin === 'down' ? 'shutdown' : p.oper === 'down' ? 'down' : 'up';
        const label = state === 'unknown' ? 'Unknown' : state === 'shutdown' ? 'Admin down' : state === 'down' ? 'Link down' : 'Link up';
        return <div key={p.idx + ':' + p.name} className={'interface-tile ' + state}>
          <button className="port-options" aria-label={'จัดการพอร์ต ' + p.name} aria-haspopup="menu" onClick={e => showMenu(e.currentTarget, p)}>•••</button>
          <button className="interface-main" aria-label={p.name + ' สถานะ ' + label} onClick={e => warning ? showMenu(e.currentTarget, p) : openTraffic(device.id, p.name)} onContextMenu={e => {e.preventDefault(); setMenu({port:p,x:e.clientX,y:e.clientY});}} onKeyDown={e => {if(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {e.preventDefault();showMenu(e.currentTarget,p);}}} title={'Admin: ' + p.admin + ' / Oper: ' + p.oper + '\n' + (p.alias || p.name) + '\nMAC: ' + (p.mac || '—')}>
            <span className={'interface-socket ' + (p.virtual ? 'virtual' : '')}><span className="socket-pins"/><span className="interface-led"/></span>
            <b className="interface-name" title={p.name}>{shortN(p.name)}</b><span className="interface-state">{label}</span><span className="interface-speed">{p.speed > 0 ? fmtSpeed(p.speed) : '—'}</span>
          </button>
        </div>;
      })}</div>
      {!shown.length && <div className="empty"><b>ยังไม่มีข้อมูลพอร์ต</b><p>รอข้อมูล SNMP หรือข้อมูลที่ CDP/LLDP ประกาศ</p></div>}
      <div className="port-legend"><span><i className="status-dot up"/>Up</span><span><i className="status-dot down"/>Down</span><span><i className="status-dot unknown"/>Unknown</span><span className="hint">คลิกพอร์ตเพื่อดูทราฟฟิก · ปุ่ม ••• เพื่อจัดการ</span></div>
    </div>
    {menu && <PortContextMenu device={device} port={menu.port} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onViewTraffic={() => openTraffic(device.id,menu.port.name)} onToggleAdmin={down => setPortAdmin(device.id,menu.port.name,down)} />}
  </div>;
};
