import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { KpiGrid } from './KpiGrid';
import { TrafficOverviewCard } from './TrafficOverviewCard';
import { LiveEventsCard } from './LiveEventsCard';
import { TopTalkersCard } from './TopTalkersCard';
import { DashboardDeviceTable } from './DashboardDeviceTable';

export const DashboardView: React.FC = () => {
  const { pollIntervalSeconds } = useSnmp();
  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h1>ภาพรวมระบบ</h1>
          <p>อัปเดตอัตโนมัติ · อ่านข้อมูลทุก {pollIntervalSeconds} วินาที</p>
        </div>
        <div className="legend-row">
          <span>
            <i className="k-in"></i>รับ (In)
          </span>
          <span>
            <i className="k-out"></i>ส่ง (Out)
          </span>
        </div>
      </div>

      <KpiGrid />

      <div className="row2">
        <TrafficOverviewCard />
        <LiveEventsCard />
      </div>

      <TopTalkersCard />

      <DashboardDeviceTable />
    </section>
  );
};
