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

export default function SettingsStoragePage() {
  const [status, setStatus] = useState<ToggleStatus | null>(null);
  const [backends, setBackends] = useState<StorageBackend[]>([]);
  const [events, setEvents] = useState<ToggleEvent[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div style={{ padding: 24 }}>
        <h1>Storage</h1>
        <div style={{ color: 'red' }}>Error: {error}</div>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (!status) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1>Storage</h1>

      <StateCard status={status} />

      <div style={{ margin: '16px 0' }}>
        {targetBackend ? (
          <button
            onClick={() => setModalOpen(true)}
            disabled={status.transition_state !== 'stable'}
            style={{
              padding: '10px 16px',
              fontSize: 15,
              background: '#0b6fd6',
              color: 'white',
              border: 0,
              borderRadius: 4,
              cursor: status.transition_state === 'stable' ? 'pointer' : 'not-allowed',
              opacity: status.transition_state === 'stable' ? 1 : 0.6,
            }}
          >
            Switch to {targetBackend.name}
          </button>
        ) : (
          <span style={{ color: '#888' }}>No alternate backend configured.</span>
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

function StateCard({ status }: { status: ToggleStatus }) {
  const pillColor =
    status.transition_state === 'stable'
      ? '#2b8a3e'
      : status.transition_state === 'draining'
      ? '#e67700'
      : '#c62828';
  return (
    <div
      style={{
        border: '1px solid #e4e4e4',
        borderRadius: 8,
        padding: 16,
        background: 'white',
      }}
    >
      <h3 style={{ margin: 0 }}>Active backend</h3>
      <div style={{ marginTop: 8 }}>
        <span
          style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: 12,
            background: pillColor,
            color: 'white',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {status.active_backend.name} ({status.active_backend.kind})
        </span>
        <span style={{ marginLeft: 12, color: '#666', fontSize: 13 }}>
          state: {status.transition_state} · inflight jobs:{' '}
          {status.inflight_jobs_count}
        </span>
      </div>
      {status.cooldown_until && (
        <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
          {formatCooldown(status.cooldown_until)}
        </div>
      )}
    </div>
  );
}

function HistoryCard({ events }: { events: ToggleEvent[] }) {
  if (events.length === 0) {
    return (
      <div
        style={{
          marginTop: 24,
          border: '1px solid #e4e4e4',
          borderRadius: 8,
          padding: 16,
          color: '#888',
        }}
      >
        No toggle events yet.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 24 }}>
      <h3>History</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={thStyle}>Started</th>
            <th style={thStyle}>From → To</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Drained / Retried</th>
            <th style={thStyle}>Error</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={tdStyle}>{formatStamp(e.started_at)}</td>
              <td style={tdStyle}>
                {e.from_backend_id.slice(0, 8)} → {e.to_backend_id.slice(0, 8)}
              </td>
              <td
                style={{
                  ...tdStyle,
                  color:
                    e.status === 'completed'
                      ? '#2b8a3e'
                      : e.status === 'failed' || e.status === 'aborted'
                      ? '#c62828'
                      : '#e67700',
                }}
              >
                {PHASE_LABEL[e.status] ?? e.status}
              </td>
              <td style={tdStyle}>
                {e.drained_job_count ?? '—'} / {e.retried_job_count ?? '—'}
              </td>
              <td style={{ ...tdStyle, color: '#c62828' }}>
                {e.error_message || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 10px' };
const tdStyle: React.CSSProperties = { padding: '6px 10px' };

// Human-readable names for the raw orchestrator status codes — matches
// orchestrator.run_toggle() phases. Kept in one place so we can update
// backend + UI labels together.
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 8,
          padding: 24,
          width: 520,
          maxWidth: '90vw',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Switch to {target.name}</h2>
        <p style={{ color: '#555', fontSize: 13 }}>
          This drains in-flight jobs, promotes the replica DB, restarts workers,
          and runs a smoke test. Expected 5–15 min downtime for new job
          acceptance. Pre-toggle snapshots remain readable after the switch.
        </p>
        <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
          Reason (min 10 chars):
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
            disabled={submitting}
          />
        </label>
        <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
          Type <code>TMVAULT-ORG</code> to confirm:
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
            disabled={submitting}
          />
        </label>
        {phaseLog.length > 0 && (
          <pre
            style={{
              marginTop: 12,
              padding: 10,
              background: '#0e1116',
              color: '#b3e5ab',
              fontSize: 12,
              maxHeight: 200,
              overflow: 'auto',
              borderRadius: 4,
            }}
          >
            {phaseLog.join('\n')}
          </pre>
        )}
        {done && finalStatus && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              background:
                finalStatus === 'completed'
                  ? '#e6f4ea'
                  : '#fdecea',
              color:
                finalStatus === 'completed' ? '#1e7e34' : '#a71d2a',
            }}
          >
            {PHASE_LABEL[finalStatus] ?? finalStatus}
            {finalStatus === 'completed' && ' — closing in 3s…'}
          </div>
        )}
        {err && <div style={{ color: 'red', marginTop: 8 }}>{err}</div>}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {!done && (
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                background: canSubmit ? '#0b6fd6' : '#888',
                color: 'white',
                border: 0,
                padding: '8px 14px',
                borderRadius: 4,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? 'Running…' : 'Start toggle'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
