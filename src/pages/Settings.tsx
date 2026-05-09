import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getSlaPoliciesPage, deleteSlaPolicy, type SlaPolicy } from '../services/sla';
import { getTenantInfo, downloadUsageReport, type TenantInfo } from '../services/tenant-info';
import { authService, type AdminConsentStatus, type PowerBIReadiness } from '../services/auth';
import { usePersistentTab } from '../hooks/usePersistentTab';
import SlaWizard from '../components/SlaWizard';
import SecretsTab from '../components/SecretsTab';
import ErrorBoundary from '../components/ErrorBoundary';
import { fmtLocalDate } from '../utils/datetime';
import './Settings.css';

type SettingsTab = 'sla' | 'info' | 'admin-consent' | 'secrets';

interface BackupItem {
  formKey: string;
  policyKey: string;
  label: string;
  checked: boolean;
  hasSettings?: boolean;
}

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

export default function Settings() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const effectiveServiceType: 'm365' | 'azure' = serviceType === 'azure' ? 'azure' : 'm365';
  const settingsTabKeys = ['sla', 'info', 'admin-consent', 'secrets'] as const;
  const subRouteKey = tenantId ? '/protection/settings' : '/settings';
  const tenantSettingsPath = tenantId && serviceType
    ? `/tenants/${tenantId}/${serviceType}/protection/settings`
    : '/settings';
  const [activeTab, setActiveTab] = usePersistentTab<SettingsTab>(subRouteKey, 'sla', settingsTabKeys);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  // Pagination — the policy list is bounded in practice (O(10) per tenant
  // even at 5k-user scale) but the server now returns a paginated envelope
  // so we honor it. Page size 50 is well above any realistic policy count
  // while still capping the initial payload if a misconfigured tenant has
  // accumulated cruft.
  const POLICIES_PAGE_SIZE = 50;
  const [policiesTotal, setPoliciesTotal] = useState(0);
  const [policiesLoadingMore, setPoliciesLoadingMore] = useState(false);

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

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'sla', label: 'SLA' },
    { key: 'info', label: 'Info' },
    { key: 'admin-consent', label: 'Admin Consent' },
    { key: 'secrets', label: 'Secrets' },
  ];

  // Wizard state — opens for new or edit
  const [showWizard, setShowWizard] = useState(false);
  const [wizardEditing, setWizardEditing] = useState<SlaPolicy | null>(null);

  useEffect(() => {
    if (activeTab !== 'sla') return;
    if (!tenantId) {
      setLoading(false);
      setPolicies([]);
      setPoliciesTotal(0);
      return;
    }
    setLoading(true);
    getSlaPoliciesPage(tenantId, effectiveServiceType, { limit: POLICIES_PAGE_SIZE, offset: 0 })
      .then(page => {
        setPolicies(page.items);
        setPoliciesTotal(page.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab, tenantId, effectiveServiceType]);

  const loadMorePolicies = async () => {
    if (!tenantId || policiesLoadingMore) return;
    setPoliciesLoadingMore(true);
    try {
      const page = await getSlaPoliciesPage(tenantId, effectiveServiceType, {
        limit: POLICIES_PAGE_SIZE,
        offset: policies.length,
      });
      setPolicies(prev => [...prev, ...page.items]);
      setPoliciesTotal(page.total);
    } catch (err) {
      console.error(err);
    } finally {
      setPoliciesLoadingMore(false);
    }
  };

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

  // OAuth transition state (return_to, CSRF state nonce, the chosen
  // tenant/service the user was viewing) lives in sessionStorage rather
  // than localStorage. It only needs to survive a top-level navigation to
  // login.microsoftonline.com and back — the tab persists, so
  // sessionStorage works. Closing the tab wipes the values, which means a
  // later XSS payload can't read a stale CSRF nonce or hijack a
  // half-finished onboarding flow days after the fact.

  const handleGrantM365Consent = async () => {
    try {
      setGrantingConsent('m365');
      sessionStorage.setItem('consent_return_to', tenantSettingsPath);
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
      sessionStorage.setItem('consent_return_to', tenantSettingsPath);
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
      sessionStorage.setItem('consent_return_to', tenantSettingsPath);
      sessionStorage.setItem('power_bi_tenant_id', tenantId);
      if (serviceType) {
        sessionStorage.setItem('power_bi_service_type', serviceType);
      }
      // The CSRF state nonce now lives in an HttpOnly cookie that the
      // backend sets on /auth/power-bi/url and validates on /callback. JS
      // (and therefore XSS) can't read it, so we don't store it here.
      const { url } = await authService.getPowerBIConnectUrl(tenantId);
      window.location.href = url;
    } catch (error) {
      console.error('Failed to get Power BI connect URL:', error);
      alert('Failed to initiate Power BI onboarding');
      setGrantingConsent(null);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    return fmtLocalDate(dateStr, {
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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this SLA?')) return;
    try {
      await deleteSlaPolicy(id);
      setPolicies(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Failed to delete SLA:', err);
    }
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

  // Days summary derived from the new Phase-1 retention fields. Used in the
  // SLA list rows below — replaces the legacy retentionType which most
  // policies leave as INDEFINITE.
  const daysLabel = (days: number | null | undefined) => {
    if (days == null) return 'Unlimited';
    if (days >= 365 * 99) return 'Unlimited';
    if (days % 365 === 0) { const y = days / 365; return `${y} year${y === 1 ? '' : 's'}`; }
    return `${days} day${days === 1 ? '' : 's'}`;
  };
  const policyRetentionLabel = (p: SlaPolicy) => {
    if (p.retentionMode === 'GFS') return 'GFS';
    return daysLabel(p.retentionHotDays);
  };
  const policyArchivingLabel = (p: SlaPolicy) => daysLabel(p.retentionArchiveDays);

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
            <button className="add-sla-btn" onClick={() => { setWizardEditing(null); setShowWizard(true); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New SLA
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
                    <div className="sla-name">
                      {policy.name}
                      <span className="sla-badges">
                        {policy.isDefault && (
                          <span className="sla-badge sla-badge-default" title="Default policy for this tenant">★ Default</span>
                        )}
                        {policy.immutabilityMode === 'Locked' && (
                          <span className="sla-badge sla-badge-locked" title="WORM-Locked. Cannot be deleted until immutability period expires.">🔒 Locked</span>
                        )}
                        {policy.immutabilityMode === 'Unlocked' && (
                          <span className="sla-badge sla-badge-unlocked" title="WORM applied; user-managed (extendable).">Unlocked</span>
                        )}
                        {policy.legalHoldEnabled && (
                          <span className="sla-badge sla-badge-hold" title="Legal hold — all deletions blocked.">⚖ Hold</span>
                        )}
                        {policy.encryptionMode === 'CUSTOMER_KEY' && policy.encryptionStatus === 'OK' && (
                          <span className="sla-badge sla-badge-cmk-ok" title="Customer-managed key applied to all containers.">CMK</span>
                        )}
                        {policy.encryptionMode === 'CUSTOMER_KEY' && policy.encryptionStatus === 'KEY_VAULT_ACCESS_DENIED' && (
                          <span
                            className="sla-badge sla-badge-cmk-denied"
                            title="Storage account lacks Get/WrapKey/UnwrapKey on the configured Key Vault key. Grant the 'Key Vault Crypto Service Encryption User' role to the storage account managed identity."
                          >● CMK access denied</span>
                        )}
                        {policy.encryptionMode === 'CUSTOMER_KEY' && policy.encryptionStatus === 'ERROR' && (
                          <span className="sla-badge sla-badge-cmk-err" title="CMK reconcile encountered an error. See policy audit trail for details.">● CMK error</span>
                        )}
                        {policy.encryptionMode === 'CUSTOMER_KEY' && policy.keyVersionResolved && (
                          <span className="sla-badge sla-badge-key-version" title={`Key version applied: ${policy.keyVersionResolved}`}>
                            v{policy.keyVersionResolved.slice(0, 8)}
                          </span>
                        )}
                      </span>
                    </div>
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
                      <div className="sla-sched-row"><span className="sla-sched-label">Retention:</span><span className="sla-sched-value">{policyRetentionLabel(policy)}</span></div>
                      <div className="sla-sched-row"><span className="sla-sched-label">Archiving:</span><span className="sla-sched-value">{policyArchivingLabel(policy)}</span></div>
                    </div>
                    <div className="sla-actions">
                      <button className="sla-action-btn" title="Edit (advanced)" onClick={() => { setWizardEditing(policy); setShowWizard(true); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button className="sla-action-btn" onClick={() => handleDelete(policy.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {policies.length < policiesTotal && (
                <div className="sla-load-more">
                  <button
                    className="sla-action-btn"
                    onClick={loadMorePolicies}
                    disabled={policiesLoadingMore}
                  >
                    {policiesLoadingMore
                      ? 'Loading…'
                      : `Load more (${policies.length} of ${policiesTotal})`}
                  </button>
                </div>
              )}
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

      {/* Secrets tab — lists the tenant's KMS keys + login secrets and
          lets the user add / inspect / delete them. Shared with the
          Azure DB Recover "new secret" flow (both write the same
          tenant_secrets row set). */}
      {tenantId && activeTab === 'secrets' && (
        <SecretsTab tenantId={tenantId} />
      )}


      {/* SLA wizard. Wrapped in ErrorBoundary so a render-time exception
          inside a single field (corrupt extra_data, bad date) doesn't
          take down the whole Settings page or strand the modal in a
          half-open state. */}
      {showWizard && tenantId && (
        <ErrorBoundary label="SLA wizard">
          <SlaWizard
            tenantId={tenantId}
            serviceType={effectiveServiceType}
            initialPolicy={wizardEditing}
            onClose={() => { setShowWizard(false); setWizardEditing(null); }}
            onSaved={(p) => {
              setPolicies(prev => {
                const idx = prev.findIndex(x => x.id === p.id);
                if (idx >= 0) { const next = [...prev]; next[idx] = p; return next; }
                return [...prev, p];
              });
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
