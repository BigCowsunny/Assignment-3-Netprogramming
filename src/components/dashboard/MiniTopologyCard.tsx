import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { TopologyConnections } from '../topology/TopologyConnections';

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
            {/* Port pairs are deduplicated; shared media use one segment. */}
            <TopologyConnections devices={devices} positions={topologyPos} links={topologyLinks} />

            {/* Nodes */}
            {devices.map((d) => {
              const pos = topologyPos[d.id];
              if (!pos) return null;
              const isOnline = d.status === 'online';

              return (
                <g
                  key={`mininode-${d.id}`}
                  className={`node ${isOnline || d.status === 'discovered' ? '' : 'off'}`}
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
        <p className="hint" style={{ marginTop: '10px' }}>
          คลิกโหนดเพื่อเปิด Port Panel · จัดตำแหน่งโหนดได้ในหน้าโทโพโลยี
        </p>
      </div>
    </div>
  );
};
