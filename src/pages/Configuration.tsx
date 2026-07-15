import { useState, useEffect } from 'react';
import { reportService } from '../services/reports';
import type { WebhookConfig } from '../services/reports';
import './Configuration.css';

export default function Configuration() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [manualReportType, setManualReportType] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Report config state
  const [reportsEnabled, setReportsEnabled] = useState(false);
  const [schedule, setSchedule] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [sendEmptyReport, setSendEmptyReport] = useState(true);
  const [emptyMessage, setEmptyMessage] = useState('No updates. No backups occurred.');
  const [sendDetailedReport, setSendDetailedReport] = useState(false);

  // Notification endpoints
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  
  const [slackWebhooks, setSlackWebhooks] = useState<WebhookConfig[]>([]);
  const [teamsWebhooks, setTeamsWebhooks] = useState<WebhookConfig[]>([]);

  // Snapshot of the last-saved config; the form is "dirty" when it diverges.
  // Prevents the silent-loss trap where "+ Add" stages a change locally but the
  // user navigates away before clicking Save.
  const [savedSnapshot, setSavedSnapshot] = useState('');

  // Load configuration on mount
  useEffect(() => {
    loadConfiguration();
  }, []);

  const buildPayload = (v: {
    enabled: boolean; schedule_type: string; send_empty_report: boolean;
    empty_message: string; send_detailed_report: boolean;
    email_recipients: string[]; slack_webhooks: WebhookConfig[]; teams_webhooks: WebhookConfig[];
  }) => ({
    enabled: v.enabled,
    schedule_type: v.schedule_type,
    send_empty_report: v.send_empty_report,
    empty_message: v.empty_message,
    send_detailed_report: v.send_detailed_report,
    email_recipients: v.email_recipients,
    slack_webhooks: v.slack_webhooks,
    teams_webhooks: v.teams_webhooks,
  });

  const currentPayload = () => buildPayload({
    enabled: reportsEnabled, schedule_type: schedule, send_empty_report: sendEmptyReport,
    empty_message: emptyMessage, send_detailed_report: sendDetailedReport,
    email_recipients: emailRecipients, slack_webhooks: slackWebhooks, teams_webhooks: teamsWebhooks,
  });

  const dirty = savedSnapshot !== '' && JSON.stringify(currentPayload()) !== savedSnapshot;

  // Warn before a browser refresh/close/URL navigation drops unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const loadConfiguration = async () => {
    try {
      setLoading(true);
      const config = await reportService.getConfig();
      
      const resolved = {
        enabled: config.enabled,
        schedule_type: config.schedule_type,
        send_empty_report: config.send_empty_report,
        empty_message: config.empty_message || 'No updates. No backups occurred.',
        send_detailed_report: config.send_detailed_report ?? false,
        email_recipients: config.email_recipients || [],
        slack_webhooks: config.slack_webhooks || [],
        teams_webhooks: config.teams_webhooks || [],
      };
      setReportsEnabled(resolved.enabled);
      setSchedule(resolved.schedule_type);
      setSendEmptyReport(resolved.send_empty_report);
      setEmptyMessage(resolved.empty_message);
      setSendDetailedReport(resolved.send_detailed_report);
      setEmailRecipients(resolved.email_recipients);
      setSlackWebhooks(resolved.slack_webhooks);
      setTeamsWebhooks(resolved.teams_webhooks);
      setSavedSnapshot(JSON.stringify(buildPayload(resolved)));
    } catch (error) {
      console.error('Failed to load configuration:', error);
      setMessage({ type: 'error', text: 'Failed to load configuration' });
    } finally {
      setLoading(false);
    }
  };

  const handleSendReport = async () => {
    try {
      setSending(true);
      setMessage(null);
      const reportType = manualReportType;
      const result = await reportService.sendReport(reportType);
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
    } catch (error) {
      console.error('Failed to send report:', error);
      setMessage({ type: 'error', text: 'Failed to send report' });
    } finally {
      setSending(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);

      const payload = currentPayload();
      await reportService.updateConfig(payload);
      setSavedSnapshot(JSON.stringify(payload));  // form is now clean

      setMessage({ type: 'success', text: 'Configuration saved successfully!' });
    } catch (error) {
      console.error('Failed to save configuration:', error);
      setMessage({ type: 'error', text: 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  // Email helpers
  const addEmail = () => {
    if (newEmail && !emailRecipients.includes(newEmail)) {
      setEmailRecipients([...emailRecipients, newEmail]);
      setNewEmail('');
    }
  };

  const removeEmail = (email: string) => {
    setEmailRecipients(emailRecipients.filter(e => e !== email));
  };

  // Webhook helpers
  const addWebhook = (type: 'slack' | 'teams', url: string) => {
    const name = `Webhook ${getWebhooks(type).length + 1}`;
    const webhook: WebhookConfig = { name, url, enabled: true };

    if (type === 'slack') {
      setSlackWebhooks([...slackWebhooks, webhook]);
    } else {
      setTeamsWebhooks([...teamsWebhooks, webhook]);
    }
  };

  const removeWebhook = (type: 'slack' | 'teams', index: number) => {
    if (type === 'slack') {
      setSlackWebhooks(slackWebhooks.filter((_, i) => i !== index));
    } else {
      setTeamsWebhooks(teamsWebhooks.filter((_, i) => i !== index));
    }
  };

  const toggleWebhook = (type: 'slack' | 'teams', index: number) => {
    if (type === 'slack') {
      setSlackWebhooks(slackWebhooks.map((w, i) => i === index ? { ...w, enabled: !w.enabled } : w));
    } else {
      setTeamsWebhooks(teamsWebhooks.map((w, i) => i === index ? { ...w, enabled: !w.enabled } : w));
    }
  };

  const getWebhooks = (type: 'slack' | 'teams') => {
    if (type === 'slack') return slackWebhooks;
    return teamsWebhooks;
  };

  if (loading) {
    return (
      <div className="configuration-page">
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="configuration-page">
      <div className="configuration-content">
        {/* Success/Error Messages */}
        {message && (
          <div className={`message ${message.type}`}>
            {message.text}
            <button className="close-message" onClick={() => setMessage(null)}>×</button>
          </div>
        )}

        {/* Reports Section */}
        <div className="config-section">
          <h2 className="section-title">Reports</h2>
          <div className="config-card">
            <div className="config-row">
              <label className="toggle-label">
                <div className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={reportsEnabled}
                    onChange={(e) => setReportsEnabled(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </div>
                <span className="toggle-text">Enable scheduled reports</span>
              </label>
            </div>

            {reportsEnabled && (
              <>
                <div className="config-row">
                  <label className="config-label">Schedule</label>
                  <select
                    className="config-select"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value as 'daily' | 'weekly' | 'monthly')}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div className="config-row">
                  <label className="toggle-label">
                    <div className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={sendEmptyReport}
                        onChange={(e) => setSendEmptyReport(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </div>
                    <span className="toggle-text">Send empty reports</span>
                  </label>
                  <p className="config-help">
                    When enabled, a message will be sent even if no backups occurred.
                    When disabled, reports will only be sent when there is backup data.
                  </p>
                </div>

                <div className="config-row">
                  <label className="toggle-label">
                    <div className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={sendDetailedReport}
                        onChange={(e) => setSendDetailedReport(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </div>
                    <span className="toggle-text">Send detailed report</span>
                  </label>
                  <p className="config-help">
                    When enabled, a CSV attachment with individual backup details (resource name, time, size) will be included in email reports.
                  </p>
                </div>

                {sendEmptyReport && (
                  <div className="config-row">
                    <label className="config-label">Empty report message</label>
                    <input
                      type="text"
                      className="config-input"
                      value={emptyMessage}
                      onChange={(e) => setEmptyMessage(e.target.value)}
                      placeholder="Message to send when no backups occurred"
                    />
                  </div>
                )}

                <div className="config-row">
                  <div className="send-report-row">
                    <div>
                      <span className="config-label">Send Report Now</span>
                      <p className="config-help">Manually trigger a report to all configured channels.</p>
                    </div>
                    <div className="send-report-controls">
                      <select
                        className="config-select"
                        value={manualReportType}
                        onChange={(e) => setManualReportType(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')}
                      >
                        <option value="DAILY">Daily</option>
                        <option value="WEEKLY">Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                      </select>
                      <button className="send-report-btn" onClick={handleSendReport} disabled={sending}>
                        {sending ? 'Sending...' : 'Send Now'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Email Recipients */}
        {reportsEnabled && (
          <div className="config-section">
            <h2 className="section-title">Email Recipients</h2>
            <div className="config-card">
              <div className="email-input-row">
                <input
                  type="email"
                  className="config-input"
                  placeholder="Enter email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addEmail()}
                />
                <button className="add-btn" onClick={addEmail}>
                  + Add
                </button>
              </div>

              {emailRecipients.length > 0 && (
                <div className="email-list">
                  {emailRecipients.map((email, index) => (
                    <div key={index} className="email-item">
                      <span>{email}</span>
                      <button className="remove-btn" onClick={() => removeEmail(email)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Webhook Endpoints */}
        {reportsEnabled && (
          <>
            {/* Slack Webhooks */}
            <WebhookSection
              title="Slack Webhooks"
              webhooks={slackWebhooks}
              onAdd={(url) => addWebhook('slack', url)}
              onRemove={(index) => removeWebhook('slack', index)}
              onToggle={(index) => toggleWebhook('slack', index)}
            />

            {/* Teams Webhooks */}
            <WebhookSection
              title="Teams Webhooks"
              webhooks={teamsWebhooks}
              onAdd={(url) => addWebhook('teams', url)}
              onRemove={(index) => removeWebhook('teams', index)}
              onToggle={(index) => toggleWebhook('teams', index)}
            />
          </>
        )}

        {/* Save Button */}
        <div className="config-save-bar">
          {dirty && (
            <span className="config-unsaved" role="status">
              <span className="config-unsaved-dot" aria-hidden="true" />
              Unsaved changes — click Save to keep them
            </span>
          )}
          <button
            className={`save-btn${dirty ? ' save-btn--dirty' : ''}`}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving...' : dirty ? 'Save Configuration' : 'Saved'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Webhook Section Component
function WebhookSection({
  title,
  webhooks,
  onAdd,
  onRemove,
  onToggle,
}: {
  title: string;
  webhooks: WebhookConfig[];
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  onToggle: (index: number) => void;
}) {
  const [newUrl, setNewUrl] = useState('');

  const handleAdd = () => {
    if (newUrl) {
      onAdd(newUrl);
      setNewUrl('');
    }
  };

  return (
    <div className="config-section">
      <h2 className="section-title">{title}</h2>
      <div className="config-card">
        <div className="webhook-input-row">
          <input
            type="url"
            className="config-input"
            placeholder={`Enter ${title} webhook URL`}
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="add-btn" onClick={handleAdd}>
            + Add
          </button>
        </div>

        {webhooks.length > 0 && (
          <div className="webhook-list">
            {webhooks.map((webhook, index) => (
              <div key={index} className="webhook-item">
                <label className="toggle-label">
                  <div className="toggle-switch small">
                    <input
                      type="checkbox"
                      checked={webhook.enabled}
                      onChange={() => onToggle(index)}
                    />
                    <span className="toggle-slider" />
                  </div>
                  <span className="webhook-info">
                    <strong>{webhook.name}</strong>
                    <br />
                    <span className="webhook-url">{webhook.url}</span>
                  </span>
                </label>
                <button className="remove-btn" onClick={() => onRemove(index)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
