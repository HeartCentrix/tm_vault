import { useEffect, useState, useSyncExternalStore } from 'react';
import { exportJobs, type ExportJob } from '../services/exportJobs';
import './ExportToasts.css';

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function ToastCard({ job, now }: { job: ExportJob; now: number }) {
  return (
    <div className={`export-toast export-toast--${job.status}`}>
      <div className="export-toast__icon" aria-hidden="true">
        {job.status === 'running' && <span className="export-toast__spinner" />}
        {job.status === 'ready' && (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        )}
        {job.status === 'failed' && (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
        )}
      </div>
      <div className="export-toast__body">
        <div className="export-toast__title">{job.label}</div>
        <div className="export-toast__sub">
          {job.status === 'running' && `Preparing export… ${fmtElapsed(now - job.startedAt)} — runs in the background`}
          {job.status === 'ready' && 'Downloaded'}
          {job.status === 'failed' && (job.error || 'Export failed')}
        </div>
      </div>
      <button
        className="export-toast__close"
        aria-label="Dismiss"
        onClick={() => exportJobs.dismiss(job.id)}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Bottom-right, non-blocking progress for background export jobs. Mounted once
 * at the app root (outside <Routes>) so it persists across navigation while the
 * module-level exportJobs store polls each job to completion.
 */
export function ExportToasts() {
  const jobs = useSyncExternalStore(exportJobs.subscribe, exportJobs.getSnapshot);
  // Re-render once a second while anything is running so the elapsed timer ticks.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'running')) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jobs]);

  if (jobs.length === 0) return null;
  return (
    <div className="export-toasts" role="status" aria-live="polite">
      {jobs.map((j) => (
        <ToastCard key={j.id} job={j} now={now} />
      ))}
    </div>
  );
}
