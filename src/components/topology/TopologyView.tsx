import React, { useRef, useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
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

  console.log('🗺️ TopologyView render:');
  console.log('  - devices:', devices.length, devices.map(d => d.id + ':' + d.name));
  console.log('  - topologyPos:', Object.keys(topologyPos).length, topologyPos);
  console.log('  - topologyLinks:', topologyLinks.length);

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
    await runDiscovery({ network, communities });
    setIsDiscovering(false);
  };

  const getSvgCoordinates = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transformed = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: transformed.x, y: transformed.y };
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
    <section className="view active">
      <div className="page-head">
        <div>
          <h1>โทโพโลยี</h1>
          <p>ค้นหาและไล่เพื่อนบ้านผ่าน CDP/LLDP และ SNMP</p>
        </div>

        <div className="hero-stats">
          {isDiscovering && (
            <div className="prog">
              <i style={{ width: `${discoveryProgress ? Math.round(100 * discoveryProgress.checked / Math.max(1, discoveryProgress.checked + discoveryProgress.queued)) : 0}%` }}></i>
            </div>
          )}
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <input aria-label="IP เริ่มต้น หรือ subnet (ไม่บังคับ)" value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="IP / subnet · ว่าง = อุปกรณ์ที่พบแล้ว" disabled={isDiscovering} />
            <input aria-label="SNMP communities" value={communities} onChange={(e) => setCommunities(e.target.value)} placeholder="SNMP communities คั่นด้วย comma" disabled={isDiscovering} />
            <button
              className="btn btn-primary"
              onClick={handleDiscover}
              disabled={isDiscovering}
            >
              <Icon name="i-radar" />
              Discover
            </button>
          </div>
        </div>
      </div>

      <p className="hint" role="status">
        {!discoveryProgress ? 'ไม่ต้องระบุ subnet · ใช้ IP ที่พบผ่าน CDP/LLDP หรืออุปกรณ์ที่เพิ่มไว้ และ SNMP community ที่บันทึกไว้' :
          `${({ starting: 'เริ่มค้นหา', scanning: 'สแกน subnet', probing: 'ตรวจ SNMP', reading_interfaces: 'อ่านพอร์ต', reading_neighbors: 'อ่านเพื่อนบ้าน', completed: 'ค้นหาเสร็จแล้ว', failed: 'ค้นหาล้มเหลว', cancelled: 'ยกเลิกแล้ว' } as Record<string, string>)[discoveryProgress.phase] || discoveryProgress.phase} ${discoveryProgress.current_name || discoveryProgress.current_ip} · ตรวจแล้ว ${discoveryProgress.checked} · พบ ${discoveryProgress.devices_count} nodes / ${discoveryProgress.links_count} neighbor links`}
      </p>
      {discoveryProgress?.error && <p className="hint" role="alert">{discoveryProgress.error}</p>}
      {!!discoveryProgress?.issues?.length && <details className="hint" open={discoveryProgress.status !== 'running'}>
        <summary>ข้อจำกัดที่พบ ({discoveryProgress.issues.length})</summary>
        <ul>{discoveryProgress.issues.map((issue, index) => <li key={index}>{issue.name || issue.ip || 'Discovery'}: {issue.message}</li>)}</ul>
      </details>}
      <div className="topo-wrap">
        <svg
          id="topo"
          ref={svgRef}
          viewBox="0 0 880 470"
          preserveAspectRatio="xMidYMid meet"
          role="img"
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
                >
                  {/* Icon only - no box background */}
                  <g transform="translate(-30, -30)">
                    <Icon name={d.type === 'switch' ? 'i-switch' : 'i-router'} size={60} />
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

      <p className="hint mt12">
        เส้นเขียว = link up · เส้นประ = พบผ่าน CDP/LLDP ยังไม่ทราบสถานะ · เส้นแดง = link down (อัปเดตทันทีเมื่อได้รับ Trap) · ป้ายแสดง Port · จุดเครือข่ายร่วมรวม neighbor บนพอร์ตเดียวกัน
      </p>
    </section>
  );
};
