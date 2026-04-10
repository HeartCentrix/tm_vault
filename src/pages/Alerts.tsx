import { useState, useEffect } from 'react';
import './Alerts.css';
import { AlertService, type AlertItem } from '../services/alerts';

const severityColors: Record<string, string> = {
  CRITICAL: '#e53e3e',
  HIGH: '#dd6b20',
  MEDIUM: '#d69e2e',
  LOW: '#718096',
};

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await AlertService.listAlerts(page, 20, { unresolvedOnly });
      setAlerts(response.content);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [unresolvedOnly, page]);

  const handleResolve = async (alertId: string) => {
    setResolvingId(alertId);
    try {
      await AlertService.resolveAlert(alertId);
      // Remove from list
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'RESOLVED', resolved: true } : a));
    } catch (err) {
      console.error('Failed to resolve alert:', err);
    } finally {
      setResolvingId(null);
    }
  };

  const unresolvedCount = alerts.filter(a => a.status === 'ACTIVE').length;

  return (
    <div className="alerts-page">
      <div className="alerts-header">
        <h1>Alerts</h1>
        <div className="alerts-summary">
          <span className="summary-item critical">
            {alerts.filter(a => a.severity === 'CRITICAL' && a.status === 'ACTIVE').length} Critical
          </span>
          <span className="summary-item high">
            {alerts.filter(a => a.severity === 'HIGH' && a.status === 'ACTIVE').length} High
          </span>
          <span className="summary-item medium">
            {alerts.filter(a => a.severity === 'MEDIUM' && a.status === 'ACTIVE').length} Medium
          </span>
          <span className="summary-item low">
            {alerts.filter(a => a.severity === 'LOW' && a.status === 'ACTIVE').length} Low
          </span>
        </div>
      </div>

      <div className="alerts-toolbar">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unresolvedOnly}
            onChange={() => {
              setUnresolvedOnly(!unresolvedOnly);
              setPage(1);
            }}
          />
          Show unresolved only
        </label>
        <span className="total-count">{totalElements} total alerts</span>
      </div>

      {loading && (
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading alerts...</p>
        </div>
      )}

      {error && (
        <div className="error-banner">{error}</div>
      )}

      {!loading && !error && alerts.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 64, height: 64, color: '#38a169'}}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <h3>All clear!</h3>
          <p>No alerts to display</p>
        </div>
      )}

      {!loading && !error && alerts.length > 0 && (
        <div className="alerts-list">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`alert-card ${alert.status === 'RESOLVED' ? 'resolved' : ''}`}
            >
              <div className="alert-severity" style={{ backgroundColor: severityColors[alert.severity] || '#718096' }}>
                {alert.severity}
              </div>
              <div className="alert-content">
                <div className="alert-title">
                  {alert.title || alert.message?.substring(0, 50)}
                </div>
                <div className="alert-description">
                  {alert.description || alert.message}
                </div>
                <div className="alert-meta">
                  {alert.tenantId && <span>Tenant: {alert.tenantId}</span>}
                  {alert.resourceType && <span>Type: {alert.resourceType}</span>}
                  {alert.resourceName && <span>Resource: {alert.resourceName}</span>}
                  <span>{formatTime(alert.createdAt)}</span>
                </div>
              </div>
              <div className="alert-actions">
                {alert.status === 'ACTIVE' && (
                  <button
                    className="resolve-btn"
                    onClick={() => handleResolve(alert.id)}
                    disabled={resolvingId === alert.id}
                  >
                    {resolvingId === alert.id ? 'Resolving...' : 'Resolve'}
                  </button>
                )}
                {alert.status === 'RESOLVED' && (
                  <span className="resolved-badge">Resolved</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
