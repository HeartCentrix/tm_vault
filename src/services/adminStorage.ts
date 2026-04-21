/**
 * Admin Storage Service — toggle between Azure Blob and on-prem SeaweedFS.
 */
import { API } from '../config/api';

export interface StorageBackend {
  id: string;
  kind: string;
  name: string;
  endpoint: string;
  is_enabled: boolean;
}

export interface ToggleStatus {
  active_backend: StorageBackend;
  transition_state: 'stable' | 'draining' | 'flipping';
  last_toggle_at: string | null;
  cooldown_until: string | null;
  inflight_jobs_count: number;
}

export interface ToggleEvent {
  id: string;
  actor_id: string;
  from_backend_id: string;
  to_backend_id: string;
  reason: string | null;
  status: string;
  started_at: string;
  drain_completed_at: string | null;
  flip_completed_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  drained_job_count: number | null;
  retried_job_count: number | null;
}

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('access_token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
};

export const AdminStorageService = {
  async status(): Promise<ToggleStatus> {
    const r = await fetch(API.ADMIN_STORAGE.STATUS, { headers: getAuthHeaders() });
    if (!r.ok) throw new Error(`status: ${r.status}`);
    return r.json();
  },

  async backends(): Promise<StorageBackend[]> {
    const r = await fetch(API.ADMIN_STORAGE.BACKENDS, { headers: getAuthHeaders() });
    if (!r.ok) throw new Error(`backends: ${r.status}`);
    return r.json();
  },

  async submitToggle(params: {
    target_backend_id: string;
    reason: string;
    confirmation_text: string;
  }): Promise<{ event_id: string; status: string }> {
    const r = await fetch(API.ADMIN_STORAGE.TOGGLE, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`toggle ${r.status}: ${body}`);
    }
    return r.json();
  },

  async events(limit = 20): Promise<ToggleEvent[]> {
    const r = await fetch(`${API.ADMIN_STORAGE.EVENTS}?limit=${limit}`, {
      headers: getAuthHeaders(),
    });
    if (!r.ok) throw new Error(`events: ${r.status}`);
    return r.json();
  },

  async abort(eventId: string): Promise<void> {
    const r = await fetch(API.ADMIN_STORAGE.ABORT(eventId), {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!r.ok) throw new Error(`abort: ${r.status}`);
  },

  streamEvent(
    eventId: string,
    onStatus: (data: Record<string, unknown>) => void
  ): EventSource {
    const url = API.ADMIN_STORAGE.EVENT_STREAM(eventId);
    // Native EventSource doesn't forward auth headers — token must be in URL
    // or the endpoint must accept cookies. For this internal-only flow we
    // pass the token as a query param and api-gateway accepts it.
    const token = localStorage.getItem('access_token');
    const withAuth = token ? `${url}?token=${encodeURIComponent(token)}` : url;
    const es = new EventSource(withAuth);
    es.addEventListener('status', (evt: MessageEvent) => {
      try {
        onStatus(JSON.parse(evt.data));
      } catch {
        /* noop */
      }
    });
    return es;
  },
};
