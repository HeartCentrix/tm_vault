import { useMemo, useRef, useState } from 'react';
import type { SnapshotItem } from '../services/snapshot';
import './BackupSizeSummary.css';

interface Props {
  snapshots: SnapshotItem[];
  totalBytes: number;
}

function fmt(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1_099_511_627_776) return `${(bytes / 1_099_511_627_776).toFixed(1)} TB`;
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtShortDate(d: Date): string {
  // Month-day only, like "Apr 15" — matches the screenshot axis labels.
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * afi-style backup size panel:
 *   - big current total
 *   - 1w / 1m / 1y delta rows (bytes added within each window)
 *   - 7-day cumulative-size sparkline centered on TODAY (today ± 3 days)
 *   - hover tooltip showing the date + cumulative size + per-day added size
 *
 * All numbers derive from the snapshots array already loaded for the resource;
 * no extra backend call. Cumulative = sum of snapshot.size for snapshots whose
 * createdAt is on-or-before that day (monotonic; flat on no-backup days;
 * empty on future days since no backup has happened yet).
 */
export default function BackupSizeSummary({ snapshots, totalBytes }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Cursor position in chart-container pixel space. Used to anchor the tooltip
  // next to the mouse so it never sits underneath the pointer.
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const { series, yMax, deltas } = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now);
    const dayMs = 24 * 60 * 60 * 1000;

    // 7 buckets: today-3 .. today+3
    const days: Date[] = [];
    for (let offset = -3; offset <= 3; offset++) {
      days.push(new Date(today.getTime() + offset * dayMs));
    }

    // Per-day "added that day" = sum of snapshot.size for snapshots whose
    // createdAt falls inside that calendar day. Future days render as null
    // (gap in the chart) so we don't draw a bogus zero-bar ahead of time.
    const parsed = snapshots
      .filter((s) => !!s.createdAt)
      .map((s) => ({ ts: new Date(s.createdAt).getTime(), size: s.size || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const series = days.map((d) => {
      const startTs = d.getTime();
      const endTs = startTs + dayMs;
      let added = 0;
      let snapshotCount = 0;
      for (const s of parsed) {
        if (s.ts >= startTs && s.ts < endTs) {
          added += s.size;
          snapshotCount += 1;
        }
      }
      const isFuture = d.getTime() > today.getTime();
      // Future days with no backups → null (renders as gap). Today/past days
      // always render a value (0 if nothing was backed up that day).
      const value = isFuture && snapshotCount === 0 ? null : added;
      return { date: d, value, snapshotCount, isFuture };
    });

    // Delta windows — sum of snapshot.size in the last N days.
    const sumSince = (sinceMs: number) =>
      parsed.filter((s) => s.ts >= sinceMs).reduce((acc, s) => acc + s.size, 0);

    const deltas = {
      week: sumSince(now.getTime() - 7 * dayMs),
      month: sumSince(now.getTime() - 30 * dayMs),
      year: sumSince(now.getTime() - 365 * dayMs),
    };

    // yMax is now based on the biggest SINGLE-DAY backup (not the cumulative
    // total) so the bars are readable at per-day scale.
    const max = Math.max(1, ...series.map((p) => p.value ?? 0));

    return { series, yMax: max, deltas };
  }, [snapshots, totalBytes]);

  // SVG layout — aspect ratio matches the screenshot (roughly 3:1)
  const W = 260;
  const H = 70;
  const padX = 8;
  const padTop = 4;
  const padBottom = 14; // leaves room for x-axis labels below the chart area
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const n = series.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  const xFor = (i: number) => padX + i * stepX;
  const yFor = (v: number) => padTop + innerH - (v / yMax) * innerH;

  // Build the filled area path, splitting at null-value gaps.
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

  // Follow the cursor so the tooltip never covers it. Default: offset
  // up-and-right by (12, -14) px. Flip sides when the cursor nears an edge so
  // the tooltip stays inside the chart container instead of clipping.
  const tipOffsetX = 12; // gap between cursor and nearest tooltip edge
  const tipOffsetY = 14; // how far above/below the cursor
  const approxTipW = 150; // matches CSS min-width; used for edge math only
  const approxTipH = 52;
  const containerW = chartRef.current?.clientWidth ?? 260;
  const containerH = chartRef.current?.clientHeight ?? 70;

  let tipStyle: React.CSSProperties = {};
  if (cursorPos) {
    // Horizontal: place to the RIGHT of the cursor by default, flip to LEFT
    // when there isn't room on the right.
    const roomRight = containerW - cursorPos.x;
    if (roomRight >= approxTipW + tipOffsetX) {
      tipStyle.left = cursorPos.x + tipOffsetX;
    } else {
      tipStyle.left = Math.max(0, cursorPos.x - tipOffsetX - approxTipW);
    }
    // Vertical: place ABOVE the cursor by default, flip BELOW if there isn't
    // room above. Never below 0, never past the container bottom.
    if (cursorPos.y - tipOffsetY - approxTipH >= 0) {
      tipStyle.top = Math.max(0, cursorPos.y - tipOffsetY - approxTipH);
    } else {
      tipStyle.top = Math.min(containerH - approxTipH, cursorPos.y + tipOffsetY);
    }
  }

  // Translate a mouse event's clientX/Y into viewBox-X (0..W) and
  // container-relative pixel coords (for tooltip positioning).
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    // Because the SVG uses preserveAspectRatio="none", viewBox X maps linearly
    // to pixel X via (pxX / rect.width) * W.
    const vbX = (pxX / rect.width) * W;
    // Nearest day index: distance from each xFor(i) in viewBox coords.
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

  return (
    <div className="bss-root">
      {/* Left column: total + deltas */}
      <div className="bss-totals">
        <div className="bss-row-header">
          <span className="bss-label">Backup size</span>
          <span className="bss-value">{fmt(totalBytes)}</span>
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

      {/* Right column: sparkline + hover tooltip */}
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
              <stop offset="0%" stopColor="#0f9e8e" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0f9e8e" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Y-axis tick markers (top + mid + bottom) */}
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

          {/* Each contiguous segment renders as a filled area + stroke on top */}
          {segments.map((seg, idx) => {
            if (seg.length === 0) return null;
            const areaPath =
              `M ${xFor(seg[0].i)} ${padTop + innerH} ` +
              seg.map((p) => `L ${xFor(p.i)} ${yFor(p.v)}`).join(' ') +
              ` L ${xFor(seg[seg.length - 1].i)} ${padTop + innerH} Z`;
            const linePath =
              `M ${xFor(seg[0].i)} ${yFor(seg[0].v)} ` +
              seg
                .slice(1)
                .map((p) => `L ${xFor(p.i)} ${yFor(p.v)}`)
                .join(' ');
            return (
              <g key={idx}>
                <path d={areaPath} fill="url(#bss-fill)" />
                <path d={linePath} fill="none" stroke="#0f9e8e" strokeWidth={1.25} />
              </g>
            );
          })}

          {/* Today marker — subtle vertical guide so the user sees "now" */}
          <line
            x1={xFor(todayIdx)}
            x2={xFor(todayIdx)}
            y1={padTop}
            y2={padTop + innerH}
            stroke="#9ca3af"
            strokeWidth={0.75}
            strokeDasharray="2 2"
          />

          {/* Hover indicator — vertical line + dot at the hovered day */}
          {hoverIdx != null && hoveredPoint && hoveredPoint.value != null && (
            <g>
              <line
                x1={xFor(hoverIdx)}
                x2={xFor(hoverIdx)}
                y1={padTop}
                y2={padTop + innerH}
                stroke="#0f9e8e"
                strokeWidth={0.75}
              />
              <circle
                cx={xFor(hoverIdx)}
                cy={yFor(hoveredPoint.value)}
                r={2.5}
                fill="#0f9e8e"
                stroke="#fff"
                strokeWidth={0.75}
              />
            </g>
          )}

          {/* X-axis date labels — all 7 days are always visible. End labels
              anchor so they don't clip the chart edges. */}
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

          {/* Y-axis value labels on the left */}
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
              <>
                <div className="bss-tip-row">
                  <span className="bss-tip-key">Backed up</span>
                  <span className="bss-tip-val">{fmt(hoveredPoint.value)}</span>
                </div>
                {hoveredPoint.snapshotCount > 1 && (
                  <div className="bss-tip-row">
                    <span className="bss-tip-key">Snapshots</span>
                    <span className="bss-tip-val">{hoveredPoint.snapshotCount}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
