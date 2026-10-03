import React, { useRef, useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { CiscoDeviceIcon } from '../common/CiscoDeviceIcon';
import { TopologyConnections } from './TopologyConnections';

export const TopologyView: React.FC = () => {
  const {
    devices,
    topologyPos,
    topologyLinks,
    topologyZoom,
    setTopologyZoom,
    updateTopologyPos,
    runDiscovery,
    discoveryProgress,
    openDevice,
  } = useSnmp();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [network, setNetwork] = useState('');
  const [communities, setCommunities] = useState('');

  const [dragState, setDragState] = useState<{
    nodeId: string;
    dx: number;
    dy: number;
    hasMoved: boolean;
  } | null>(null);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    try { await runDiscovery({ network, communities }); }
    finally { setIsDiscovering(false); }
  };

  const getSvgCoordinates = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transformed = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return {
      x: (transformed.x - 440 * (1 - topologyZoom)) / topologyZoom,
      y: (transformed.y - 235 * (1 - topologyZoom)) / topologyZoom,
    };
  };

  const handlePointerDown = (
    e: React.PointerEvent<SVGGElement>,
    nodeId: string
  ) => {
    const pt = getSvgCoordinates(e as unknown as React.PointerEvent<SVGSVGElement>);
    const currentPos = topologyPos[nodeId];
    if (!currentPos) return;

    setDragState({
      nodeId,
      dx: pt.x - currentPos.x,
      dy: pt.y - currentPos.y,
      hasMoved: false,
    });

    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragState) return;

    const pt = getSvgCoordinates(e);
    const newX = Math.max(72, Math.min(808, pt.x - dragState.dx));
    const newY = Math.max(40, Math.min(432, pt.y - dragState.dy));

    updateTopologyPos(dragState.nodeId, newX, newY);

    if (!dragState.hasMoved) {
      setDragState((prev) => (prev ? { ...prev, hasMoved: true } : null));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragState) return;
    const { nodeId, hasMoved } = dragState;
    setDragState(null);

    // If click without dragging, navigate to device
    if (!hasMoved) {
      openDevice(nodeId);
    }
  };

  const handleZoomIn = () => {
    setTopologyZoom((prev) => Math.min(1.6, prev + 0.2));
  };

  const handleZoomOut = () => {
    setTopologyZoom((prev) => Math.max(0.6, prev - 0.2));
  };

  const transformStyle = `translate(${440 * (1 - topologyZoom)}, ${235 * (1 - topologyZoom)}) scale(${topologyZoom})`;

  return (
    <section className="view active topology-view">
      <div className="page-head">
        <div>
          <h1>โทโพโลยี</h1>
          <p>ค้นหาและไล่เพื่อนบ้านผ่าน CDP/LLDP และ SNMP</p>
        </div>

        <span className="pill off">{devices.length} อุปกรณ์</span>
      </div>
      <div className="card discovery-card"><div className="card-body">
        <div className="discovery-fields">
            <div className="field"><label htmlFor="discovery-seed">IP เริ่มต้น / Subnet <span className="hint">(ไม่บังคับ)</span></label><input id="discovery-seed" value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="เว้นว่างเพื่อเริ่มจากอุปกรณ์ที่พบแล้ว" disabled={isDiscovering} /></div>
            <div className="field"><label htmlFor="discovery-community">SNMP communities <span className="hint">(ไม่บังคับ)</span></label><input id="discovery-community" type="password" autoComplete="off" value={communities} onChange={(e) => setCommunities(e.target.value)} placeholder="ใช้ค่าที่บันทึกไว้ หรือระบุคั่นด้วย comma" disabled={isDiscovering} /></div>
            <button
              className="btn btn-primary"
              onClick={handleDiscover}
              disabled={isDiscovering}
            >
              <Icon name="i-radar" />
              {isDiscovering ? 'กำลังค้นหา…' : 'Discover'}
            </button>
        </div>

      <p className="discovery-status" role="status">
        {!discoveryProgress ? 'ไม่ต้องระบุ subnet · ใช้ IP ที่พบผ่าน CDP/LLDP หรืออุปกรณ์ที่เพิ่มไว้ และ SNMP community ที่บันทึกไว้' :
          `${({ starting: 'เริ่มค้นหา', scanning: 'สแกน subnet', probing: 'ตรวจ SNMP', reading_interfaces: 'อ่านพอร์ต', reading_neighbors: 'อ่านเพื่อนบ้าน', completed: 'ค้นหาเสร็จแล้ว', failed: 'ค้นหาล้มเหลว', cancelled: 'ยกเลิกแล้ว' } as Record<string, string>)[discoveryProgress.phase] || discoveryProgress.phase} ${discoveryProgress.current_name || discoveryProgress.current_ip} · ตรวจแล้ว ${discoveryProgress.checked} · พบ ${discoveryProgress.devices_count} nodes / ${discoveryProgress.links_count} neighbor links`}
      </p>
      {discoveryProgress?.error && <p className="hint" role="alert">{discoveryProgress.error}</p>}
      {!!discoveryProgress?.issues?.length && <details className="discovery-issues">
        <summary>ข้อจำกัดที่พบ ({discoveryProgress.issues.length})</summary>
        <ul>{discoveryProgress.issues.map((issue, index) => <li key={index}>{issue.name || issue.ip || 'Discovery'}: {issue.message}</li>)}</ul>
      </details>}
      </div></div>
      <div className="card topology-card"><div className="card-head"><h3>Network topology</h3><div className="topology-legend"><span><i className="status-dot up"/>Up</span><span><i className="status-dot down"/>Down</span><span><i className="status-dot unknown"/>Unknown</span><span>ลากเพื่อจัดตำแหน่ง · คลิกเพื่อดูพอร์ต</span></div></div>
      <div className="topo-wrap">
        {!devices.length && <div className="empty"><b>ยังไม่มีอุปกรณ์ในแผนภาพ</b><p>เพิ่มอุปกรณ์หรือกด Discover เพื่อเริ่มค้นหา</p></div>}
        <svg
          id="topo"
          ref={svgRef}
          style={!devices.length ? {display:'none'} : undefined}
          viewBox="0 0 880 470"
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="แผนภาพโทโพโลยีเครือข่าย"
          className={dragState ? 'dragging' : ''}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <g className="topo-layer" transform={transformStyle}>
            {/* Port pairs are deduplicated; shared media use one segment. */}
            <TopologyConnections devices={devices} positions={topologyPos} links={topologyLinks} />

            {/* Nodes */}
            {devices.map((d) => {
              const pos = topologyPos[d.id];
              if (!pos) return null;
              const isOnline = d.status === 'online';

              return (
                <g
                  key={`toponode-${d.id}`}
                  className={`node ${isOnline || d.status === 'discovered' ? '' : 'off'}`}
                  transform={`translate(${pos.x},${pos.y})`}
                  onPointerDown={(e) => handlePointerDown(e, d.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={'ดูพอร์ต ' + d.name}
                  onKeyDown={e => { if(e.key === 'Enter' || e.key === ' ') {e.preventDefault();openDevice(d.id);} }}
                >
                  <title>{d.name + ' · ' + (d.ip || 'ไม่มี IP · Config ไม่ได้')}</title>
                  <rect className="node-surface" x="-32" y="-32" width="64" height="64" rx="12" />
                  <g transform="translate(-30, -30)">
                    <CiscoDeviceIcon deviceType={d.type} size={60} />
                  </g>
                  
                  {/* Device name below icon */}
                  <text className="name" x="0" y="42" textAnchor="middle">
                    {d.name}
                  </text>
                  <text className="meta" x="0" y="58" textAnchor="middle">
                    {d.ip || 'ไม่มี IP · Config ไม่ได้'}
                  </text>
                  
                  {/* Status indicator dot */}
                  <circle
                    cx="25"
                    cy="-25"
                    r="5"
                    fill={d.status === 'discovered' ? 'oklch(75% 0.16 75)' : isOnline ? 'oklch(62% 0.15 150)' : 'oklch(56% 0.19 25)'}
                    stroke="white"
                    strokeWidth="2"
                  />
                </g>
              );
            })}
          </g>
        </svg>

        <div className="topo-ctl">
          <button className="icon-btn" onClick={handleZoomOut} aria-label="ย่อ">
            <Icon name="i-zoom-out" />
          </button>
          <button className="icon-btn" onClick={handleZoomIn} aria-label="ขยาย">
            <Icon name="i-zoom-in" />
          </button>
        </div>
      </div>
      </div>

      <p className="hint mt12">
        สายอ้างอิง CDP/LLDP และชื่อพอร์ต · เส้นประ = ยังไม่ทราบสถานะ · จุดเครือข่ายร่วม = อนุมานจาก neighbor หลายตัวบนพอร์ตเดียวกัน
      </p>
    </section>
  );
};
