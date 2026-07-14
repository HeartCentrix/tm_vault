// Background export-job store. Exports (PST / ZIP / EML / MBOX / Entra) are
// server-side jobs: the API returns a jobId, we poll /jobs/{id} until COMPLETED,
// then fetch the artifact and trigger a browser download.
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
    // NOTE: we keep polling even if the toast was dismissed — dismissing hides
    // the notification but must NOT cancel the export; the file still downloads
    // when ready (set() below is a harmless no-op once the job is gone).
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
        // Clear the "downloaded" toast after a short confirmation window.
        setTimeout(() => exportJobs.dismiss(jobId), 8000);
      } catch {
        set(jobId, { status: 'failed', error: 'Download failed — try again from Activity.' });
      }
      return;
    }
    if (job.status === 'FAILED') {
      set(jobId, { status: 'failed', error: 'Export failed. Please try again.' });
      return;
    }
  }
  set(jobId, { status: 'failed', error: 'Export timed out. Try again later.' });
}

export const exportJobs = {
  /** Register a just-created export job and begin polling in the background. */
  start(jobId: string, label: string, fallbackName: string, intervalMs = 3000) {
    jobs.set(jobId, { id: jobId, label, status: 'running', startedAt: Date.now() });
    emit();
    void poll(jobId, fallbackName, intervalMs);
  },
  /** Register a running job whose completion is driven EXTERNALLY (e.g. the
   *  Teams chat export's SSE stream). The caller downloads the artifact and
   *  then calls markReady/markFailed. */
  track(jobId: string, label: string) {
    jobs.set(jobId, { id: jobId, label, status: 'running', startedAt: Date.now() });
    emit();
  },
  markReady(id: string) {
    set(id, { status: 'ready' });
    setTimeout(() => exportJobs.dismiss(id), 8000);
  },
  markFailed(id: string, error: string) {
    set(id, { status: 'failed', error });
  },
  dismiss(id: string) {
    if (jobs.delete(id)) emit();
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
