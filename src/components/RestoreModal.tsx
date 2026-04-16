import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import './RestoreModal.css';
import { RestoreService, type RestoreType } from '../services/restore';
import { getResourcesByType, type ResourceItem } from '../services/resource';

interface RestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemIds: string[];
  snapshotIds: string[];
  itemName?: string;
  itemType?: string;
  snapshotDate?: string;
}

const WORKLOADS = ['Mail', 'OneDrive', 'Contacts', 'Calendar', 'Chats'] as const;
type Workload = typeof WORKLOADS[number];

type Scope = 'selected' | 'full';
type Destination = 'original' | 'another';
type OriginalSubOption = 'separate_folder' | 'overwrite';

export function RestoreModal({ isOpen, onClose, itemIds, snapshotIds, itemName, itemType, snapshotDate }: RestoreModalProps) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [scope, setScope] = useState<Scope>('selected');
  const [workloads, setWorkloads] = useState<Set<Workload>>(new Set(['Mail', 'OneDrive', 'Contacts', 'Calendar']));
  const [destination, setDestination] = useState<Destination>('original');
  const [originalSub, setOriginalSub] = useState<OriginalSubOption>('separate_folder');
  const [folderName, setFolderName] = useState(
    `Restored by AFI/${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
  );
  const [targetUserId, setTargetUserId] = useState('');
  const [targetResourceId, setTargetResourceId] = useState('');
  const [powerBiTargets, setPowerBiTargets] = useState<ResourceItem[]>([]);
  const [powerBiTargetsLoading, setPowerBiTargetsLoading] = useState(false);
  const [powerBiTargetsError, setPowerBiTargetsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isPowerBiItem = Boolean(itemType?.startsWith('POWER_BI'));

  useEffect(() => {
    if (!isOpen || !isPowerBiItem || !tenantId) {
      return;
    }

    let cancelled = false;
    setPowerBiTargetsLoading(true);
    setPowerBiTargetsError(null);

    getResourcesByType(tenantId, 'POWER_BI', 1, 500, undefined, 'active')
      .then((data) => {
        if (cancelled) return;
        setPowerBiTargets(data.items || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setPowerBiTargets([]);
        setPowerBiTargetsError(err instanceof Error ? err.message : 'Failed to load Power BI workspaces');
      })
      .finally(() => {
        if (!cancelled) {
          setPowerBiTargetsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isPowerBiItem, tenantId]);

  if (!isOpen) return null;

  const toggleWorkload = (w: Workload) => {
    setWorkloads(prev => {
      const next = new Set(prev);
      next.has(w) ? next.delete(w) : next.add(w);
      return next;
    });
  };

  const handleRecover = async () => {
    if (isPowerBiItem) {
      if (destination === 'another' && !targetResourceId.trim()) {
        setError('Please select a target Power BI workspace');
        return;
      }
    } else if (destination === 'another' && !targetUserId.trim()) {
      setError('Please enter a target resource ID');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let restoreType: RestoreType;
      if (isPowerBiItem) {
        restoreType = destination === 'another' ? 'CROSS_RESOURCE' : 'IN_PLACE';
      } else {
        restoreType = destination === 'another' ? 'CROSS_USER' : 'IN_PLACE';
      }

      const response = await RestoreService.triggerRestore({
        restoreType,
        snapshotIds,
        itemIds: scope === 'selected' ? itemIds : [],
        targetUserId: !isPowerBiItem && destination === 'another' ? targetUserId : undefined,
        targetResourceId: isPowerBiItem && destination === 'another' ? targetResourceId : undefined,
        targetFolder: !isPowerBiItem && destination === 'original' && originalSub === 'separate_folder' ? folderName : undefined,
        overwrite: !isPowerBiItem && destination === 'original' && originalSub === 'overwrite',
        workloads: !isPowerBiItem && scope === 'full' ? Array.from(workloads) : undefined,
      });
      setSuccess(response.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  const dateLabel = snapshotDate
    ? new Date(snapshotDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    : '';

  if (success) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={onClose}>×</button>
          <div className="modal-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2" style={{ width: 48, height: 48 }}>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            <p>Restore job queued</p>
            <span className="success-job-id">Job ID: {success}</span>
            <button className="btn-recover" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-title">
          Recover from backup version{dateLabel ? <> <strong>{dateLabel}</strong></> : ''}
        </div>

        {isPowerBiItem && (
          <div className="restore-item-info">
            <strong>Note:</strong> Power BI restores may require manual datasource rebinds or credential re-entry after replay.
          </div>
        )}

        <div className="modal-columns">
          {/* Left: Scope (non-Power BI only) */}
          {!isPowerBiItem && (
            <div className="modal-col">
              <label className="radio-row">
                <input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} />
                <span>
                  Recover selected items
                  {itemName && <strong> ({itemName})</strong>}
                </span>
              </label>

              <label className="radio-row">
                <input type="radio" checked={scope === 'full'} onChange={() => setScope('full')} />
                <span>Recover full account</span>
              </label>

              {scope === 'full' && (
                <div className="workload-list">
                  {WORKLOADS.map(w => (
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
          )}

          {isPowerBiItem && (
            <div className="modal-col">
              <div className="radio-row">
                <span>
                  Recover selected items
                  {itemName && <strong> ({itemName})</strong>}
                </span>
              </div>
            </div>
          )}

          {/* Right: Destination */}
          <div className="modal-col">
            <label className="radio-row">
              <input type="radio" checked={destination === 'original'} onChange={() => setDestination('original')} />
              <span>{isPowerBiItem ? 'Recover to the original workspace' : 'Recover to the original resource'}</span>
            </label>

            {!isPowerBiItem && destination === 'original' && (
              <div className="sub-options">
                <label className="radio-row">
                  <input type="radio" checked={originalSub === 'separate_folder'} onChange={() => setOriginalSub('separate_folder')} />
                  <span>Recover to a separate folder <span className="info-icon" title="Items will be placed in a new folder">ℹ</span></span>
                </label>
                {originalSub === 'separate_folder' && (
                  <input
                    className="folder-input"
                    value={folderName}
                    onChange={e => setFolderName(e.target.value)}
                  />
                )}
                <label className="radio-row">
                  <input type="radio" checked={originalSub === 'overwrite'} onChange={() => setOriginalSub('overwrite')} />
                  <span>Overwrite existing content</span>
                </label>
              </div>
            )}

            <label className="radio-row">
              <input type="radio" checked={destination === 'another'} onChange={() => setDestination('another')} />
              <span>{isPowerBiItem ? 'Recover to another workspace' : 'Recover to another resource'}</span>
            </label>

            {destination === 'another' && !isPowerBiItem && (
              <input
                className="folder-input"
                placeholder="Target resource ID"
                value={targetUserId}
                onChange={e => setTargetUserId(e.target.value)}
              />
            )}

            {destination === 'another' && isPowerBiItem && (
              <>
                <select
                  value={targetResourceId}
                  onChange={(e) => setTargetResourceId(e.target.value)}
                  className="folder-input"
                  disabled={powerBiTargetsLoading}
                >
                  <option value="">Select target workspace</option>
                  {powerBiTargets.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                      {resource.email ? ` (${resource.email})` : ''}
                    </option>
                  ))}
                </select>
                {powerBiTargetsLoading && (
                  <div className="restore-item-info">Loading available Power BI workspaces...</div>
                )}
                {powerBiTargetsError && (
                  <div className="modal-error">{powerBiTargetsError}</div>
                )}
              </>
            )}
          </div>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-footer">
          <button className="btn-recover" onClick={handleRecover} disabled={loading}>
            {loading ? 'Recovering...' : 'Recover'}
          </button>
        </div>
      </div>
    </div>
  );
}
