// Background export-job store. Exports (PST / ZIP / EML / MBOX / Entra / Teams
// chat) are server-side jobs: the API returns a jobId, we poll /jobs/{id} until
// COMPLETED, then fetch the artifact and trigger a browser download.
//
// This store lives at module scope — NOT inside a React component — so the poll
// survives route navigation (the user can move across screens while it runs).
// A single <ExportToasts/> mounted at the app root renders progress bottom-right.
// Auth is handled by the global window.fetch interceptor (main.tsx), so plain
// fetch() here is authenticated automatically.
//
// Caveat: closing the browser TAB stops the JS, so the auto-download can't fire
// then — the job still finishes server-side and is re-downloadable from Activity.
import { API } from '../config/api';

export type ExportJobStatus = 'running' | 'ready' | 'failed';

export interface ExportJob {
  id: string;
  label: string;
  status: ExportJobStatus;
  startedAt: number;
  error?: string;
}

type Listener = () => void;

const jobs = new Map<string, ExportJob>();
// Per-job cancel plumbing kept out of the rendered snapshot.
const cancelUrls = new Map<string, string>(); // server-side cancel endpoint
const stoppers = new Map<string, () => void>(); // client-side stop (e.g. close SSE)
const listeners = new Set<Listener>();
let snapshot: ExportJob[] = [];

function emit() {
  // Rebuild the array reference only on change so useSyncExternalStore is stable.
  snapshot = Array.from(jobs.values());
  listeners.forEach((l) => l());
}

function set(id: string, patch: Partial<ExportJob>) {
  const j = jobs.get(id);
  if (j) {
    Object.assign(j, patch);
    emit();
  }
}

function remove(id: string) {
  const existed = jobs.delete(id);
  cancelUrls.delete(id);
  stoppers.delete(id);
  if (existed) emit();
}

function browserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function poll(jobId: string, fallbackName: string, intervalMs: number) {
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (!jobs.has(jobId)) return; // cancelled — stop polling
    let job: any;
    try {
      const res = await fetch(`${API.BASE_URL}/jobs/${jobId}`);
      if (!res.ok) continue;
      job = await res.json();
    } catch {
      continue; // transient — keep polling
    }
    if (job.status === 'COMPLETED') {
      try {
        const dl = await fetch(API.EXPORT.DOWNLOAD(jobId));
        if (!dl.ok) throw new Error('Download failed');
        const blob = await dl.blob();
        const cd = dl.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="?([^"]+)"?/i);
        browserDownload(blob, m ? m[1] : fallbackName);
        set(jobId, { status: 'ready' });
        setTimeout(() => remove(jobId), 8000); // clear the "downloaded" toast
      } catch {
        set(jobId, { status: 'failed', error: 'Download failed — try again from Activity.' });
      }
      return;
    }
    if (job.status === 'FAILED' || job.status === 'CANCELLED') {
      if (job.status === 'CANCELLED') remove(jobId);
      else set(jobId, { status: 'failed', error: 'Export failed. Please try again.' });
      return;
    }
  }
  set(jobId, { status: 'failed', error: 'Export timed out. Try again later.' });
}

export const exportJobs = {
  /** Register a just-created export job and begin polling in the background. */
  start(jobId: string, label: string, fallbackName: string, intervalMs = 3000) {
    jobs.set(jobId, { id: jobId, label, status: 'running', startedAt: Date.now() });
    cancelUrls.set(jobId, API.JOBS.CANCEL(jobId));
    emit();
    void poll(jobId, fallbackName, intervalMs);
  },
  /** Register a running job whose completion is driven EXTERNALLY (e.g. the
   *  Teams chat export's SSE stream). The caller downloads the artifact and
   *  then calls markReady/markFailed. `cancelUrl`/`stop` wire up cancellation. */
  track(jobId: string, label: string, opts?: { cancelUrl?: string; stop?: () => void }) {
    jobs.set(jobId, { id: jobId, label, status: 'running', startedAt: Date.now() });
    if (opts?.cancelUrl) cancelUrls.set(jobId, opts.cancelUrl);
    if (opts?.stop) stoppers.set(jobId, opts.stop);
    emit();
  },
  markReady(id: string) {
    set(id, { status: 'ready' });
    setTimeout(() => remove(id), 8000);
  },
  markFailed(id: string, error: string) {
    set(id, { status: 'failed', error });
  },
  /** × on a card. Running → cancel the job (server + client); terminal → just
   *  clear the notification. */
  cancel(id: string) {
    const j = jobs.get(id);
    if (!j) return;
    const wasRunning = j.status === 'running';
    const url = cancelUrls.get(id);
    const stop = stoppers.get(id);
    remove(id); // poll aborts on !jobs.has(id); no re-appear from late set()
    if (wasRunning) {
      try { stop?.(); } catch { /* ignore */ }
      if (url) fetch(url, { method: 'POST' }).catch(() => { /* best-effort */ });
    }
  },
  cancelAll() {
    for (const id of Array.from(jobs.keys())) exportJobs.cancel(id);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  getSnapshot() {
    return snapshot;
  },
};
