import { useState } from 'react';
import { createPortal } from 'react-dom';
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

export function ActivityRow({
  item,
  displayedProgressPct,
  renderStatusIcon,
  formatDate,
  formatBytes,
}: Props) {
  const fmtBytes = formatBytes || defaultFmtBytes;
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<BatchChildren | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canOpen = !!item.batchId;

  const openModal = async () => {
    if (!canOpen) return;
    setOpen(true);
    if (!children && !loading) {
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

  const closeModal = () => setOpen(false);

  const warnings = item.warnings;
  const hasWarnings = !!warnings && ((warnings.partial || 0) + (warnings.failed || 0) > 0);

  const rowClickProps = canOpen
    ? { onClick: openModal, style: { cursor: 'pointer' as const } }
    : {};

  return (
    <>
      <tr {...rowClickProps}>
        <td>{formatDate(item.start_time)}</td>
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

      {open && createPortal(
        <div className="modal-overlay" onClick={closeModal}>
              <div className="audit-modal-compact" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close-x" onClick={closeModal}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <div className="modal-compact-content">
                  <div className="compact-row">
                    <span className="compact-label">Operation:</span>
                    <span className="compact-value">{item.operation}</span>
                  </div>
                  <div className="compact-row">
                    <span className="compact-label">Status:</span>
                    <span className="compact-value">{item.status}</span>
                  </div>
                  <div className="compact-row">
                    <span className="compact-label">Started:</span>
                    <span className="compact-value">{formatDate(item.start_time)}</span>
                  </div>
                  {item.finish_time && (
                    <div className="compact-row">
                      <span className="compact-label">Finished:</span>
                      <span className="compact-value">{formatDate(item.finish_time)}</span>
                    </div>
                  )}

                  {loading && (
                    <div className="compact-row">
                      <span className="compact-label">&nbsp;</span>
                      <span className="compact-value">Loading…</span>
                    </div>
                  )}
                  {err && (
                    <div className="compact-row">
                      <span className="compact-label">Error:</span>
                      <span className="compact-value">{err}</span>
                    </div>
                  )}
                  {children && flattenChildren(children.resources).map((leaf) => (
                    <div className="compact-row" key={leaf.key}>
                      <span className="compact-label">{TYPE_LABEL[leaf.type] || leaf.type}:</span>
                      <span className="compact-value">
                        {leaf.displayName || leaf.resourceId}
                        <span className="object-type-inline">({leaf.type})</span>
                        {' — '}
                        {leaf.status ?? 'pending'}
                        {leaf.itemCount != null && `, ${leaf.itemCount} items`}
                        {leaf.bytesAdded != null && `, ${fmtBytes(leaf.bytesAdded)}`}
                        {leaf.status === 'IN_PROGRESS' && leaf.bytesAdded != null && (
                          <span className="leaf-progress-chip" title="In-progress bytes so far">
                            {' '}· {fmtBytes(leaf.bytesAdded)} so far
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
        </div>,
        document.body
      )}
    </>
  );
}
