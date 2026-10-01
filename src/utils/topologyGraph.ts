import { Device, TopologyLink, TopologyNodePos } from '../types/snmp';

export function normalizedPort(value: string): string {
  return value.trim().toLowerCase()
    .replace(/^gigabitethernet/, 'gi').replace(/^gig(?=\d)/, 'gi')
    .replace(/^fastethernet/, 'fa').replace(/^fas(?=\d)/, 'fa')
    .replace(/^tengigabitethernet/, 'te')
    .replace(/^ethernet/, 'et').replace(/^eth(?=\d)/, 'et');
}

export function topologyLinkKey(link: TopologyLink): string {
  return JSON.stringify([
    [link.a, normalizedPort(link.pa)], [link.b, normalizedPort(link.pb)],
  ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

/** One undirected device/port pair, regardless of reporter or CDP/LLDP. */
export function uniqueTopologyLinks(links: TopologyLink[]): TopologyLink[] {
  const unique = new Map<string, TopologyLink>();
  for (const link of links) {
    if (!link.a || !link.b || !link.pa || !link.pb || link.a === link.b) continue;
    const ends = [
      { device: link.a, port: link.pa }, { device: link.b, port: link.pb },
    ].sort((a, b) => a.device.localeCompare(b.device) || normalizedPort(a.port).localeCompare(normalizedPort(b.port)));
    const key = topologyLinkKey(link);
    if (!unique.has(key)) unique.set(key, {
      ...link, a: ends[0].device, pa: ends[0].port, b: ends[1].device, pb: ends[1].port,
    });
    else if (!unique.get(key)!.proto && link.proto) unique.get(key)!.proto = link.proto;
  }
  return [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, link]) => link);
}

export interface SharedSegment {
  id: string;
  pos: TopologyNodePos;
  members: { deviceId: string; port: string }[];
  protocols: string[];
}

export interface DisplayLink extends TopologyLink {
  key: string;
  shared: boolean;
}

function endpointKey(device: string, port: string): string {
  return JSON.stringify([device, normalizedPort(port)]);
}

function segmentPosition(
  members: SharedSegment['members'], devices: Device[], positions: Record<string, TopologyNodePos>,
  previous: SharedSegment[],
): TopologyNodePos {
  const center = members.reduce((sum, member) => ({
    x: sum.x + positions[member.deviceId].x / members.length,
    y: sum.y + positions[member.deviceId].y / members.length,
  }), { x: 0, y: 0 });
  const candidates = [[0, 0], [0, 60], [60, 0], [-60, 0], [0, -60],
    [60, 60], [-60, 60], [0, 110], [110, 0], [-110, 0], [0, -110]];
  const score = (pos: TopologyNodePos) => {
    let collisions = 0;
    for (const device of devices) {
      const p = positions[device.id];
      if (!p) continue;
      const halfWidth = Math.max(68, device.name.length * 3.5);
      if (pos.x + 64 > p.x - halfWidth && pos.x - 64 < p.x + halfWidth &&
          pos.y + 23 > p.y - 35 && pos.y - 23 < p.y + 70) collisions++;
    }
    for (const segment of previous) {
      if (Math.abs(pos.x - segment.pos.x) < 140 && Math.abs(pos.y - segment.pos.y) < 65) collisions++;
    }
    return collisions * 100000 + Math.hypot(pos.x - center.x, pos.y - center.y);
  };
  return candidates.map(([dx, dy]) => ({
    x: Math.max(80, Math.min(800, center.x + dx)),
    y: Math.max(45, Math.min(400, center.y + dy)),
  })).sort((a, b) => score(a) - score(b))[0];
}

/**
 * A complete neighbor graph on the SAME interface of 3+ distinct devices is
 * displayed as a shared segment. No grouping from subnet or names alone.
 * Incomplete tables and triangles using different interfaces remain separate.
 * Original API observations are untouched; this is a presentation grouping.
 */
export function buildTopologyGraph(
  input: TopologyLink[], devices: Device[], positions: Record<string, TopologyNodePos>,
): { links: DisplayLink[]; segments: SharedSegment[]; neighborLinks: TopologyLink[] } {
  const inventory = new Map(devices.map((device) => [device.id, device]));
  const neighbors = uniqueTopologyLinks(input).filter((link) =>
    inventory.has(link.a) && inventory.has(link.b) && positions[link.a] && positions[link.b]);
  const adjacency = new Map<string, Set<string>>();
  const endpoints = new Map<string, { deviceId: string; port: string }>();
  for (const link of neighbors) {
    if (!['CDP', 'LLDP'].includes(link.proto || '')) continue;
    const a = endpointKey(link.a, link.pa), b = endpointKey(link.b, link.pb);
    endpoints.set(a, { deviceId: link.a, port: link.pa });
    endpoints.set(b, { deviceId: link.b, port: link.pb });
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  const visited = new Set<string>(), grouped = new Set<string>();
  const segments: SharedSegment[] = [];
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const queue = [start], component: string[] = [];
    visited.add(start);
    while (queue.length) {
      const key = queue.pop()!;
      component.push(key);
      for (const peer of adjacency.get(key)!) {
        if (!visited.has(peer)) { visited.add(peer); queue.push(peer); }
      }
    }
    component.sort();
    if (component.length < 3 ||
        new Set(component.map((key) => endpoints.get(key)!.deviceId)).size !== component.length ||
        !component.every((key) => adjacency.get(key)!.size === component.length - 1)) continue;
    const keys = new Set(component);
    const sharedNeighbors = neighbors.filter((link) =>
      keys.has(endpointKey(link.a, link.pa)) && keys.has(endpointKey(link.b, link.pb)));
    sharedNeighbors.forEach((link) => grouped.add(topologyLinkKey(link)));
    const members = component.map((key) => endpoints.get(key)!);
    segments.push({
      id: 'segment:' + JSON.stringify(component),
      members, pos: segmentPosition(members, devices, positions, segments),
      protocols: [...new Set(sharedNeighbors.map((link) => link.proto!).filter(Boolean))].sort(),
    });
  }
  const links: DisplayLink[] = neighbors.filter((link) => !grouped.has(topologyLinkKey(link)))
    .map((link) => ({ ...link, key: topologyLinkKey(link), shared: false }));
  for (const segment of segments) {
    for (const member of segment.members) {
      links.push({
        a: member.deviceId, pa: member.port, b: segment.id, pb: '',
        key: segment.id + endpointKey(member.deviceId, member.port), shared: true,
      });
    }
  }
  return { links, segments, neighborLinks: neighbors };
}
