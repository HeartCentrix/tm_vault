import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import './RestoreModal.css';
import { RestoreService, type RestoreType } from '../services/restore';
import { getResourcesByType, type ResourceItem } from '../services/resource';
import { fmtLocalDate } from '../utils/datetime';
import { EntraRestoreForm, type EntraRestoreSelection } from './EntraRestoreForm';

interface RestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemIds: string[];
  snapshotIds: string[];
  itemName?: string;
  itemType?: string;
  snapshotDate?: string;
  resourceKind?: string;
}

const WORKLOADS = ['Mail', 'OneDrive', 'Contacts', 'Calendar', 'Chats'] as const;
type Workload = typeof WORKLOADS[number];

type Scope = 'selected' | 'full';
type Destination = 'original' | 'another';
type OriginalSubOption = 'separate_folder' | 'overwrite';

export function RestoreModal({ isOpen, onClose, itemIds, snapshotIds, itemName, itemType, snapshotDate, resourceKind }: RestoreModalProps) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [scope, setScope] = useState<Scope>('selected');
  // Shared + room mailboxes have no OneDrive in M365 — hide it so users
  // can't pick a workload the backend will silently drop.
  const isMailOnlyResource = resourceKind === 'shared_mailbox' || resourceKind === 'room_mailbox';
  const availableWorkloads = isMailOnlyResource
    ? WORKLOADS.filter((w) => w !== 'OneDrive')
    : WORKLOADS;
  const [workloads, setWorkloads] = useState<Set<Workload>>(
    new Set(isMailOnlyResource ? ['Mail', 'Contacts', 'Calendar'] : ['Mail', 'OneDrive', 'Contacts', 'Calendar']),
  );
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
  const [pPlatformEnvs, setPPlatformEnvs] = useState<ResourceItem[]>([]);
  const [pPlatformEnvsLoading, setPPlatformEnvsLoading] = useState(false);
  const [pPlatformEnvsError, setPPlatformEnvsError] = useState<string | null>(null);
  const [mailboxTargets, setMailboxTargets] = useState<ResourceItem[]>([]);
  const [mailboxTargetsLoading, setMailboxTargetsLoading] = useState(false);
  const [mailboxTargetsError, setMailboxTargetsError] = useState<string | null>(null);
  const [targetEnvironmentId, setTargetEnvironmentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [entraSelection, setEntraSelection] = useState<EntraRestoreSelection | null>(null);

  const isPowerBiItem = Boolean(itemType?.startsWith('POWER_BI'));
  // Power Platform coverage: canvas/model-driven apps, flows, and DLP policies.
  // Apps/flows need an environment picker when restoring to a different environment;
  // DLP is tenant-scoped so it only supports in-place replay.
  const isPowerAppItem = Boolean(itemType?.startsWith('POWER_APP'));
  const isPowerFlowItem = Boolean(itemType?.startsWith('POWER_FLOW'));
  const isPowerDlpItem = Boolean(itemType?.startsWith('POWER_DLP'));
  const isPowerPlatformItem = isPowerAppItem || isPowerFlowItem || isPowerDlpItem;
  const powerPlatformWorkload = isPowerAppItem ? 'Power App' : isPowerFlowItem ? 'Power Automate flow' : 'DLP policy';

  useEffect(() => {
    if (!isOpen || !isPowerBiItem || !tenantId) {
      return;
    }

    let cancelled = false;
    setPowerBiTargetsLoading(true);
    setPowerBiTargetsError(null);

    // Pass includeHidden=true — POWER_BI is filtered out of default listings but
    // the Restore modal explicitly needs the workspace picker for cross-workspace restore.
    getResourcesByType(tenantId, 'POWER_BI', 1, 500, undefined, 'active', true)
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

  // Load Power Platform environments when restoring an app or flow.
  // Environments come from discovery as POWER_APPS resources whose external_id
  // starts with 'env_' — that's the convention set by discover_power_platform.
  useEffect(() => {
    if (!isOpen || !(isPowerAppItem || isPowerFlowItem) || !tenantId) return;
    let cancelled = false;
    setPPlatformEnvsLoading(true);
    setPPlatformEnvsError(null);
    getResourcesByType(tenantId, 'POWER_APPS', 1, 500, undefined, 'active')
      .then((data) => {
        if (cancelled) return;
        const envs = (data.items || []).filter((r) =>
          (r.external_id || '').startsWith('env_') || (r.name || '').endsWith('(Environment)'),
        );
        setPPlatformEnvs(envs);
      })
      .catch((err) => {
        if (cancelled) return;
        setPPlatformEnvs([]);
        setPPlatformEnvsError(err instanceof Error ? err.message : 'Failed to load environments');
      })
      .finally(() => {
        if (!cancelled) setPPlatformEnvsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isPowerAppItem, isPowerFlowItem, tenantId]);

  // Mail restore — load candidate target mailboxes (user/shared/room)
  // when the user picks "Recover to another resource". Concatenate the
  // three mailbox types so the dropdown covers all AFI-parity targets.
  useEffect(() => {
    if (!isOpen || !tenantId) return;
    if (destination !== 'another') return;
    const isMailSource = resourceKind === 'mailbox'
      || resourceKind === 'shared_mailbox'
      || resourceKind === 'room_mailbox';
    if (!isMailSource) return;

    let cancelled = false;
    setMailboxTargetsLoading(true);
    setMailboxTargetsError(null);

    Promise.all([
      getResourcesByType(tenantId, 'MAILBOX', 1, 500, undefined, 'active'),
      getResourcesByType(tenantId, 'SHARED_MAILBOX', 1, 500, undefined, 'active'),
      getResourcesByType(tenantId, 'ROOM_MAILBOX', 1, 500, undefined, 'active'),
    ])
      .then((results) => {
        if (cancelled) return;
        const merged: ResourceItem[] = [];
        for (const r of results) merged.push(...(r.items || []));
        setMailboxTargets(merged);
      })
      .catch((err) => {
        if (cancelled) return;
        setMailboxTargets([]);
        setMailboxTargetsError(err instanceof Error ? err.message : 'Failed to load mailboxes');
      })
      .finally(() => {
        if (!cancelled) setMailboxTargetsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, tenantId, destination, resourceKind]);

  // Reset per-submission state each time the modal opens. The component
  // stays mounted across close/open cycles (we render null when closed),
  // so success / error / loading / entraSelection would otherwise leak
  // from the previous restore and show the "Restore job queued" screen
  // on re-open instead of a fresh form.
  useEffect(() => {
    if (isOpen) {
      setSuccess(null);
      setError(null);
      setLoading(false);
      setEntraSelection(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleWorkload = (w: Workload) => {
    setWorkloads(prev => {
      const next = new Set(prev);
      next.has(w) ? next.delete(w) : next.add(w);
      return next;
    });
  };

  const handleRecover = async () => {
    // Full-account restore requires at least one workload selected —
    // otherwise the backend receives an empty filter list and silently
    // skips every item. The error surfaces the misconfiguration before
    // the restore job gets created.
    if (scope === 'full' && !isPowerBiItem && !isPowerAppItem && !isPowerFlowItem && !isPowerDlpItem && workloads.size === 0) {
      setError(`Select at least one workload to restore (${availableWorkloads.join(', ')}).`);
      return;
    }
    if (isPowerBiItem) {
      if (destination === 'another' && !targetResourceId.trim()) {
        setError('Please select a target Power BI workspace');
        return;
      }
    } else if (isPowerAppItem || isPowerFlowItem) {
      if (destination === 'another' && !targetEnvironmentId.trim()) {
        setError('Please select a target environment');
        return;
      }
    } else if (isPowerDlpItem) {
      // DLP is tenant-scoped — only in-place restore is meaningful
    } else if (destination === 'another' && !targetUserId.trim()) {
      setError('Please enter a target resource ID');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Entra directory restore — delegated entirely to EntraRestoreForm selection
      if (resourceKind === 'entra_directory' && entraSelection) {
        const response = await RestoreService.triggerRestore({
          restoreType: 'IN_PLACE',
          snapshotIds,
          itemIds: entraSelection.recoverMode === 'selected' ? itemIds : [],
          recoverMode: entraSelection.recoverMode,
          entraSections: entraSelection.recoverMode === 'directory' ? entraSelection.sections : undefined,
          includeGroupMembership: entraSelection.includeGroupMembership,
          includeAuMembership: entraSelection.includeAuMembership,
        });
        setSuccess(response.jobId);
        return;
      }

      let restoreType: RestoreType;
      if (isPowerBiItem || isPowerAppItem || isPowerFlowItem) {
        restoreType = 'IN_PLACE';  // Power Platform uses IN_PLACE + targetEnvironmentId for cross-env
      } else if (isPowerDlpItem) {
        restoreType = 'IN_PLACE';
      } else {
        restoreType = destination === 'another' ? 'CROSS_USER' : 'IN_PLACE';
      }

      const response = await RestoreService.triggerRestore({
        restoreType,
        snapshotIds,
        itemIds: scope === 'selected' ? itemIds : [],
        targetUserId: !isPowerBiItem && !isPowerPlatformItem && destination === 'another' ? targetUserId : undefined,
        targetResourceId: isPowerBiItem && destination === 'another' ? targetResourceId : undefined,
        targetEnvironmentId: (isPowerAppItem || isPowerFlowItem) && destination === 'another' ? targetEnvironmentId : undefined,
        targetFolder: !isPowerBiItem && !isPowerPlatformItem && destination === 'original' && originalSub === 'separate_folder' ? folderName : undefined,
        overwrite: !isPowerBiItem && !isPowerPlatformItem && destination === 'original' && originalSub === 'overwrite',
        workloads: !isPowerBiItem && !isPowerPlatformItem && scope === 'full' ? Array.from(workloads) : undefined,
      });
      setSuccess(response.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  const dateLabel = snapshotDate
    ? fmtLocalDate(snapshotDate, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
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

        {(isPowerAppItem || isPowerFlowItem) && (
          <div className="restore-item-info">
            <strong>Note:</strong> Requires a {powerPlatformWorkload} package backup. Definition-only snapshots cannot be restored — re-run backup with package export enabled first.
          </div>
        )}

        {isPowerDlpItem && (
          <div className="restore-item-info">
            <strong>Note:</strong> DLP policies are tenant-wide. Restore replaces the current policy with the captured definition; review connector groups before confirming.
          </div>
        )}

        {resourceKind === 'entra_directory' ? (
          <div className="modal-columns">
            <EntraRestoreForm onChange={setEntraSelection} />
          </div>
        ) : (
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
                  {availableWorkloads.map(w => (
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

          {isPowerPlatformItem && (
            <div className="modal-col">
              <div className="radio-row">
                <span>
                  Recover {powerPlatformWorkload}
                  {itemName && <strong> ({itemName})</strong>}
                </span>
              </div>
            </div>
          )}

          {/* Right: Destination */}
          <div className="modal-col">
            <label className="radio-row">
              <input type="radio" checked={destination === 'original'} onChange={() => setDestination('original')} />
              <span>
                {isPowerBiItem
                  ? 'Recover to the original workspace'
                  : isPowerAppItem || isPowerFlowItem
                  ? 'Recover to the original environment'
                  : isPowerDlpItem
                  ? 'Restore policy tenant-wide'
                  : 'Recover to the original resource'}
              </span>
            </label>

            {!isPowerBiItem && !isPowerPlatformItem && destination === 'original' && (
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

            {!isPowerDlpItem && (
              <label className="radio-row">
                <input type="radio" checked={destination === 'another'} onChange={() => setDestination('another')} />
                <span>
                  {isPowerBiItem
                    ? 'Recover to another workspace'
                    : isPowerAppItem || isPowerFlowItem
                    ? 'Recover to another environment'
                    : 'Recover to another resource'}
                </span>
              </label>
            )}

            {destination === 'another' && !isPowerBiItem && !isPowerPlatformItem && (
              (resourceKind === 'mailbox' || resourceKind === 'shared_mailbox' || resourceKind === 'room_mailbox') ? (
                <>
                  <select
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    className="folder-input"
                    disabled={mailboxTargetsLoading}
                  >
                    <option value="">Select target mailbox</option>
                    {mailboxTargets.map((resource) => {
                      const kindLabel = resource.kind === 'shared_mailbox'
                        ? ' (shared)'
                        : resource.kind === 'room_mailbox'
                          ? ' (room)'
                          : '';
                      const label = resource.email
                        ? `${resource.name} <${resource.email}>${kindLabel}`
                        : `${resource.name}${kindLabel}`;
                      // Value is the resource row id (DB UUID), not the
                      // Graph external_id — a single external_id can be
                      // shared across MAILBOX / ENTRA_USER / CHAT_EXPORT
                      // rows for the same person, and the restore worker
                      // needs to know which flavor to target.
                      return (
                        <option key={resource.id} value={resource.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  {mailboxTargetsLoading && (
                    <div className="restore-item-info">Loading mailboxes…</div>
                  )}
                  {mailboxTargetsError && (
                    <div className="modal-error">{mailboxTargetsError}</div>
                  )}
                </>
              ) : (
                <input
                  className="folder-input"
                  placeholder="Target resource ID"
                  value={targetUserId}
                  onChange={e => setTargetUserId(e.target.value)}
                />
              )
            )}

            {destination === 'another' && (isPowerAppItem || isPowerFlowItem) && (
              <>
                <select
                  value={targetEnvironmentId}
                  onChange={(e) => setTargetEnvironmentId(e.target.value)}
                  className="folder-input"
                  disabled={pPlatformEnvsLoading}
                >
                  <option value="">Select target environment</option>
                  {pPlatformEnvs.map((env) => (
                    <option key={env.id} value={(env.external_id || '').replace(/^env_/, '')}>
                      {env.name}
                    </option>
                  ))}
                </select>
                {pPlatformEnvsLoading && (
                  <div className="restore-item-info">Loading available environments...</div>
                )}
                {pPlatformEnvsError && (
                  <div className="modal-error">{pPlatformEnvsError}</div>
                )}
              </>
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
        )}

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
