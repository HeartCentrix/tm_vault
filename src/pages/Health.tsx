/**
 * Health — application-wide health overview.
 *
 * Hits GET /api/v1/health (aggregated across all services + subsystems) and
 * renders an overall colored dot plus a per-component breakdown. Auto-refreshes
 * every 30s. A logged-in session gets full detail (service matrix, queue/worker
 * specifics); unauthenticated callers get a coarse summary.
 */
import { useCallback, useEffect, useState } from 'react';
import HealthDot from '../components/HealthDot';
import { getHealth, type HealthStatus } from '../services/health';
import './Health.css';

const COMPONENT_LABELS: Record<string, string> = {
  database: 'Database (PostgreSQL)',
  rabbitmq: 'Message bus (RabbitMQ)',
  queues: 'Queues & consumers',
  workers: 'Workers',
  storage: 'Storage backend',
  leases: 'Work leases',
  subsystems: 'Subsystems',
};

export default function Health() {
  const [data, setData] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const h = await getHealth();
      setData(h);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30000);
    return () => clearInterval(iv);
  }, [refresh]);

  return (
    <div className="health-page">
      <div className="health-header">
        <div className="health-header-left">
          <h1>Application Health</h1>
          {data && <HealthDot status={data.status} size="lg" />}
        </div>
        <div className="health-header-right">
          {lastUpdated && (
            <span className="health-updated">Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
          <button className="health-refresh" onClick={refresh}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="health-empty">Loading health status…</div>
      ) : error && !data ? (
        <div className="health-empty health-error">Failed to load health: {error}</div>
      ) : data ? (
        <>
          {data.services && (
            <div className="health-services">
              <span className="health-services-summary">
                {data.services.up} services up
                {data.services.down ? `, ${data.services.down} down` : ''}
              </span>
              {data.services.down_list && data.services.down_list.length > 0 && (
                <span className="health-services-down">
                  Down: {data.services.down_list.join(', ')}
                </span>
              )}
            </div>
          )}

          <div className="health-grid">
            {Object.entries(data.components).map(([key, comp]) => (
              <div key={key} className={`health-card health-card-${comp.status}`}>
                <div className="health-card-head">
                  <span className="health-card-title">{COMPONENT_LABELS[key] ?? key}</span>
                  <HealthDot status={comp.status} size="sm" />
                </div>
                {comp.detail && <div className="health-card-detail">{comp.detail}</div>}
                {comp.no_consumer && comp.no_consumer.length > 0 && (
                  <div className="health-card-flag">No consumer: {comp.no_consumer.join(', ')}</div>
                )}
                {comp.dlq_nonempty && comp.dlq_nonempty.length > 0 && (
                  <div className="health-card-flag">DLQ backlog: {comp.dlq_nonempty.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="health-empty">No health data.</div>
      )}
    </div>
  );
}
