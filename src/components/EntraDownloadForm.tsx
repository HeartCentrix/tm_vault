import { useEffect, useState } from 'react';
import { EntraIcon } from './EntraIcon';
import './EntraForm.css';

export type EntraDownloadSelection = {
  sections: string[];
  format: 'csv' | 'json';
  includeNestedDetail: boolean;
};

const ALL_SECTIONS: Array<{ id: string; label: string; jsonOnly?: boolean }> = [
  { id: 'users',        label: 'Users' },
  { id: 'groups',       label: 'Groups' },
  { id: 'roles',        label: 'Roles', jsonOnly: true },
  { id: 'security',     label: 'Security policies', jsonOnly: true },
  { id: 'audit',        label: 'Audit + Sign-in logs' },
  { id: 'applications', label: 'Applications' },
  { id: 'intune',       label: 'Intune' },
  { id: 'adminunits',   label: 'Administrative Units' },
];

const Check = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const Info = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
);

export function EntraDownloadForm({
  onChange,
}: {
  onChange: (selection: EntraDownloadSelection) => void;
}) {
  const [sections, setSections] = useState<Set<string>>(
    () => new Set(ALL_SECTIONS.map((s) => s.id)),
  );
  const [format, setFormat] = useState<'csv' | 'json'>('json');
  const [includeNestedDetail, setNested] = useState(false);

  const emit = (override?: Partial<EntraDownloadSelection>) => {
    onChange({
      sections: Array.from(sections),
      format,
      includeNestedDetail,
      ...(override || {}),
    });
  };

  // Populate the parent with the default (all-selected) payload on mount so
  // Download works even if the user never touches the form.
  useEffect(() => {
    onChange({ sections: ALL_SECTIONS.map((s) => s.id), format: 'json', includeNestedDetail: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = (id: string) => {
    const next = new Set(sections);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSections(next);
    emit({ sections: Array.from(next) });
  };

  const allOn = sections.size === ALL_SECTIONS.length;
  const toggleAll = () => {
    const next = allOn ? new Set<string>() : new Set(ALL_SECTIONS.map((s) => s.id));
    setSections(next);
    emit({ sections: Array.from(next) });
  };

  const nonCsvSectionsInScope = Array.from(sections).some(
    (s) => ALL_SECTIONS.find((x) => x.id === s)?.jsonOnly,
  );

  return (
    <div className="entra-form">
      <div className="entra-form__group">
        <div className="entra-form__head">
          <span className="entra-form__title">What to export</span>
          <button type="button" className="entra-form__selectall" onClick={toggleAll}>
            {allOn ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="entra-grid">
          {ALL_SECTIONS.map((s) => {
            const on = sections.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                className={`entra-card${on ? ' entra-card--on' : ''}`}
                onClick={() => toggleSection(s.id)}
              >
                <span className="entra-card__icon"><EntraIcon id={s.id} /></span>
                <span className="entra-card__label">{s.label}</span>
                <span className="entra-card__check"><Check /></span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="entra-form__group">
        <span className="entra-form__title">Format</span>
        <div className="entra-seg" role="radiogroup" aria-label="Export format">
          <button
            type="button"
            role="radio"
            aria-checked={format === 'json'}
            className="entra-seg__btn"
            onClick={() => { setFormat('json'); emit({ format: 'json' }); }}
          >
            JSON
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={format === 'csv'}
            className="entra-seg__btn"
            onClick={() => { setFormat('csv'); emit({ format: 'csv' }); }}
          >
            CSV
          </button>
        </div>
        {format === 'csv' && nonCsvSectionsInScope && (
          <div className="entra-note">
            <Info />
            <span>Roles and Security policies export as JSON regardless of the selected format — their schemas are too nested for a useful CSV.</span>
          </div>
        )}
      </div>

      <label className="entra-option">
        <input
          type="checkbox"
          checked={includeNestedDetail}
          onChange={(e) => { setNested(e.target.checked); emit({ includeNestedDetail: e.target.checked }); }}
        />
        <span className="entra-switch" />
        <span className="entra-option__text">
          <span className="entra-option__title">Include membership detail</span>
          <span className="entra-option__sub">Group and admin-unit membership as separate CSV files</span>
        </span>
      </label>
    </div>
  );
}
