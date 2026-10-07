import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve('src');
let state;

test('trap identities separate shared NAT devices and resolve when inventory arrives', () => {
  const { resolveTrapEvent, trapDeviceName } = load('utils/trapEvents.ts');
  const devices = [neighbor('r1', 'R1', '192.0.2.1'), neighbor('r2', 'R2.localdomain', '192.0.2.2')];
  const event = { id: 'e1', dev: 'unknown', src: '198.51.100.9', agent_ip: '192.0.2.2',
    port: 'Ethernet0/1', type: 'linkDown', t: new Date(), oid: 'linkDown' };
  assert.equal(resolveTrapEvent(event, []).dev, 'unknown');
  const resolved = resolveTrapEvent(event, devices);
  assert.equal(resolved.dev, 'r2');
  assert.equal(resolved.id, event.id);
  assert.equal(resolved.src, event.src);
  assert.equal(trapDeviceName(resolved, devices), 'R2.localdomain');
  assert.equal(resolveTrapEvent({ ...event, agent_ip: '', agent_name: 'r1' }, devices).dev, 'r1');
  assert.equal(resolveTrapEvent({ ...event, agent_ip: '', agent_name: '' }, devices).dev, 'unknown');
  assert.equal(resolveTrapEvent({ ...event, agent_ip: '192.0.2.99' }, [neighbor('gateway', 'GW', event.src)]).dev, 'unknown');
  assert.equal(resolveTrapEvent({ ...event, agent_ip: '', agent_name: 'r2' },
    [...devices, neighbor('duplicate', 'R2.example')]).dev, 'unknown');
});

test('history refresh replaces stale Unknown with resolved name and does not duplicate notifications', () => {
  const { mergeTrapEvents } = load('utils/trapEvents.ts');
  const original = { id: 'e1', dev: 'unknown', src: '198.51.100.9', port: 'ifIndex 2',
    type: 'linkDown', t: new Date('2026-01-01'), oid: 'linkDown', isNew: true };
  const updated = { ...original, dev: 'r2', dev_name: 'R2', port: 'Et0/1', isNew: undefined };
  const result = mergeTrapEvents([original], [updated]);
  assert.equal(result.length, 1);
  assert.equal(result[0].dev, 'r2');
  assert.equal(result[0].port, 'Et0/1');
  assert.equal(result[0].isNew, true);
  assert.equal(result[0].t.getTime(), original.t.getTime());
});

test('merged Test Trap labels are excluded from unknown device counts', () => {
  const { trapEventDeviceName, isUnknownTrapSource } = load('utils/trapEvents.ts');
  const event = { id: 'test', dev: 'unknown', src: '127.0.0.1', port: 'TestInterface', is_test: true };
  assert.equal(trapEventDeviceName(event, []), 'NetSmonitor (Test Trap)');
  assert.equal(isUnknownTrapSource(event, []), false);
  assert.equal(isUnknownTrapSource({ ...event, is_test: false }, []), true);
});

test('Events and Dashboard show packet sysName before device enrollment', () => {
  setup([]);
  state.events = [{ id: 'e1', dev: 'unknown', src: '198.51.100.9', agent_name: 'Branch-Router',
    agent_ip: '192.0.2.2', port: 'Et0/1', type: 'linkDown', t: new Date(), oid: 'linkDown' }];
  state.isRealtime = true;
  state.setIsRealtime = () => {};
  state.triggerTestTrap = () => {};
  const { EventsView } = load('components/events/EventsView.tsx');
  const { LiveEventsCard } = load('components/dashboard/LiveEventsCard.tsx');
  const events = renderToStaticMarkup(React.createElement(EventsView));
  const dashboard = renderToStaticMarkup(React.createElement(LiveEventsCard));
  assert.match(events, /Branch-Router/);
  assert.match(events, /Agent IP/);
  assert.match(events, /192\.0\.2\.2/);
  assert.match(dashboard, /Branch-Router/);
});

function load(relative, cache = new Map(), globals = {}) {
  const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localRequire = (specifier) => {
    if (specifier.endsWith('.css')) return {};
    if (/\.(png|svg)$/.test(specifier)) return specifier;
    if (specifier.endsWith('context/SnmpContext')) return { useSnmp: () => state };
    if (specifier.endsWith('common/Icons')) return { Icon: () => React.createElement('svg') };
    if (!specifier.startsWith('.')) return require(specifier);
    const target = path.resolve(path.dirname(filename), specifier);
    const resolved = ['.ts', '.tsx'].map((ext) => target + ext).find(existsSync);
    if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
    return load(resolved, cache, globals);
  };
  vm.runInNewContext(output, {
    require: localRequire, exports: module.exports, module,
    console: { ...console, log() {} }, window: { innerWidth: 1280, innerHeight: 800 },
    setTimeout, clearTimeout, setInterval, clearInterval,
    ...globals,
  }, { filename });
  return module.exports;
}

function neighbor(id, name, ip = '') {
  return { id, name, ip, type: 'switch', vendor: 'CDP', descr: '', ver: 'v2c', rw: false,
    status: 'discovered', up: '—', discovery_only: true, can_configure: false,
    config_unavailable_reason: ip ? 'ยังไม่ได้ยืนยัน SNMP จึงไม่สามารถ Config ได้' : 'ไม่มี Management IP จึงไม่สามารถ Config ผ่าน SNMP ได้',
    ports: [{ idx: 0, name: 'GigabitEthernet0/1', speed: 0, admin: 'unknown', oper: 'unknown', errors: 0, mac: '', alias: '', virtual: false, ip: '', observed_only: true }],
  };
}

test('live events reconnect after disconnect and stop retrying on cleanup', () => {
  const sockets = [];
  const timers = new Map();
  let nextTimer = 0;
  class FakeWebSocket {
    constructor() { sockets.push(this); }
    close() { this.onclose?.(); }
  }
  const { connectTrapWebSocket } = load('services/api.ts', new Map(), {
    WebSocket: FakeWebSocket,
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  });
  const messages = [];
  const connection = connectTrapWebSocket((message) => messages.push(message));
  sockets[0].onmessage({ data: '{"type":"TRAP_EVENT"}' });
  assert.equal(messages[0].type, 'TRAP_EVENT');
  sockets[0].onclose();
  const [id, retry] = [...timers][0];
  timers.delete(id);
  retry();
  assert.equal(sockets.length, 2);
  sockets[1].onclose();
  connection.close();
  assert.equal(timers.size, 0);
});

function setup(devices) {
  state = { devices, searchQuery: '', filterType: 'all', filterStatus: 'all',
    setSearchQuery() {}, setFilterType() {}, setFilterStatus() {}, openDevice() {},
    deleteDevice() {}, addDevice() {}, addToast() {}, addTopologyLink() {}, refreshDeviceData() {},
    activeDevice: devices[0], setView() {}, pollingCountdown: 60, showVirtual: false,
    setShowVirtual() {}, openTraffic() {}, setPortAdmin() {}, topologyZoom: 1,
    topologyPos: Object.fromEntries(devices.map((device, index) => [device.id, { x: 150 + 190 * index, y: 150 }])),
    topologyLinks: [], setTopologyZoom() {}, updateTopologyPos() {}, runDiscovery() {},
  };
}

test('merge preserves separate devices with empty IP and updates by ID', () => {
  const { mergeDevices } = load('utils/deviceManagement.ts');
  const result = mergeDevices([neighbor('a', 'A')], [neighbor('b', 'B'), neighbor('a', 'Renamed')]);
  assert.equal(result.length, 2);
  assert.equal(result.find((device) => device.id === 'a').name, 'Renamed');
});

test('promotion replaces existing observation with managed device at same ID', () => {
  const { mergeDevices, configurationWarning } = load('utils/deviceManagement.ts');
  const device = neighbor('a', 'A');
  const promoted = { ...device, ip: '192.0.2.1', discovery_only: false, can_configure: true };
  const result = mergeDevices([device], [promoted]);
  assert.equal(result.length, 1);
  assert.equal(configurationWarning(result[0]), '');
});

test('device table displays both no-IP neighbors and configuration warnings', () => {
  setup([neighbor('a', 'Switch-A'), neighbor('b', 'Switch-B')]);
  const { DevicesView } = load('components/devices/DevicesView.tsx');
  const html = renderToStaticMarkup(React.createElement(DevicesView));
  assert.match(html, /Switch-A/);
  assert.match(html, /Switch-B/);
  assert.match(html, /ไม่มี IP/);
  assert.match(html, /Config ไม่ได้/);
  assert.match(html, /CDP\/LLDP/);
  assert.match(html, /IP \/ SNMP/);
  assert.equal((html.match(/<th(?:\s|>)/g) || []).length, 6);
});

test('detail warns and does not present observed ports as operationally up', () => {
  setup([neighbor('a', 'Switch-A')]);
  const { DeviceDetailView } = load('components/device-detail/DeviceDetailView.tsx');
  const html = renderToStaticMarkup(React.createElement(DeviceDetailView));
  assert.match(html, /Config ไม่ได้/);
  assert.match(html, /ยังไม่ใช่พอร์ตทั้งหมด/);
  assert.match(html, /สถานะ Unknown/);
  assert.doesNotMatch(html, /สถานะ Link up/);
});

test('port controls are disabled for discovery-only device with or without advertised IP', () => {
  for (const ip of ['', '192.0.2.20']) {
    const device = neighbor('a', 'A', ip);
    const { PortContextMenu } = load('components/device-detail/PortContextMenu.tsx');
    const html = renderToStaticMarkup(React.createElement(PortContextMenu, {
      device, port: device.ports[0], x: 0, y: 0, onClose() {}, onViewTraffic() {}, onToggleAdmin() {},
    }));
    assert.equal((html.match(/disabled=""/g) || []).length, 2);
  }
});

test('topology displays unknown link rather than a false down status', () => {
  setup([neighbor('a', 'A'), neighbor('b', 'B')]);
  state.topologyLinks = [{ a: 'a', pa: 'GigabitEthernet0/1', b: 'b', pb: 'GigabitEthernet0/1' }];
  const { TopologyView } = load('components/topology/TopologyView.tsx');
  const html = renderToStaticMarkup(React.createElement(TopologyView));
  assert.match(html, /class="link unknown"/);
  assert.match(html, /ไม่มี IP · Config ไม่ได้/);
});

test('untrusted discovery labels are escaped before confirmation HTML', () => {
  const { escapeHtml } = load('utils/deviceManagement.ts');
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('Discover accepts blank target without requiring a subnet', () => {
  setup([]);
  const { TopologyView } = load('components/topology/TopologyView.tsx');
  const html = renderToStaticMarkup(React.createElement(TopologyView));
  assert.match(html, /ไม่ต้องระบุ subnet/);
  assert.match(html, /IP เริ่มต้น \/ Subnet/);
  assert.match(html, /เว้นว่างเพื่อเริ่มจากอุปกรณ์ที่พบแล้ว/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('existing topology toolbar displays job progress and diagnostics', () => {
  setup([neighbor('a', 'A')]);
  state.discoveryProgress = { status: 'completed', phase: 'completed', checked: 3,
    queued: 0, devices_count: 3, links_count: 2, current_name: '',
    issues: [{ name: 'R2', ip: '192.0.2.2', code: 'snmp_timeout', message: 'SNMP timeout' }] };
  const { TopologyView } = load('components/topology/TopologyView.tsx');
  const html = renderToStaticMarkup(React.createElement(TopologyView));
  assert.match(html, /ตรวจแล้ว 3 · พบ 3 nodes \/ 2 neighbor links/);
  assert.match(html, /R2: SNMP timeout/);
  assert.equal((html.match(/<input /g) || []).length, 2);
  assert.equal((html.match(/<svg[^>]*id="topo"/g) || []).length, 1);
});

test('LLDP observation has the same configuration restriction and warning', () => {
  const d = { ...neighbor('a', 'LLDP-SW'), discovery_protocol: 'LLDP' };
  setup([d]);
  const { DeviceDetailView } = load('components/device-detail/DeviceDetailView.tsx');
  const html = renderToStaticMarkup(React.createElement(DeviceDetailView));
  assert.match(html, /LLDP/);
  assert.match(html, /Config/);
  assert.match(html, /ยังไม่ใช่พอร์ตทั้งหมด/);
});

test('discovery service uses jobs for IP, optional CIDR, and automatic seeds', async () => {
  for (const target of ['', '192.0.2.1', '192.0.2.0/24']) {
    const calls = [], progress = [];
    const result = { devices: [], links: [], issues: [] };
    const mockFetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => calls.length === 1
        ? { id: 'test-job', status: 'running' }
        : { id: 'test-job', status: 'completed', result } };
    };
    const { runDiscoveryApi } = load('services/api.ts', new Map(), {
      fetch: mockFetch, window: { setTimeout(callback) { callback(); } },
    });
    const actual = await runDiscoveryApi(target, ['lab-ro'], (p) => progress.push(p.status));
    assert.equal(actual, result);
    assert.equal(calls[0].url, 'http://localhost:8000/api/discovery/jobs');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body[target.includes('/') ? 'subnet' : 'seed_ip'], target);
    assert.deepEqual(body.communities, ['lab-ro']);
    assert.equal(calls[1].url, 'http://localhost:8000/api/discovery/jobs/test-job');
    assert.deepEqual(progress, ['running', 'completed']);
  }
});

test('discovery service surfaces job and HTTP failures', async () => {
  const { runDiscoveryApi } = load('services/api.ts', new Map(), {
    fetch: async () => ({ ok: false, json: async () => ({ detail: 'Discovery กำลังทำงานอยู่' }) }),
  });
  await assert.rejects(runDiscoveryApi(), /กำลังทำงานอยู่/);
  const failed = load('services/api.ts', new Map(), {
    fetch: async () => ({ ok: true, json: async () => ({ status: 'failed', error: 'SNMP unavailable' }) }),
  });
  await assert.rejects(failed.runDiscoveryApi(), /SNMP unavailable/);
});

test('header shows service connection status without calling real data a demo', () => {
  setup([]);
  state.isBackendConnected = true;
  const { Topbar } = load('components/layout/Topbar.tsx');
  const html = renderToStaticMarkup(React.createElement(Topbar));
  assert.match(html, /บริการระบบพร้อมใช้งาน/);
  assert.doesNotMatch(html, /ข้อมูลจำลอง/);
});

test('parallel links between the same nodes show separate port labels', () => {
  setup([neighbor('a', 'A'), neighbor('b', 'B')]);
  state.topologyLinks = [
    { a: 'a', pa: 'GigabitEthernet0/1', b: 'b', pb: 'GigabitEthernet0/1' },
    { a: 'b', pa: 'GigabitEthernet0/2', b: 'a', pb: 'GigabitEthernet0/2' },
  ];
  const { TopologyView } = load('components/topology/TopologyView.tsx');
  const html = renderToStaticMarkup(React.createElement(TopologyView));
  const paths = [...html.matchAll(/class="link unknown" d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 2);
  assert.notEqual(paths[0], paths[1]);
  assert.match(html, /Gi0\/1/);
  assert.match(html, /Gi0\/2/);
});

test('link route avoids unrelated nodes between its actual endpoints', () => {
  setup([neighbor('a', 'R001'), neighbor('b', 'R2'), neighbor('c', 'R3'), neighbor('d', 'R002')]);
  state.topologyPos = {
    a: {x: 150, y: 100}, b: {x: 340, y: 100},
    c: {x: 530, y: 100}, d: {x: 720, y: 100},
  };
  state.topologyLinks = [{ a: 'a', pa: 'Gi0/2', b: 'd', pb: 'Gi0/0', proto: 'CDP' }];
  const { TopologyView } = load('components/topology/TopologyView.tsx');
  const html = renderToStaticMarkup(React.createElement(TopologyView));
  assert.match(html, /R001 \[Gi0\/2\] ↔ R002 \[Gi0\/0\]/);
  assert.match(html, /d="M 150 100 L 150 25 L 720 25 L 720 100"/);
  assert.doesNotMatch(html, /d="M 150 100 Q 435 100 720 100"/);
});

test('duplicate reports in reverse direction and abbreviated names produce one edge', () => {
  const { uniqueTopologyLinks } = load('utils/topologyGraph.ts');
  const links = uniqueTopologyLinks([
    { a: 'a', pa: 'Gi0/1', b: 'b', pb: 'Et0/0', proto: 'CDP' },
    { a: 'b', pa: 'Ethernet0/0', b: 'a', pb: 'GigabitEthernet0/1', proto: 'CDP' },
    { a: 'a', pa: 'GigabitEthernet0/1', b: 'b', pb: 'Ethernet0/0', proto: 'LLDP' },
  ]);
  assert.equal(links.length, 1);
});

test('shared CDP segment replaces peer triangle with one spoke per physical port', () => {
  setup([neighbor('a', 'R2'), neighbor('b', 'R3'), neighbor('c', 'Switch')]);
  const links = [
    { a: 'a', pa: 'Gi0/0', b: 'b', pb: 'Et0/0', proto: 'CDP' },
    { a: 'a', pa: 'Gi0/0', b: 'c', pb: 'Gi0/0', proto: 'CDP' },
    { a: 'b', pa: 'Et0/0', b: 'c', pb: 'Gi0/0', proto: 'CDP' },
    { a: 'a', pa: 'Gi0/1', b: 'b', pb: 'Et0/1', proto: 'CDP' },
  ];
  const { buildTopologyGraph } = load('utils/topologyGraph.ts');
  const graph = buildTopologyGraph(links, state.devices, state.topologyPos);
  assert.equal(graph.segments.length, 1);
  assert.equal(graph.links.filter((l) => l.shared).length, 3);
  assert.equal(graph.links.filter((l) => !l.shared).length, 1);
  assert.equal(graph.neighborLinks.length, 4);
  assert.equal(links.length, 4); // Rendering must not delete API observations.
  state.topologyLinks = links;
  const { TopologyView } = load('components/topology/TopologyView.tsx');
  const html = renderToStaticMarkup(React.createElement(TopologyView));
  assert.match(html, /class="shared-segment"/);
  assert.match(html, /เครือข่ายร่วม/);
  assert.match(html, /Gi0\/1 ↔ Et0\/1/);
  const { MiniTopologyCard } = load('components/dashboard/MiniTopologyCard.tsx');
  const mini = renderToStaticMarkup(React.createElement(MiniTopologyCard));
  assert.equal((mini.match(/class="shared-segment"/g) || []).length, 1);
  assert.match(mini, /Gi0\/1 ↔ Et0\/1/);
});

test('incomplete tables or triangles using different ports are not grouped', () => {
  setup([neighbor('a', 'A'), neighbor('b', 'B'), neighbor('c', 'C')]);
  const { buildTopologyGraph } = load('utils/topologyGraph.ts');
  const cases = [
    [
      { a: 'a', pa: 'Gi0/0', b: 'b', pb: 'Gi0/0', proto: 'CDP' },
      { a: 'a', pa: 'Gi0/0', b: 'c', pb: 'Gi0/0', proto: 'CDP' },
    ],
    [
      { a: 'a', pa: 'Gi0/0', b: 'b', pb: 'Gi0/0', proto: 'CDP' },
      { a: 'a', pa: 'Gi0/1', b: 'c', pb: 'Gi0/0', proto: 'CDP' },
      { a: 'b', pa: 'Gi0/1', b: 'c', pb: 'Gi0/1', proto: 'CDP' },
    ],
  ];
  for (const links of cases) {
    const graph = buildTopologyGraph(links, state.devices, state.topologyPos);
    assert.equal(graph.segments.length, 0);
    assert.equal(graph.links.length, links.length);
  }
});

test('shared grouping is stable under reordered neighbor reports', () => {
  setup([neighbor('a', 'A'), neighbor('b', 'B'), neighbor('c', 'C')]);
  const { buildTopologyGraph } = load('utils/topologyGraph.ts');
  const links = [
    { a: 'a', pa: 'Gi0/0', b: 'b', pb: 'Gi0/0', proto: 'CDP' },
    { a: 'a', pa: 'Gi0/0', b: 'c', pb: 'Gi0/0', proto: 'CDP' },
    { a: 'b', pa: 'Gi0/0', b: 'c', pb: 'Gi0/0', proto: 'CDP' },
  ];
  const first = buildTopologyGraph(links, state.devices, state.topologyPos);
  const second = buildTopologyGraph([...links].reverse(), state.devices, state.topologyPos);
  assert.equal(first.segments[0].id, second.segments[0].id);
  assert.deepEqual(JSON.parse(JSON.stringify(first.segments[0].pos)), JSON.parse(JSON.stringify(second.segments[0].pos)));
});
