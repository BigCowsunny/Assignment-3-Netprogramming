import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { shortN } from '../../utils/formatters';

export const MiniTopologyCard: React.FC = () => {
  const { devices, topologyPos, topologyLinks, openDevice, setView } = useSnmp();

  return (
    <div className="card mt12">
      <div className="card-head">
        <h3>โทโพโลยีเครือข่าย</h3>
        <div className="legend-row">
          <span>
            <i className="k-up"></i>link up
          </span>
          <span>
            <i className="k-down"></i>link down
          </span>
          <button className="btn btn-ghost" onClick={() => setView('topology')}>
            <Icon name="i-topo" />
            เปิดแผนภาพเต็ม
          </button>
        </div>
      </div>
      <div className="card-body">
        <svg
          id="topo-mini"
          viewBox="0 0 880 470"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="แผนภาพโทโพโลยีเครือข่าย (ย่อ)"
        >
          <g className="topo-layer">
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
                <g key={`minilink-${i}`}>
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
                  key={`mininode-${d.id}`}
                  className={`node ${isOnline ? '' : 'off'}`}
                  transform={`translate(${pos.x},${pos.y})`}
                  onClick={() => openDevice(d.id)}
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
        <p className="hint" style={{ marginTop: '10px' }}>
          คลิกโหนดเพื่อเปิด Port Panel · จัดตำแหน่งโหนดได้ในหน้าโทโพโลยี
        </p>
      </div>
    </div>
  );
};
