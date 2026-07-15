import { useEffect, useState } from 'react';
import { EntraIcon } from './EntraIcon';
import './EntraForm.css';

/**
 * Entra restore sub-form mounted inside RestoreModal. Owns the
 * scope segmented control + per-section card grid + membership toggles.
 * Parent modal reads the selection via the `onChange` callback and ships it
 * in the restore payload (entraSections, recoverMode, includeGroupMembership,
 * includeAuMembership).
 */
export type EntraRestoreSelection = {
  recoverMode: 'selected' | 'directory';
  sections: string[];
  includeGroupMembership: boolean;
  includeAuMembership: boolean;
};

const RESTORABLE_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'users',        label: 'Users' },
  { id: 'groups',       label: 'Groups' },
  { id: 'roles',        label: 'Custom roles & assignments' },
  { id: 'applications', label: 'Applications & service principals' },
  { id: 'security',     label: 'Conditional Access + security policies' },
  { id: 'adminunits',   label: 'Administrative Units' },
  { id: 'intune',       label: 'Intune compliance & config policies' },
];

const READ_ONLY_NOTE =
  'Audit logs, sign-in logs, Intune devices, risky users and security alerts are ' +
  'read-only in Microsoft Graph — use Download to export them.';

const Check = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const Info = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
);

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

  // Emit the initial selection once so the parent always has a populated
  // payload even if the user clicks Recover without touching the form.
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

  const allOn = sections.size === RESTORABLE_SECTIONS.length;
  const toggleAll = () => {
    const next = allOn ? new Set<string>() : new Set(RESTORABLE_SECTIONS.map((s) => s.id));
    setSections(next);
    emit({ sections: Array.from(next) });
  };

  const groupsOn = sections.has('groups');
  const auOn = sections.has('adminunits');

  return (
    <div className="entra-form">
      <div className="entra-form__group">
        <span className="entra-form__title">Recover</span>
        <div className="entra-seg" role="radiogroup" aria-label="Recovery scope">
          <button
            type="button"
            role="radio"
            aria-checked={recoverMode === 'selected'}
            className="entra-seg__btn"
            onClick={() => { setRecoverMode('selected'); emit({ recoverMode: 'selected' }); }}
          >
            Selected items
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={recoverMode === 'directory'}
            className="entra-seg__btn"
            onClick={() => { setRecoverMode('directory'); emit({ recoverMode: 'directory' }); }}
          >
            Entire directory
          </button>
        </div>
      </div>

      {recoverMode === 'directory' && (
        <>
          <div className="entra-form__group">
            <div className="entra-form__head">
              <span className="entra-form__title">What to recover</span>
              <button type="button" className="entra-form__selectall" onClick={toggleAll}>
                {allOn ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="entra-grid">
              {RESTORABLE_SECTIONS.map((s) => {
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
            <span className="entra-form__title">Membership</span>
            <label className={`entra-option${groupsOn ? '' : ' entra-option--disabled'}`}>
              <input
                type="checkbox"
                disabled={!groupsOn}
                checked={includeGroupMembership}
                onChange={(e) => { setGroupMembers(e.target.checked); emit({ includeGroupMembership: e.target.checked }); }}
              />
              <span className="entra-switch" />
              <span className="entra-option__text">
                <span className="entra-option__title">Include group membership</span>
                <span className="entra-option__sub">Restore which users belong to each group</span>
              </span>
            </label>
            <label className={`entra-option${auOn ? '' : ' entra-option--disabled'}`}>
              <input
                type="checkbox"
                disabled={!auOn}
                checked={includeAuMembership}
                onChange={(e) => { setAuMembers(e.target.checked); emit({ includeAuMembership: e.target.checked }); }}
              />
              <span className="entra-switch" />
              <span className="entra-option__text">
                <span className="entra-option__title">Include admin-unit membership</span>
                <span className="entra-option__sub">Restore which members belong to each administrative unit</span>
              </span>
            </label>
          </div>

          <div className="entra-note">
            <Info />
            <span>{READ_ONLY_NOTE}</span>
          </div>
        </>
      )}
    </div>
  );
}
