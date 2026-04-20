import { useState } from 'react';

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

  const toggleSection = (id: string) => {
    const next = new Set(sections);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSections(next);
    emit({ sections: Array.from(next) });
  };

  const nonCsvSectionsInScope = Array.from(sections).some(
    (s) => ALL_SECTIONS.find((x) => x.id === s)?.jsonOnly,
  );

  return (
    <div className="modal-col">
      <div className="workload-list">
        {ALL_SECTIONS.map((s) => (
          <label key={s.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={sections.has(s.id)}
              onChange={() => toggleSection(s.id)}
            />
            <span>{s.label}</span>
          </label>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="radio-row">
          <input
            type="radio"
            checked={format === 'json'}
            onChange={() => { setFormat('json'); emit({ format: 'json' }); }}
          />
          <span>JSON</span>
        </label>
        <label className="radio-row">
          <input
            type="radio"
            checked={format === 'csv'}
            onChange={() => { setFormat('csv'); emit({ format: 'csv' }); }}
          />
          <span>CSV</span>
        </label>
        {format === 'csv' && nonCsvSectionsInScope && (
          <div className="restore-item-info" style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Roles and Security policies export as JSON regardless of the selected format — their schemas are too nested for a useful CSV.
          </div>
        )}
      </div>

      <label className="checkbox-row" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          checked={includeNestedDetail}
          onChange={(e) => { setNested(e.target.checked); emit({ includeNestedDetail: e.target.checked }); }}
        />
        <span>Include group + admin unit membership (separate CSV files)</span>
      </label>
    </div>
  );
}
