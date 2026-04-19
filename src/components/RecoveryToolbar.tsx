import { useEffect, useRef, useState } from 'react';
import type { SnapshotItem } from '../services/snapshot';
import './RecoveryToolbar.css';

/**
 * RecoveryToolbar — global toolbar that sits between the content header
 * and the content-type tabs on the Recovery page. Always looks the same;
 * only the callbacks + ids change per resource + content-type.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [ Search … 🔍 ]                                  [Version] │
 *   │                                     [Download] [Recover]    │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Functionality is driven by props so each resource/content-type can
 * wire its own handlers while sharing the layout + style.
 */
export interface RecoveryToolbarProps {
  snapshots: SnapshotItem[];
  selectedSnapshotId: string;
  onSelectSnapshot: (id: string) => void;
  onDownload: () => void;
  onRecover: () => void;
  selectedCount: number;
  downloadError?: string | null;
  /** Disable just the Recover button — useful on content types where
   *  restore isn't supported yet. */
  recoverDisabled?: boolean;
  /** Disable just the Download button — same reasoning as above. */
  downloadDisabled?: boolean;
  /** Optional search wiring. Omit to hide the search box (e.g. for
   *  resource kinds where search isn't supported yet). */
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  onSearchSubmit?: () => void;
  searchPlaceholder?: string;
}

/** Custom dropdown replacement for <select>. Native select popup menus
 *  don't honour border-radius; rolling our own is the only way to get
 *  the rounded corners the design asks for. Closes on outside click +
 *  Escape. Keyboard nav + aria attributes make it accessible. */
function VersionDropdown({
  items, value, onChange, formatLabel,
}: {
  items: SnapshotItem[];
  value: string;
  onChange: (id: string) => void;
  formatLabel: (s: SnapshotItem) => string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = items.find(s => s.id === value);
  const buttonLabel = items.length === 0
    ? 'No backups yet'
    : selected ? formatLabel(selected) : 'Select version';

  return (
    <div className="recovery-toolbar-version-wrap" ref={rootRef}>
      <button
        type="button"
        className="recovery-toolbar-version-select"
        onClick={() => items.length > 0 && setOpen(o => !o)}
        disabled={items.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="recovery-toolbar-version-current">{buttonLabel}</span>
        <span className="recovery-toolbar-version-caret" aria-hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <ul className="recovery-toolbar-version-menu" role="listbox">
          {items.map(s => (
            <li
              key={s.id}
              role="option"
              aria-selected={s.id === value}
              className={`recovery-toolbar-version-opt${s.id === value ? ' active' : ''}`}
              onClick={() => { onChange(s.id); setOpen(false); }}
            >
              {formatLabel(s)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtSnapshotLabel(s: SnapshotItem): string {
  if (!s.createdAt) return s.id.slice(0, 8);
  const d = new Date(s.createdAt);
  if (isNaN(d.getTime())) return s.id.slice(0, 8);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export default function RecoveryToolbar({
  snapshots,
  selectedSnapshotId,
  onSelectSnapshot,
  onDownload,
  onRecover,
  selectedCount,
  downloadError,
  recoverDisabled,
  downloadDisabled,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = 'Search',
}: RecoveryToolbarProps) {
  const completed = (snapshots || [])
    .filter(s => (s.status || '').toUpperCase() === 'COMPLETED')
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

  const hasSnapshot = !!selectedSnapshotId;
  const disableDownload = !hasSnapshot || !!downloadDisabled;
  const disableRecover = !hasSnapshot || selectedCount === 0 || !!recoverDisabled;

  const showSearch = typeof onSearchChange === 'function';

  return (
    <div className={`recovery-toolbar${showSearch ? '' : ' recovery-toolbar-no-search'}`}>
      {showSearch && (
        <div className="recovery-toolbar-search">
          {/* Input + button share a single bordered pill — the button
              sits inside the same field, no visual gap. */}
          <div className="recovery-toolbar-search-field">
            <input
              type="text"
              className="recovery-toolbar-search-input"
              placeholder={searchPlaceholder}
              value={searchValue || ''}
              onChange={e => onSearchChange!(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && onSearchSubmit) onSearchSubmit(); }}
            />
            <button
              type="button"
              className="recovery-toolbar-search-btn"
              onClick={() => onSearchSubmit && onSearchSubmit()}
              aria-label="Search"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="recovery-toolbar-version-section">
        <div className="recovery-toolbar-version">
          <label className="recovery-toolbar-version-label">Version</label>
          <VersionDropdown
            items={completed}
            value={selectedSnapshotId}
            onChange={onSelectSnapshot}
            formatLabel={fmtSnapshotLabel}
          />
        </div>
      </div>

      <div className="recovery-toolbar-actions-section">
        {downloadError && (
          <span className="recovery-toolbar-error">{downloadError}</span>
        )}
        <button
          type="button"
          className="recovery-toolbar-btn recovery-toolbar-btn-download"
          onClick={onDownload}
          disabled={disableDownload}
        >
          {`Download${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
        </button>
        <button
          type="button"
          className="recovery-toolbar-btn recovery-toolbar-btn-recover"
          onClick={onRecover}
          disabled={disableRecover}
        >
          {`Recover${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
        </button>
      </div>
    </div>
  );
}
