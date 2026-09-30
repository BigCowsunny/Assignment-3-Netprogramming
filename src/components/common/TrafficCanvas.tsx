import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { TrafficPoint } from '../../types/snmp';
import { fmtFull, fmtRate, niceMax, xfmt } from '../../utils/formatters';

interface TrafficCanvasProps {
  points: TrafficPoint[];
  range: string;
  isTall?: boolean;
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
  ({ points, range, isTall }, ref) => {
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
        if (p.in != null) rawMax = Math.max(rawMax, p.in, p.out || 0);
      });

      const hasData = rawMax > 0;
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
      const stepX = Math.max(1, Math.ceil(points.length / 7));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      points.forEach((p, i) => {
        if (i % stepX !== 0) return;
        const x = L + (i / (points.length - 1 || 1)) * iw;
        ctx.fillText(xfmt(p.t, range), x, T + ih + 8);
      });

      hitPointsRef.current = [];

      if (!hasData) {
        ctx.fillStyle = mutedCol;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '500 13.5px "IBM Plex Sans Thai", system-ui, sans-serif';
        ctx.fillText(
          'ไม่มีข้อมูลในช่วงเวลาที่เลือก — อุปกรณ์อาจออฟไลน์หรือยังไม่มีข้อมูลสะสม',
          L + iw / 2,
          T + ih / 2
        );
        return;
      }

      const X = (i: number) => L + (i / (points.length - 1 || 1)) * iw;
      const Y = (v: number | null) => (v == null ? T + ih : T + ih - (v / mx) * ih);

      // Separate continuous segments to handle data gaps
      const segs: number[][] = [];
      let currentSeg: number[] = [];

      points.forEach((p, i) => {
        if (p.in == null) {
          if (currentSeg.length) segs.push(currentSeg);
          currentSeg = [];
        } else {
          currentSeg.push(i);
        }
      });
      if (currentSeg.length) segs.push(currentSeg);

      // Render lines & area fill
      segs.forEach((sg) => {
        (['in', 'out'] as const).forEach((key, ki) => {
          ctx.beginPath();
          sg.forEach((i, j) => {
            const x = X(i);
            const y = Y(points[i][key]);
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });

          ctx.strokeStyle = ki === 0 ? 'oklch(46% 0.14 145)' : 'oklch(55% 0.10 245)';
          ctx.lineWidth = 1.8;
          ctx.lineJoin = 'round';
          ctx.stroke();

          // Gradient fill under the In line
          if (ki === 0) {
            ctx.beginPath();
            ctx.moveTo(X(sg[0]), T + ih);
            sg.forEach((i) => ctx.lineTo(X(i), Y(points[i][key])));
            ctx.lineTo(X(sg[sg.length - 1]), T + ih);
            ctx.closePath();
            ctx.fillStyle = 'rgba(74, 222, 128, 0.12)';
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
    }, [points, range, isTall]);

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
        x: best.x,
        y: e.clientY - rect.top - 4,
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
