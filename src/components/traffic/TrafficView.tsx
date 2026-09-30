import React, { useMemo, useRef } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from '../common/Icons';
import { TrafficCanvas, TrafficCanvasRef } from '../common/TrafficCanvas';
import { calculateStats, getSeriesFor, TIME_RANGES } from '../../utils/trafficGenerator';
import { fmtRate, fmtSpeed } from '../../utils/formatters';
import { TimeRange } from '../../types/snmp';

export const TrafficView: React.FC = () => {
  const {
    activeDevice,
    activePort,
    timeRange,
    setTimeRange,
    setView,
    setPortAdmin,
    addToast,
  } = useSnmp();

  const chartRef = useRef<TrafficCanvasRef | null>(null);

  if (!activeDevice || !activePort) {
    return (
      <section className="view active">
        <p className="empty">ไม่ได้เลือกพอร์ตที่ต้องการดูทราฟฟิก</p>
        <button className="btn" onClick={() => setView('devices')}>
          กลับไปที่หน้ารายการอุปกรณ์
        </button>
      </section>
    );
  }

  const isUp = activePort.admin === 'up' && activePort.oper === 'up';
  const isAdminUp = activePort.admin === 'up';

  const points = useMemo(() => {
    return getSeriesFor(activeDevice, activePort, timeRange);
  }, [activeDevice, activePort, timeRange]);

  const statsIn = useMemo(() => calculateStats(points, 'in'), [points]);
  const statsOut = useMemo(() => calculateStats(points, 'out'), [points]);

  const capacity = activePort.speed * 1e6;
  const currentUtil = statsIn ? Math.round((statsIn.cur / capacity) * 100) : 0;

  const handleExportCSV = () => {
    let csv = 'timestamp,in_bps,out_bps\n';
    points.forEach((pt) => {
      if (pt.in == null) return;
      csv += `${new Date(pt.t).toISOString()},${Math.round(pt.in)},${Math.round(pt.out || 0)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traffic-${activePort.name.replace(/\//g, '_')}-${timeRange}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);

    addToast('ok', 'Export CSV แล้ว', `${activePort.name} · ${timeRange}`);
  };

  const handleExportPNG = () => {
    const canvas = chartRef.current?.getCanvas();
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `traffic-${activePort.name.replace(/\//g, '_')}-${timeRange}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2500);
      addToast('ok', 'Export PNG แล้ว', `${activePort.name} · ${timeRange}`);
    }, 'image/png');
  };

  const ranges: { key: TimeRange; label: string }[] = [
    { key: 'live', label: 'Live' },
    { key: 'day', label: 'วัน' },
    { key: 'week', label: 'สัปดาห์' },
    { key: 'month', label: 'เดือน' },
    { key: 'year', label: 'ปี' },
  ];

  return (
    <section className="view active">
      <div className="back-row">
        <button className="btn btn-ghost" onClick={() => setView('device')}>
          <Icon name="i-back" />
          กลับไปที่ Port Panel
        </button>
      </div>

      <div className="page-head">
        <div>
          <h1>
            <span>{activePort.name}</span>{' '}
            <span className={`pill ${isUp ? 'ok' : 'bad'}`}>
              <i></i>
              {isUp ? 'up' : 'down'}
            </span>
          </h1>
          <p className="mono">
            {activeDevice.name} · {activeDevice.ip} · ifIndex {activePort.idx} ·{' '}
            {fmtSpeed(activePort.speed)} · {activePort.alias}
          </p>
        </div>

        <div className="hero-stats">
          <span className="pill off">Utilization {currentUtil}%</span>
          <span className="pill off">Errors {activePort.errors} / 0</span>

          <div className="seg" role="group" aria-label="ช่วงเวลา">
            {ranges.map((r) => (
              <button
                key={r.key}
                className={timeRange === r.key ? 'on' : ''}
                onClick={() => setTimeRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button className="btn" onClick={handleExportCSV}>
            <Icon name="i-download" />
            CSV
          </button>
          <button className="btn" onClick={handleExportPNG}>
            <Icon name="i-image" />
            PNG
          </button>

          <button
            className={`btn btn-icon ${isAdminUp ? 'btn-success' : 'btn-danger'}`}
            title={isAdminUp ? `Shutdown พอร์ต ${activePort.name}` : `No Shutdown พอร์ต ${activePort.name}`}
            aria-label={isAdminUp ? 'ปิดพอร์ต (Shutdown)' : 'เปิดพอร์ต (No Shutdown)'}
            onClick={() => setPortAdmin(activeDevice.id, activePort.name, isAdminUp)}
          >
            <Icon name={isAdminUp ? 'i-circle-check' : 'i-ban'} />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>
            ทราฟฟิก{' '}
            <span className="mono hint">{TIME_RANGES[timeRange].label}</span>
          </h3>
          <div className="legend-row">
            <span>
              <i className="k-in"></i>รับ (In)
            </span>
            <span>
              <i className="k-out"></i>ส่ง (Out)
            </span>
          </div>
        </div>
        <div className="card-body">
          <TrafficCanvas
            ref={chartRef}
            points={points}
            range={timeRange}
            isTall={true}
          />
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="lbl">รับล่าสุด (In)</div>
          <div className="v">{fmtRate(statsIn?.cur)}</div>
        </div>
        <div className="stat">
          <div className="lbl">ต่ำสุด</div>
          <div className="v">{fmtRate(statsIn?.min)}</div>
        </div>
        <div className="stat">
          <div className="lbl">เฉลี่ย</div>
          <div className="v">{fmtRate(statsIn?.avg)}</div>
        </div>
        <div className="stat">
          <div className="lbl">สูงสุด</div>
          <div className="v">{fmtRate(statsIn?.max)}</div>
        </div>

        <div className="stat">
          <div className="lbl">ส่งล่าสุด (Out)</div>
          <div className="v">{fmtRate(statsOut?.cur)}</div>
        </div>
        <div className="stat">
          <div className="lbl">ต่ำสุด</div>
          <div className="v">{fmtRate(statsOut?.min)}</div>
        </div>
        <div className="stat">
          <div className="lbl">เฉลี่ย</div>
          <div className="v">{fmtRate(statsOut?.avg)}</div>
        </div>
        <div className="stat">
          <div className="lbl">สูงสุด</div>
          <div className="v">{fmtRate(statsOut?.max)}</div>
        </div>
      </div>

      <p className="hint mt12">
        หน่วยเปลี่ยนอัตโนมัติตามค่า (bps / Kbps / Mbps / Gbps) · ช่องว่างในกราฟคือช่วงที่ไม่มีข้อมูล ระบบไม่ลากเส้นผ่านช่วงขาด
      </p>
    </section>
  );
};
