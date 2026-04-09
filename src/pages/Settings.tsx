import { useState } from 'react';
import './Settings.css';

type SettingsTab = 'sla' | 'info' | 'admin' | 'apps' | 'access' | 'secrets' | 'saml';

interface SlaPolicy {
  id: string;
  name: string;
  tier: 'GOLD' | 'SILVER' | 'BRONZE' | 'MANUAL' | 'CUSTOM';
  frequency: string;
  retention: string;
  resources: number;
}

const mockPolicies: SlaPolicy[] = [
  { id: '1', name: 'Gold Policy', tier: 'GOLD', frequency: 'Every 6 hours', retention: 'Indefinite', resources: 450 },
  { id: '2', name: 'Silver Policy', tier: 'SILVER', frequency: 'Daily', retention: '30 days', resources: 320 },
  { id: '3', name: 'Bronze Policy', tier: 'BRONZE', frequency: 'Weekly', retention: '7 days', resources: 200 },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('sla');

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'sla', label: 'SLA Policies' },
    { key: 'info', label: 'Info' },
    { key: 'admin', label: 'Admin Consent' },
    { key: 'apps', label: 'Apps' },
    { key: 'access', label: 'Access Groups' },
    { key: 'secrets', label: 'Secrets' },
    { key: 'saml', label: 'SAML/Okta' },
  ];

  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="settings-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`settings-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {activeTab === 'sla' && (
          <div className="sla-tab">
            <div className="sla-header">
              <h2 className="sla-title">SLA Policies</h2>
              <button className="create-policy-btn" onClick={() => setShowCreateModal(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Create Policy
              </button>
            </div>

            <div className="sla-list">
              {mockPolicies.map((policy) => (
                <div key={policy.id} className="sla-card">
                  <div className="sla-card-header">
                    <div className="sla-card-title">
                      <span className={`tier-badge tier-${policy.tier.toLowerCase()}`}>{policy.tier}</span>
                      <h3 className="sla-name">{policy.name}</h3>
                    </div>
                    <div className="sla-actions">
                      <button className="edit-btn">Edit</button>
                      <button className="delete-btn">Delete</button>
                    </div>
                  </div>
                  <div className="sla-card-details">
                    <div className="sla-detail-item">
                      <span className="sla-detail-label">Frequency</span>
                      <span className="sla-detail-value">{policy.frequency}</span>
                    </div>
                    <div className="sla-detail-item">
                      <span className="sla-detail-label">Retention</span>
                      <span className="sla-detail-value">{policy.retention}</span>
                    </div>
                    <div className="sla-detail-item">
                      <span className="sla-detail-label">Resources</span>
                      <span className="sla-detail-value">{policy.resources}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'info' && (
          <div className="info-tab">
            <h2 className="info-title">Tenant Information</h2>
            <div className="info-card">
              <div className="info-row">
                <span className="info-label">Customer ID</span>
                <span className="info-value">CUST-001</span>
              </div>
              <div className="info-row">
                <span className="info-label">Tenant ID</span>
                <span className="info-value">tenant-abc-123</span>
              </div>
              <div className="info-row">
                <span className="info-label">Region</span>
                <span className="info-value">US East</span>
              </div>
              <button className="download-btn">Download Usage Report</button>
            </div>
          </div>
        )}

        {activeTab === 'access' && (
          <div className="access-tab">
            <div className="access-header">
              <h2 className="access-title">Access Groups</h2>
              <button className="create-group-btn">Create Group</button>
            </div>
            <div className="empty-state">
              <p>No access groups configured</p>
            </div>
          </div>
        )}

        {!['sla', 'info', 'access'].includes(activeTab) && (
          <div className="empty-state">
            <p>{tabs.find(t => t.key === activeTab)?.label} - Coming soon</p>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content sla-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCreateModal(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div className="modal-header">
              <h3 className="modal-title">Create SLA Policy</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Policy Name</label>
                <input type="text" className="form-input" placeholder="Enter policy name" />
              </div>
              <div className="form-group">
                <label className="form-label">Tier</label>
                <select className="form-select">
                  <option>Gold</option>
                  <option>Silver</option>
                  <option>Bronze</option>
                  <option>Manual</option>
                  <option>Custom</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Frequency</label>
                <select className="form-select">
                  <option>Every 6 hours</option>
                  <option>Daily</option>
                  <option>Weekly</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Retention</label>
                <select className="form-select">
                  <option>Indefinite</option>
                  <option>30 days</option>
                  <option>90 days</option>
                  <option>1 year</option>
                </select>
              </div>
              <div className="form-actions">
                <button className="cancel-btn" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button className="save-btn">Create Policy</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
