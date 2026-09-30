import React, { useRef, useState } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { shortN } from '../../utils/formatters';

export const TopologyView: React.FC = () => {
  const {
    devices,
    topologyPos,
    topologyLinks,
    topologyZoom,
    setTopologyZoom,
    updateTopologyPos,
    runDiscovery,
    openDevice,
  } = useSnmp();

  console.log('🗺️ TopologyView render:');
  console.log('  - devices:', devices.length, devices.map(d => d.id + ':' + d.name));
  console.log('  - topologyPos:', Object.keys(topologyPos).length, topologyPos);
  console.log('  - topologyLinks:', topologyLinks.length);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoverProgress, setDiscoverProgress] = useState(0);
  const [scanMode, setScanMode] = useState<'network' | 'eveng'>('network');
  const [network, setNetwork] = useState('192.168.1.0/24');
  const [communities, setCommunities] = useState('public,private');
  const [evengHost, setEvengHost] = useState('192.168.213.1');
  const [evengUsername, setEvengUsername] = useState('admin');
  const [evengPassword, setEvengPassword] = useState('eve');

  const [dragState, setDragState] = useState<{
    nodeId: string;
    dx: number;
    dy: number;
    hasMoved: boolean;
  } | null>(null);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    setDiscoverProgress(0);
    setDiscoverProgress(35);
    await runDiscovery(scanMode === 'eveng'
      ? { mode: 'eveng', host: evengHost, username: evengUsername, password: evengPassword }
      : { mode: 'network', network, communities });
    setDiscoverProgress(100);
    setIsDiscovering(false);
    setTimeout(() => setDiscoverProgress(0), 500);
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
          <p>สแกนอุปกรณ์จริงผ่าน SNMP หรือค้นหา node ใน EVE-NG</p>
        </div>

        <div className="hero-stats">
          {isDiscovering && (
            <div className="prog">
              <i style={{ width: `${discoverProgress}%` }}></i>
            </div>
          )}
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <select aria-label="วิธีค้นหาอุปกรณ์" value={scanMode} onChange={(e) => setScanMode(e.target.value as 'network' | 'eveng')} disabled={isDiscovering}>
              <option value="network">เครือข่ายจริง (SNMP)</option>
              <option value="eveng">EVE-NG</option>
            </select>
            {scanMode === 'network' ? (
              <>
                <input aria-label="Subnet ที่ต้องการสแกน" value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="192.168.1.0/24" disabled={isDiscovering} />
                <input aria-label="SNMP communities" value={communities} onChange={(e) => setCommunities(e.target.value)} placeholder="SNMP communities คั่นด้วย comma" disabled={isDiscovering} />
              </>
            ) : (
              <>
                <input aria-label="EVE-NG host" value={evengHost} onChange={(e) => setEvengHost(e.target.value)} placeholder="EVE-NG IP หรือ URL" disabled={isDiscovering} />
                <input aria-label="EVE-NG username" value={evengUsername} onChange={(e) => setEvengUsername(e.target.value)} placeholder="Username" disabled={isDiscovering} />
                <input aria-label="EVE-NG password" type="password" value={evengPassword} onChange={(e) => setEvengPassword(e.target.value)} placeholder="Password" disabled={isDiscovering} />
              </>
            )}
            <button
              className="btn btn-primary"
              onClick={handleDiscover}
              disabled={isDiscovering || (scanMode === 'network' ? !network.trim() : !evengHost.trim())}
            >
              <Icon name="i-radar" />
              Discover
            </button>
          </div>
        </div>
      </div>

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
            {/* Links */}
            {topologyLinks.map((l, i) => {
              const A = devices.find((d) => d.id === l.a);
              const B = devices.find((d) => d.id === l.b);
              const posA = topologyPos[l.a];
              const posB = topologyPos[l.b];
              if (!A || !B || !posA || !posB) return null;

              const pa = A.ports.find((p) => p.name === l.pa);
              const pb = B.ports.find((p) => p.name === l.pb);
              const isUp =
                pa?.oper === 'up' &&
                pb?.oper === 'up' &&
                A.status === 'online' &&
                B.status === 'online';

              const mx = (posA.x + posB.x) / 2;
              const my = (posA.y + posB.y) / 2;

              return (
                <g key={`topolink-${i}`}>
                  <line
                    className={`link ${isUp ? 'up' : 'down'}`}
                    x1={posA.x}
                    y1={posA.y}
                    x2={posB.x}
                    y2={posB.y}
                  />
                  <g className="link-label">
                    <rect
                      x={mx - 52}
                      y={my - 9}
                      width={104}
                      height={18}
                      rx={4}
                    />
                    <text x={mx} y={my + 4}>
                      {shortN(l.pa)} ↔ {shortN(l.pb)}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Nodes */}
            {devices.map((d) => {
              const pos = topologyPos[d.id];
              if (!pos) return null;
              const isOnline = d.status === 'online';

              return (
                <g
                  key={`toponode-${d.id}`}
                  className={`node ${isOnline ? '' : 'off'}`}
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
                    {d.ip}
                  </text>
                  
                  {/* Status indicator dot */}
                  <circle
                    cx="25"
                    cy="-25"
                    r="5"
                    fill={isOnline ? 'oklch(62% 0.15 150)' : 'oklch(56% 0.19 25)'}
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
        เส้นเขียว = link up · เส้นแดง = link down (อัปเดตทันทีเมื่อได้รับ Trap) · ป้ายแสดง Port ปลายทางทั้งสองฝั่ง
      </p>
    </section>
  );
};
