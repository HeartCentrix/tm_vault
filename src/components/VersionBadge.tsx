import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '../version';
import './VersionBadge.css';

interface Commit {
  sha: string;
  subject: string;
  date: string;
  author: string;
}

interface VersionHistory {
  version: string;
  current: Commit | null;
  history: Commit[];
}

/**
 * Clickable version badge. Shows the build version (e.g. "v0.1.339") and, on
 * click, a popover with the current commit summary + recent version history.
 * The history is generated from `git log` at image-build time into
 * `public/version-history.json` (see scripts/build-image.sh) and fetched
 * lazily the first time the popover opens.
 */
export default function VersionBadge() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VersionHistory | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click (matches the header's other dropdowns).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Lazy-load the history the first time the popover is opened.
  useEffect(() => {
    if (!open || state !== 'idle' || data) return;
    setState('loading');
    fetch('/version-history.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error('no history');
        return r.json();
      })
      .then((d: VersionHistory) => {
        setData(d);
        setState('idle');
      })
      .catch(() => setState('error'));
  }, [open, state, data]);

  const earlier = data?.history?.slice(1) ?? [];

  return (
    <div className="version-badge-wrap" ref={ref}>
      <button
        className="version-badge"
        onClick={() => setOpen((o) => !o)}
        title="Version & build history"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {APP_VERSION}
      </button>

      {open && (
        <div className="version-popover" role="dialog" aria-label="Version history">
          <div className="version-popover-title">TM Vault {data?.version || APP_VERSION}</div>

          {state === 'loading' && <div className="version-popover-msg">Loading…</div>}
          {state === 'error' && (
            <div className="version-popover-msg">Build history unavailable (local/dev build).</div>
          )}

          {data?.current && (
            <div className="version-current">
              <div className="version-section-label">Current build</div>
              <div className="version-commit-row">
                <code className="version-commit-sha">{data.current.sha}</code>
                <span className="version-commit-subject">{data.current.subject}</span>
              </div>
              <div className="version-commit-meta">
                {data.current.author} · {data.current.date}
              </div>
            </div>
          )}

          {earlier.length > 0 && (
            <>
              <div className="version-section-label">Version history</div>
              <ul className="version-history-list">
                {earlier.map((c) => (
                  <li key={c.sha} className="version-history-item">
                    <code className="version-commit-sha">{c.sha}</code>
                    <span className="version-commit-subject">{c.subject}</span>
                    <span className="version-commit-meta">{c.date}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
