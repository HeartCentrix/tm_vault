import { useState } from 'react';
import './Configuration.css';

export default function Configuration() {
  const [reportsEnabled, setReportsEnabled] = useState(true);
  const [schedule, setSchedule] = useState('daily');
  const [skipEmpty, setSkipEmpty] = useState(true);

  return (
    <div className="configuration-page">
      <div className="configuration-header">
        <h1 className="page-title">Configuration</h1>
      </div>

      <div className="configuration-content">
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
                    onChange={(e) => setSchedule(e.target.value)}
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
                        checked={skipEmpty}
                        onChange={(e) => setSkipEmpty(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </div>
                    <span className="toggle-text">Skip empty reports</span>
                  </label>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Notification Recipients */}
        <div className="config-section">
          <h2 className="section-title">Notification Recipients</h2>
          <div className="config-card">
            <div className="config-row">
              <label className="config-label">Email</label>
              <input type="email" className="config-input" placeholder="admin@contoso.com" />
            </div>
            <div className="config-row">
              <label className="config-label">Slack Webhook URL</label>
              <input type="url" className="config-input" placeholder="https://hooks.slack.com/services/..." />
            </div>
            <div className="config-row">
              <label className="config-label">Teams Webhook URL</label>
              <input type="url" className="config-input" placeholder="https://outlook.office.com/webhook/..." />
            </div>
            <div className="config-row">
              <label className="config-label">Google Chat Webhook URL</label>
              <input type="url" className="config-input" placeholder="https://chat.googleapis.com/v1/spaces/..." />
            </div>
            <button className="save-btn">Save Configuration</button>
          </div>
        </div>
      </div>
    </div>
  );
}
