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
  // Mail / Contacts / generic folder checkbox selection. The user ticks
  // a folder (e.g. `/Inbox`, `Contacts`) in the left rail and we send
  // the paths to the backend; shared.folder_resolver expands them into
  // item ids server-side, so we don't have to materialise the full list
  // in the UI. Sent alongside itemIds — backend treats them as a union.
  folderPaths?: string[];
  // The Online Archive folder is selected (browsed inside the Mail/Contacts
  // view). Redirects PST type resolution to ARCHIVE_ITEM; the caller also
  // passes the archive child snapshot id as snapshotIds.
  isArchive?: boolean;
}

type Scope = 'selected' | 'all';

// PST-compatible workload → item type mapping.
const WORKLOAD_TO_PST_TYPE: Partial<Record<DownloadWorkload, string>> = {
  Mail: 'EMAIL',
  Contacts: 'USER_CONTACT',
  Calendar: 'CALENDAR_EVENT',
  // OneDrive has no PST equivalent — intentionally omitted.
};

// True when the current selection produces a coherent PST.
//
//   * "all" scope — at least one checked workload must be PST-compatible
//     (OneDrive alone can't produce a PST).
//   * "selected" scope — generally requires folder paths so the PST has
//     a hierarchy to materialise. Contacts are exempt: each contact is
//     a self-contained item, so individual contact picks export as
//     one-PST-per-contact (ITEM granularity).
function hasPstCompatibleWorkload(
  scope: Scope,
  workloads: Set<DownloadWorkload>,
  folderPaths: string[] | undefined,
  contentType: ContentTab,
  itemCount: number,
  isArchive: boolean = false,
): boolean {
  if (scope === 'selected') {
    if (folderPaths && folderPaths.length > 0) return true;
    // Any explicitly-ticked items are PST-exportable — mail, contacts,
    // calendar, and Online Archive all support item-level PST (one PST per
    // item, or rebuilt into a folder tree). Don't gate mail behind a folder
    // pick: selecting a single email must keep PST available.
    if (itemCount > 0) return true;
    return false;
  }
  // "all" scope: the Online Archive is itself PST-compatible.
  if (isArchive) return true;
  return [...workloads].some(w => w in WORKLOAD_TO_PST_TYPE);
}

// Compute pstIncludeTypes from the current scope + workloads + contentType + resourceKind.
// "selected" scope: driven by the active content tab (email tab → EMAIL only, etc.).
// "all" scope: driven by whichever PST-compatible workloads are checked.
// Resource-kind restrictions applied on top for shared/room/M365 mailboxes.
function resolvePstIncludeTypes(
  contentType: ContentTab,
  resourceKind: string | undefined,
  scope: Scope,
  workloads: Set<DownloadWorkload>,
  isArchive: boolean = false,
): string[] {
  // Online Archive items are their own item_type regardless of the tab they're
  // browsed under (archive lives inside the Mail/Contacts view).
  if (isArchive) return ['ARCHIVE_ITEM'];

  let types: string[];

  if (scope === 'selected') {
    // Tab drives the type exactly — selected items on the mail tab are emails only.
    if (contentType === 'contacts') types = ['USER_CONTACT'];
    else if (contentType === 'calendar') types = ['CALENDAR_EVENT'];
    else types = ['EMAIL'];
  } else {
    // Workload checkboxes drive the types.
    types = [...workloads]
      .map(w => WORKLOAD_TO_PST_TYPE[w])
      .filter((t): t is string => Boolean(t));
  }

  // Restrict by resource kind (shared/room have no calendar or contacts).
  if (resourceKind === 'shared_mailbox' || resourceKind === 'room_mailbox')
    types = types.filter(t => t === 'EMAIL');
  else if (resourceKind === 'm365_group')
    types = types.filter(t => t !== 'USER_CONTACT');

  return types;
}

// Auto-determines PST granularity from selection — no manual picker needed.
// Download all                  → MAILBOX (one PST per mailbox, full source tree)
// Multi-calendar picks          → FOLDER  (one PST per ticked calendar —
//                                          users on the Calendar tab
//                                          want each source calendar as
//                                          its own file)
// Multi-folder picks (mail/...) → MAILBOX (one PST with the source folder
//                                          hierarchy rebuilt inside it)
// Single folder/calendar pick   → MAILBOX (one PST containing that pick)
// Otherwise                     → ITEM    (one PST per item — legacy
//                                          per-email pick experience)
function autoGranularity(
  scope: Scope,
  folderPaths?: string[],
  contentType?: ContentTab,
): 'MAILBOX' | 'FOLDER' | 'ITEM' {
  if (scope === 'all') return 'MAILBOX';
  // Contacts: always ITEM when the user is picking individual contacts —
  // each contact ships as its own PST file (consistent with the
  // reference Outlook export, which produces one .pst per contact).
  if (contentType === 'contacts') return 'ITEM';
  const folderCount = folderPaths?.length ?? 0;
  if (folderCount > 0) {
    // Multi-calendar selection: split per-folder so the user gets one
    // PST per calendar source (per the calendar-filter UX). Mail / other
    // tabs keep their multi-folder-in-one-PST behaviour because the
    // pstwriter rebuilds the source folder hierarchy inside the file.
    if (contentType === 'calendar' && folderCount > 1) return 'FOLDER';
    return 'MAILBOX';
  }
  return 'ITEM';
}

// Human-readable label for the auto-detected granularity + output files.
function getPstAutoLabel(
  scope: Scope,
  folderPaths: string[] | undefined,
  contentType: ContentTab,
  resourceKind: string | undefined,
  workloads: Set<DownloadWorkload>,
  selectedCount: number,
  isArchive: boolean = false,
): string {
  const gran = autoGranularity(scope, folderPaths, contentType);
  const types = resolvePstIncludeTypes(contentType, resourceKind, scope, workloads, isArchive);
  if (types.length === 0) return 'No PST-compatible items in current selection.';

  const typeLabels: string[] = [];
  if (types.includes('EMAIL'))          typeLabels.push('mail');
  if (types.includes('CALENDAR_EVENT')) typeLabels.push('calendar');
  if (types.includes('USER_CONTACT'))   typeLabels.push('contacts');
  const what = typeLabels.join(' + ');

  if (gran === 'MAILBOX') {
    if (folderPaths && folderPaths.length > 0) {
      const label = contentType === 'calendar' ? 'calendar' : 'folder';
      return `${folderPaths.length} ${label}${folderPaths.length > 1 ? 's' : ''} exported as a single PST (${what}) — opens in Outlook`;
    }
    // Individual-item picks for calendar get auto-coalesced into a
    // single MAILBOX-granularity PST (per autoGranularity); say so
    // explicitly so the user doesn't expect N PSTs back.
    if (scope === 'selected' && contentType === 'calendar') {
      return `${selectedCount} event${selectedCount !== 1 ? 's' : ''} exported as a single PST (${what}) — opens in Outlook`;
    }
    return `Full mailbox exported as PST (${what}) — opens in Outlook`;
  }
  if (gran === 'FOLDER') {
    const label = contentType === 'calendar' ? 'calendar' : 'folder';
    return `${folderPaths!.length} ${label}${folderPaths!.length > 1 ? 's' : ''} exported as ${folderPaths!.length} separate PST file${folderPaths!.length > 1 ? 's' : ''} (${what}) — one per ${label}, all bundled in the download`;
  }
  // ITEM granularity: one PST per item, all zipped together. For
  // contacts this is the default selected-picks experience.
  if (contentType === 'contacts') {
    return `${selectedCount} contact${selectedCount !== 1 ? 's' : ''} exported as ${selectedCount} separate PST file${selectedCount !== 1 ? 's' : ''} (${what}) — one per contact, all bundled in the download`;
  }
  return `${selectedCount} item${selectedCount !== 1 ? 's' : ''} exported as PST (${what}) — opens in Outlook`;
}

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
  folderPaths,
  isArchive = false,
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
  // Granularity is auto-determined — no state needed.
  const pstGranularity = autoGranularity(scope, folderPaths, contentType);

  // Auto-deselect PST when the current selection can no longer produce
  // one (OneDrive-only workload checked, or individual items picked
  // without a folderPath selection).
  useEffect(() => {
    if (exportFormat === 'PST' && !hasPstCompatibleWorkload(scope, workloads, folderPaths, contentType, itemIds.length, isArchive)) {
      setExportFormat(DEFAULT_FORMAT[contentType]);
    }
  }, [scope, workloads, contentType, exportFormat, folderPaths, itemIds.length]);

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
        const headers: Record<string, string> = {};
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

    if (exportFormat === 'PST') {
      if (scope === 'selected' && itemIds.length === 0 && !(folderPaths && folderPaths.length > 0)) {
        setError('No items selected.');
        return;
      }
      setDownloading(true);
      setError(null);
      try {
        // When the user picked folder/calendar filters in the sidebar,
        // drop the auto-seeded itemIds. The backend's resolver OR-s
        // item_ids and folder_paths — sending both would pull every
        // event the user *could have* selected (e.g. all 166 events
        // when only one calendar is ticked).
        const useFolders = scope === 'selected' && (folderPaths?.length ?? 0) > 0;
        const response = await RecoveryService.triggerExport({
          restoreType: 'EXPORT_PST',
          snapshotIds,
          itemIds: scope === 'selected' && !useFolders ? itemIds : [],
          folderPaths: useFolders ? folderPaths : undefined,
          exportFormat: 'PST',
          pstGranularity,
          pstIncludeTypes: resolvePstIncludeTypes(contentType, resourceKind, scope, workloads, isArchive),
          // Archive: no workload filter — the archive snapshot holds only
          // ARCHIVE_ITEM, and pstIncludeTypes already scopes to it. Sending
          // Mail/Contacts/Calendar would filter every archive item out.
          workloads: scope === 'all' && !isArchive ? Array.from(workloads) : undefined,
          includeAttachments,
        });
        const jobId = response.jobId;
        const headers: Record<string, string> = {};
        for (let i = 0; i < 600; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const statusRes = await fetch(`${API.BASE_URL}/jobs/${jobId}`, { headers });
          if (!statusRes.ok) continue;
          const job = await statusRes.json();
          if (job.status === 'COMPLETED') {
            const dlRes = await fetch(API.EXPORT.DOWNLOAD(jobId), { headers });
            if (!dlRes.ok) throw new Error('Download failed');
            const blob = await dlRes.blob();
            const cd = dlRes.headers.get('Content-Disposition') || '';
            const m = cd.match(/filename="?([^"]+)"?/i);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = m ? m[1] : `pst-export-${jobId.slice(0, 8)}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            onClose();
            return;
          }
          if (job.status === 'FAILED') {
            setError('PST export failed. Please try again.');
            return;
          }
        }
        setError('Export timed out. Try again later.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'PST export failed');
      } finally {
        setDownloading(false);
      }
      return;
    }

    if (scope === 'selected' && itemIds.length === 0 && !(folderPaths && folderPaths.length > 0)) {
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
        folderPaths:
          scope === 'selected' && folderPaths && folderPaths.length > 0
            ? folderPaths
            : undefined,
        // File-family resources always export as ZIP with full tree;
        // no format or workload axis applies.
        exportFormat: isFilesFamily ? undefined : exportFormat,
        // Archive export: skip the workload filter (archive snapshot is all
        // ARCHIVE_ITEM; Mail/Contacts/Calendar would exclude everything).
        workloads:
          !isFilesFamily && scope === 'all' && !isArchive ? Array.from(workloads) : undefined,
        includeAttachments: isFilesFamily ? undefined : includeAttachments,
        preserveTree:
          isFilesFamily || scope === 'all' || preserveTree
          || (!!folderPaths && folderPaths.length > 0),
        contactFolders: isFilesFamily ? undefined : contactFoldersPayload,
      });
      const jobId = response.jobId;

      const headers: Record<string, string> = {};
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
            {(() => {
              // Inline hint shown above the format list when PST is
              // disabled solely because no folder/calendar was ticked
              // — lets the user fix the missing input without hovering.
              if (formats.length === 0) return null;
              if (scope !== 'selected') return null;
              if (folderPaths && folderPaths.length > 0) return null;
              if (!formats.some(f => f.value === 'PST')) return null;
              // Contacts and the Online Archive have no folder-checkbox gate —
              // selecting item rows alone unlocks PST, so no folder hint applies.
              if (contentType === 'contacts' || isArchive) return null;
              const msg =
                contentType === 'calendar'
                  ? 'To enable PST export, tick one or more calendars in the "Calendar" section of the sidebar. Multiple calendars → one PST per calendar.'
                  : 'To enable PST export, tick one or more folders in the left sidebar.';
              return (
                <div
                  style={{
                    marginBottom: 10,
                    padding: '8px 10px',
                    background: '#fef3c7',
                    border: '1px solid #fcd34d',
                    borderRadius: 6,
                    color: '#78350f',
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {msg}
                </div>
              );
            })()}
            {formats.length === 0 ? (
              <div className="modal-error">No export formats configured for “{contentType}”.</div>
            ) : (
              (() => {
                const pstDisabledGlobal = !hasPstCompatibleWorkload(scope, workloads, folderPaths, contentType, itemIds.length, isArchive);
                const pstFolderHint = (() => {
                  if (!pstDisabledGlobal || scope !== 'selected') return '';
                  if (folderPaths && folderPaths.length > 0) return '';
                  // contentType-specific direction: tell the user exactly
                  // which sidebar section enables PST for their tab.
                  // Contacts is exempt — itemIds alone unlock PST.
                  if (isArchive)
                    return 'Select one or more archived items — or tick archive folders in the left sidebar — to enable PST export.';
                  if (contentType === 'calendar')
                    return 'Tick one or more calendars in the "Calendar" filter sidebar to enable PST export. Multiple calendars produce one PST per calendar.';
                  if (contentType === 'contacts')
                    return 'Select one or more contacts to enable PST export.';
                  return 'Select one or more items, or tick folders in the left sidebar, to enable PST export. Multiple folders produce one PST containing the source folder tree.';
                })();
                return formats.map(f => {
                  const pstDisabled = f.value === 'PST' && pstDisabledGlobal;
                  const pstDisabledReason = pstFolderHint
                    || 'No PST-compatible workload selected (OneDrive does not support PST)';
                  return (
                    <label
                      key={f.value}
                      className="radio-row"
                      style={pstDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                      title={pstDisabled ? pstDisabledReason : undefined}
                    >
                      <input
                        type="radio"
                        name="export-format"
                        checked={exportFormat === f.value}
                        onChange={() => !pstDisabled && setExportFormat(f.value)}
                        disabled={pstDisabled}
                      />
                      <span>
                        {f.label}
                        {f.hint && <span className="info-icon" title={f.hint}>ℹ</span>}
                        {pstDisabled && <span style={{ fontSize: 11, marginLeft: 6, color: '#9ca3af' }}>(not available)</span>}
                      </span>
                    </label>
                  );
                });
              })()
            )}
            {exportFormat === 'PST' && (
              <div style={{ marginTop: 14, fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                {getPstAutoLabel(scope, folderPaths, contentType, resourceKind, workloads, selectedCount, isArchive)}
              </div>
            )}
            {contentType === 'mail' && exportFormat !== 'PST' && (
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
