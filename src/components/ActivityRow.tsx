import { useState } from 'react';
import { fetchBatchChildren } from '../services/activity';
import type { ActivityItem, BatchChildren } from '../services/activity';

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

  const rowClickProps = canExpand
    ? {
        onClick: onToggle,
        style: { cursor: 'pointer' as const },
        'aria-expanded': expanded,
      }
    : {};

  return (
    <>
      <tr {...rowClickProps}>
        <td>
          {canExpand && (
            <button
              type="button"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
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
              <div className="modal-compact-content activity-drilldown-compact">
                {flattenChildren(children.resources).map((leaf) => (
                  <div className="compact-row" key={leaf.key}>
                    <span className="compact-label">{TYPE_LABEL[leaf.type] || leaf.type}:</span>
                    <span className="compact-value">
                      {leaf.displayName || leaf.resourceId}
                      <span className="object-type-inline">({leaf.type})</span>
                      {' — '}
                      {leaf.status ?? 'pending'}
                      {leaf.itemCount != null && `, ${leaf.itemCount} items`}
                      {leaf.bytesAdded != null && `, ${fmtBytes(leaf.bytesAdded)}`}
                      {leaf.partitions && (
                        <>
                          {' '}({leaf.partitions.done}/{leaf.partitions.total} shards
                          {leaf.partitions.failed > 0 && `, ${leaf.partitions.failed} failed`})
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Resource-type → short label shown on the compact-row left side.
const TYPE_LABEL: Record<string, string> = {
  ENTRA_USER:      'User',
  USER_MAIL:       'Mail',
  USER_ONEDRIVE:   'OneDrive',
  USER_CHATS:      'Chats',
  USER_CALENDAR:   'Calendar',
  USER_CONTACTS:   'Contacts',
  MAILBOX:         'Mailbox',
  SHARED_MAILBOX:  'Shared Mailbox',
  ROOM_MAILBOX:    'Room Mailbox',
  SHAREPOINT_SITE: 'SharePoint',
};

// Flatten the Tier-1 → Tier-2 tree into a single ordered list so each
// resource appears on its own row in the compact list. Tier-1 first,
// then its children directly below it.
type Leaf = {
  key: string;
  resourceId: string;
  displayName: string;
  type: string;
  status?: string;
  itemCount?: number;
  bytesAdded?: number;
  partitions?: { total: number; done: number; pending: number; failed: number };
};
function flattenChildren(resources: BatchChildren['resources']): Leaf[] {
  const out: Leaf[] = [];
  for (const r of resources) {
    out.push({
      key: r.resourceId,
      resourceId: r.resourceId,
      displayName: r.displayName,
      type: r.type,
      status: r.status,
      itemCount: r.itemCount,
      bytesAdded: r.bytesAdded,
      partitions: r.partitions,
    });
    for (const c of (r.children ?? [])) {
      out.push({
        key: `${r.resourceId}/${c.resourceId}`,
        resourceId: c.resourceId,
        displayName: c.displayName,
        type: c.type,
        status: c.status,
        itemCount: c.itemCount,
        bytesAdded: c.bytesAdded,
        partitions: c.partitions,
      });
    }
  }
  return out;
}
