import { useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchBatchChildren } from '../services/activity';
import type { ActivityItem, BatchChildren } from '../services/activity';

interface Props {
  item: ActivityItem;
  // null when the server has no progress estimate yet — render "—"
  // instead of a ratcheted stale percentage. See spec
  // docs/superpowers/specs/2026-05-15-backup-batch-race-fix-design.md.
  displayedProgressPct: number | null;
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

function statusGlyph(status?: string): { ch: string; cls: string; label: string } {
  switch ((status || '').toUpperCase()) {
    case 'COMPLETED':   return { ch: '✓', cls: 'glyph-done',    label: 'Completed' };
    case 'IN_PROGRESS': return { ch: '◐', cls: 'glyph-running', label: 'In progress' };
    case 'FAILED':      return { ch: '✗', cls: 'glyph-failed',  label: 'Failed' };
    case 'PARTIAL':     return { ch: '⚠', cls: 'glyph-partial', label: 'Partial' };
    default:            return { ch: '⋯', cls: 'glyph-pending', label: 'Pending' };
  }
}

const LEAF_PAGE_SIZE = 50;

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
  const [visibleCount, setVisibleCount] = useState(LEAF_PAGE_SIZE);

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

  const closeModal = () => {
    setOpen(false);
    setVisibleCount(LEAF_PAGE_SIZE);  // reset paging on close
  };

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
              {displayedProgressPct == null ? (
                <span className="activity-row-progress-unknown">—</span>
              ) : (
                <>
                  <div
                    className="activity-row-progress-bar"
                    style={{ width: `${displayedProgressPct}%` }}
                  />
                  <span>{displayedProgressPct}%</span>
                </>
              )}
            </div>
          )}
        </td>
      </tr>

      {open && createPortal(
        <div className="modal-overlay" onClick={closeModal}>
          <div className="audit-modal-compact mini-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={closeModal}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="modal-compact-content">
              {/* Header — single line: operation · status · % */}
              <div className="mini-header">
                <span className="mini-operation">{item.operation}</span>
                <span className="mini-sep">·</span>
                <span className={`mini-status ${statusGlyph(item.status === 'In Progress' ? 'IN_PROGRESS' : item.status === 'Done' ? 'COMPLETED' : item.status === 'Failed' ? 'FAILED' : item.status === 'Partial' ? 'PARTIAL' : 'PENDING').cls}`}>
                  {item.status}
                </span>
                {item.status === 'In Progress' && (
                  <>
                    <span className="mini-sep">·</span>
                    <span className="mini-pct">
                      {displayedProgressPct == null ? '—' : `${displayedProgressPct}%`}
                    </span>
                  </>
                )}
              </div>
              <div className="mini-subheader">
                {formatDate(item.start_time)}
                {item.finish_time && ` → ${formatDate(item.finish_time)}`}
                <span className="mini-sep">·</span>
                {item.object}
              </div>

              {loading && <div className="mini-loading">Loading…</div>}
              {err && <div className="mini-error">Error: {err}</div>}

              {children && (() => {
                const groups = children.resources;
                const visibleGroups = groups.slice(0, visibleCount);
                const remaining = groups.length - visibleGroups.length;
                return (
                  <div className="mini-tree">
                    {visibleGroups.map((parent) => {
                      const pGlyph = statusGlyph(parent.status);
                      const kids = parent.children ?? [];
                      return (
                        <div className="mini-group" key={parent.resourceId}>
                          <div className="mini-parent">
                            <span className={`mini-glyph ${pGlyph.cls}`} title={pGlyph.label}>{pGlyph.ch}</span>
                            <span className="mini-name">{parent.displayName || parent.resourceId}</span>
                          </div>
                          {kids.map((child) => {
                            const cGlyph = statusGlyph(child.status);
                            return (
                              <div className="mini-child" key={child.resourceId}>
                                <span className={`mini-glyph ${cGlyph.cls}`} title={cGlyph.label}>{cGlyph.ch}</span>
                                <span className="mini-type">{TYPE_LABEL[child.type] || child.type}</span>
                                <span className="mini-count">{child.itemCount != null ? child.itemCount.toLocaleString() : '—'}</span>
                                <span
                                  className="mini-bytes"
                                  title={
                                    child.bytesTotal != null && child.bytesTotal > 0
                                      ? `${fmtBytes(child.bytesAdded ?? 0)} added · ${fmtBytes(child.bytesTotal)} total`
                                      : undefined
                                  }
                                >
                                  {child.bytesAdded != null && child.bytesAdded > 0
                                    ? fmtBytes(child.bytesAdded)
                                    : '—'}
                                </span>
                              </div>
                            );
                          })}
                          {/* Tier-1-only resources (no children) render their own metrics inline */}
                          {kids.length === 0 && (parent.itemCount != null || parent.bytesAdded != null) && (
                            <div className="mini-child">
                              <span className="mini-glyph glyph-spacer">&nbsp;</span>
                              <span className="mini-type">{TYPE_LABEL[parent.type] || parent.type}</span>
                              <span className="mini-count">{parent.itemCount != null ? parent.itemCount.toLocaleString() : '—'}</span>
                              <span
                                className="mini-bytes"
                                title={
                                  parent.bytesTotal != null && parent.bytesTotal > 0
                                    ? `${fmtBytes(parent.bytesAdded ?? 0)} added · ${fmtBytes(parent.bytesTotal)} total`
                                    : undefined
                                }
                              >
                                {parent.bytesAdded != null && parent.bytesAdded > 0
                                  ? fmtBytes(parent.bytesAdded)
                                  : '—'}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {remaining > 0 && (
                      <div className="mini-show-more">
                        <button
                          type="button"
                          className="mini-show-more-link"
                          onClick={() => setVisibleCount((n) => n + LEAF_PAGE_SIZE)}
                        >
                          {visibleGroups.length} of {groups.length} · Show {Math.min(LEAF_PAGE_SIZE, remaining)} more
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
