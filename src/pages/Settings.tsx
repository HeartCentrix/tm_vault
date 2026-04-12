import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getSlaPolicies, createSlaPolicy, deleteSlaPolicy, type SlaPolicy } from '../services/sla';
import { getTenantInfo, downloadUsageReport, type TenantInfo } from '../services/tenant-info';
import './Settings.css';

type SettingsTab = 'sla' | 'info' | 'admin' | 'apps' | 'access' | 'secrets' | 'saml';

interface BackupItem {
  key: string;
  label: string;
  checked: boolean;
  hasSettings?: boolean;
}

const DAYS = ['M', 'T', 'W', 'R', 'F', 'S', 'U'] as const;
const DAY_LABELS: Record<string, string> = { M: 'M', T: 'T', W: 'W', R: 'T', F: 'F', S: 'S', U: 'S' };

const BACKUP_ITEMS_LEFT: BackupItem[] = [
  { key: 'backup_exchange', label: 'Emails', checked: true, hasSettings: true },
  { key: 'backup_teams_chats', label: 'Chats', checked: true },
  { key: 'contacts', label: 'Contacts', checked: true },
  { key: 'calendars', label: 'Calendars', checked: true },
  { key: 'backup_onedrive', label: 'Drive & OneNote', checked: true },
  { key: 'tasks', label: 'Tasks', checked: false },
  { key: 'backup_copilot', label: 'Copilot', checked: false },
];

const BACKUP_ITEMS_RIGHT: BackupItem[] = [
  { key: 'backup_sharepoint', label: 'SharePoint', checked: true },
  { key: 'backup_teams', label: 'Team Channels', checked: true },
  { key: 'group_mailbox', label: 'Group mailbox', checked: true },
  { key: 'backup_entra_id', label: 'Entra ID', checked: true },
  { key: 'backup_power_platform', label: 'Power Platform', checked: true },
  { key: 'planner', label: 'Planner', checked: false },
];

export default function Settings() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const [activeTab, setActiveTab] = useState<SettingsTab>('sla');
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Tenant info state
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [downloadingReport, setDownloadingReport] = useState(false);

  // Modal form state
  const [formName, setFormName] = useState('');
  const [formBackups, setFormBackups] = useState<Record<string, boolean>>({
    backup_exchange: true, backup_teams_chats: true, contacts: true, calendars: true,
    backup_onedrive: true, tasks: false, backup_copilot: false,
    backup_sharepoint: true, backup_teams: true, group_mailbox: true,
    backup_entra_id: true, backup_power_platform: true, planner: false,
    backup_exchange_recoverable: false,
  });
  const [formFrequency, setFormFrequency] = useState('1x');
  const [formDays, setFormDays] = useState<Set<string>>(new Set(['M', 'T', 'W', 'R', 'F', 'S', 'U']));
  const [formStartTime, setFormStartTime] = useState('21:00');
  const [formRetention, setFormRetention] = useState('INDEFINITE');
  const [formArchiveRetention, setFormArchiveRetention] = useState('same');
  const [formArchiving, setFormArchiving] = useState('INDEFINITE');
  const [showEmailSettings, setShowEmailSettings] = useState(false);

  const sharedTabs: { key: SettingsTab; label: string }[] = [
    { key: 'sla', label: 'SLA' },
    { key: 'info', label: 'Info' },
    { key: 'admin', label: 'Admin consent' },
    { key: 'apps', label: 'Apps' },
    { key: 'access', label: 'Access groups' },
    { key: 'secrets', label: 'Secrets' },
  ];

  const tabs: { key: SettingsTab; label: string }[] = serviceType === 'azure' 
    ? sharedTabs 
    : [...sharedTabs, { key: 'saml' as SettingsTab, label: 'SAML/Okta' }];

  useEffect(() => {
    if (activeTab === 'sla' && tenantId) {
      setLoading(true);
      getSlaPolicies(tenantId)
        .then(setPolicies)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [activeTab, tenantId]);

  useEffect(() => {
    if (activeTab === 'info' && tenantId) {
      setInfoLoading(true);
      getTenantInfo(tenantId)
        .then(setTenantInfo)
        .catch(console.error)
        .finally(() => setInfoLoading(false));
    }
  }, [activeTab, tenantId]);

  const handleDownloadReport = async () => {
    if (!tenantId) return;
    setDownloadingReport(true);
    try {
      await downloadUsageReport(tenantId, 'qfion.com');
    } catch (err) {
      console.error('Failed to download report:', err);
      alert('Failed to download usage report');
    } finally {
      setDownloadingReport(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const resetForm = () => {
    setFormName('');
    setFormBackups({
      backup_exchange: true, backup_teams_chats: true, contacts: true, calendars: true,
      backup_onedrive: true, tasks: false, backup_copilot: false,
      backup_sharepoint: true, backup_teams: true, group_mailbox: true,
      backup_entra_id: true, backup_power_platform: true, planner: false,
      backup_exchange_recoverable: false,
    });
    setShowEmailSettings(false);
    setFormFrequency('1x');
    setFormDays(new Set(['M', 'T', 'W', 'R', 'F', 'S', 'U']));
    setFormStartTime('21:00');
    setFormRetention('INDEFINITE');
    setFormArchiveRetention('same');
    setFormArchiving('INDEFINITE');
  };

  const handleSave = async () => {
    if (!formName.trim() || !tenantId) return;
    setSaving(true);
    try {
      // Map frontend day codes to backend day codes
      const DAY_MAP: Record<string, string> = {
        M: 'MON', T: 'TUE', W: 'WED', R: 'THU', F: 'FRI', S: 'SAT', U: 'SUN',
      };
      const allDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      const backupDays = Array.from(formDays).map(d => DAY_MAP[d]).filter(Boolean);

      // Determine frequency: if all 7 days + 1x → DAILY, if all 7 days + 3x → THREE_DAILY, otherwise → CUSTOM
      const allDaysSelected = backupDays.length === 7 && allDays.every(d => backupDays.includes(d));
      let frequency: string;
      if (!allDaysSelected) {
        frequency = 'CUSTOM';
      } else {
        frequency = formFrequency === '3x' ? 'THREE_DAILY' : 'DAILY';
      }

      const data: Partial<SlaPolicy> = {
        tenantId,
        name: formName.trim(),
        frequency,
        backupDays,
        backupWindowStart: formStartTime,
        backupExchange: formBackups.backup_exchange,
        backupExchangeArchive: false,
        backupExchangeRecoverable: formBackups.backup_exchange_recoverable,
        backupOneDrive: formBackups.backup_onedrive,
        backupSharepoint: formBackups.backup_sharepoint,
        backupTeams: formBackups.backup_teams,
        backupTeamsChats: formBackups.backup_teams_chats,
        backupEntraId: formBackups.backup_entra_id,
        backupPowerPlatform: formBackups.backup_power_platform,
        backupCopilot: formBackups.backup_copilot,
        contacts: formBackups.contacts,
        calendars: formBackups.calendars,
        tasks: formBackups.tasks,
        groupMailbox: formBackups.group_mailbox,
        planner: formBackups.planner,
        retentionType: formRetention,
        enabled: true,
        isDefault: false,
      };
      const newPolicy = await createSlaPolicy(data);
      setPolicies(prev => [...prev, newPolicy]);
      setShowModal(false);
      resetForm();
    } catch (err) {
      console.error('Failed to save SLA:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this SLA?')) return;
    try {
      await deleteSlaPolicy(id);
      setPolicies(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Failed to delete SLA:', err);
    }
  };

  const toggleBackup = (key: string) => {
    setFormBackups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleDay = (day: string) => {
    setFormDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const DAY_LABELS_FULL: Record<string, string> = {
    MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun',
  };
  const frequencyLabel = (freq: string) => {
    if (freq === 'THREE_DAILY') return '3x per day';
    if (freq === 'CUSTOM') return 'Custom days';
    return '1x per day';
  };
  const scheduleLabel = (policy: SlaPolicy) => {
    if (policy.frequency === 'THREE_DAILY') return 'Every day (00:00, 08:00, 16:00)';
    if (policy.frequency === 'CUSTOM' && policy.backupDays?.length) {
      const days = policy.backupDays.map(d => DAY_LABELS_FULL[d] || d).join(', ');
      return days;
    }
    return 'Every day';
  };
  const retentionLabel = (type: string) => type === 'INDEFINITE' ? 'Unlimited' : type;

  return (
    <div className="settings-page">
      {/* Tabs */}
      <div className="settings-tabs">
        {tabs.map(tab => (
          <button key={tab.key} className={`settings-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* SLA Tab Content */}
      {activeTab === 'sla' && (
        <div className="sla-tab">
          <div className="sla-header">
            <div />
            <button className="add-sla-btn" onClick={() => { resetForm(); setShowModal(true); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add new SLA
            </button>
          </div>

          {loading ? (
            <div className="empty-state"><p>Loading SLA...</p></div>
          ) : policies.length === 0 ? (
            <div className="empty-state"><p>No SLA configured.</p></div>
          ) : (
            <div className="sla-list">
              {policies.map((policy, idx) => (
                <div key={policy.id} className={`sla-entry ${idx > 0 ? 'sla-entry-divider' : ''}`}>
                  <div className="sla-entry-row">
                    <div className="sla-name">{policy.name}</div>
                    <div className="sla-backups">
                      <div className="sla-backup-col">
                        {[
                          { key: 'backupExchange', label: 'Emails' },
                          { key: 'backupTeamsChats', label: 'Chats' },
                          { key: 'contacts', label: 'Contacts' },
                          { key: 'calendars', label: 'Calendars' },
                          { key: 'backupOneDrive', label: 'Drive & OneNote' },
                          { key: 'tasks', label: 'Tasks' },
                          { key: 'backupCopilot', label: 'Copilot' },
                        ].map(item => (
                          <label key={item.key} className="sla-check">
                            <span className={`sla-check-box ${policy[item.key as keyof typeof policy] ? 'checked' : ''}`}>
                              {policy[item.key as keyof typeof policy] ? '✓' : ''}
                            </span>
                            {item.label}
                          </label>
                        ))}
                      </div>
                      <div className="sla-backup-col">
                        {[
                          { key: 'backupSharepoint', label: 'SharePoint' },
                          { key: 'backupTeams', label: 'Team Channels' },
                          { key: 'groupMailbox', label: 'Group mailbox' },
                          { key: 'backupEntraId', label: 'Entra ID' },
                          { key: 'backupPowerPlatform', label: 'Power Platform' },
                          { key: 'planner', label: 'Planner' },
                        ].map(item => (
                          <label key={item.key} className="sla-check">
                            <span className={`sla-check-box ${policy[item.key as keyof typeof policy] ? 'checked' : ''}`}>
                              {policy[item.key as keyof typeof policy] ? '✓' : ''}
                            </span>
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="sla-schedule">
                      <div className="sla-sched-row"><span className="sla-sched-label">Frequency:</span><span className="sla-sched-value">{frequencyLabel(policy.frequency)}</span></div>
                      <div className="sla-sched-row"><span className="sla-sched-label">Schedule:</span><span className="sla-sched-value">{scheduleLabel(policy)}</span></div>
                      {policy.backupWindowStart && policy.frequency !== 'THREE_DAILY' && (
                        <div className="sla-sched-row"><span className="sla-sched-label">Start:</span><span className="sla-sched-value">{policy.backupWindowStart}</span></div>
                      )}
                    </div>
                    <div className="sla-retention">
                      <div className="sla-sched-row"><span className="sla-sched-label">Retention:</span><span className="sla-sched-value">{retentionLabel(policy.retentionType || '')}</span></div>
                      <div className="sla-sched-row"><span className="sla-sched-label">Archiving:</span><span className="sla-sched-value">{retentionLabel(policy.retentionType || '')}</span></div>
                    </div>
                    <div className="sla-actions">
                      <button className="sla-action-btn" onClick={() => handleDelete(policy.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'info' && (
        <div className="info-tab">
          {infoLoading ? (
            <div className="empty-state"><p>Loading tenant info...</p></div>
          ) : tenantInfo ? (
            <div className="info-content">
              <div className="info-row">
                <span className="info-label">Customer ID:</span>
                <span className="info-value">{tenantInfo.customerId}</span>
                <button className="copy-btn" onClick={() => copyToClipboard(tenantInfo.customerId)} title="Copy to clipboard">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
              <div className="info-row">
                <span className="info-label">Tenant ID:</span>
                <span className="info-value">{tenantInfo.tenantId}</span>
                <button className="copy-btn" onClick={() => copyToClipboard(tenantInfo.tenantId)} title="Copy to clipboard">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
              <div className="info-row">
                <span className="info-label">Region:</span>
                <span className="info-value">{tenantInfo.region}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Usage report:</span>
                <button className="download-csv-btn" onClick={handleDownloadReport} disabled={downloadingReport}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {downloadingReport ? 'Downloading...' : 'Download CSV'}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state"><p>Failed to load tenant info</p></div>
          )}
        </div>
      )}

      {activeTab !== 'sla' && activeTab !== 'info' && <div className="empty-state"><p>{tabs.find(t => t.key === activeTab)?.label} - Coming soon</p></div>}

      {/* Add SLA Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sla-modal" onClick={(e) => e.stopPropagation()}>
            <button className="sla-modal-close" onClick={() => setShowModal(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 20, height: 20}}>
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            {/* Name */}
            <div className="sla-modal-name">
              <span className="sla-modal-label">Name:</span>
              <input type="text" className="sla-modal-name-input" value={formName} onChange={e => setFormName(e.target.value)} placeholder="" />
            </div>

            {/* Data to back up */}
            <div className="sla-modal-section">
              <h4 className="sla-modal-heading">Data to back up:</h4>
              <div className="sla-modal-backup-grid">
                <div className="sla-modal-backup-col">
                  {BACKUP_ITEMS_LEFT.map(item => (
                    <div key={`bl-${item.key}`} className="sla-modal-check-row">
                      <label className="sla-modal-check" onClick={() => toggleBackup(item.key)}>
                        <span className={`sla-modal-check-box ${formBackups[item.key] ? 'checked' : ''}`}>
                          {formBackups[item.key] && <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>}
                        </span>
                        <span>{item.label}</span>
                      </label>
                      {item.hasSettings && (
                        <div className="sla-modal-email-settings-inline">
                          <button className="sla-modal-settings-btn" onClick={(e) => { e.stopPropagation(); setShowEmailSettings(!showEmailSettings); }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 20, height: 20}}>
                              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                          </button>
                          {showEmailSettings && (
                            <div className="sla-modal-email-popup" onClick={(e) => e.stopPropagation()}>
                              <label className="sla-modal-email-option">
                                <span>Backup Recoverable Items:</span>
                                <span className={`sla-modal-toggle ${formBackups.backup_exchange_recoverable ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setFormBackups(prev => ({ ...prev, backup_exchange_recoverable: !prev.backup_exchange_recoverable })); }}>
                                  <span className="sla-modal-toggle-slider"></span>
                                </span>
                              </label>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="sla-modal-backup-col">
                  {BACKUP_ITEMS_RIGHT.map(item => (
                    <label key={`br-${item.key}`} className="sla-modal-check" onClick={() => toggleBackup(item.key)}>
                      <span className={`sla-modal-check-box ${formBackups[item.key] ? 'checked' : ''}`}>
                        {formBackups[item.key] && <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>}
                      </span>
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Exclusions */}
            <div className="sla-modal-section">
              <span className="sla-modal-label-inline">
                Exclusions
                <span className="sla-modal-info-icon">i</span>
                <button className="sla-modal-add-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 14, height: 14}}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                  add
                </button>
              </span>
            </div>

            {/* Schedule */}
            <div className="sla-modal-section">
              <h4 className="sla-modal-heading">Schedule:</h4>
              <div className="sla-modal-schedule-row">
                <span className="sla-modal-schedule-label">Frequency:</span>
                <select className="sla-modal-select" value={formFrequency} onChange={e => setFormFrequency(e.target.value)}>
                  <option value="1x">1x per day</option>
                  <option value="3x">3x per day</option>
                </select>
              </div>
              {formFrequency === '1x' && (
                <>
                  <div className="sla-modal-schedule-row">
                    <span className="sla-modal-schedule-label">Day:</span>
                    <div className="sla-modal-day-btns">
                      {DAYS.map((d) => (
                        <button key={`day-${d}`} className={`sla-modal-day-btn ${formDays.has(d) ? 'active' : ''}`} onClick={() => toggleDay(d)}>{DAY_LABELS[d]}</button>
                      ))}
                    </div>
                  </div>
                  <div className="sla-modal-schedule-row">
                    <span className="sla-modal-schedule-label">Starts at:</span>
                    <div className="sla-modal-time-group">
                      <select className="sla-modal-select" value={formStartTime} onChange={e => setFormStartTime(e.target.value)}>
                        {Array.from({length: 24}, (_, i) => (
                          <option key={i} value={`${i.toString().padStart(2, '0')}:00`}>{`${i.toString().padStart(2, '0')}:00`}</option>
                        ))}
                      </select>
                      <span className="sla-modal-timezone">GMT+5:30</span>
                    </div>
                  </div>
                </>
              )}
              {formFrequency === '3x' && (
                <div className="sla-modal-schedule-row">
                  <span className="sla-modal-schedule-label">Day:</span>
                  <div className="sla-modal-day-btns">
                    {DAYS.map((d) => (
                      <button key={`day3-${d}`} className={`sla-modal-day-btn ${formDays.has(d) ? 'active' : ''}`} onClick={() => toggleDay(d)}>{DAY_LABELS[d]}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Retention */}
            <div className="sla-modal-section">
              <div className="sla-modal-schedule-row">
                <span className="sla-modal-schedule-label">
                  Retention <span className="sla-modal-info-icon">i</span>:
                </span>
                <select className="sla-modal-select" value={formRetention} onChange={e => setFormRetention(e.target.value)}>
                  <option value="INDEFINITE">Unlimited</option>
                  <option value="DAYS">Number of days</option>
                  <option value="VERSIONS">Number of versions</option>
                </select>
              </div>
              <div className="sla-modal-schedule-row" style={{paddingLeft: 24, marginTop: 8}}>
                <span className="sla-modal-schedule-label" style={{fontSize: 13, color: '#64748b'}}>
                  Apply data retention rules to archived data:
                </span>
                <select className="sla-modal-select" value={formArchiveRetention} onChange={e => setFormArchiveRetention(e.target.value)} style={{minWidth: 180}}>
                  <option value="same">Same retention rules</option>
                </select>
              </div>
            </div>

            {/* Archiving */}
            <div className="sla-modal-section">
              <div className="sla-modal-schedule-row">
                <span className="sla-modal-schedule-label">
                  Archiving <span className="sla-modal-info-icon">i</span>:
                </span>
                <select className="sla-modal-select" value={formArchiving} onChange={e => setFormArchiving(e.target.value)}>
                  <option value="INDEFINITE">Unlimited</option>
                  <option value="DAYS">Number of days</option>
                </select>
              </div>
            </div>

            {/* Encryption */}
            <div className="sla-modal-section">
              <div className="sla-modal-schedule-row">
                <span className="sla-modal-schedule-label">Encryption key:</span>
                <span style={{fontSize: 13, color: '#475569'}}>Service-managed encryption key</span>
              </div>
            </div>

            {/* Actions */}
            <div className="sla-modal-actions">
              <button className="sla-modal-save-btn" onClick={handleSave} disabled={saving || !formName.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
