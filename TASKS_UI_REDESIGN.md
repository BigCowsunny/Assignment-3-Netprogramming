# NetFix — UI/UX redesign

Completed: 2 October 2026

## Assessment

- Dense toolbars and long system descriptions obscured primary actions.
- Router ports stretched across the panel; management actions required right-click.
- Several labels confused unknown state with down, or showed unverified service status.
- Settings controls reported success without changing backend settings.
- Narrow screens clipped graph range buttons and empty messages inside wide tables.

## Completed work

- [x] Shared navy / blue theme, spacing, typography, status colors and navigation.
- [x] Dashboard: readable KPIs, correct discovered counts and 24-hour event counts.
- [x] Devices: inventory, filters, status summary, row actions and empty states.
- [x] Device details: compact port tiles, visible action menus, virtual interfaces and collapsed system information.
- [x] Traffic: separate range toolbar, export actions, clear shutdown action, real sample timestamps and gaps.
- [x] Trap events: summary, filters, readable empty state and accurate live-display switch wording.
- [x] Topology: separate discovery controls, optional seed/subnet, collapsed diagnostics, consistent device icons and keyboard navigation.
- [x] Settings: backend health, actual trap port, read-only polling information, searchable and paginated audit logs.
- [x] Popups: add, edit, IP/SNMP setup, network scan, confirmation, device actions and port actions.
- [x] Keyboard focus, Escape, focus restoration, modal scroll locking and closeable notifications.
- [x] Responsive layouts and table scrolling.

## Verification

- Production build and TypeScript compilation: passed with `npm run build`.
- Browser inspection: all seven views and application dialogs.
- Observed CSS viewport widths: 1670px, 764px and 382px; temporary viewport override reset afterwards.
- Checked unknown ports and disabled configuration actions for the device without a management IP.
- Checked search, no-result states, audit pagination and opening device details from topology with Enter.
- Checked confirmation defaults to Cancel and Escape dismisses it.
- Reviewed graph against stored samples: missing time buckets remain gaps; nonzero utilization below 1% is displayed as <1%.

No router configuration or device deletion was executed during UI inspection.

## Existing boundaries

- Follow-up: Settings now saves the SNMP polling interval (10–3,600 seconds) to SQLite and updates the running poller without restarting. Dashboard captions, refresh timers and chart gap handling follow the saved interval. Trap reception remains independent.
- Backend discovery, SNMP SET and trap processing remain the existing implementations.
- Native COM selection is controlled by the browser.
- This pass used production compilation and manual browser inspection; no new automated test suite was added.
