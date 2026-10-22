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

/**
 * Friendly display label for a storage backend, derived from its endpoint/kind
 * (display-only — does not change which backend is used). The S3-compatible
 * slot (kind `seaweedfs`) is pointed at Wasabi in this deployment, so an
 * endpoint on `wasabisys.com` is surfaced as "Wasabi (S3)" rather than the raw
 * "seaweedfs-local" name. If that slot is ever repointed at a real SeaweedFS
 * host the label correctly falls back to SeaweedFS.
 */
export function backendLabel(b: StorageBackend): string {
  const ep = (b.endpoint || '').toLowerCase();
  if (ep.includes('wasabisys.com')) return 'Wasabi (S3)';
  if (b.kind === 'azure_blob') return 'Azure Blob';
  if (b.kind === 'seaweedfs') return 'SeaweedFS';
  return b.name;
}

/** Short sub-label (region/host) shown beside the friendly name. */
export function backendDetail(b: StorageBackend): string {
  const ep = (b.endpoint || '').toLowerCase();
  const wasabi = ep.match(/s3\.([a-z0-9-]+)\.wasabisys\.com/);
  if (wasabi) return `wasabi · ${wasabi[1]}`;
  return b.kind;
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

// Auth rides on the HttpOnly cookie set by /auth/callback. fetch() picks
// it up automatically thanks to the credentials: 'include' default in
// main.tsx, so no per-call header construction is needed.
const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

export const AdminStorageService = {
  async status(): Promise<ToggleStatus> {
    // cache: 'no-store' + a cache-buster query so neither the browser
    // disk cache nor any intermediate proxy can serve a stale status.
    const url = `${API.ADMIN_STORAGE.STATUS}?_t=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`status: ${r.status}`);
    return r.json();
  },

  async backends(): Promise<StorageBackend[]> {
    const r = await fetch(API.ADMIN_STORAGE.BACKENDS);
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
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`toggle ${r.status}: ${body}`);
    }
    return r.json();
  },

  async events(limit = 20): Promise<ToggleEvent[]> {
    const r = await fetch(`${API.ADMIN_STORAGE.EVENTS}?limit=${limit}`);
    if (!r.ok) throw new Error(`events: ${r.status}`);
    return r.json();
  },

  async abort(eventId: string): Promise<void> {
    const r = await fetch(API.ADMIN_STORAGE.ABORT(eventId), { method: 'POST' });
    if (!r.ok) throw new Error(`abort: ${r.status}`);
  },

  streamEvent(
    eventId: string,
    onStatus: (data: Record<string, unknown>) => void
  ): EventSource {
    const url = API.ADMIN_STORAGE.EVENT_STREAM(eventId);
    // EventSource carries the HttpOnly cookie when withCredentials=true; the
    // gateway translates that cookie to a Bearer header for the upstream
    // service. Don't pass the token in the URL — that leaks it to logs.
    const es = new EventSource(url, { withCredentials: true });
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
