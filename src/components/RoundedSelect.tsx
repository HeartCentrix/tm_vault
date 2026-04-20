import { useEffect, useRef, useState } from 'react';
import './RoundedSelect.css';

/** Custom select with a rounded-corner popup menu (native <select>
 *  popups are browser-rendered and can't be styled). Accepts a flat
 *  array of `{ value, label }` options plus a value and onChange. */
export interface RoundedSelectProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Extra class on the trigger for positioning tweaks. */
  className?: string;
}

export default function RoundedSelect({
  value, options, onChange, placeholder = 'Select', disabled, className,
}: RoundedSelectProps) {
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

  const active = options.find(o => o.value === value);
  const display = active?.label || placeholder;

  return (
    <div className={`rsel-wrap ${className || ''}`} ref={rootRef}>
      <button
        type="button"
        className="rsel-btn"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="rsel-label">{display}</span>
        <span className="rsel-caret" aria-hidden>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <ul className="rsel-menu" role="listbox">
          {options.length === 0 && <li className="rsel-empty">No options</li>}
          {options.map(o => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`rsel-opt${o.value === value ? ' active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
