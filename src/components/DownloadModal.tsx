import { useEffect, useState } from 'react';
import './RestoreModal.css';
import './DownloadModal.css';
import { RecoveryService } from '../services/recovery';
import { API } from '../config/api';
import type { ContentTab } from '../services/snapshot';
import { SnapshotService } from '../services/snapshot';
import {
  EXPORT_FORMATS,
  DEFAULT_FORMAT,
  DOWNLOAD_ALL_WORKLOADS,
  type DownloadWorkload,
} from '../config/exportFormats';
import { EntraDownloadForm, type EntraDownloadSelection } from './EntraDownloadForm';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshotIds: string[];
  itemIds: string[];
  selectedCount: number;
  contentType: ContentTab;
  snapshotDate?: string;
  // When true, the current selection came from a folder checkbox (not
  // individual file rows). Forces the backend to zip even a 1-item
  // expansion so the folder path is preserved.
  preserveTree?: boolean;
  resourceId?: string;
  threadPath?: string | null;
  resourceKind?: string;
}

type Scope = 'selected' | 'all';

export function DownloadModal({
  isOpen,
  onClose,
  snapshotIds,
  itemIds,
  selectedCount,
  contentType,
  snapshotDate,
  preserveTree = false,
  resourceId,
  threadPath,
  resourceKind,
}: DownloadModalProps) {
  const [scope, setScope] = useState<Scope>('selected');
  const [workloads, setWorkloads] = useState<Set<DownloadWorkload>>(
    new Set(['Mail', 'Contacts', 'Calendar']),
  );
  const [exportFormat, setExportFormat] = useState<string>(DEFAULT_FORMAT[contentType]);
  const [includeAttachments, setIncludeAttachments] = useState<boolean>(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Elapsed-time tick during the async poll loop so the user sees
  // progress instead of a frozen "Preparing..." button. Updates every
  // second while downloading=true.
  const [elapsedSec, setElapsedSec] = useState(0);
  const [estimate, setEstimate] = useState<{
    messages: number; estimatedZipBytes: number;
    layoutMode: string; softCapExceeded: boolean;
  } | null>(null);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [entraSelection, setEntraSelection] = useState<EntraDownloadSelection | null>(null);

  // Contact folder subgroup state. Populated only when Contacts is checked
  // and scope === 'all' for a single-snapshot export. Default = all checked
  // (so omitting unmodified selection means "include all" — no payload field).
  const [contactFolders, setContactFolders] = useState<string[]>([]);
  const [selectedContactFolders, setSelectedContactFolders] = useState<Set<string>>(new Set());

  // Tick the elapsed counter while a download is in flight so users
  // see movement and don't assume the modal is stuck.
  useEffect(() => {
    if (!downloading) {
      setElapsedSec(0);
      return;
    }
    const t = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [downloading]);

  useEffect(() => {
    if (!isOpen || contentType !== 'chats' || !resourceId) return;
    const t = setTimeout(async () => {
      try {
        const est = await RecoveryService.estimateChatExport({
          resourceId,
          snapshotIds,
          threadPath: threadPath ?? undefined,
          itemIds: threadPath ? [] : itemIds,
          exportFormat: exportFormat as 'HTML' | 'JSON' | 'PDF',
          includeAttachments,
        });
        setEstimate(est);
      } catch {
        setEstimate(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [isOpen, contentType, resourceId, threadPath, itemIds, exportFormat, includeAttachments, snapshotIds]);

  // Fetch the per-snapshot contact folder list when Contacts is selected
  // for a Download-all export. Re-fetch on workload toggle / scope change.
  useEffect(() => {
    if (
      isOpen
      && workloads.has('Contacts')
      && scope === 'all'
      && snapshotIds.length === 1
    ) {
      SnapshotService.listContactFolders(snapshotIds[0])
        .then(folders => {
          setContactFolders(folders);
          setSelectedContactFolders(new Set(folders));
        })
        .catch(() => {
          setContactFolders([]);
          setSelectedContactFolders(new Set());
        });
    } else {
      setContactFolders([]);
      setSelectedContactFolders(new Set());
    }
  }, [isOpen, workloads, scope, snapshotIds]);

  // Reset per-submission state on each open — component stays mounted
  // across close/open cycles, so error / downloading / progress / the
  // Entra selection would otherwise leak from the previous run.
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setDownloading(false);
      setProgressPct(0);
      setElapsedSec(0);
      setEntraSelection(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formats = EXPORT_FORMATS[contentType] || [];

  const toggleWorkload = (w: DownloadWorkload) => {
    setWorkloads(prev => {
      const next = new Set(prev);
      next.has(w) ? next.delete(w) : next.add(w);
      return next;
    });
  };

  const itemLabel = (() => {
    switch (contentType) {
      case 'mail': return selectedCount === 1 ? '1 message' : `${selectedCount} messages`;
      case 'onedrive': return selectedCount === 1 ? '1 file' : `${selectedCount} files`;
      case 'contacts': return selectedCount === 1 ? '1 contact' : `${selectedCount} contacts`;
      case 'calendar': return selectedCount === 1 ? '1 event' : `${selectedCount} events`;
      case 'chats': return selectedCount === 1 ? '1 chat' : `${selectedCount} chats`;
      default: return `${selectedCount} items`;
    }
  })();

  const dateLabel = snapshotDate
    ? new Date(snapshotDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : '';

  const handleDownload = async () => {
    if (contentType === 'chats' && resourceId) {
      if (!threadPath && itemIds.length === 0) {
        setError('Select messages from one thread, or tick one thread.');
        return;
      }
      setDownloading(true); setError(null); setProgressPct(0);
      try {
        const { jobId } = await RecoveryService.triggerChatExport({
          resourceId,
          snapshotIds,
          threadPath: threadPath ?? undefined,
          itemIds: threadPath ? [] : itemIds,
          exportFormat: exportFormat as 'HTML' | 'JSON' | 'PDF',
          includeAttachments,
        });
        RecoveryService.subscribeChatExportStatus(jobId, {
          onProgress: (p) => { if (typeof p.percent === 'number') setProgressPct(p.percent); },
          onComplete: (c) => {
            // SAS URL already carries auth in the query string — don't send any
            // headers (they'd force a CORS preflight the blob account doesn't
            // allow). Use an anchor-tag click so the browser streams the ZIP
            // directly from blob with no XHR / CORS involvement.
            try {
              const a = document.createElement('a');
              a.href = c.url;
              a.download = `teams-chat-${jobId.slice(0, 8)}.zip`;
              a.rel = 'noopener';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            } finally {
              setDownloading(false);
              onClose();
            }
          },
          onError: (e) => { setError(e?.code ?? 'Export failed'); setDownloading(false); },
        });
      } catch (e: any) {
        if (e?.status === 409) {
          setError(e.body?.detail?.error === 'SIZE_SOFT_CAP_EXCEEDED' || e.body?.error === 'SIZE_SOFT_CAP_EXCEEDED'
            ? 'Export is larger than 20 GB. Narrow scope or contact admin.'
            : 'Size cap exceeded.');
        } else if (e?.status === 429) {
          setError('Too many exports. Try again in a minute.');
        } else {
          setError(e?.message ?? 'Export failed');
        }
        setDownloading(false);
      }
      return;
    }

    if (resourceKind === 'entra_directory' && entraSelection) {
      setDownloading(true);
      setError(null);
      try {
        const response = await RecoveryService.triggerExport({
          restoreType: 'EXPORT_ZIP',
          snapshotIds,
          itemIds: [],
          entraSections: entraSelection.sections,
          format: entraSelection.format,
          includeNestedDetail: entraSelection.includeNestedDetail,
        });
        const jobId = response.jobId;
        const token = localStorage.getItem('access_token');
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        for (let i = 0; i < 600; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const statusRes = await fetch(`${API.BASE_URL}/jobs/${jobId}`, { headers });
          if (!statusRes.ok) continue;
          const job = await statusRes.json();
          if (job.status === 'COMPLETED') {
            const dlRes = await fetch(API.EXPORT.DOWNLOAD(jobId), { headers });
            if (!dlRes.ok) throw new Error('Download failed');
            const blob = await dlRes.blob();
            const cd = dlRes.headers.get('Content-Disposition') || '';
            const m = cd.match(/filename="?([^"]+)"?/i);
            const fallback = `entra-export-${jobId.slice(0, 8)}.zip`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = m ? m[1] : fallback;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            onClose();
            return;
          }
          if (job.status === 'FAILED') {
            setError('Export failed. Please try again.');
            return;
          }
        }
        setError('Export timed out. Try again later.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed');
      } finally {
        setDownloading(false);
      }
      return;
    }

    if (scope === 'selected' && itemIds.length === 0) {
      setError('No items selected.');
      return;
    }
    // The workload picker only applies to user-centric resources
    // (mailbox / entra_user). For file-family resources (SharePoint
    // sites today, OneDrive tomorrow) scope='all' means "download the
    // whole resource" — there's no workload axis to pick from.
    const isFilesFamily = resourceKind === 'sharepoint_site';
    if (scope === 'all' && !isFilesFamily && workloads.size === 0) {
      setError('Select at least one workload.');
      return;
    }

    setDownloading(true);
    setError(null);
    try {
      // Only forward contactFolders when the user actually unticked at
      // least one folder. Backend treats omitted/empty as "include all"
      // — preserves backward compatibility for the common case.
      const allFoldersSelected =
        contactFolders.length > 0
        && contactFolders.every(f => selectedContactFolders.has(f));
      const contactFoldersPayload =
        workloads.has('Contacts')
        && scope === 'all'
        && contactFolders.length > 0
        && !allFoldersSelected
          ? Array.from(selectedContactFolders)
          : undefined;

      const response = await RecoveryService.triggerExport({
        restoreType: 'EXPORT_ZIP',
        snapshotIds,
        itemIds: scope === 'selected' ? itemIds : [],
        // File-family resources always export as ZIP with full tree;
        // no format or workload axis applies.
        exportFormat: isFilesFamily ? undefined : exportFormat,
        workloads:
          !isFilesFamily && scope === 'all' ? Array.from(workloads) : undefined,
        includeAttachments: isFilesFamily ? undefined : includeAttachments,
        preserveTree: isFilesFamily || scope === 'all' || preserveTree,
        contactFolders: isFilesFamily ? undefined : contactFoldersPayload,
      });
      const jobId = response.jobId;

      const token = localStorage.getItem('access_token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      // Full-drive OneDrive ZIPs for a power user can need a few minutes
      // to assemble; 60 s (the old cap) timed out on real drives. Poll for
      // up to 20 min and surface the in-progress state clearly.
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${API.BASE_URL}/jobs/${jobId}`, { headers });
        if (!statusRes.ok) continue;
        const job = await statusRes.json();
        if (job.status === 'COMPLETED') {
          const dlRes = await fetch(API.EXPORT.DOWNLOAD(jobId), { headers });
          if (!dlRes.ok) throw new Error('Download failed');
          const blob = await dlRes.blob();
          // Prefer the server's Content-Disposition filename — raw_single
          // responses set it to the user's original filename (e.g. Report.xlsx)
          // so single-file ORIGINAL downloads don't land as .zip. Fall back
          // to the ZIP naming for the multi-file case where the header is
          // the generated export-<jobid>.zip.
          const cd = dlRes.headers.get('Content-Disposition') || '';
          const m = cd.match(/filename="?([^"]+)"?/i);
          const fallback = `export-${jobId.slice(0, 8)}.${exportFormat.toLowerCase()}.zip`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = m ? m[1] : fallback;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          onClose();
          return;
        }
        if (job.status === 'FAILED') {
          setError('Export failed. Please try again.');
          return;
        }
      }
      setError('Export timed out. Try again later.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content download-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-title">
          Download from the backup version{dateLabel ? <> <strong>{dateLabel}</strong></> : ''}
        </div>

        {resourceKind === 'entra_directory' ? (
          <div className="modal-columns">
            <EntraDownloadForm onChange={setEntraSelection} />
          </div>
        ) : resourceKind === 'sharepoint_site' ? (
          // SharePoint sites aren't mailboxes — the Mail/Contacts/Calendar
          // workload picker + per-content-type export formats don't apply.
          // Offer a file-family UX (selected items vs whole site) that
          // submits the existing EXPORT_ZIP path via /export-or-restore.
          <div className="modal-columns">
            <div className="modal-col">
              <label className="radio-row">
                <input
                  type="radio"
                  checked={scope === 'selected'}
                  onChange={() => setScope('selected')}
                />
                <span>
                  Download selected files / folders
                  {selectedCount > 0 && (
                    <strong> ({selectedCount} {selectedCount === 1 ? 'item' : 'items'})</strong>
                  )}
                </span>
              </label>
              <label className="radio-row">
                <input
                  type="radio"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                <span>Download entire site</span>
              </label>
            </div>
            <div className="modal-col">
              <div className="radio-row">
                <span>
                  Export format: <strong>ZIP</strong>
                </span>
              </div>
              <div className="restore-item-info" style={{ marginTop: 8 }}>
                Folder structure is preserved inside the archive — your tree is rebuilt
                as you see it on SharePoint.
              </div>
            </div>
          </div>
        ) : (
        <div className="modal-columns">
          <div className="modal-col">
            <label className="radio-row">
              <input
                type="radio"
                checked={scope === 'selected'}
                onChange={() => setScope('selected')}
              />
              <span>
                Download selected items
                {selectedCount > 0 && <strong> ({itemLabel})</strong>}
              </span>
            </label>

            <label className="radio-row">
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
              <span>Download all</span>
            </label>

            {scope === 'all' && (
              <div className="workload-list">
                {DOWNLOAD_ALL_WORKLOADS.map(w => (
                  <label key={w} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={workloads.has(w)}
                      onChange={() => toggleWorkload(w)}
                    />
                    <span>{w}</span>
                  </label>
                ))}
              </div>
            )}
            {scope === 'all' && workloads.has('Contacts') && contactFolders.length > 0 && (
              <div className="contact-folder-subgroup" style={{ marginLeft: 24, marginTop: 8 }}>
                <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4 }}>
                  Contact folders
                </div>
                {contactFolders.map(f => (
                  <label key={f} className="checkbox-row" style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      checked={selectedContactFolders.has(f)}
                      aria-label={f}
                      onChange={e => {
                        const next = new Set(selectedContactFolders);
                        if (e.target.checked) next.add(f); else next.delete(f);
                        setSelectedContactFolders(next);
                      }}
                    />
                    <span>{f}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="modal-col">
            {formats.length === 0 ? (
              <div className="modal-error">No export formats configured for “{contentType}”.</div>
            ) : (
              formats.map(f => (
                <label key={f.value} className="radio-row">
                  <input
                    type="radio"
                    name="export-format"
                    checked={exportFormat === f.value}
                    onChange={() => setExportFormat(f.value)}
                  />
                  <span>
                    {f.label}
                    {f.hint && <span className="info-icon" title={f.hint}>ℹ</span>}
                  </span>
                </label>
              ))
            )}
            {contentType === 'mail' && (
              <label className="checkbox-row" style={{ marginTop: 16 }}>
                <input
                  type="checkbox"
                  checked={includeAttachments}
                  onChange={(e) => setIncludeAttachments(e.target.checked)}
                />
                <span>
                  Include attachments{' '}
                  <span className="info-icon" title="Uncheck for metadata-only export (smaller, faster)">ℹ</span>
                </span>
              </label>
            )}
            {contentType === 'chats' && estimate && (
              <div className="modal-size-chip">
                {estimate.messages.toLocaleString()} messages · {(estimate.estimatedZipBytes / 1048576).toFixed(1)} MB
                {estimate.softCapExceeded && <span className="warn"> — large, will take time</span>}
              </div>
            )}
            {contentType === 'chats' && downloading && (
              <div className="modal-progress-bar"><div style={{ width: `${progressPct}%` }} /></div>
            )}
          </div>
        </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        {downloading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 0',
              fontSize: 13,
              color: '#4b5563',
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                border: '2px solid #d1d5db',
                borderTopColor: '#2563eb',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                flexShrink: 0,
              }}
            />
            <div>
              <div>
                Assembling export…{' '}
                <strong>
                  {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
                </strong>{' '}
                elapsed
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                Large drives or full-backup downloads can take several minutes —
                please keep this tab open.
              </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn-download" onClick={handleDownload} disabled={downloading || formats.length === 0}>
            {downloading ? 'Preparing…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
