import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { TrafficPoint } from '../../types/snmp';
import { fmtFull, fmtRate, niceMax, xfmt } from '../../utils/formatters';

interface TrafficCanvasProps {
  points: TrafficPoint[];
  range: string;
  isTall?: boolean;
  pollIntervalSeconds?: number;
}

export interface TrafficCanvasRef {
  getCanvas: () => HTMLCanvasElement | null;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  t: number;
  inVal: number | null;
  outVal: number | null;
}

export const TrafficCanvas = forwardRef<TrafficCanvasRef, TrafficCanvasProps>(
  ({ points, range, isTall, pollIntervalSeconds = 60 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [tooltip, setTooltip] = useState<TooltipState>({
      visible: false,
      x: 0,
      y: 0,
      t: 0,
      inVal: null,
      outVal: null,
    });

    const hitPointsRef = useRef<
      { x: number; t: number; in: number | null; out: number | null }[]
    >([]);

    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
    }));

    const renderChart = () => {
      const cv = canvasRef.current;
      const container = containerRef.current;
      if (!cv || !container) return;

      const w = container.clientWidth;
      const h = isTall ? 336 : 296;
      if (!w || !h) return;

      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);

      const ctx = cv.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const L = 64;
      const R = 14;
      const T = 12;
      const B = 26;
      const iw = w - L - R;
      const ih = h - T - B;

      if (iw < 40 || ih < 40) return;

      let rawMax = 0;
      points.forEach((p) => {
        rawMax = Math.max(rawMax, p.in || 0, p.out || 0);
      });

      const hasData = points.some(point => point.in != null || point.out != null);
      const mx = niceMax(rawMax || 1);

      const borderCol = '#e5e7eb';
      const mutedCol = '#7b8494';

      ctx.font = '500 10.5px "IBM Plex Mono", ui-monospace, Consolas, monospace';

      // Draw horizontal gridlines & labels
      for (let k = 0; k <= 4; k++) {
        const v = (mx * k) / 4;
        const y = T + ih - (v / mx) * ih;
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(L, Math.round(y) + 0.5);
        ctx.lineTo(L + iw, Math.round(y) + 0.5);
        ctx.stroke();

        ctx.fillStyle = mutedCol;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(k ? fmtRate(v) : '0', L - 8, y);
      }

      // Draw X-axis timestamps
      const start = points[0]?.t || Date.now();
      const span = Math.max(1, (points[points.length - 1]?.t || start) - start);
      const X = (i: number) => L + (points.length === 1 ? iw / 2 : (points[i].t - start) / span * iw);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      if (points.length) {
        const ticks = Math.max(2, Math.min(6, Math.floor(iw / 100)));
        for (let i = 0; i <= ticks; i++) {
          ctx.fillText(xfmt(start + span * i / ticks, range), L + iw * i / ticks, T + ih + 8);
        }
      }

      hitPointsRef.current = [];

      if (!hasData) {
        ctx.fillStyle = mutedCol;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '500 13.5px "IBM Plex Sans Thai", system-ui, sans-serif';
        ctx.fillText(
          iw < 520 ? 'ยังไม่มีข้อมูลในช่วงนี้' : 'ยังไม่มีข้อมูลในช่วงเวลาที่เลือก',
          L + iw / 2,
          T + ih / 2
        );
        return;
      }

      const Y = (v: number | null) => (v == null ? T + ih : T + ih - (v / mx) * ih);

      // Place samples at actual timestamps and break lines across missing buckets.
      const buckets: Record<string, number> = {live:5000,day:300000,week:1800000,month:7200000,year:86400000};
      const gapMs = Math.max(pollIntervalSeconds * 1500, (buckets[range] || 300000) * 1.5);
      (['in', 'out'] as const).forEach((key, ki) => {
        const segs: number[][] = [];
        let segment: number[] = [];
        points.forEach((point, i) => {
          if (segment.length && point.t - points[segment[segment.length - 1]].t > gapMs) {
            segs.push(segment); segment = [];
          }
          if (point[key] == null) { if(segment.length) segs.push(segment); segment = []; }
          else segment.push(i);
        });
        if (segment.length) segs.push(segment);
        segs.forEach((sg) => {
          ctx.beginPath();
          sg.forEach((i, j) => {
            const x = X(i);
            const y = Y(points[i][key]);
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });

          ctx.strokeStyle = ki === 0 ? '#245edb' : '#129683';
          ctx.lineWidth = 1.8;
          ctx.lineJoin = 'round';
          ctx.stroke();
          if (sg.length === 1) {
            ctx.beginPath(); ctx.arc(X(sg[0]), Y(points[sg[0]][key]), 2.5, 0, Math.PI * 2);
            ctx.fillStyle = ki === 0 ? '#245edb' : '#129683'; ctx.fill();
          }

          // Gradient fill under the In line
          if (ki === 0) {
            ctx.beginPath();
            ctx.moveTo(X(sg[0]), T + ih);
            sg.forEach((i) => ctx.lineTo(X(i), Y(points[i][key])));
            ctx.lineTo(X(sg[sg.length - 1]), T + ih);
            ctx.closePath();
            ctx.fillStyle = 'rgba(36, 94, 219, 0.08)';
            ctx.fill();
          }
        });
      });

      hitPointsRef.current = points.map((p, i) => ({
        x: X(i),
        t: p.t,
        in: p.in,
        out: p.out,
      }));
    };

    useEffect(() => {
      renderChart();
      const handleResize = () => renderChart();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [points, range, isTall, pollIntervalSeconds]);

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hits = hitPointsRef.current;
      if (!hits.length) {
        setTooltip((prev) => ({ ...prev, visible: false }));
        return;
      }

      let best: (typeof hits)[0] | null = null;
      let minDiff = 1e9;
      for (const h of hits) {
        const diff = Math.abs(h.x - x);
        if (diff < minDiff) {
          minDiff = diff;
          best = h;
        }
      }

      if (!best || minDiff > 14) {
        setTooltip((prev) => ({ ...prev, visible: false }));
        return;
      }

      setTooltip({
        visible: true,
        x: Math.max(100, Math.min(rect.width - 100, best.x)),
        y: Math.max(80, e.clientY - rect.top - 4),
        t: best.t,
        inVal: best.in,
        outVal: best.out,
      });
    };

    const handleMouseLeave = () => {
      setTooltip((prev) => ({ ...prev, visible: false }));
    };

    return (
      <div className={`chart-wrap ${isTall ? 'tall' : ''}`} ref={containerRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="กราฟทราฟฟิกรับและส่ง หน่วยบิตต่อวินาที"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ width: '100%', height: isTall ? '336px' : '296px' }}
        />
        {tooltip.visible && (
          <div
            className="chart-tooltip"
            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          >
            {fmtFull(tooltip.t)}
            <br />
            In {fmtRate(tooltip.inVal)}
            <br />
            Out {fmtRate(tooltip.outVal)}
          </div>
        )}
      </div>
    );
  }
);
