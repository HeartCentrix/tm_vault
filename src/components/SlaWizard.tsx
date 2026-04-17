import { useEffect, useState } from 'react';
import {
  type SlaPolicy,
  type SlaExclusion,
  createSlaPolicy,
  updateSlaPolicy,
  getExclusions,
  createExclusion,
  deleteExclusion,
} from '../services/sla';
import './SlaWizard.css';

type Step = 'tier' | 'workloads' | 'schedule' | 'retention' | 'exclusions' | 'storage';

interface Props {
  tenantId: string;
  serviceType: 'm365' | 'azure';
  initialPolicy?: SlaPolicy | null;
  onClose: () => void;
  onSaved: (p: SlaPolicy) => void;
}

const PRESETS = [
  { key: 'gold',   name: 'Gold',   freq: 'HOURLY', retentionMode: 'GFS' as const,
    gfsDailyCount: 14, gfsWeeklyCount: 8, gfsMonthlyCount: 12, gfsYearlyCount: 7,
    retentionHotDays: 30, retentionCoolDays: 180, retentionArchiveDays: 2555 },
  { key: 'silver', name: 'Silver', freq: 'DAILY',  retentionMode: 'GFS' as const,
    gfsDailyCount: 7, gfsWeeklyCount: 4, gfsMonthlyCount: 12, gfsYearlyCount: 3,
    retentionHotDays: 14, retentionCoolDays: 90, retentionArchiveDays: 1095 },
  { key: 'bronze', name: 'Bronze', freq: 'WEEKLY', retentionMode: 'FLAT' as const,
    retentionHotDays: 7, retentionCoolDays: 30, retentionArchiveDays: 365 },
  { key: 'manual', name: 'Manual / Custom', freq: 'MANUAL', retentionMode: 'FLAT' as const,
    retentionHotDays: 7, retentionCoolDays: 30, retentionArchiveDays: 90 },
];

const M365_WORKLOADS: Array<[keyof SlaPolicy, string]> = [
  ['backupExchange', 'Exchange (mail)'],
  ['contacts', 'Contacts'],
  ['calendars', 'Calendars'],
  ['backupOneDrive', 'OneDrive'],
  ['backupSharepoint', 'SharePoint'],
  ['backupTeams', 'Teams Channels'],
  ['backupTeamsChats', 'Teams Chats'],
  ['groupMailbox', 'Group Mailbox'],
  ['planner', 'Planner'],
  ['tasks', 'To Do'],
  ['backupEntraId', 'Entra ID'],
  ['backupPowerPlatform', 'Power Platform'],
  ['backupCopilot', 'Copilot'],
];

const AZURE_WORKLOADS: Array<[keyof SlaPolicy, string]> = [
  ['backupAzureVm', 'Azure Virtual Machines'],
  ['backupAzureSql', 'Azure SQL Databases'],
  ['backupAzurePostgresql', 'Azure PostgreSQL'],
];

const FREQUENCIES = ['HOURLY', '4x', '2x', 'DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const STEP_ORDER: Step[] = ['tier', 'workloads', 'schedule', 'retention', 'exclusions', 'storage'];
const STEP_LABELS: Record<Step, string> = {
  tier: 'Tier',
  workloads: 'Workloads',
  schedule: 'Schedule',
  retention: 'Retention',
  exclusions: 'Exclusions',
  storage: 'Storage',
};

export default function SlaWizard({ tenantId, serviceType, initialPolicy, onClose, onSaved }: Props) {
  const isEdit = !!initialPolicy;
  const [step, setStep] = useState<Step>(isEdit ? 'workloads' : 'tier');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [policy, setPolicy] = useState<Partial<SlaPolicy>>(() => {
    if (initialPolicy) return { ...initialPolicy };
    return {
      tenantId,
      serviceType,
      name: '',
      frequency: 'DAILY',
      backupDays: [...DAYS],
      backupWindowStart: '21:00',
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

  // Load existing exclusions when editing
  useEffect(() => {
    if (initialPolicy?.id) {
      getExclusions(initialPolicy.id).then(setExclusions).catch(() => setExclusions([]));
    }
  }, [initialPolicy?.id]);

  function patch(p: Partial<SlaPolicy>) { setPolicy(prev => ({ ...prev, ...p })); }

  function applyPreset(presetKey: string) {
    const p = PRESETS.find(x => x.key === presetKey);
    if (!p) return;
    patch({
      name: policy.name || p.name,
      frequency: p.freq,
      retentionMode: p.retentionMode,
      gfsDailyCount: p.gfsDailyCount,
      gfsWeeklyCount: p.gfsWeeklyCount,
      gfsMonthlyCount: p.gfsMonthlyCount,
      gfsYearlyCount: p.gfsYearlyCount,
      retentionHotDays: p.retentionHotDays,
      retentionCoolDays: p.retentionCoolDays,
      retentionArchiveDays: p.retentionArchiveDays,
    });
  }

  async function handleSave() {
    if (!policy.name?.trim()) { setError('Name is required'); setStep('tier'); return; }
    setSaving(true); setError(null);
    try {
      const saved = isEdit && initialPolicy?.id
        ? await updateSlaPolicy(initialPolicy.id, policy)
        : await createSlaPolicy(policy);

      // Persist exclusion edits — only newly-added ones (existing ones already saved)
      // We track adds via items without id; deletes happen inline via removeExclusion()
      onSaved(saved);
      onClose();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addExclusion() {
    const policyId = initialPolicy?.id;
    if (!policyId) {
      setError('Save the policy first, then add exclusions.');
      return;
    }
    if (!newExclusion.pattern?.trim()) return;
    try {
      const created = await createExclusion(policyId, newExclusion);
      setExclusions(prev => [...prev, created]);
      setNewExclusion({ exclusionType: 'FOLDER_PATH', pattern: '', workload: 'ALL' });
    } catch (e: any) { setError(e.message); }
  }

  async function removeExclusion(id: string) {
    if (!initialPolicy?.id) return;
    try {
      await deleteExclusion(initialPolicy.id, id);
      setExclusions(prev => prev.filter(x => x.id !== id));
    } catch (e: any) { setError(e.message); }
  }

  const workloadList = serviceType === 'azure' ? AZURE_WORKLOADS : M365_WORKLOADS;
  const stepIdx = STEP_ORDER.indexOf(step);

  return (
    <div className="wiz-overlay" onClick={onClose}>
      <div className="wiz-modal" onClick={e => e.stopPropagation()}>
        <div className="wiz-header">
          <h2>{isEdit ? `Edit policy — ${initialPolicy?.name}` : 'New SLA policy'}</h2>
          <button className="wiz-close" onClick={onClose}>×</button>
        </div>

        <div className="wiz-stepper">
          {STEP_ORDER.map((s, i) => (
            <button
              key={s}
              className={`wiz-step-pill ${s === step ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`}
              onClick={() => setStep(s)}
            >
              <span className="wiz-step-num">{i + 1}</span>
              <span>{STEP_LABELS[s]}</span>
            </button>
          ))}
        </div>

        <div className="wiz-body">
          {step === 'tier' && (
            <>
              <label className="wiz-row">
                <span>Policy name</span>
                <input
                  type="text"
                  value={policy.name || ''}
                  onChange={e => patch({ name: e.target.value })}
                  placeholder="e.g. Gold, Compliance, HR-Hourly"
                />
              </label>
              <p className="wiz-hint">Pick a starting tier — you can fine-tune everything in the next steps.</p>
              <div className="wiz-tier-grid">
                {PRESETS.map(p => (
                  <button key={p.key} className="wiz-tier-card" onClick={() => applyPreset(p.key)}>
                    <div className="wiz-tier-name">{p.name}</div>
                    <div className="wiz-tier-meta">
                      <div>{p.freq}</div>
                      <div>{p.retentionMode}</div>
                      {p.retentionMode === 'GFS' && (
                        <div>{p.gfsDailyCount}d / {p.gfsWeeklyCount}w / {p.gfsMonthlyCount}m / {p.gfsYearlyCount}y</div>
                      )}
                      {p.retentionMode === 'FLAT' && (
                        <div>Hot {p.retentionHotDays}d / Cool {p.retentionCoolDays}d / Archive {p.retentionArchiveDays}d</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <label className="wiz-row inline">
                <input type="checkbox" checked={!!policy.isDefault} onChange={e => patch({ isDefault: e.target.checked })} />
                <span>Set as the default policy for this tenant</span>
              </label>
            </>
          )}

          {step === 'workloads' && (
            <>
              <p className="wiz-hint">Pick which content types this policy backs up. Unchecked workloads are skipped.</p>
              <div className="wiz-workload-grid">
                {workloadList.map(([key, label]) => (
                  <label key={key as string} className="wiz-row inline">
                    <input
                      type="checkbox"
                      checked={!!(policy as any)[key]}
                      onChange={e => patch({ [key]: e.target.checked } as any)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {step === 'schedule' && (
            <>
              <label className="wiz-row">
                <span>Frequency</span>
                <select value={policy.frequency || 'DAILY'} onChange={e => patch({ frequency: e.target.value })}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="wiz-row">
                <span>Backup days</span>
                <div className="wiz-day-row">
                  {DAYS.map(d => {
                    const on = policy.backupDays?.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`wiz-day-pill ${on ? 'on' : ''}`}
                        onClick={() => {
                          const cur = new Set(policy.backupDays || []);
                          if (on) cur.delete(d); else cur.add(d);
                          patch({ backupDays: Array.from(cur) });
                        }}
                      >{d}</button>
                    );
                  })}
                </div>
              </label>
              <label className="wiz-row">
                <span>Window start</span>
                <input type="time" value={policy.backupWindowStart || ''} onChange={e => patch({ backupWindowStart: e.target.value })} />
              </label>
              <label className="wiz-row">
                <span>Window end</span>
                <input type="time" value={policy.backupWindowEnd || ''} onChange={e => patch({ backupWindowEnd: e.target.value })} />
              </label>
            </>
          )}

          {step === 'retention' && (
            <>
              <label className="wiz-row">
                <span>Retention mode</span>
                <select value={policy.retentionMode || 'FLAT'} onChange={e => patch({ retentionMode: e.target.value as any })}>
                  <option value="FLAT">FLAT — keep snapshots for N days</option>
                  <option value="GFS">GFS — Grandfather/Father/Son</option>
                  <option value="ITEM_LEVEL">ITEM_LEVEL — per-item cutoff</option>
                  <option value="HYBRID">HYBRID — FLAT + per-item</option>
                </select>
              </label>

              {policy.retentionMode === 'GFS' && (
                <div className="wiz-grid-4">
                  <label className="wiz-row"><span>Daily</span><input type="number" min={0} value={policy.gfsDailyCount ?? 0} onChange={e => patch({ gfsDailyCount: +e.target.value })} /></label>
                  <label className="wiz-row"><span>Weekly</span><input type="number" min={0} value={policy.gfsWeeklyCount ?? 0} onChange={e => patch({ gfsWeeklyCount: +e.target.value })} /></label>
                  <label className="wiz-row"><span>Monthly</span><input type="number" min={0} value={policy.gfsMonthlyCount ?? 0} onChange={e => patch({ gfsMonthlyCount: +e.target.value })} /></label>
                  <label className="wiz-row"><span>Yearly</span><input type="number" min={0} value={policy.gfsYearlyCount ?? 0} onChange={e => patch({ gfsYearlyCount: +e.target.value })} /></label>
                </div>
              )}

              {(policy.retentionMode === 'ITEM_LEVEL' || policy.retentionMode === 'HYBRID') && (
                <>
                  <label className="wiz-row">
                    <span>Item retention (days)</span>
                    <input type="number" min={0} value={policy.itemRetentionDays ?? 0} onChange={e => patch({ itemRetentionDays: +e.target.value })} />
                  </label>
                  <label className="wiz-row">
                    <span>Item basis</span>
                    <select value={policy.itemRetentionBasis || 'SNAPSHOT'} onChange={e => patch({ itemRetentionBasis: e.target.value as any })}>
                      <option value="SNAPSHOT">Snapshot date</option>
                      <option value="ITEM_DATE">Item's own date (received/modified)</option>
                    </select>
                  </label>
                </>
              )}

              <div className="wiz-grid-3">
                <label className="wiz-row"><span>Hot days</span><input type="number" min={0} value={policy.retentionHotDays ?? 0} onChange={e => patch({ retentionHotDays: +e.target.value })} /></label>
                <label className="wiz-row"><span>Cool days</span><input type="number" min={0} value={policy.retentionCoolDays ?? 0} onChange={e => patch({ retentionCoolDays: +e.target.value })} /></label>
                <label className="wiz-row"><span>Archive days</span><input type="number" min={0} value={policy.retentionArchiveDays ?? 0} onChange={e => patch({ retentionArchiveDays: +e.target.value || (null as any) })} /></label>
              </div>

              <label className="wiz-row">
                <span>Archived resources</span>
                <select value={policy.archivedRetentionMode || 'SAME'} onChange={e => patch({ archivedRetentionMode: e.target.value as any })}>
                  <option value="SAME">Use the rules above</option>
                  <option value="KEEP_ALL">Never delete</option>
                  <option value="KEEP_LAST">Keep only the most recent snapshot</option>
                  <option value="CUSTOM">Custom (days)</option>
                </select>
              </label>
              {policy.archivedRetentionMode === 'CUSTOM' && (
                <label className="wiz-row">
                  <span>Archived days</span>
                  <input type="number" min={0} value={policy.archivedRetentionDays ?? 0} onChange={e => patch({ archivedRetentionDays: +e.target.value })} />
                </label>
              )}

              <label className="wiz-row inline">
                <input type="checkbox" checked={!!policy.legalHoldEnabled} onChange={e => patch({ legalHoldEnabled: e.target.checked })} />
                <span>Legal hold (block all deletions)</span>
              </label>
              <label className="wiz-row">
                <span>Immutability</span>
                <select value={policy.immutabilityMode || 'None'} onChange={e => patch({ immutabilityMode: e.target.value as any })}>
                  <option value="None">None</option>
                  <option value="Unlocked">Unlocked (user-managed)</option>
                  <option value="Locked">Locked (WORM)</option>
                </select>
              </label>
            </>
          )}

          {step === 'exclusions' && (
            <>
              {!isEdit && (
                <p className="wiz-hint warn">Save the policy first to add exclusion rules — they're attached to a saved policy.</p>
              )}
              <div className="wiz-excl-add">
                <select value={newExclusion.exclusionType} onChange={e => setNewExclusion(p => ({ ...p, exclusionType: e.target.value as any }))}>
                  <option value="FOLDER_PATH">Folder path contains</option>
                  <option value="FILE_EXTENSION">File extension</option>
                  <option value="FILENAME_GLOB">Filename glob</option>
                  <option value="MIME_TYPE">MIME type</option>
                  <option value="SUBJECT_REGEX">Subject regex</option>
                  <option value="EMAIL_ADDRESS">Email address</option>
                </select>
                <input
                  type="text"
                  placeholder="pattern (e.g. Drafts, .pst, *.bak, image/*)"
                  value={newExclusion.pattern || ''}
                  onChange={e => setNewExclusion(p => ({ ...p, pattern: e.target.value }))}
                />
                <select value={newExclusion.workload || 'ALL'} onChange={e => setNewExclusion(p => ({ ...p, workload: e.target.value as any }))}>
                  <option value="ALL">All workloads</option>
                  <option value="EMAIL">Email only</option>
                  <option value="FILE">Files only</option>
                  <option value="CALENDAR">Calendar</option>
                  <option value="CONTACT">Contacts</option>
                </select>
                <button className="wiz-btn small" onClick={addExclusion} disabled={!isEdit}>Add</button>
              </div>
              <ul className="wiz-excl-list">
                {exclusions.length === 0 && <li className="wiz-empty">No exclusions yet — every item is backed up.</li>}
                {exclusions.map(e => (
                  <li key={e.id}>
                    <span className="wiz-excl-type">{e.exclusionType}</span>
                    <code>{e.pattern}</code>
                    <span className="wiz-excl-wl">{e.workload || 'ALL'}</span>
                    <button className="wiz-link danger" onClick={() => removeExclusion(e.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 'storage' && (
            <>
              <label className="wiz-row">
                <span>Storage region</span>
                <input
                  type="text"
                  placeholder="(default — inherit tenant region)"
                  value={policy.storageRegion || ''}
                  onChange={e => patch({ storageRegion: e.target.value || (null as any) })}
                />
              </label>
              <label className="wiz-row">
                <span>Encryption</span>
                <select value={policy.encryptionMode || 'VAULT_MANAGED'} onChange={e => patch({ encryptionMode: e.target.value as any })}>
                  <option value="VAULT_MANAGED">Vault-managed key</option>
                  <option value="CUSTOMER_KEY">Customer-managed (BYOK)</option>
                </select>
              </label>
              {policy.encryptionMode === 'CUSTOMER_KEY' && (
                <>
                  <label className="wiz-row"><span>Key Vault URI</span>
                    <input type="text" placeholder="https://my-vault.vault.azure.net" value={policy.keyVaultUri || ''} onChange={e => patch({ keyVaultUri: e.target.value })} />
                  </label>
                  <label className="wiz-row"><span>Key name</span>
                    <input type="text" value={policy.keyName || ''} onChange={e => patch({ keyName: e.target.value })} />
                  </label>
                  <label className="wiz-row"><span>Key version</span>
                    <input type="text" placeholder="(latest)" value={policy.keyVersion || ''} onChange={e => patch({ keyVersion: e.target.value })} />
                  </label>
                </>
              )}
              <label className="wiz-row inline">
                <input type="checkbox" checked={!!policy.autoApplyToMatching} onChange={e => patch({ autoApplyToMatching: e.target.checked })} />
                <span>Auto-apply to matching resources (resource groups)</span>
              </label>
            </>
          )}
        </div>

        {error && <div className="wiz-error">{error}</div>}

        <div className="wiz-footer">
          <button className="wiz-btn ghost" onClick={onClose}>Cancel</button>
          <div className="wiz-nav">
            <button
              className="wiz-btn"
              disabled={stepIdx === 0}
              onClick={() => setStep(STEP_ORDER[stepIdx - 1])}
            >Back</button>
            {stepIdx < STEP_ORDER.length - 1 ? (
              <button className="wiz-btn primary" onClick={() => setStep(STEP_ORDER[stepIdx + 1])}>Next</button>
            ) : (
              <button className="wiz-btn primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create policy')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
