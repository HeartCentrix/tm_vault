import { useEffect, useState } from 'react';
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
    // A backup that succeeded but whose restore point later aged out under the
    // SLA retention policy. Neutral (muted) treatment — it is NOT a failure.
    case 'EXPIRED':     return { ch: '⌛', cls: 'glyph-pending', label: 'Expired' };
    // Workload the user has no M365 license for — deliberately skipped, not
    // pending/failed. Neutral shield-slash glyph.
    case 'SKIPPED_NO_LICENSE':
                        return { ch: '⊘', cls: 'glyph-skipped', label: 'Skipped — no license' };
    default:            return { ch: '⋯', cls: 'glyph-pending', label: 'Pending' };
  }
}

// Roll up a parent's status from its children. The backend's parent row
// is the Tier-1 ENTRA_USER snapshot, which COMPLETES as soon as the
// user-metadata fetch finishes — long before per-workload Tier-2
// snapshots (Mail / OneDrive / Chats / Calendar / Contacts) settle. If
// we surface the raw parent.status, the operator sees a ✓ next to the
// user name while every workload row still shows ⋯ — the original
// 2026-05-16 UX complaint. Aggregate so the parent glyph reflects the
// WHOLE user.
//   - any child PENDING / IN_PROGRESS / unknown  → IN_PROGRESS
//   - all children COMPLETED                     → COMPLETED
//   - all children FAILED                        → FAILED
//   - mix of COMPLETED + FAILED/PARTIAL          → PARTIAL
function rollupParentStatus(
  parentStatus: string | undefined,
  kids: { status?: string }[],
): string {
  if (!kids.length) return (parentStatus || '').toUpperCase();
  let anyPending = false, anyCompleted = false, anyFailed = false, anyPartial = false;
  for (const k of kids) {
    const s = (k.status || '').toUpperCase();
    if (s === 'COMPLETED') anyCompleted = true;
    else if (s === 'FAILED') anyFailed = true;
    else if (s === 'PARTIAL') anyPartial = true;
    // License-skipped workloads are terminal, not pending — they must NOT
    // hold the parent at ◐ In Progress (the whole point of the fix). Treat
    // like a benign no-op: neither pending nor a success/failure signal.
    else if (s === 'SKIPPED_NO_LICENSE') continue;
    else anyPending = true; // IN_PROGRESS, PENDING, unknown
  }
  if (anyPending) return 'IN_PROGRESS';
  if (anyFailed && !anyCompleted && !anyPartial) return 'FAILED';
  if (anyFailed || anyPartial) return 'PARTIAL';
  return 'COMPLETED';
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

  // Live refresh: while the modal is open AND the batch is still
  // in progress, repoll the children endpoint so the per-user x
  // per-workload breakdown updates without the operator closing /
  // reopening the modal. (2026-05-16 report: "i not want had to have
  // the need to see the new tier discovered and backend up info it
  // should show me in realtime instantly" — Tier-2 sub-rows appeared
  // only after manual refresh because the initial fetch landed
  // before Tier-2 discovery completed.)
  //
  // 2 s cadence — feels close to real-time without hammering the
  // endpoint. The /batches/{id}/children query is a single CTE
  // walk; one extra request every 2 s during an open modal is
  // negligible. We:
  //   * fire an immediate tick on mount so we don't wait the
  //     interval before the first refresh,
  //   * swallow errors so a transient 5xx doesn't blank out the
  //     last-good payload — next tick replaces it cleanly,
  //   * tear down on close / status flip to terminal so we don't
  //     poll forever on a Done row that can't change.
  useEffect(() => {
    if (!open || !item.batchId || item.status !== 'In Progress') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchBatchChildren(item.batchId!);
        if (!cancelled) setChildren(data);
      } catch {
        // keep prior children; transient errors are not user-facing
      }
    };
    void tick();  // immediate refresh on open
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, item.status, item.batchId]);

  const warnings = item.warnings;
  const hasWarnings = !!warnings && ((warnings.partial || 0) + (warnings.failed || 0) > 0);
  // Workloads skipped because the user has no M365 license — a neutral,
  // informational chip (NOT a warning). This is why a partially-licensed
  // user's backup reads "Completed · N skipped (no license)" instead of
  // stalling at "In Progress".
  const skippedNoLicense = warnings?.skipped_no_license || 0;

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
                title={`${warnings!.partial || 0} partial, ${warnings!.failed || 0} failed`}
              >
                ⚠ {warnings!.partial || 0} partial · {warnings!.failed || 0} failed
              </span>
            )}
            {skippedNoLicense > 0 && (
              <span
                className="activity-row-skip-chip"
                tabIndex={0}
                role="note"
                data-tooltip={`${skippedNoLicense} workload${skippedNoLicense === 1 ? '' : 's'} skipped — the user has no M365 license for ${skippedNoLicense === 1 ? 'it' : 'them'}. Resumes automatically once a license is assigned.`}
                aria-label={`${skippedNoLicense} workload${skippedNoLicense === 1 ? '' : 's'} skipped, no M365 license`}
                onClick={(e) => e.stopPropagation()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" />
                </svg>
                {skippedNoLicense} skipped (no license)
              </span>
            )}
          </div>
          {item.status === 'In Progress' && (
            <div className="activity-row-progress">
              {displayedProgressPct == null ? (
                <span className="activity-row-progress-unknown">—</span>
              ) : (
                <>
                  {/* Track is a fixed-width container so the % label
                      sitting alongside doesn't get pushed right as the
                      bar grows. Previously bar + label were direct
                      flex siblings and the label slid with the bar's
                      `width: N%` (2026-05-16 UX report). */}
                  <div className="activity-row-progress-track">
                    <div
                      className="activity-row-progress-bar"
                      style={{ width: `${displayedProgressPct}%` }}
                    />
                  </div>
                  <span className="activity-row-progress-label">
                    {displayedProgressPct}%
                  </span>
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
                <span className={`mini-status ${statusGlyph(item.status === 'In Progress' ? 'IN_PROGRESS' : item.status === 'Done' ? 'COMPLETED' : item.status === 'Failed' ? 'FAILED' : item.status === 'Partial' ? 'PARTIAL' : item.status === 'Expired' ? 'EXPIRED' : 'PENDING').cls}`}>
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
                      const kids = parent.children ?? [];
                      const pGlyph = statusGlyph(
                        rollupParentStatus(parent.status, kids),
                      );
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
                                <span className="mini-count" title={child.skippedNoLicense && child.licenseHint ? `No ${child.licenseHint} license` : undefined}>
                                  {child.skippedNoLicense
                                    ? 'No license'
                                    : (child.itemCount != null ? child.itemCount.toLocaleString() : '—')}
                                </span>
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
