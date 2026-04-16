import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getSlaPolicies, createSlaPolicy, deleteSlaPolicy, type SlaPolicy } from '../services/sla';
import { getTenantInfo, downloadUsageReport, type TenantInfo } from '../services/tenant-info';
import { authService, type AdminConsentStatus, type PowerBIReadiness } from '../services/auth';
import { usePersistentTab } from '../hooks/usePersistentTab';
import './Settings.css';

type SettingsTab = 'sla' | 'info' | 'admin-consent';

interface BackupItem {
  formKey: string;
  policyKey: string;
  label: string;
  checked: boolean;
  hasSettings?: boolean;
}

const DAYS = ['M', 'T', 'W', 'R', 'F', 'S', 'U'] as const;
const DAY_LABELS: Record<string, string> = { M: 'M', T: 'T', W: 'W', R: 'T', F: 'F', S: 'S', U: 'S' };

const M365_BACKUP_ITEMS_LEFT: BackupItem[] = [
  { formKey: 'backup_exchange', policyKey: 'backupExchange', label: 'Emails', checked: true, hasSettings: true },
  { formKey: 'backup_teams_chats', policyKey: 'backupTeamsChats', label: 'Chats', checked: true },
  { formKey: 'contacts', policyKey: 'contacts', label: 'Contacts', checked: true },
  { formKey: 'calendars', policyKey: 'calendars', label: 'Calendars', checked: true },
  { formKey: 'backup_onedrive', policyKey: 'backupOneDrive', label: 'Drive & OneNote', checked: true },
  { formKey: 'tasks', policyKey: 'tasks', label: 'Tasks', checked: false },
  { formKey: 'backup_copilot', policyKey: 'backupCopilot', label: 'Copilot', checked: false },
];

const M365_BACKUP_ITEMS_RIGHT: BackupItem[] = [
  { formKey: 'backup_sharepoint', policyKey: 'backupSharepoint', label: 'SharePoint', checked: true },
  { formKey: 'backup_teams', policyKey: 'backupTeams', label: 'Team Channels', checked: true },
  { formKey: 'group_mailbox', policyKey: 'groupMailbox', label: 'Group mailbox', checked: true },
  { formKey: 'backup_entra_id', policyKey: 'backupEntraId', label: 'Entra ID', checked: true },
  { formKey: 'backup_power_platform', policyKey: 'backupPowerPlatform', label: 'Power Platform', checked: true },
  { formKey: 'planner', policyKey: 'planner', label: 'Planner', checked: false },
];

const AZURE_BACKUP_ITEMS_LEFT: BackupItem[] = [
  { formKey: 'backup_azure_vm', policyKey: 'backupAzureVm', label: 'Virtual machines', checked: true },
  { formKey: 'backup_azure_sql', policyKey: 'backupAzureSql', label: 'Azure SQL databases', checked: true },
];

const AZURE_BACKUP_ITEMS_RIGHT: BackupItem[] = [
  { formKey: 'backup_azure_postgresql', policyKey: 'backupAzurePostgresql', label: 'Azure PostgreSQL servers', checked: true },
];

function defaultFormBackups(serviceType: 'm365' | 'azure'): Record<string, boolean> {
  if (serviceType === 'azure') {
    return {
      backup_exchange: false,
      backup_teams_chats: false,
      contacts: false,
      calendars: false,
      backup_onedrive: false,
      tasks: false,
      backup_copilot: false,
      backup_sharepoint: false,
      backup_teams: false,
      group_mailbox: false,
      backup_entra_id: false,
      backup_power_platform: false,
      planner: false,
      backup_exchange_recoverable: false,
      backup_azure_vm: true,
      backup_azure_sql: true,
      backup_azure_postgresql: true,
    };
  }

  return {
    backup_exchange: true,
    backup_teams_chats: true,
    contacts: true,
    calendars: true,
    backup_onedrive: true,
    tasks: false,
    backup_copilot: false,
    backup_sharepoint: true,
    backup_teams: true,
    group_mailbox: true,
    backup_entra_id: true,
    backup_power_platform: true,
    planner: false,
    backup_exchange_recoverable: false,
    backup_azure_vm: false,
    backup_azure_sql: false,
    backup_azure_postgresql: false,
  };
}

export default function Settings() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const effectiveServiceType: 'm365' | 'azure' = serviceType === 'azure' ? 'azure' : 'm365';
  const settingsTabKeys = ['sla', 'info', 'admin-consent'] as const;
  const subRouteKey = tenantId ? '/protection/settings' : '/settings';
  const tenantSettingsPath = tenantId && serviceType
    ? `/tenants/${tenantId}/${serviceType}/protection/settings`
    : '/settings';
  const [activeTab, setActiveTab] = usePersistentTab<SettingsTab>(subRouteKey, 'sla', settingsTabKeys);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Tenant info state
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [downloadingReport, setDownloadingReport] = useState(false);

  // Admin consent state
  const [m365Consent, setM365Consent] = useState<AdminConsentStatus | null>(null);
  const [azureConsent, setAzureConsent] = useState<AdminConsentStatus | null>(null);
  const [powerBiReadiness, setPowerBiReadiness] = useState<PowerBIReadiness | null>(null);
  const [adminConsentLoading, setAdminConsentLoading] = useState(true);
  const [grantingConsent, setGrantingConsent] = useState<'m365' | 'azure' | 'powerbi' | null>(null);
  const backupItemsLeft = effectiveServiceType === 'azure' ? AZURE_BACKUP_ITEMS_LEFT : M365_BACKUP_ITEMS_LEFT;
  const backupItemsRight = effectiveServiceType === 'azure' ? AZURE_BACKUP_ITEMS_RIGHT : M365_BACKUP_ITEMS_RIGHT;

  // Modal form state
  const [formName, setFormName] = useState('');
  const [formBackups, setFormBackups] = useState<Record<string, boolean>>(() => defaultFormBackups(effectiveServiceType));
  const [formFrequency, setFormFrequency] = useState('1x');
  const [formDays, setFormDays] = useState<Set<string>>(new Set(['M', 'T', 'W', 'R', 'F', 'S', 'U']));
  const [formStartTime, setFormStartTime] = useState('21:00');
  const [formRetention, setFormRetention] = useState('INDEFINITE');
  const [formArchiveRetention, setFormArchiveRetention] = useState('same');
  const [formArchiving, setFormArchiving] = useState('INDEFINITE');
  const [showEmailSettings, setShowEmailSettings] = useState(false);

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'sla', label: 'SLA' },
    { key: 'info', label: 'Info' },
    { key: 'admin-consent', label: 'Admin Consent' },
  ];

  useEffect(() => {
    if (activeTab !== 'sla') return;
    if (!tenantId) {
      setLoading(false);
      setPolicies([]);
      return;
    }
    setLoading(true);
    getSlaPolicies(tenantId, effectiveServiceType)
      .then(setPolicies)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab, tenantId, effectiveServiceType]);

  useEffect(() => {
    if (activeTab !== 'info') return;
    if (!tenantId) {
      setInfoLoading(false);
      setTenantInfo(null);
      return;
    }
    setInfoLoading(true);
    getTenantInfo(tenantId)
      .then(setTenantInfo)
      .catch(console.error)
      .finally(() => setInfoLoading(false));
  }, [activeTab, tenantId]);

  useEffect(() => {
    if (activeTab !== 'admin-consent') return;
    if (!tenantId) {
      setAdminConsentLoading(false);
      setM365Consent(null);
      setAzureConsent(null);
      setPowerBiReadiness(null);
      return;
    }
    setAdminConsentLoading(true);
    Promise.all([
      authService.getM365AdminConsentStatus().catch(() => null),
      authService.getAzureAdminConsentStatus().catch(() => null),
      authService.getPowerBIReadiness(tenantId).catch(() => null),
    ])
      .then(([m365, azure, powerBi]) => {
        setM365Consent(m365);
        setAzureConsent(azure);
        setPowerBiReadiness(powerBi);
      })
      .catch(console.error)
      .finally(() => setAdminConsentLoading(false));
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

  const handleGrantM365Consent = async () => {
    try {
      setGrantingConsent('m365');
      localStorage.setItem('consent_return_to', tenantSettingsPath);
      const { url } = await authService.getM365AdminConsentUrl();
      window.location.href = url;
    } catch (error) {
      console.error('Failed to get M365 consent URL:', error);
      alert('Failed to initiate M365 admin consent');
      setGrantingConsent(null);
    }
  };

  const handleGrantAzureConsent = async () => {
    try {
      setGrantingConsent('azure');
      localStorage.setItem('consent_return_to', tenantSettingsPath);
      const { url } = await authService.getAzureAdminConsentUrl();
      window.location.href = url;
    } catch (error) {
      console.error('Failed to get Azure consent URL:', error);
      alert('Failed to initiate Azure admin consent');
      setGrantingConsent(null);
    }
  };

  const handleConnectPowerBI = async () => {
    if (!tenantId) return;
    try {
      setGrantingConsent('powerbi');
      localStorage.setItem('consent_return_to', tenantSettingsPath);
      localStorage.setItem('power_bi_tenant_id', tenantId);
      if (serviceType) {
        localStorage.setItem('power_bi_service_type', serviceType);
      }
      const { url, state } = await authService.getPowerBIConnectUrl(tenantId);
      localStorage.setItem('power_bi_oauth_state', state);
      window.location.href = url;
    } catch (error) {
      console.error('Failed to get Power BI connect URL:', error);
      alert('Failed to initiate Power BI onboarding');
      setGrantingConsent(null);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const powerBiStatusLabel = (status: PowerBIReadiness['status']) => {
    if (status === 'ready') return 'Ready';
    if (status === 'warning') return 'Limited';
    return 'Action required';
  };

  const powerBiStatusClass = (status: PowerBIReadiness['status']) => {
    if (status === 'ready') return 'ready';
    if (status === 'warning') return 'warning';
    return 'action';
  };

  const resetForm = () => {
    setFormName('');
    setFormBackups(defaultFormBackups(effectiveServiceType));
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
        serviceType: effectiveServiceType,
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
        backupAzureVm: formBackups.backup_azure_vm,
        backupAzureSql: formBackups.backup_azure_sql,
        backupAzurePostgresql: formBackups.backup_azure_postgresql,
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

      {!tenantId && (
        <div className="empty-state">
          <p>Open Settings from a specific datasource to manage SLA, tenant info, and admin consent.</p>
        </div>
      )}

      {/* SLA Tab Content */}
      {tenantId && activeTab === 'sla' && (
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
                        {backupItemsLeft.map(item => (
                          <label key={item.policyKey} className="sla-check">
                            <span className={`sla-check-box ${policy[item.policyKey as keyof typeof policy] ? 'checked' : ''}`}>
                              {policy[item.policyKey as keyof typeof policy] ? '✓' : ''}
                            </span>
                            {item.label}
                          </label>
                        ))}
                      </div>
                      <div className="sla-backup-col">
                        {backupItemsRight.map(item => (
                          <label key={item.policyKey} className="sla-check">
                            <span className={`sla-check-box ${policy[item.policyKey as keyof typeof policy] ? 'checked' : ''}`}>
                              {policy[item.policyKey as keyof typeof policy] ? '✓' : ''}
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

      {tenantId && activeTab === 'info' && (
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

      {tenantId && activeTab === 'admin-consent' && (
        <div className="admin-consent-tab">
          {adminConsentLoading ? (
            <div className="empty-state"><p>Loading admin consent status...</p></div>
          ) : (
            <div className="admin-consent-content">
              {/* M365 Admin Consent Card */}
              <div className="admin-consent-card">
                <div className="admin-consent-header">
                  <div className="admin-consent-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor" style={{width: 20, height: 20}}>
                      <rect x="3" y="3" width="7" height="7" rx="1"/>
                      <rect x="14" y="3" width="7" height="7" rx="1"/>
                      <rect x="3" y="14" width="7" height="7" rx="1"/>
                      <rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                  </div>
                  <span className="admin-consent-title">Microsoft 365 admin consent</span>
                </div>
                {m365Consent && m365Consent.isActive ? (
                  <div className="admin-consent-status granted">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#34a853" strokeWidth="2" style={{width: 18, height: 18, flexShrink: 0}}>
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    <div className="admin-consent-details">
                      <div className="admin-consent-granted-by">{m365Consent.grantedBy || 'N/A'}</div>
                      <div className="admin-consent-date">{formatDate(m365Consent.consentedAt)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="admin-consent-status not-granted">
                    <span>Not granted</span>
                  </div>
                )}
                <button 
                  className="admin-consent-regrant-btn" 
                  onClick={handleGrantM365Consent}
                  disabled={grantingConsent === 'm365'}
                >
                  {grantingConsent === 'm365' ? 'Redirecting...' : m365Consent?.isActive ? 'Regrant' : 'Connect'}
                </button>
              </div>

              {/* Azure Admin Consent Card */}
              <div className="admin-consent-card">
                <div className="admin-consent-header">
                  <div className="admin-consent-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor" style={{width: 20, height: 20}}>
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                  </div>
                  <span className="admin-consent-title">Azure admin consent</span>
                </div>
                {azureConsent && azureConsent.isActive ? (
                  <div className="admin-consent-status granted">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#34a853" strokeWidth="2" style={{width: 18, height: 18, flexShrink: 0}}>
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    <div className="admin-consent-details">
                      <div className="admin-consent-granted-by">{azureConsent.grantedBy || 'N/A'}</div>
                      <div className="admin-consent-date">{formatDate(azureConsent.consentedAt)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="admin-consent-status not-granted">
                    <span>Not granted</span>
                  </div>
                )}
                <button 
                  className="admin-consent-regrant-btn" 
                  onClick={handleGrantAzureConsent}
                  disabled={grantingConsent === 'azure'}
                >
                  {grantingConsent === 'azure' ? 'Redirecting...' : azureConsent?.isActive ? 'Regrant' : 'Connect'}
                </button>
              </div>

              {/* Power BI Readiness Card */}
              <div className="power-bi-readiness-card">
                <div className="power-bi-readiness-header">
                  <div>
                    <div className="power-bi-readiness-title">Power BI backup readiness</div>
                    <div className="power-bi-readiness-subtitle">
                      Connect a Power BI service user and we will reuse that connection for discovery and backup, with app-only as fallback.
                    </div>
                  </div>
                  <div className="power-bi-header-actions">
                    {powerBiReadiness && (
                      <span className={`power-bi-status-badge ${powerBiStatusClass(powerBiReadiness.status)}`}>
                        {powerBiStatusLabel(powerBiReadiness.status)}
                      </span>
                    )}
                    <button
                      className="admin-consent-regrant-btn"
                      onClick={handleConnectPowerBI}
                      disabled={grantingConsent === 'powerbi'}
                    >
                      {grantingConsent === 'powerbi'
                        ? 'Redirecting...'
                        : powerBiReadiness?.authMode === 'DELEGATED_SERVICE_USER'
                          ? 'Reconnect service user'
                          : 'Connect service user'}
                    </button>
                  </div>
                </div>

                {powerBiReadiness ? (
                  <>
                    <p className="power-bi-summary">{powerBiReadiness.summary}</p>

                    <div className="power-bi-metrics">
                      <div className="power-bi-metric">
                        <span className="power-bi-metric-label">Auth mode</span>
                        <span className="power-bi-metric-value">
                          {powerBiReadiness.authMode === 'APP_ONLY' ? 'App-only fallback' : 'Delegated service user'}
                        </span>
                      </div>
                      <div className="power-bi-metric">
                        <span className="power-bi-metric-label">Accessible workspaces</span>
                        <span className="power-bi-metric-value">{powerBiReadiness.accessibleWorkspaceCount}</span>
                      </div>
                      <div className="power-bi-metric">
                        <span className="power-bi-metric-label">Discovered in TMVault</span>
                        <span className="power-bi-metric-value">{powerBiReadiness.discoveredWorkspaceCount}</span>
                      </div>
                      <div className="power-bi-metric">
                        <span className="power-bi-metric-label">Credential source</span>
                        <span className="power-bi-metric-value">
                          {powerBiReadiness.usesDedicatedApp ? 'Dedicated Power BI app' : 'Primary Microsoft app'}
                        </span>
                      </div>
                    </div>

                    <div className="power-bi-checklist">
                      {powerBiReadiness.checks.map((check) => (
                        <div key={check.key} className={`power-bi-check ${powerBiStatusClass(check.status)}`}>
                          <div className="power-bi-check-header">
                            <span className="power-bi-check-title">{check.label}</span>
                            <span className={`power-bi-check-state ${powerBiStatusClass(check.status)}`}>
                              {powerBiStatusLabel(check.status)}
                            </span>
                          </div>
                          <div className="power-bi-check-detail">{check.detail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="power-bi-next-steps">
                      <div className="power-bi-next-steps-title">Recommended next steps</div>
                      {powerBiReadiness.recommendedActions.length > 0 ? (
                        <ol className="power-bi-next-steps-list">
                          {powerBiReadiness.recommendedActions.map((action, index) => (
                            <li key={`${index}-${action}`}>{action}</li>
                          ))}
                        </ol>
                      ) : (
                        <p className="power-bi-next-steps-empty">Nothing else is needed right now. You can run discovery and assign SLA protection.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="power-bi-next-steps-empty">
                    Power BI readiness could not be loaded yet. Re-open this tab after tenant setup completes.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
                  {backupItemsLeft.map(item => (
                    <div key={`bl-${item.formKey}`} className="sla-modal-check-row">
                      <label className="sla-modal-check" onClick={() => toggleBackup(item.formKey)}>
                        <span className={`sla-modal-check-box ${formBackups[item.formKey] ? 'checked' : ''}`}>
                          {formBackups[item.formKey] && <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>}
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
                  {backupItemsRight.map(item => (
                    <label key={`br-${item.formKey}`} className="sla-modal-check" onClick={() => toggleBackup(item.formKey)}>
                      <span className={`sla-modal-check-box ${formBackups[item.formKey] ? 'checked' : ''}`}>
                        {formBackups[item.formKey] && <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2"><polyline points="2 6 5 9 10 3"/></svg>}
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
