import { useState } from 'react';
import './RestoreModal.css';
import './DownloadModal.css';
import { RecoveryService } from '../services/recovery';
import { API } from '../config/api';
import type { ContentTab } from '../services/snapshot';
import {
  EXPORT_FORMATS,
  DEFAULT_FORMAT,
  DOWNLOAD_ALL_WORKLOADS,
  type DownloadWorkload,
} from '../config/exportFormats';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshotIds: string[];
  itemIds: string[];
  selectedCount: number;
  contentType: ContentTab;
  snapshotDate?: string;
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
}: DownloadModalProps) {
  const [scope, setScope] = useState<Scope>('selected');
  const [workloads, setWorkloads] = useState<Set<DownloadWorkload>>(
    new Set(['Mail', 'Contacts', 'Calendar', 'Chats']),
  );
  const [exportFormat, setExportFormat] = useState<string>(DEFAULT_FORMAT[contentType]);
  const [includeAttachments, setIncludeAttachments] = useState<boolean>(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (scope === 'selected' && itemIds.length === 0) {
      setError('No items selected.');
      return;
    }
    if (scope === 'all' && workloads.size === 0) {
      setError('Select at least one workload.');
      return;
    }

    setDownloading(true);
    setError(null);
    try {
      const response = await RecoveryService.triggerExport({
        restoreType: 'EXPORT_ZIP',
        snapshotIds,
        itemIds: scope === 'selected' ? itemIds : [],
        exportFormat,
        workloads: scope === 'all' ? Array.from(workloads) : undefined,
        includeAttachments,
      });
      const jobId = response.jobId;

      const token = localStorage.getItem('access_token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${API.BASE_URL}/jobs/${jobId}`, { headers });
        if (!statusRes.ok) continue;
        const job = await statusRes.json();
        if (job.status === 'COMPLETED') {
          const dlRes = await fetch(API.EXPORT.DOWNLOAD(jobId), { headers });
          if (!dlRes.ok) throw new Error('Download failed');
          const blob = await dlRes.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `export-${jobId.slice(0, 8)}.${exportFormat.toLowerCase()}.zip`;
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
          </div>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-footer">
          <button className="btn-download" onClick={handleDownload} disabled={downloading || formats.length === 0}>
            {downloading ? 'Preparing…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
