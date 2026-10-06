import React, { useMemo } from 'react';
import { Device, TopologyLink, TopologyNodePos } from '../../types/snmp';
import { buildTopologyGraph, normalizedPort } from '../../utils/topologyGraph';
import { shortN } from '../../utils/formatters';

interface Props {
  devices: Device[];
  positions: Record<string, TopologyNodePos>;
  links: TopologyLink[];
}

export const TopologyConnections: React.FC<Props> = ({ devices, positions, links }) => {
  const graph = useMemo(() => buildTopologyGraph(links, devices, positions), [links, devices, positions]);
  const segments = new Map(graph.segments.map((segment) => [segment.id, segment]));
  const rendered = graph.links.map((link) => {
    const A = devices.find((device) => device.id === link.a)!;
    const B = devices.find((device) => device.id === link.b);
    const posA = positions[link.a], posB = positions[link.b] || segments.get(link.b)!.pos;
    const pa = A.ports.find((port) => normalizedPort(port.name) === normalizedPort(link.pa));
    const pb = B?.ports.find((port) => normalizedPort(port.name) === normalizedPort(link.pb));
    const unknown = A.discovery_only || !pa || pa.oper === 'unknown' ||
      (!link.shared && (!B || B.discovery_only || !pb || pb.oper === 'unknown'));
    const up = A.status === 'online' && pa?.oper === 'up' &&
      (link.shared || (B?.status === 'online' && pb?.oper === 'up'));
    const parallel = graph.links.filter((peer) =>
      (peer.a === link.a && peer.b === link.b) || (peer.a === link.b && peer.b === link.a));
    const offset = (parallel.indexOf(link) - (parallel.length - 1) / 2) * 44;
    const dx = posB.x - posA.x, dy = posB.y - posA.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const mx = (posA.x + posB.x) / 2 - dy / distance * offset;
    const my = (posA.y + posB.y) / 2 + dx / distance * offset;
    const cx = (posA.x + posB.x) / 2 - dy / distance * offset * 2;
    const cy = (posA.y + posB.y) / 2 + dx / distance * offset * 2;
    // A saved layout can place unrelated nodes directly between two endpoints.
    // Route around their icon and label so a real R1-R2 link cannot look like
    // a link between the nodes it happens to pass through.
    const blockers = devices.filter((device) => device.id !== link.a && device.id !== link.b)
      .map((device) => positions[device.id]).filter((pos): pos is TopologyNodePos => !!pos);
    const crossesNode = (x1: number, y1: number, x2: number, y2: number, node: TopologyNodePos) => {
      if (Math.abs(x2 - x1) < 1) {
        return Math.abs(x1 - node.x) < 72 &&
          Math.max(Math.min(y1, y2), node.y - 55) < Math.min(Math.max(y1, y2), node.y + 70);
      }
      if (Math.abs(y2 - y1) < 1) {
        return Math.abs(y1 - node.y) < 70 &&
          Math.max(Math.min(x1, x2), node.x - 72) < Math.min(Math.max(x1, x2), node.x + 72);
      }
      const t = Math.max(0, Math.min(1, ((node.x - x1) * (x2 - x1) + (node.y - y1) * (y2 - y1)) /
        ((x2 - x1) ** 2 + (y2 - y1) ** 2)));
      return t > 0.05 && t < 0.95 &&
        Math.abs(x1 + t * (x2 - x1) - node.x) < 72 &&
        Math.abs(y1 + t * (y2 - y1) - node.y) < 70;
    };
    let path = 'M ' + posA.x + ' ' + posA.y + ' Q ' + cx + ' ' + cy + ' ' + posB.x + ' ' + posB.y;
    let labelX = mx, labelY = my;
    if (!link.shared && blockers.some((node) => crossesNode(posA.x, posA.y, posB.x, posB.y, node))) {
      const candidates = [
        Math.max(25, Math.min(posA.y, posB.y) - 85),
        Math.min(440, Math.max(posA.y, posB.y) + 95), 25, 440,
      ];
      const clear = candidates.find((routeY) => blockers.every((node) =>
        !crossesNode(posA.x, posA.y, posA.x, routeY, node) &&
        !crossesNode(posA.x, routeY, posB.x, routeY, node) &&
        !crossesNode(posB.x, routeY, posB.x, posB.y, node)));
      if (clear !== undefined) {
        path = `M ${posA.x} ${posA.y} L ${posA.x} ${clear} L ${posB.x} ${clear} L ${posB.x} ${posB.y}`;
        labelX = (posA.x + posB.x) / 2;
        labelY = clear;
      }
    }
    const label = link.shared ? shortN(link.pa) : shortN(link.pa) + ' ↔ ' + shortN(link.pb);
    const width = Math.max(62, label.length * 6.3 + 16);
    const title = A.name + ' [' + link.pa + '] ↔ ' +
      (link.shared ? 'เครือข่ายร่วม' : B!.name + ' [' + link.pb + ']');
    return {
      link, label, width, title, mx: labelX, my: labelY,
      state: unknown ? 'unknown' : up ? 'up' : 'down',
      path,
    };
  });
  return <>
    {/* All paths first: later paths cannot paint over earlier labels. */}
    <g className="topology-connections">
      {rendered.map((edge) => <path key={edge.link.key} className={'link ' + edge.state} d={edge.path}>
        <title>{edge.title}</title>
      </path>)}
    </g>
    <g className="topology-segments">
      {graph.segments.map((segment) => <g key={segment.id} className="shared-segment"
        transform={'translate(' + segment.pos.x + ',' + segment.pos.y + ')'}>
        <title>{'รวม neighbor บนพอร์ตเดียวกัน: ' + segment.members.map((member) =>
          devices.find((device) => device.id === member.deviceId)!.name + ' [' + member.port + ']').join(' · ')}</title>
        <rect x={-64} y={-23} width={128} height={46} rx={12} />
        <text className="segment-name" x={0} y={-2}>เครือข่ายร่วม</text>
        <text className="segment-meta" x={0} y={14}>
          {'อนุมาน · ' + segment.members.length + ' พอร์ต'}
        </text>
      </g>)}
    </g>
    <g className="topology-port-labels">
      {rendered.map((edge) => <g key={edge.link.key} className="link-label">
        <title>{edge.title}</title>
        <rect x={edge.mx - edge.width / 2} y={edge.my - 10} width={edge.width} height={20} rx={4} />
        <text x={edge.mx} y={edge.my + 4}>{edge.label}</text>
      </g>)}
    </g>
  </>;
};
