/**
 * Settings → Storage — toggle between Azure Blob and on-prem SeaweedFS.
 * Org-admin only. Kicks off the 8-phase toggle via POST /api/admin/storage/toggle
 * and streams live phase transitions from the SSE endpoint.
 */
import { useEffect, useMemo, useState } from 'react';

import {
  AdminStorageService,
  type StorageBackend,
  type ToggleEvent,
  type ToggleStatus,
} from '../../services/adminStorage';
import './SettingsStorage.css';

export default function SettingsStoragePage() {
  const [status, setStatus] = useState<ToggleStatus | null>(null);
  const [backends, setBackends] = useState<StorageBackend[]>([]);
  const [events, setEvents] = useState<ToggleEvent[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = async () => {
    try {
      const [s, bs, es] = await Promise.all([
        AdminStorageService.status(),
        AdminStorageService.backends(),
        AdminStorageService.events(20),
      ]);
      setStatus(s);
      setBackends(bs);
      setEvents(es);
      setLastUpdated(new Date());
      // Clear any prior error once a refresh succeeds — without this,
      // an early failure (CORS outage, transient 401) wedges the page
      // into the error UI even after the backend recovers.
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, []);

  const targetBackend = useMemo(() => {
    if (!status) return null;
    return backends.find((b) => b.id !== status.active_backend.id) || null;
  }, [status, backends]);

  if (error) {
    return (
      <div className="storage-error">
        <span className="storage-eyebrow">System</span>
        <h1 className="storage-title">Storage</h1>
        <div className="storage-error-msg">Error: {error}</div>
        <button className="storage-switch-btn" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="storage-loading">
        <span className="storage-eyebrow">System</span>
        <h1 className="storage-title">Storage</h1>
        <p className="storage-desc">Loading backend status…</p>
      </div>
    );
  }

  // Defensive: a malformed status payload (e.g. orchestrator returned
  // an empty active_backend during a DB-reset window) used to crash
  // the page when StateCard accessed `status.active_backend.name` —
  // unmounting the whole tree and showing a blank screen. Render an
  // explicit error placeholder instead so the operator can hit Retry.
  if (!status.active_backend || !status.active_backend.name) {
    return (
      <div className="storage-error">
        <span className="storage-eyebrow">System</span>
        <h1 className="storage-title">Storage</h1>
        <div className="storage-error-msg">
          Backend metadata missing — system_config may not be seeded.
          Run the on-prem storage migration and retry.
        </div>
        <button className="storage-switch-btn" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="storage-page">
      <header className="storage-header">
        <span className="storage-eyebrow">System · Org Admin</span>
        <h1 className="storage-title">Storage</h1>
        <p className="storage-desc">
          Switch between Azure Blob and on-prem SeaweedFS. Toggling drains
          in-flight jobs, promotes the replica DB, restarts workers, and runs a
          smoke test before accepting new work.
        </p>
      </header>

      <StateCard status={status} lastUpdated={lastUpdated} onRefresh={refresh} />

      <div className="storage-actions">
        {targetBackend ? (
          <button
            className="storage-switch-btn"
            data-backend-kind={targetBackend.kind}
            data-backend-name={targetBackend.name}
            onClick={() => setModalOpen(true)}
            disabled={status.transition_state !== 'stable'}
          >
            Switch to {targetBackend.name}
          </button>
        ) : (
          <span className="storage-no-alt">No alternate backend configured.</span>
        )}
      </div>

      <HistoryCard events={events} />

      {modalOpen && targetBackend && (
        <ToggleModal
          target={targetBackend}
          onClose={() => {
            setModalOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function StateCard({
  status,
  lastUpdated,
  onRefresh,
}: {
  status: ToggleStatus;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  const pillClass =
    status.transition_state === 'stable'
      ? 'stable'
      : status.transition_state === 'draining'
      ? 'draining'
      : 'other';
  return (
    <section className="storage-state-card" aria-label="Active backend">
      <span className="storage-state-label">Active backend</span>
      <div className="storage-state-row">
        <span
          className="storage-state-name"
          data-backend-kind={status.active_backend.kind}
          data-backend-name={status.active_backend.name}
        >
          {status.active_backend.name}
        </span>
        <span className="storage-state-kind">{status.active_backend.kind}</span>
        <span className={`storage-state-pill ${pillClass}`}>
          {status.transition_state}
        </span>
      </div>
      <div className="storage-state-meta">
        <span>
          Inflight jobs: <strong>{status.inflight_jobs_count}</strong>
        </span>
        {lastUpdated && (
          <span style={{ marginLeft: 12, fontSize: 11, opacity: 0.65 }}>
            (updated {lastUpdated.toLocaleTimeString()})
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          style={{
            marginLeft: 12,
            padding: '2px 10px',
            fontSize: 11,
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 4,
            cursor: 'pointer',
            opacity: 0.75,
          }}
          title="Force refresh storage status"
        >
          ↻ Refresh
        </button>
      </div>
      {status.cooldown_until && (
        <div className="storage-state-cooldown">
          {formatCooldown(status.cooldown_until)}
        </div>
      )}
    </section>
  );
}

function HistoryCard({ events }: { events: ToggleEvent[] }) {
  if (events.length === 0) {
    return (
      <section className="storage-history">
        <div className="storage-history-header">
          <h2 className="storage-history-title">History</h2>
          <span className="storage-history-count">0 events</span>
        </div>
        <div className="storage-history-empty">No toggle events yet.</div>
      </section>
    );
  }
  return (
    <section className="storage-history">
      <div className="storage-history-header">
        <h2 className="storage-history-title">History</h2>
        <span className="storage-history-count">{events.length} events</span>
      </div>
      <div className="storage-table-wrap">
        <div className="storage-table-scroll">
          <table className="storage-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>From → To</th>
                <th>Status</th>
                <th>Drained / Retried</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="storage-hash">{formatStamp(e.started_at)}</td>
                  <td>
                    <span className="storage-hash">{e.from_backend_id.slice(0, 8)}</span>
                    <span className="storage-arrow">→</span>
                    <span className="storage-hash">{e.to_backend_id.slice(0, 8)}</span>
                  </td>
                  <td>
                    <span className={`storage-status ${e.status}`}>
                      {PHASE_LABEL[e.status] ?? e.status}
                    </span>
                  </td>
                  <td>
                    {e.drained_job_count ?? '—'} / {e.retried_job_count ?? '—'}
                  </td>
                  <td className="storage-err" title={e.error_message ?? ''}>
                    {e.error_message || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const PHASE_LABEL: Record<string, string> = {
  started: 'Queued',
  drain_started: 'Draining in-flight jobs',
  drain_completed: 'Drain complete',
  db_promoted: 'Database promoted',
  dns_flipped: 'DNS flipped',
  workers_restarted: 'Workers restarted',
  smoke_passed: 'Smoke tests passed',
  completed: '✓ Completed',
  aborted: '✗ Aborted',
  failed: '✗ Failed',
};

function formatCooldown(iso: string): string {
  const until = new Date(iso);
  const now = Date.now();
  const diffMs = until.getTime() - now;
  if (diffMs <= 0) return 'Cooldown ended';
  const secs = Math.floor(diffMs / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours >= 1) {
    return `Cooldown for ${hours}h ${mins % 60}m (until ${until.toLocaleTimeString()})`;
  }
  if (mins >= 1) return `Cooldown for ${mins}m ${secs % 60}s`;
  return `Cooldown for ${secs}s`;
}

function formatStamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}


function ToggleModal({
  target,
  onClose,
}: {
  target: StorageBackend;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phaseLog, setPhaseLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit =
    reason.trim().length >= 10 && confirm === 'TMVAULT-ORG' && !submitting;

  const TERMINAL = new Set(['completed', 'failed', 'aborted']);

  function appendPhase(status: string) {
    const label = PHASE_LABEL[status] ?? status;
    const time = new Date().toLocaleTimeString();
    setPhaseLog((l) => {
      // Dedupe — SSE + fallback poll can both deliver the same status.
      const last = l[l.length - 1] || '';
      const entry = `${time}  ${label}`;
      return last.endsWith(label) ? l : [...l, entry];
    });
  }

  function markTerminal(status: string) {
    setDone(true);
    setFinalStatus(status);
    setSubmitting(false);
    // Auto-close 3s after completion so the user sees the final phase
    // briefly but doesn't have to dismiss the modal manually. Aborts/
    // failures stay open so the operator can read the error.
    if (status === 'completed') {
      window.setTimeout(() => onClose(), 3000);
    }
  }

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await AdminStorageService.submitToggle({
        target_backend_id: target.id,
        reason,
        confirmation_text: confirm,
      });
      setPhaseLog((l) => [...l, `${new Date().toLocaleTimeString()}  Queued`]);

      let terminalSeen = false;
      const es = AdminStorageService.streamEvent(r.event_id, (data) => {
        const s = String(data.status || '');
        if (!s) return;
        appendPhase(s);
        if (TERMINAL.has(s) && !terminalSeen) {
          terminalSeen = true;
          if (data.error_message) setErr(String(data.error_message));
          markTerminal(s);
          es.close();
        }
      });

      // Fallback poll — if SSE drops silently (proxy timeout, auth drift
      // on the token query param, etc.) the modal must still settle.
      // Polls every 3s and resolves via the /events/{id} snapshot.
      const pollId = window.setInterval(async () => {
        if (terminalSeen) {
          window.clearInterval(pollId);
          return;
        }
        try {
          const evts = await AdminStorageService.events(20);
          const match = evts.find((e) => e.id === r.event_id);
          if (match) {
            appendPhase(match.status);
            if (TERMINAL.has(match.status)) {
              terminalSeen = true;
              if (match.error_message) setErr(match.error_message);
              markTerminal(match.status);
              es.close();
              window.clearInterval(pollId);
            }
          }
        } catch {
          /* ignore transient poll errors */
        }
      }, 3000);
    } catch (e) {
      setErr(String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="storage-modal-overlay" onClick={onClose}>
      <div
        className="storage-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="storage-modal-title"
          className="storage-modal-title"
          data-backend-kind={target.kind}
          data-backend-name={target.name}
        >
          Switch to {target.name}
        </h2>

        <div className="storage-modal-warn">
          Drains in-flight jobs, promotes the replica DB, restarts workers, and
          runs a smoke test. Expect 5–15 min downtime for new job acceptance.
          Pre-toggle snapshots remain readable after the switch.
        </div>

        <label className="storage-modal-field">
          Reason
          <span className="storage-modal-field-hint">min 10 chars</span>
          <textarea
            className="storage-modal-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            disabled={submitting}
          />
        </label>

        <label className="storage-modal-field">
          Type <code>TMVAULT-ORG</code> to confirm
          <input
            className="storage-modal-input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
          />
        </label>

        {phaseLog.length > 0 && (
          <pre className="storage-modal-log">{phaseLog.join('\n')}</pre>
        )}
        {done && finalStatus && (
          <div className={`storage-modal-final ${finalStatus}`}>
            {PHASE_LABEL[finalStatus] ?? finalStatus}
            {finalStatus === 'completed' && ' — closing in 3s…'}
          </div>
        )}
        {err && <div className="storage-modal-error">{err}</div>}

        <div className="storage-modal-actions">
          <button className="storage-modal-btn ghost" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              className="storage-modal-btn primary"
              onClick={submit}
              disabled={!canSubmit}
            >
              {submitting ? 'Running…' : 'Start toggle'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
