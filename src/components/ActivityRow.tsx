import { useState } from 'react';
import { ActivityItem, BatchChildren, fetchBatchChildren } from '../services/activity';

interface Props {
  item: ActivityItem;
  displayedProgressPct: number;
  renderStatusIcon: (status: string, jobId?: string, jobIds?: string[]) => React.ReactNode;
  formatDate: (iso: string) => string;
  formatBytes?: (n: number) => string;
}

const defaultFmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} EiB`;
};

export function ActivityRow({
  item,
  displayedProgressPct,
  renderStatusIcon,
  formatDate,
  formatBytes,
}: Props) {
  const fmtBytes = formatBytes || defaultFmtBytes;
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<BatchChildren | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canExpand = !!item.batchId;
  const onToggle = async () => {
    if (!canExpand) return;
    const next = !expanded;
    setExpanded(next);
    if (next && !children && !loading) {
      setLoading(true);
      try {
        const data = await fetchBatchChildren(item.batchId!);
        setChildren(data);
        setErr(null);
      } catch (e: any) {
        setErr(e?.message || 'failed to load');
      } finally {
        setLoading(false);
      }
    }
  };

  const warnings = item.warnings;
  const hasWarnings = !!warnings && ((warnings.partial || 0) + (warnings.failed || 0) > 0);

  return (
    <>
      <tr>
        <td>
          {canExpand && (
            <button
              type="button"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={onToggle}
              className="activity-row-chevron"
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
          {formatDate(item.start_time)}
        </td>
        <td><span className="operation-badge">{item.operation}</span></td>
        <td className="object-cell">{item.object}</td>
        <td>{renderStatusIcon(item.status, item.id, item.jobIds)}</td>
        <td>{formatDate(item.finish_time)}</td>
        <td className="details-cell">
          <div className="activity-row-details">
            <span>{item.details || '—'}</span>
            {hasWarnings && (
              <span
                className="activity-row-warning-chip"
                title={`${warnings!.partial} partial, ${warnings!.failed} failed`}
              >
                ⚠ {warnings!.partial} partial · {warnings!.failed} failed
              </span>
            )}
          </div>
          {item.status === 'In Progress' && (
            <div className="activity-row-progress">
              <div
                className="activity-row-progress-bar"
                style={{ width: `${displayedProgressPct}%` }}
              />
              <span>{displayedProgressPct}%</span>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="activity-row-expanded">
          <td colSpan={6}>
            {loading && <span>Loading…</span>}
            {err && <span className="error">Error: {err}</span>}
            {children && (
              <ul className="activity-row-children">
                {children.resources.map((r) => (
                  <li key={r.resourceId} className="activity-row-child">
                    <strong>{r.displayName || r.resourceId}</strong>{' '}
                    <span className="activity-row-child-type">({r.type})</span>
                    {r.status && (
                      <span className="activity-row-child-status">
                        {' — '}{r.status}
                        {r.itemCount != null && `, ${r.itemCount} items`}
                        {r.bytesAdded != null && `, ${fmtBytes(r.bytesAdded)}`}
                      </span>
                    )}
                    {r.children && r.children.length > 0 && (
                      <ul>
                        {r.children.map((c) => (
                          <li key={c.resourceId}>
                            {c.displayName || c.resourceId}
                            <span className="activity-row-child-type"> ({c.type})</span>
                            {' — '}
                            {c.status ?? 'pending'}
                            {c.itemCount != null && `, ${c.itemCount} items`}
                            {c.bytesAdded != null && `, ${fmtBytes(c.bytesAdded)}`}
                            {c.partitions && (
                              <span className="activity-row-shards">
                                {' '}({c.partitions.done}/{c.partitions.total} shards
                                {c.partitions.failed > 0 && `, ${c.partitions.failed} failed`})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
