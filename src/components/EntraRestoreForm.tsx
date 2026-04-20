import { useEffect, useState } from 'react';

/**
 * Entra restore sub-form mounted inside RestoreModal. Owns the
 * scope radio + per-section checkbox state. Parent modal reads the
 * selection via the `onChange` callback and ships it in the restore
 * payload (entraSections, recoverMode, includeGroupMembership, includeAuMembership).
 */
export type EntraRestoreSelection = {
  recoverMode: 'selected' | 'directory';
  sections: string[];
  includeGroupMembership: boolean;
  includeAuMembership: boolean;
};

const RESTORABLE_SECTIONS: Array<{ id: string; label: string; sub?: 'group' | 'au' }> = [
  { id: 'users',        label: 'Users' },
  { id: 'groups',       label: 'Groups', sub: 'group' },
  { id: 'roles',        label: 'Custom roles & assignments' },
  { id: 'applications', label: 'Applications & service principals' },
  { id: 'security',     label: 'Conditional Access + security policies' },
  { id: 'adminunits',   label: 'Administrative Units', sub: 'au' },
  { id: 'intune',       label: 'Intune compliance & configuration policies' },
];

const READ_ONLY_NOTE =
  'Audit logs, sign-in logs, Intune devices, risky users and security alerts are ' +
  'read-only in Microsoft Graph — use Download to export them.';

export function EntraRestoreForm({
  onChange,
}: {
  onChange: (selection: EntraRestoreSelection) => void;
}) {
  const [recoverMode, setRecoverMode] = useState<'selected' | 'directory'>('selected');
  const [sections, setSections] = useState<Set<string>>(
    () => new Set(RESTORABLE_SECTIONS.map((s) => s.id)),
  );
  const [includeGroupMembership, setGroupMembers] = useState(true);
  const [includeAuMembership, setAuMembers] = useState(true);

  // Emit the initial selection exactly once so the parent always has a
  // populated payload even if the user clicks Recover without touching
  // the form.
  useEffect(() => {
    onChange({
      recoverMode: 'selected',
      sections: RESTORABLE_SECTIONS.map((s) => s.id),
      includeGroupMembership: true,
      includeAuMembership: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (next: Partial<EntraRestoreSelection>) => {
    onChange({
      recoverMode,
      sections: Array.from(sections),
      includeGroupMembership,
      includeAuMembership,
      ...next,
    });
  };

  const toggleSection = (id: string) => {
    const nextSet = new Set(sections);
    if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
    setSections(nextSet);
    emit({ sections: Array.from(nextSet) });
  };

  return (
    <div className="modal-col">
      <label className="radio-row">
        <input
          type="radio"
          checked={recoverMode === 'selected'}
          onChange={() => { setRecoverMode('selected'); emit({ recoverMode: 'selected' }); }}
        />
        <span>Recover selected items</span>
      </label>
      <label className="radio-row">
        <input
          type="radio"
          checked={recoverMode === 'directory'}
          onChange={() => { setRecoverMode('directory'); emit({ recoverMode: 'directory' }); }}
        />
        <span>Recover entire directory</span>
      </label>

      {recoverMode === 'directory' && (
        <div className="workload-list">
          {RESTORABLE_SECTIONS.map((s) => (
            <label key={s.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={sections.has(s.id)}
                onChange={() => toggleSection(s.id)}
              />
              <span>{s.label}</span>
              {s.sub === 'group' && sections.has(s.id) && (
                <label style={{ marginLeft: 20, fontSize: 12, opacity: 0.8 }}>
                  <input
                    type="checkbox"
                    checked={includeGroupMembership}
                    onChange={(e) => {
                      setGroupMembers(e.target.checked);
                      emit({ includeGroupMembership: e.target.checked });
                    }}
                  />
                  Include group membership
                </label>
              )}
              {s.sub === 'au' && sections.has(s.id) && (
                <label style={{ marginLeft: 20, fontSize: 12, opacity: 0.8 }}>
                  <input
                    type="checkbox"
                    checked={includeAuMembership}
                    onChange={(e) => {
                      setAuMembers(e.target.checked);
                      emit({ includeAuMembership: e.target.checked });
                    }}
                  />
                  Include AU membership
                </label>
              )}
            </label>
          ))}
          <div className="restore-item-info" style={{ marginTop: 8, opacity: 0.7 }}>
            {READ_ONLY_NOTE}
          </div>
        </div>
      )}
    </div>
  );
}
