import { useEffect, useMemo, useState } from 'react';
import {
  type SlaPolicy,
  type SlaExclusion,
  createSlaPolicy,
  updateSlaPolicy,
  getExclusions,
  createExclusion,
  deleteExclusion,
} from '../services/sla';
import { useActiveBackend } from '../hooks/useActiveBackend';
import './SlaWizard.css';

// Day-count options shared by Retention and Archiving dropdowns.
// `null` means "Unlimited" — wizard sends null to the backend and the
// retention reconciler/cleanup treats null as "no delete rule".
const DAY_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null,  label: 'Unlimited' },
  { value: 7,     label: '7 days' },
  { value: 30,    label: '30 days' },
  { value: 90,    label: '90 days' },
  { value: 365,   label: '1 year' },
  { value: 1095,  label: '3 years' },
  { value: 2555,  label: '7 years' },
  { value: 3650,  label: '10 years' },
];

function dayOptionValue(v: number | null | undefined): string {
  return v == null ? 'UNLIMITED' : String(v);
}
function parseDayOption(s: string): number | null {
  return s === 'UNLIMITED' ? null : Number(s);
}

interface Props {
  tenantId: string;
  serviceType: 'm365' | 'azure';
  initialPolicy?: SlaPolicy | null;
  onClose: () => void;
  onSaved: (p: SlaPolicy) => void;
}

// Workload labels mirror afi.ai's "Data to back up" copy. Keys map to the
// SlaPolicy boolean flags in services/sla.ts.
const M365_WORKLOADS: Array<[keyof SlaPolicy, string]> = [
  ['backupExchange', 'Emails'],
  ['backupTeamsChats', 'Chats'],
  ['contacts', 'Contacts'],
  ['calendars', 'Calendars'],
  ['backupOneDrive', 'Drive & OneNote'],
  ['tasks', 'Tasks'],
  ['backupCopilot', 'Copilot'],
  ['backupSharepoint', 'SharePoint'],
  ['backupTeams', 'Team Channels'],
  ['groupMailbox', 'Group mailbox'],
  ['backupEntraId', 'Entra ID'],
  ['backupPowerPlatform', 'Power Platform'],
  ['planner', 'Planner'],
];

const AZURE_WORKLOADS: Array<[keyof SlaPolicy, string]> = [
  ['backupAzureVm', 'Azure Virtual Machines'],
  ['backupAzureSql', 'Azure SQL Databases'],
  ['backupAzurePostgresql', 'Azure PostgreSQL'],
];

// afi only exposes 1x/3x/Manual. Drop-down values mirror the backend strings.
const FREQUENCIES: Array<{ value: string; label: string }> = [
  { value: 'THREE_DAILY', label: '3x per day' },
  { value: 'DAILY',       label: '1x per day' },
  { value: 'MANUAL',      label: 'Manual' },
];

const DAYS: Array<[string, string]> = [
  ['MON', 'M'], ['TUE', 'T'], ['WED', 'W'], ['THU', 'T'],
  ['FRI', 'F'], ['SAT', 'S'], ['SUN', 'S'],
];

// Build a list of half-hour starts (12-hour clock) for the schedule dropdown.
const TIME_SLOTS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const period = h < 12 ? 'AM' : 'PM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const label = `${h12}:${String(m).padStart(2, '0')} ${period}`;
      out.push({ value, label });
    }
  }
  return out;
})();

// "GMT+5:30" style suffix derived from the browser's offset. afi shows the
// effective tz next to the start time so the operator sees what their pick
// resolves to in real time.
const tzLabel = (() => {
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? '+' : '−';
  const abs = Math.abs(off);
  return `GMT${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
})();

export default function SlaWizard({ tenantId, serviceType, initialPolicy, onClose, onSaved }: Props) {
  const isEdit = !!initialPolicy;
  const backend = useActiveBackend();
  const isAzure = backend.kind === 'azure_blob';
  const isSeaweed = backend.kind === 'seaweedfs';
  // True while backend is loading OR explicitly SeaweedFS OR unknown.
  // Drives Azure-only option gating: treat "unknown destination" as
  // SeaweedFS (safer default — never offers options that might vanish
  // when the backend resolves). isAzure-confirmed is the only state
  // that unlocks BYOK + WORM-Locked.
  const azureOnlyOptionsAllowed = isAzure && !backend.loading;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showExclusions, setShowExclusions] = useState(false);

  const [policy, setPolicy] = useState<Partial<SlaPolicy>>(() => {
    if (initialPolicy) return { ...initialPolicy };
    return {
      tenantId,
      serviceType,
      name: '',
      frequency: 'DAILY',
      backupDays: DAYS.map(([d]) => d),
      backupWindowStart: '21:00',
      backupExchange: true,
      backupOneDrive: true,
      backupSharepoint: true,
      backupTeams: true,
      contacts: true,
      calendars: true,
      groupMailbox: true,
      retentionMode: 'FLAT',
      retentionHotDays: 7,
      retentionCoolDays: 30,
      retentionArchiveDays: 365,
      archivedRetentionMode: 'SAME',
      encryptionMode: 'VAULT_MANAGED',
      autoApplyToMatching: false,
      enabled: true,
      isDefault: false,
    };
  });

  const [exclusions, setExclusions] = useState<SlaExclusion[]>([]);
  const [newExclusion, setNewExclusion] = useState<Partial<SlaExclusion>>({
    exclusionType: 'FOLDER_PATH', pattern: '', workload: 'ALL',
  });
  // Simple "show more" pagination for the exclusion list. Past ~200
  // rows DOM responsiveness drops; rather than pull a virtualization
  // library, render the first N and let the operator request the rest.
  // 50 covers the vast majority of policies in practice.
  const [exclusionsLimit, setExclusionsLimit] = useState(50);

  // WORM-Lock typed confirmation. Set true ONLY when the operator types
  // the exact policy name into the confirm modal — sent to the backend
  // alongside immutabilityMode='Locked'. The /api/v1/policies endpoint
  // refuses Locked saves without it (resource-service _gate_immutability_lock).
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockConfirmText, setLockConfirmText] = useState('');
  // Persisted typed name (kept across modal close) — sent to backend so
  // it can re-validate the typed name still matches policy.name at save.
  const [confirmedLockName, setConfirmedLockName] = useState<string>('');
  const [confirmImmutabilityLock, setConfirmImmutabilityLock] = useState(false);

  // Idempotency key for the entire wizard session: same key replays
  // produce the same created policy server-side. Regenerated only when
  // the wizard remounts (operator opens "New SLA" again).
  const [idemKey] = useState(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
    return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });
  // ETag for optimistic concurrency on update — captured at modal open;
  // sent back as If-Match so a concurrent edit elsewhere fails with 412
  // instead of silently overwriting our payload.
  const ifMatch = initialPolicy?.['updatedAt' as keyof SlaPolicy] as string | undefined
    || initialPolicy?.createdAt;
  // Was Locked already in effect when we loaded? Idempotent re-saves of
  // an already-Locked policy don't need a second confirmation.
  const initialLocked = (initialPolicy?.immutabilityMode === 'Locked');
  // Inline edit state — null when no row is being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<SlaExclusion>>({});

  // Local-only exclusions (created before the policy is saved) get a
  // `local-…` id so we can distinguish them from server rows. They're
  // POSTed after the policy is created in handleSave().
  const isLocalId = (id: string) => id.startsWith('local-');
  const newLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  useEffect(() => {
    if (initialPolicy?.id) {
      getExclusions(initialPolicy.id).then(setExclusions).catch(() => setExclusions([]));
    }
  }, [initialPolicy?.id]);

  // ESC closes the modal — afi.ai parity, also a WCAG escape route.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus trap for the WORM-Lock confirmation modal. While the modal
  // is open, Tab/Shift-Tab cycle within its focusable elements so the
  // operator can't accidentally interact with the wizard behind it
  // (which would let them edit the policy name and then click Lock
  // permanently — the very stale-confirm we already block, but it's
  // also a WCAG 2.4.3 / 2.1.2 requirement: focus must stay inside a
  // modal dialog).
  useEffect(() => {
    if (!lockConfirmOpen) return;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const modal = document.querySelector('.wiz-confirm-modal');
      if (!modal) return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !(el as HTMLButtonElement).disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !modal.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trap);
    return () => window.removeEventListener('keydown', trap);
  }, [lockConfirmOpen]);

  function patch(p: Partial<SlaPolicy>) { setPolicy(prev => ({ ...prev, ...p })); }

  async function handleSave() {
    if (!policy.name?.trim()) { setError('Please enter a policy name'); return; }
    // Defense in depth: if dropdown somehow has Locked without confirmation
    // (shouldn't be possible given the modal gate, but defensive), block.
    if (policy.immutabilityMode === 'Locked' && !initialLocked && !confirmImmutabilityLock) {
      setError('Locked (WORM) requires typed confirmation before saving.');
      setLockConfirmOpen(true);
      return;
    }
    setSaving(true); setError(null);
    // Pass the confirm flag AND the typed name through; backend refuses
    // Locked without both, and rejects if typed name doesn't match the
    // current policy.name (defends against rename-after-confirmation).
    const payload: Partial<SlaPolicy> & {
      confirmImmutabilityLock?: boolean;
      immutabilityLockTypedName?: string;
    } = {
      ...policy,
      ...(confirmImmutabilityLock && policy.immutabilityMode === 'Locked'
        ? {
            confirmImmutabilityLock: true,
            // Send the name the operator typed in the confirm modal —
            // backend re-validates it equals the current policy.name so
            // a rename after confirmation re-prompts.
            immutabilityLockTypedName: confirmedLockName || (policy.name || '').trim(),
          }
        : {}),
    };
    try {
      const saved = isEdit && initialPolicy?.id
        ? await updateSlaPolicy(initialPolicy.id, payload as any, { ifMatch })
        : await createSlaPolicy(payload as any, { idempotencyKey: idemKey });

      // Flush any locally-buffered exclusions to the now-saved policy.
      const pending = exclusions.filter(x => isLocalId(x.id));
      if (pending.length && saved.id) {
        await Promise.all(pending.map(x =>
          createExclusion(saved.id, {
            exclusionType: x.exclusionType,
            pattern: x.pattern,
            workload: x.workload ?? 'ALL',
          }).catch(() => null)
        ));
      }
      onSaved(saved);
      onClose();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addExclusion() {
    if (!newExclusion.pattern?.trim()) return;
    const policyId = initialPolicy?.id;
    setError(null);
    try {
      if (policyId) {
        const created = await createExclusion(policyId, newExclusion);
        setExclusions(prev => [...prev, created]);
      } else {
        // Buffer locally — flushed in handleSave() after the policy is created.
        const local: SlaExclusion = {
          id: newLocalId(),
          policyId: '',
          exclusionType: (newExclusion.exclusionType as SlaExclusion['exclusionType']) || 'FOLDER_PATH',
          pattern: newExclusion.pattern!.trim(),
          workload: (newExclusion.workload as SlaExclusion['workload']) ?? 'ALL',
        };
        setExclusions(prev => [...prev, local]);
      }
      setNewExclusion({ exclusionType: 'FOLDER_PATH', pattern: '', workload: 'ALL' });
    } catch (e: any) { setError(e.message); }
  }

  async function removeExclusion(id: string) {
    if (isLocalId(id)) {
      setExclusions(prev => prev.filter(x => x.id !== id));
      return;
    }
    if (!initialPolicy?.id) return;
    try {
      await deleteExclusion(initialPolicy.id, id);
      setExclusions(prev => prev.filter(x => x.id !== id));
    } catch (e: any) { setError(e.message); }
  }

  function startEdit(x: SlaExclusion) {
    setEditingId(x.id);
    setEditDraft({ exclusionType: x.exclusionType, pattern: x.pattern, workload: x.workload ?? 'ALL' });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  // Save an inline edit. Local rows mutate in place; server rows are
  // delete+create since the API doesn't expose PUT for exclusions.
  async function saveEdit(id: string) {
    if (!editDraft.pattern?.trim()) { cancelEdit(); return; }
    const policyId = initialPolicy?.id;
    setError(null);
    try {
      if (isLocalId(id) || !policyId) {
        setExclusions(prev => prev.map(x => x.id === id ? { ...x, ...editDraft } as SlaExclusion : x));
      } else {
        await deleteExclusion(policyId, id);
        const created = await createExclusion(policyId, editDraft);
        setExclusions(prev => prev.map(x => x.id === id ? created : x));
      }
      cancelEdit();
    } catch (e: any) { setError(e.message); }
  }

  const workloadList = serviceType === 'azure' ? AZURE_WORKLOADS : M365_WORKLOADS;

  // Retention summary mirrors afi: "Unlimited" when everything ≥ a year,
  // otherwise show the hot-tier number. Drives the compact dropdown view.
  const retentionLabel = useMemo(() => {
    if (policy.retentionMode === 'GFS') return 'GFS';
    const d = policy.retentionHotDays ?? 0;
    if (!d) return 'Unlimited';
    if (d >= 365 * 99) return 'Unlimited';
    return `${d} day${d === 1 ? '' : 's'}`;
  }, [policy.retentionMode, policy.retentionHotDays]);

  const archivingLabel = useMemo(() => {
    const d = policy.retentionArchiveDays;
    if (!d) return 'Unlimited';
    return `${d} day${d === 1 ? '' : 's'}`;
  }, [policy.retentionArchiveDays]);

  return (
    <div className="wiz-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="wiz-title">
      <div className="wiz-modal" onClick={e => e.stopPropagation()}>
        <div className="wiz-header">
          <div>
            <h2 id="wiz-title" className="wiz-title">
              {isEdit ? `Edit policy — ${initialPolicy?.name}` : 'New SLA policy'}
            </h2>
            <p className="wiz-subtitle">Define backup scope, schedule and retention for this tenant.</p>
          </div>
          <button
            className="wiz-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </div>

        <div className="wiz-body">
          {/* Backup destination banner. While the active backend is
              loading we render a skeleton — operators must NOT see WORM
              or BYOK options before we know whether Azure or SeaweedFS
              is active, otherwise they could choose Azure-only options
              that vanish when the backend resolves. */}
          {backend.loading ? (
            <div className="wiz-dest wiz-dest-loading" aria-busy="true">
              <span className="wiz-dest-dot wiz-skeleton-dot" />
              <span className="wiz-skeleton-line">Loading backup destination…</span>
            </div>
          ) : backend.error ? (
            <div className="wiz-dest" role="alert" style={{ borderColor: 'var(--wiz-warn)', color: 'var(--wiz-warn)' }}>
              <span className="wiz-dest-dot" style={{ background: 'var(--wiz-warn)' }} />
              <span>
                <strong>Backup destination:</strong> unable to determine —
                some Azure-only options are temporarily hidden.
              </span>
            </div>
          ) : backend.kind ? (
            <div className={`wiz-dest ${isAzure ? 'azure' : 'seaweed'}`}>
              <span className="wiz-dest-dot" />
              <span>
                <strong>Backup destination:</strong>{' '}
                {isAzure
                  ? `Azure Blob — ${backend.name}`
                  : isSeaweed
                  ? 'SeaweedFS (on-prem)'
                  : backend.name || 'Unknown'}
              </span>
            </div>
          ) : null}

          {/* Name */}
          <div className="wiz-field">
            <label htmlFor="wiz-name" className="wiz-field-label">Name:</label>
            <div className="wiz-field-stack">
              <input
                id="wiz-name"
                type="text"
                value={policy.name || ''}
                onChange={e => {
                  const newName = e.target.value;
                  patch({ name: newName });
                  // If the operator already typed the lock-confirmation
                  // and then renames the policy, the typed name is now
                  // stale and the backend will refuse the save with
                  // "typed name does not match". Clear here so the UI
                  // forces a re-confirmation BEFORE the failed POST.
                  if (confirmImmutabilityLock && confirmedLockName &&
                      confirmedLockName !== newName.trim()) {
                    setConfirmImmutabilityLock(false);
                    setConfirmedLockName('');
                  }
                }}
                placeholder="e.g. Gold, Compliance, HR-Hourly"
                className={!policy.name?.trim() && error ? 'wiz-required-empty' : ''}
                autoFocus
              />
              {!policy.name?.trim() && (
                <span className="wiz-help">Please enter a policy name</span>
              )}
            </div>
          </div>

          {/* Data to back up */}
          <div className="wiz-section">
            <span className="wiz-section-label">Data to back up:</span>
            <div className="wiz-workload-grid" role="group" aria-label="Workloads to back up">
              {workloadList.map(([key, label]) => (
                <label key={key as string} className="wiz-check">
                  <input
                    type="checkbox"
                    checked={!!(policy as any)[key]}
                    onChange={e => patch({ [key]: e.target.checked } as any)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Exclusions */}
          <div className="wiz-section">
            <span className="wiz-section-label">
              Exclusions <span className="wiz-info" title="Patterns to exclude from backup (paths, extensions, addresses).">i</span>:
              {!showExclusions && (
                <button
                  type="button"
                  className="wiz-link"
                  style={{ marginLeft: 6 }}
                  onClick={() => setShowExclusions(true)}
                >+ add</button>
              )}
            </span>
            {showExclusions && (
              <>
                {!isEdit && (
                  <span className="wiz-help">
                    Exclusions you add now are saved to the policy when you click Save.
                  </span>
                )}
                <div className="wiz-excl-add">
                  <select
                    value={newExclusion.exclusionType}
                    onChange={e => setNewExclusion(p => ({ ...p, exclusionType: e.target.value as any }))}
                    aria-label="Exclusion type"
                  >
                    <option value="FOLDER_PATH">Folder path contains</option>
                    <option value="FILE_EXTENSION">File extension</option>
                    <option value="FILENAME_GLOB">Filename glob</option>
                    <option value="MIME_TYPE">MIME type</option>
                    <option value="SUBJECT_REGEX">Subject regex</option>
                    <option value="EMAIL_ADDRESS">Email address</option>
                  </select>
                  <input
                    type="text"
                    placeholder="pattern (e.g. Drafts, .pst, *.bak)"
                    value={newExclusion.pattern || ''}
                    onChange={e => setNewExclusion(p => ({ ...p, pattern: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExclusion(); } }}
                  />
                  <select
                    value={newExclusion.workload || 'ALL'}
                    onChange={e => setNewExclusion(p => ({ ...p, workload: e.target.value as any }))}
                    aria-label="Apply to workload"
                  >
                    <option value="ALL">All</option>
                    <option value="EMAIL">Email</option>
                    <option value="FILE">Files</option>
                    <option value="CALENDAR">Calendar</option>
                    <option value="CONTACT">Contacts</option>
                  </select>
                  <button
                    type="button"
                    className="wiz-btn small primary"
                    onClick={addExclusion}
                    disabled={!newExclusion.pattern?.trim()}
                  >Add</button>
                </div>
                <ul className="wiz-excl-list">
                  {exclusions.length === 0 ? (
                    <li className="wiz-excl-empty">No exclusions yet — every item is backed up.</li>
                  ) : exclusions.slice(0, exclusionsLimit).map(x => editingId === x.id ? (
                    <li key={x.id} className="editing">
                      <select
                        value={editDraft.exclusionType}
                        onChange={e => setEditDraft(p => ({ ...p, exclusionType: e.target.value as any }))}
                        aria-label="Exclusion type"
                      >
                        <option value="FOLDER_PATH">Folder path contains</option>
                        <option value="FILE_EXTENSION">File extension</option>
                        <option value="FILENAME_GLOB">Filename glob</option>
                        <option value="MIME_TYPE">MIME type</option>
                        <option value="SUBJECT_REGEX">Subject regex</option>
                        <option value="EMAIL_ADDRESS">Email address</option>
                      </select>
                      <input
                        type="text"
                        value={editDraft.pattern || ''}
                        onChange={e => setEditDraft(p => ({ ...p, pattern: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveEdit(x.id); }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                        }}
                        autoFocus
                      />
                      <select
                        value={editDraft.workload || 'ALL'}
                        onChange={e => setEditDraft(p => ({ ...p, workload: e.target.value as any }))}
                        aria-label="Apply to workload"
                      >
                        <option value="ALL">All</option>
                        <option value="EMAIL">Email</option>
                        <option value="FILE">Files</option>
                        <option value="CALENDAR">Calendar</option>
                        <option value="CONTACT">Contacts</option>
                      </select>
                      <span className="wiz-excl-actions">
                        <button className="wiz-link" onClick={() => saveEdit(x.id)}>Save</button>
                        <button className="wiz-link danger" onClick={cancelEdit}>Cancel</button>
                      </span>
                    </li>
                  ) : (
                    <li key={x.id}>
                      <span className="wiz-excl-type">{x.exclusionType}</span>
                      <code>{x.pattern}</code>
                      <span className="wiz-excl-wl">{x.workload || 'ALL'}</span>
                      <span className="wiz-excl-actions">
                        <button className="wiz-link" onClick={() => startEdit(x)}>Edit</button>
                        <button className="wiz-link danger" onClick={() => removeExclusion(x.id)}>Remove</button>
                      </span>
                    </li>
                  ))}
                  {exclusions.length > exclusionsLimit && (
                    <li className="wiz-excl-empty" style={{ fontStyle: 'normal' }}>
                      Showing {exclusionsLimit} of {exclusions.length}.{' '}
                      <button
                        type="button"
                        className="wiz-link"
                        onClick={() => setExclusionsLimit(n => n + 100)}
                      >Show 100 more</button>
                      {' · '}
                      <button
                        type="button"
                        className="wiz-link"
                        onClick={() => setExclusionsLimit(exclusions.length)}
                      >Show all ({exclusions.length})</button>
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>

          {/* Schedule */}
          <div className="wiz-section">
            <span className="wiz-section-label">Schedule:</span>
            <div className="wiz-field">
              <span className="wiz-field-label">Frequency:</span>
              <div className="wiz-inline">
                <select
                  value={policy.frequency || 'DAILY'}
                  onChange={e => patch({ frequency: e.target.value })}
                  aria-label="Frequency"
                >
                  {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </div>
            <div className="wiz-field">
              <span className="wiz-field-label">Day:</span>
              <div className="wiz-days" role="group" aria-label="Backup days">
                {DAYS.map(([code, letter]) => {
                  const on = !!policy.backupDays?.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`wiz-day ${on ? 'on' : ''}`}
                      onClick={() => {
                        const cur = new Set(policy.backupDays || []);
                        if (on) cur.delete(code); else cur.add(code);
                        patch({ backupDays: Array.from(cur) });
                      }}
                      aria-pressed={on}
                      aria-label={code}
                    >{letter}</button>
                  );
                })}
              </div>
            </div>
            <div className="wiz-field">
              <span className="wiz-field-label">
                Starts at <span className="wiz-info" title="Local backup window start. Jitter is applied per policy to spread load.">i</span>:
              </span>
              <div className="wiz-inline">
                <select
                  value={policy.backupWindowStart || '21:00'}
                  onChange={e => patch({ backupWindowStart: e.target.value })}
                  aria-label="Window start"
                >
                  {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <span className="wiz-tz">{tzLabel}</span>
              </div>
            </div>
          </div>

          {/* Retention */}
          <div className="wiz-section">
            <div className="wiz-field">
              <span className="wiz-field-label">
                Retention <span className="wiz-info" title="How long primary (Hot-tier) snapshots are kept before tiering down.">i</span>:
              </span>
              <select
                value={policy.retentionMode === 'GFS' ? 'GFS' : dayOptionValue(policy.retentionHotDays)}
                onChange={e => {
                  const v = e.target.value;
                  if (v === 'GFS') {
                    patch({ retentionMode: 'GFS' });
                  } else {
                    patch({ retentionMode: 'FLAT', retentionHotDays: parseDayOption(v) ?? undefined });
                  }
                }}
              >
                {DAY_OPTIONS.map(o => <option key={dayOptionValue(o.value)} value={dayOptionValue(o.value)}>{o.label}</option>)}
                <option value="GFS">Grandfather/Father/Son</option>
              </select>
            </div>
            <div className="wiz-field">
              <span className="wiz-field-label">
                Archived data <span className="wiz-info" title="What happens to backups when the source resource (mailbox, drive, user) is removed from M365.">i</span>:
              </span>
              <div className="wiz-field-stack">
                <select
                  value={policy.archivedRetentionMode || 'SAME'}
                  onChange={e => patch({ archivedRetentionMode: e.target.value as any })}
                >
                  <option value="SAME">Same retention rules</option>
                  <option value="KEEP_ALL">Never delete</option>
                  <option value="KEEP_LAST">Keep most recent only</option>
                  <option value="CUSTOM">Custom (days)</option>
                </select>
                {policy.archivedRetentionMode === 'CUSTOM' && (
                  <input
                    type="number"
                    min={1}
                    placeholder="days to keep archived backups"
                    value={policy.archivedRetentionDays ?? ''}
                    onChange={e => patch({ archivedRetentionDays: e.target.value ? +e.target.value : null })}
                  />
                )}
              </div>
            </div>
            <div className="wiz-field">
              <span className="wiz-field-label">
                Archiving <span className="wiz-info" title="Long-term retention after the cool window. Data stays queryable — no rehydration needed.">i</span>:
              </span>
              <select
                value={dayOptionValue(policy.retentionArchiveDays)}
                onChange={e => patch({ retentionArchiveDays: parseDayOption(e.target.value) })}
              >
                {DAY_OPTIONS.map(o => <option key={dayOptionValue(o.value)} value={dayOptionValue(o.value)}>{o.label}</option>)}
              </select>
            </div>
            <div className="wiz-field">
              <span className="wiz-field-label">Encryption key:</span>
              <div className="wiz-field-stack">
                <select
                  value={policy.encryptionMode || 'VAULT_MANAGED'}
                  onChange={e => patch({ encryptionMode: e.target.value as any })}
                  disabled={!azureOnlyOptionsAllowed}
                  title={
                    backend.loading
                      ? 'Loading backup destination…'
                      : !isAzure
                      ? 'Customer-managed keys require Azure backend'
                      : undefined
                  }
                >
                  <option value="VAULT_MANAGED">Service-managed encryption key</option>
                  {azureOnlyOptionsAllowed && (
                    <option value="CUSTOMER_KEY">Customer-managed key (BYOK)</option>
                  )}
                </select>
                {azureOnlyOptionsAllowed && policy.encryptionMode === 'CUSTOMER_KEY' && (
                  <>
                    <input
                      type="text"
                      placeholder="Key Vault URI (https://my-vault.vault.azure.net)"
                      value={policy.keyVaultUri || ''}
                      onChange={e => patch({ keyVaultUri: e.target.value || null })}
                    />
                    <input
                      type="text"
                      placeholder="Key name"
                      value={policy.keyName || ''}
                      onChange={e => patch({ keyName: e.target.value || null })}
                    />
                    <input
                      type="text"
                      placeholder="Key version (leave blank for latest)"
                      value={policy.keyVersion || ''}
                      onChange={e => patch({ keyVersion: e.target.value || null })}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Advanced */}
          <div className="wiz-advanced">
            <button
              type="button"
              className={`wiz-advanced-toggle ${showAdvanced ? 'open' : ''}`}
              onClick={() => setShowAdvanced(s => !s)}
              aria-expanded={showAdvanced}
            >
              <span className="chev">›</span>
              {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
            </button>
            {showAdvanced && (
              <div className="wiz-advanced-content">
                {policy.retentionMode === 'GFS' && (
                  <div className="wiz-grid-4">
                    <label className="wiz-field"><span className="wiz-field-label">Daily</span>
                      <input type="number" min={0} value={policy.gfsDailyCount ?? 0} onChange={e => patch({ gfsDailyCount: +e.target.value })} />
                    </label>
                    <label className="wiz-field"><span className="wiz-field-label">Weekly</span>
                      <input type="number" min={0} value={policy.gfsWeeklyCount ?? 0} onChange={e => patch({ gfsWeeklyCount: +e.target.value })} />
                    </label>
                    <label className="wiz-field"><span className="wiz-field-label">Monthly</span>
                      <input type="number" min={0} value={policy.gfsMonthlyCount ?? 0} onChange={e => patch({ gfsMonthlyCount: +e.target.value })} />
                    </label>
                    <label className="wiz-field"><span className="wiz-field-label">Yearly</span>
                      <input type="number" min={0} value={policy.gfsYearlyCount ?? 0} onChange={e => patch({ gfsYearlyCount: +e.target.value })} />
                    </label>
                  </div>
                )}
                <div className="wiz-grid-3">
                  <label className="wiz-field"><span className="wiz-field-label">Hot days</span>
                    <input type="number" min={0} value={policy.retentionHotDays ?? 0} onChange={e => patch({ retentionHotDays: +e.target.value })} />
                  </label>
                  <label className="wiz-field"><span className="wiz-field-label">Cool days</span>
                    <input type="number" min={0} value={policy.retentionCoolDays ?? 0} onChange={e => patch({ retentionCoolDays: +e.target.value })} />
                  </label>
                  <label className="wiz-field"><span className="wiz-field-label">Archive days</span>
                    <input type="number" min={0} value={policy.retentionArchiveDays ?? 0} onChange={e => patch({ retentionArchiveDays: +e.target.value || (null as any) })} />
                  </label>
                </div>
                <div className="wiz-field">
                  <span className="wiz-field-label">Immutability</span>
                  <select
                    value={policy.immutabilityMode || 'None'}
                    onChange={e => {
                      const next = e.target.value as any;
                      // Selecting Locked is irreversible. Only commit the
                      // value AFTER the operator confirms by typing the
                      // policy name — until then, leave the dropdown
                      // visually selected on Locked but the underlying
                      // state at the prior value, and open the modal.
                      if (next === 'Locked' && !initialLocked) {
                        setLockConfirmOpen(true);
                        setLockConfirmText('');
                        return;
                      }
                      patch({ immutabilityMode: next });
                      // Toggling away from Locked must drop ALL stale
                      // confirmation state. Otherwise an operator who
                      // typed the name, then switched to Unlocked, then
                      // switched back to Locked could re-arrive at a
                      // pre-confirmed state without re-typing — defeating
                      // the entire two-factor lock gate.
                      if (next !== 'Locked') {
                        setConfirmImmutabilityLock(false);
                        setConfirmedLockName('');
                        setLockConfirmText('');
                      }
                    }}
                  >
                    <option value="None">None</option>
                    <option value="Unlocked">Unlocked (user-managed)</option>
                    <option value="Locked" disabled={!azureOnlyOptionsAllowed}>
                      Locked (WORM){
                        backend.loading ? ' — loading…'
                          : !isAzure ? ' — Azure-only' : ''
                      }
                    </option>
                  </select>
                  {policy.immutabilityMode === 'Locked' && !initialLocked && confirmImmutabilityLock && (
                    <span className="wiz-help" style={{ color: 'var(--wiz-warn)' }}>
                      ⚠ This policy will be Locked (WORM) on save. Cannot be undone.
                    </span>
                  )}
                </div>
                <label className="wiz-check">
                  <input type="checkbox" checked={!!policy.legalHoldEnabled} onChange={e => patch({ legalHoldEnabled: e.target.checked })} />
                  <span>Legal hold (block all deletions)</span>
                </label>
                <label className="wiz-check">
                  <input type="checkbox" checked={!!policy.autoApplyToMatching} onChange={e => patch({ autoApplyToMatching: e.target.checked })} />
                  <span>Auto-apply to matching resources (resource groups)</span>
                </label>
                <label className="wiz-check">
                  <input type="checkbox" checked={!!policy.isDefault} onChange={e => patch({ isDefault: e.target.checked })} />
                  <span>Set as the default policy for this tenant</span>
                </label>
              </div>
            )}
          </div>

          {/* Read-only summary preserved for screen readers */}
          <span className="wiz-help" aria-live="polite">
            Retention: {retentionLabel} · Archiving: {archivingLabel}
          </span>
        </div>

        {error && (
          <div
            className="wiz-error"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >{error}</div>
        )}

        <div className="wiz-footer">
          <button className="wiz-btn ghost" onClick={onClose}>Cancel</button>
          <button className="wiz-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {lockConfirmOpen && (
        <div
          className="wiz-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wiz-lock-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wiz-confirm-modal">
            <h3 id="wiz-lock-title" className="wiz-confirm-title">
              Lock (WORM) is irreversible
            </h3>
            <p className="wiz-confirm-body">
              Once saved with <strong>Locked</strong>, no one — including you,
              admins, or Anthropic support — can delete blobs in this policy's
              containers until the immutability period expires
              ({((policy.retentionHotDays ?? 0) +
                 (policy.retentionCoolDays ?? 0) +
                 (policy.retentionArchiveDays ?? 0)) || 'cumulative retention'}{' '}
              days). The policy itself cannot be loosened or removed.
            </p>
            <p className="wiz-confirm-body">
              Type the policy name <code>{policy.name || '(set name first)'}</code>{' '}
              to confirm:
            </p>
            <input
              type="text"
              autoFocus
              className="wiz-confirm-input"
              value={lockConfirmText}
              onChange={(e) => setLockConfirmText(e.target.value)}
              placeholder="Type policy name to confirm"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setLockConfirmOpen(false);
                  setLockConfirmText('');
                }
              }}
            />
            <div className="wiz-confirm-actions">
              <button
                className="wiz-btn ghost"
                onClick={() => {
                  setLockConfirmOpen(false);
                  setLockConfirmText('');
                }}
              >Cancel</button>
              <button
                className="wiz-btn primary"
                disabled={
                  !policy.name?.trim() ||
                  lockConfirmText.trim() !== (policy.name || '').trim()
                }
                onClick={() => {
                  setConfirmImmutabilityLock(true);
                  setConfirmedLockName(lockConfirmText.trim());
                  patch({ immutabilityMode: 'Locked' });
                  setLockConfirmOpen(false);
                  setLockConfirmText('');
                }}
              >Lock permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
