import { useEffect, useState, useSyncExternalStore } from 'react';
import { exportJobs, type ExportJob } from '../services/exportJobs';
import './ExportToasts.css';

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function StatusIcon({ status }: { status: ExportJob['status'] }) {
  if (status === 'running') return <span className="export-toast__spinner" />;
  if (status === 'ready')
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
  );
}

function ToastCard({ job, now }: { job: ExportJob; now: number }) {
  const running = job.status === 'running';
  return (
    <div className={`export-toast export-toast--${job.status}`}>
      <div className="export-toast__icon" aria-hidden="true">
        <StatusIcon status={job.status} />
      </div>
      <div className="export-toast__body">
        <div className="export-toast__title">{job.label}</div>
        <div className="export-toast__sub">
          {running && `Preparing export… ${fmtElapsed(now - job.startedAt)} — runs in the background`}
          {job.status === 'ready' && 'Downloaded'}
          {job.status === 'failed' && (job.error || 'Export failed')}
        </div>
      </div>
      <button
        className="export-toast__close"
        aria-label={running ? 'Cancel export' : 'Dismiss'}
        title={running ? 'Cancel this export — the job will be stopped' : 'Dismiss'}
        onClick={() => exportJobs.cancel(job.id)}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Bottom-right, non-blocking progress for background export jobs. Mounted once
 * at the app root (outside <Routes>) so it persists across navigation while the
 * module-level exportJobs store polls each job. One job → a single card; several
 * → a collapsed summary with a chevron that expands to per-job cards, each
 * cancellable, plus Cancel all.
 */
export function ExportToasts() {
  const jobs = useSyncExternalStore(exportJobs.subscribe, exportJobs.getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  // Tick every second while anything runs so the elapsed timer moves.
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'running')) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jobs]);

  // Collapse automatically once everything is down to a single (or no) job.
  useEffect(() => {
    if (jobs.length <= 1 && expanded) setExpanded(false);
  }, [jobs.length, expanded]);

  if (jobs.length === 0) return null;

  if (jobs.length === 1) {
    return (
      <div className="export-toasts" role="status" aria-live="polite">
        <ToastCard job={jobs[0]} now={now} />
      </div>
    );
  }

  const running = jobs.filter((j) => j.status === 'running').length;
  const done = jobs.filter((j) => j.status === 'ready').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const meta = [
    running ? `${running} running` : '',
    done ? `${done} done` : '',
    failed ? `${failed} failed` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="export-toasts" role="status" aria-live="polite">
      <div className="export-toasts__group">
        <button
          className="export-toasts__header"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          title={expanded ? 'Collapse' : 'Show all exports'}
        >
          <span className="export-toast__icon" aria-hidden="true">
            {running > 0 ? <span className="export-toast__spinner" /> : <StatusIcon status={failed ? 'failed' : 'ready'} />}
          </span>
          <span className="export-toasts__summary">
            <span className="export-toast__title">{jobs.length} exports</span>
            <span className="export-toast__sub">{meta}</span>
          </span>
          <svg className={`export-toasts__chev${expanded ? ' export-toasts__chev--open' : ''}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg>
        </button>
        {expanded && (
          <div className="export-toasts__list">
            {running > 0 && (
              <button
                className="export-toasts__cancel-all"
                onClick={() => exportJobs.cancelAll()}
                title="Cancel every running export"
              >
                Cancel all
              </button>
            )}
            {jobs.map((j) => (
              <ToastCard key={j.id} job={j} now={now} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
