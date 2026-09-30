import React from 'react';
import { SnmpProvider, useSnmp } from './context/SnmpContext';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { ToastContainer } from './components/common/ToastContainer';
import { ConfirmModal } from './components/common/ConfirmModal';
import { DashboardView } from './components/dashboard/DashboardView';
import { DevicesView } from './components/devices/DevicesView';
import { DeviceDetailView } from './components/device-detail/DeviceDetailView';
import { TrafficView } from './components/traffic/TrafficView';
import { EventsView } from './components/events/EventsView';
import { TopologyView } from './components/topology/TopologyView';
import { SettingsView } from './components/settings/SettingsView';

const MainContent: React.FC = () => {
  const { view } = useSnmp();

  return (
    <main className="main">
      {view === 'dashboard' && <DashboardView />}
      {view === 'devices' && <DevicesView />}
      {view === 'device' && <DeviceDetailView />}
      {view === 'traffic' && <TrafficView />}
      {view === 'events' && <EventsView />}
      {view === 'topology' && <TopologyView />}
      {view === 'settings' && <SettingsView />}
    </main>
  );
};

export const App: React.FC = () => {
  return (
    <SnmpProvider>
      <Topbar />
      <div className="shell">
        <Sidebar />
        <MainContent />
      </div>
      <ConfirmModal />
      <ToastContainer />
    </SnmpProvider>
  );
};

export default App;
