import { useState } from 'react';
import './Alerts.css';

interface Alert {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  tenant: string;
  time: string;
  resolved: boolean;
}

const mockAlerts: Alert[] = [
  { id: '1', severity: 'CRITICAL', message: 'Backup job failed for Contoso M365', tenant: 'Contoso M365', time: '5 min ago', resolved: false },
  { id: '2', severity: 'HIGH', message: 'Storage threshold exceeded', tenant: 'Fabrikam Azure', time: '1 hour ago', resolved: false },
  { id: '3', severity: 'MEDIUM', message: 'SLA policy not assigned to 3 resources', tenant: 'Contoso M365', time: '3 hours ago', resolved: false },
  { id: '4', severity: 'LOW', message: 'Daily report generated', tenant: 'Contoso M365', time: '6 hours ago', resolved: true },
  { id: '5', severity: 'HIGH', message: 'Connection timeout to Azure tenant', tenant: 'Fabrikam Azure', time: '1 day ago', resolved: true },
];

export default function Alerts() {
  const [showUnresolved, setShowUnresolved] = useState(false);

  const filteredAlerts = showUnresolved
    ? mockAlerts.filter(a => !a.resolved)
    : mockAlerts;

  const severityClass = (severity: string) => {
    return `severity-badge severity-${severity.toLowerCase()}`;
  };

  return (
    <div className="alerts-page">
      <div className="alerts-header">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showUnresolved}
            onChange={(e) => setShowUnresolved(e.target.checked)}
          />
          Show unresolved only
        </label>
      </div>

      <div className="alerts-container">
        {filteredAlerts.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 48, height: 48, color: '#a0aec0'}}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <p className="empty-state-text">No alerts to display</p>
          </div>
        ) : (
          <div className="alerts-list">
            {filteredAlerts.map((alert) => (
              <div key={alert.id} className={`alert-card ${alert.resolved ? 'resolved' : ''}`}>
                <div className="alert-header">
                  <span className={severityClass(alert.severity)}>{alert.severity}</span>
                  <span className="alert-time">{alert.time}</span>
                </div>
                <p className="alert-message">{alert.message}</p>
                <div className="alert-footer">
                  <span className="alert-tenant">{alert.tenant}</span>
                  {!alert.resolved && (
                    <button className="resolve-btn">Resolve</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {filteredAlerts.length > 0 && (
        <div className="pagination">
          <span className="pagination-info">
            Showing {filteredAlerts.length} of {mockAlerts.length} alerts
          </span>
        </div>
      )}
    </div>
  );
}
