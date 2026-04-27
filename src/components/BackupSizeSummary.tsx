import { useEffect, useMemo, useRef, useState } from 'react';
import { SnapshotService, type StorageSummary } from '../services/snapshot';
import './BackupSizeSummary.css';

interface Props {
  /** Authoritative source: the backend rollup. Renders directly with
   *  zero client-side math. */
  summary?: StorageSummary | null;
  /** Convenience: fetch the rollup ourselves if the parent didn't already.
   *  Pass either `summary` OR `resourceId` (the latter triggers a fetch). */
  resourceId?: string;
}

function fmt(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1_099_511_627_776) return `${(bytes / 1_099_511_627_776).toFixed(1)} TB`;
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Protection-tab backup-size panel.
 *
 *   - "Backup size" = bytes the backups actually occupy on disk for this
 *     resource subtree. Comes from the backend's `/storage-summary`
 *     rollup which sums `bytes_added` across non-failed snapshots.
 *     bytes_added is the bytes the worker wrote to object storage on
 *     that run, so the sum is the true on-disk footprint — no
 *     double-counting of unchanged items across incrementals.
 *   - 1w / 1m / 1y deltas: bytes_added in those windows. For the user's
 *     first backup all three equal the total (everything was added in
 *     the last week); they diverge on the next incremental run.
 *   - 7-day sparkline: per-day bytes_added centered on today.
 *
 * The component does NO arithmetic on snapshots. Everything is rendered
 * from the StorageSummary the backend hands us.
 */
export default function BackupSizeSummary({ summary: passed, resourceId }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [fetched, setFetched] = useState<StorageSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // If the parent didn't pre-load the summary, fetch it ourselves.
  useEffect(() => {
    if (passed || !resourceId) return;
    let cancelled = false;
    setErr(null);
    SnapshotService.getStorageSummary(resourceId)
      .then((s) => { if (!cancelled) setFetched(s); })
      .catch((e) => { if (!cancelled) setErr(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [passed, resourceId]);

  const summary = passed ?? fetched;

  const { series, yMax } = useMemo(() => {
    if (!summary) return { series: [], yMax: 1 };
    const s = summary.dailySeries.map((d) => ({
      date: new Date(d.date + 'T00:00:00'),
      value: d.bytesAdded,
      isFuture: d.isFuture,
    }));
    const max = Math.max(1, ...s.map((p) => p.value ?? 0));
    return { series: s, yMax: max };
  }, [summary]);

  // SVG layout — aspect ratio matches the screenshot (roughly 3:1)
  const W = 260;
  const H = 70;
  const padX = 8;
  const padTop = 4;
  const padBottom = 14;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const n = series.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  const xFor = (i: number) => padX + i * stepX;
  const yFor = (v: number) => padTop + innerH - (v / yMax) * innerH;

  const segments: Array<Array<{ i: number; v: number }>> = [];
  let cur: Array<{ i: number; v: number }> = [];
  series.forEach((p, i) => {
    if (p.value == null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else {
      cur.push({ i, v: p.value });
    }
  });
  if (cur.length) segments.push(cur);

  const todayIdx = 3;
  const hoveredPoint = hoverIdx != null ? series[hoverIdx] : null;

  const tipOffsetX = 12;
  const tipOffsetY = 14;
  const approxTipW = 150;
  const approxTipH = 52;
  const containerW = chartRef.current?.clientWidth ?? 260;
  const containerH = chartRef.current?.clientHeight ?? 70;

  const tipStyle: React.CSSProperties = {};
  if (cursorPos) {
    const roomRight = containerW - cursorPos.x;
    if (roomRight >= approxTipW + tipOffsetX) {
      tipStyle.left = cursorPos.x + tipOffsetX;
    } else {
      tipStyle.left = Math.max(0, cursorPos.x - tipOffsetX - approxTipW);
    }
    if (cursorPos.y - tipOffsetY - approxTipH >= 0) {
      tipStyle.top = Math.max(0, cursorPos.y - tipOffsetY - approxTipH);
    } else {
      tipStyle.top = Math.min(containerH - approxTipH, cursorPos.y + tipOffsetY);
    }
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const vbX = (pxX / rect.width) * W;
    let bestI = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(vbX - xFor(i));
      if (d < bestDist) {
        bestDist = d;
        bestI = i;
      }
    }
    setHoverIdx(bestI);
    setCursorPos({ x: pxX, y: pxY });
  };
  const handleMouseLeave = () => {
    setHoverIdx(null);
    setCursorPos(null);
  };

  // Loading / empty / error states.
  const totalBytes = summary?.totalBytes ?? 0;
  const deltas = summary?.deltas ?? { week: 0, month: 0, year: 0 };

  return (
    <div className="bss-root">
      <div className="bss-totals">
        <div className="bss-row-header">
          <span className="bss-label">Backup size</span>
          <span className="bss-value">
            {err ? '—' : (summary == null ? '…' : fmt(totalBytes))}
          </span>
        </div>
        <div className="bss-delta-row">
          <span className="bss-arrow">»</span>
          <span className="bss-delta-key">1w</span>
          <span className="bss-delta-val">+ {fmt(deltas.week)}</span>
        </div>
        <div className="bss-delta-row">
          <span className="bss-arrow">»</span>
          <span className="bss-delta-key">1m</span>
          <span className="bss-delta-val">+ {fmt(deltas.month)}</span>
        </div>
        <div className="bss-delta-row">
          <span className="bss-arrow">»</span>
          <span className="bss-delta-key">1y</span>
          <span className="bss-delta-val">+ {fmt(deltas.year)}</span>
        </div>
      </div>

      <div className="bss-chart" ref={chartRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: 'crosshair' }}
        >
          <defs>
            <linearGradient id="bss-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D31245" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#D31245" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((t) => (
            <line
              key={t}
              x1={padX}
              x2={W - padX}
              y1={padTop + innerH * (1 - t)}
              y2={padTop + innerH * (1 - t)}
              stroke="#e5e7eb"
              strokeWidth={0.5}
            />
          ))}

          {segments.map((seg, idx) => {
            if (seg.length === 0) return null;
            const areaPath =
              `M ${xFor(seg[0].i)} ${padTop + innerH} ` +
              seg.map((p) => `L ${xFor(p.i)} ${yFor(p.v)}`).join(' ') +
              ` L ${xFor(seg[seg.length - 1].i)} ${padTop + innerH} Z`;
            const linePath =
              `M ${xFor(seg[0].i)} ${yFor(seg[0].v)} ` +
              seg.slice(1).map((p) => `L ${xFor(p.i)} ${yFor(p.v)}`).join(' ');
            return (
              <g key={idx}>
                <path d={areaPath} fill="url(#bss-fill)" />
                <path d={linePath} fill="none" stroke="#D31245" strokeWidth={1.25} />
              </g>
            );
          })}

          <line
            x1={xFor(todayIdx)}
            x2={xFor(todayIdx)}
            y1={padTop}
            y2={padTop + innerH}
            stroke="#9ca3af"
            strokeWidth={0.75}
            strokeDasharray="2 2"
          />

          {hoverIdx != null && hoveredPoint && hoveredPoint.value != null && (
            <g>
              <line
                x1={xFor(hoverIdx)}
                x2={xFor(hoverIdx)}
                y1={padTop}
                y2={padTop + innerH}
                stroke="#D31245"
                strokeWidth={0.75}
              />
              <circle
                cx={xFor(hoverIdx)}
                cy={yFor(hoveredPoint.value)}
                r={2.5}
                fill="#D31245"
                stroke="#fff"
                strokeWidth={0.75}
              />
            </g>
          )}

          {series.map((p, i) => (
            <text
              key={i}
              x={xFor(i)}
              y={H - 2}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize="7.5"
              fill={i === todayIdx ? '#111827' : '#6b7280'}
              fontWeight={i === todayIdx ? 600 : 400}
            >
              {fmtShortDate(p.date)}
            </text>
          ))}

          <text x={padX} y={padTop + 6} fontSize="7.5" fill="#9ca3af">
            {fmt(yMax)}
          </text>
          <text x={padX} y={padTop + innerH - 1} fontSize="7.5" fill="#9ca3af">
            0
          </text>
        </svg>

        {hoverIdx != null && hoveredPoint && cursorPos && (
          <div
            className="bss-tooltip"
            style={tipStyle}
            role="tooltip"
          >
            <div className="bss-tip-date">{fmtLongDate(hoveredPoint.date)}</div>
            {hoveredPoint.value == null ? (
              <div className="bss-tip-empty">No backup yet</div>
            ) : hoveredPoint.value === 0 ? (
              <div className="bss-tip-empty">No backup that day</div>
            ) : (
              <div className="bss-tip-row">
                <span className="bss-tip-key">Backed up</span>
                <span className="bss-tip-val">{fmt(hoveredPoint.value)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
