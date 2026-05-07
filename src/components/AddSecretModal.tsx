import { useState, useEffect } from 'react';
import { API } from '../config/api';
import RoundedSelect from './RoundedSelect';
import './AddSecretModal.css';

/**
 * Create-Secret modal. Two flavors:
 *
 *   variant="login" — matches azure/add_secret.png. Fields: Type (SQL
 *     Server Login | PostgreSQL Login), Name, Description, Login,
 *     Password (with eye toggle). Opens on top of Azure DB Recover
 *     when the user clicks "Create a new secret".
 *
 *   variant="kms" — matches azure/sett_sec.png. Fields: Type (AES-256
 *     Key), Description, KMS Key Provider (GCP/AWS/AZURE), KMS Key ID,
 *     Default key toggle. Used from the Settings → Secrets section.
 *
 * Posts to `/api/v1/tenants/{tenantId}/secrets` with the encrypted
 * payload — password / KMS key id are sent to the backend which
 * encrypts before persist. The response carries only the non-sensitive
 * metadata, matching the list endpoint.
 */
export interface AddSecretModalProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  variant: 'login' | 'kms';
  /** Preselect the login server flavor — 'sql' or 'postgresql'. Only
   *  used when variant === 'login'. */
  defaultLoginKind?: 'sql' | 'postgresql';
  /** Called after a successful save with the freshly-created secret so
   *  callers (e.g. Azure DB Recover) can auto-select it. */
  onCreated?: (secret: { id: string; name: string; type: string }) => void;
}

const LOGIN_TYPES = [
  { value: 'SQL_SERVER_LOGIN', label: 'SQL Server Login' },
  { value: 'POSTGRESQL_LOGIN', label: 'PostgreSQL Login' },
];

const KMS_PROVIDERS = [
  { value: 'GCP', label: 'GCP' },
  { value: 'AWS', label: 'AWS' },
  { value: 'AZURE', label: 'Azure Key Vault' },
];

export default function AddSecretModal({
  open, onClose, tenantId, variant, defaultLoginKind, onCreated,
}: AddSecretModalProps) {
  // Login fields
  const [loginType, setLoginType] = useState<string>(
    defaultLoginKind === 'postgresql' ? 'POSTGRESQL_LOGIN' : 'SQL_SERVER_LOGIN',
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  // KMS fields
  const [kmsProvider, setKmsProvider] = useState('GCP');
  const [kmsKeyId, setKmsKeyId] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLoginType(defaultLoginKind === 'postgresql' ? 'POSTGRESQL_LOGIN' : 'SQL_SERVER_LOGIN');
      setName(''); setDescription(''); setLogin(''); setPassword(''); setShowPw(false);
      setKmsProvider('GCP'); setKmsKeyId(''); setIsDefault(false);
      setError(null);
    }
  }, [open, defaultLoginKind]);

  if (!open) return null;

  const saveDisabled = submitting || (
    variant === 'login'
      ? !name.trim() || !login.trim() || !password.trim()
      : !description.trim() || !kmsKeyId.trim()
  );

  const handleSave = async () => {
    if (saveDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      let body: any;
      if (variant === 'login') {
        body = {
          type: loginType,
          name: name.trim(),
          description: description.trim() || null,
          metadata: { login: login.trim() },
          payload: { password },
        };
      } else {
        body = {
          type: 'AES_256_KEY',
          name: `${kmsProvider}:${kmsKeyId}`.slice(0, 120),
          description: description.trim() || null,
          metadata: { provider: kmsProvider, keyId: kmsKeyId.trim() },
          payload: { keyId: kmsKeyId.trim() },
          isDefault,
        };
      }
      const res = await fetch(`${API.BASE_URL}/tenants/${tenantId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const created = await res.json();
      if (onCreated) onCreated({ id: created.id, name: created.name, type: created.type });
      onClose();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="add-sec-overlay" onClick={onClose} role="presentation">
      <div className="add-sec-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="add-sec-x" onClick={onClose} aria-label="Close">×</button>

        <div className="add-sec-body">
          {variant === 'login' ? (
            <>
              <div className="add-sec-row">
                <label>Type:</label>
                <RoundedSelect
                  value={loginType}
                  onChange={setLoginType}
                  options={LOGIN_TYPES.map(t => ({ value: t.value, label: t.label }))}
                />
              </div>
              <div className="add-sec-row">
                <label>Name:</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
              <div className="add-sec-row">
                <label>Description:</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className="add-sec-row">
                <label>Login:</label>
                <input type="text" value={login} onChange={e => setLogin(e.target.value)} autoComplete="off" />
              </div>
              <div className="add-sec-row">
                <label>Password:</label>
                <div className="add-sec-pw">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="add-sec-eye"
                    onClick={() => setShowPw(s => !s)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    title={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-7 0-11-8-11-8a18.46 18.46 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12A3 3 0 1 1 9.88 9.88" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="add-sec-row">
                <label>Type:</label>
                <RoundedSelect
                  value="AES_256_KEY"
                  onChange={() => { /* locked */ }}
                  disabled
                  options={[{ value: 'AES_256_KEY', label: 'AES-256 Key' }]}
                />
              </div>
              <div className="add-sec-row">
                <label>Description:</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className={description.trim() ? '' : 'add-sec-required'}
                  autoFocus
                />
              </div>
              <div className="add-sec-row">
                <label>KMS Key Provider:</label>
                <RoundedSelect
                  value={kmsProvider}
                  onChange={setKmsProvider}
                  options={KMS_PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                />
              </div>
              <div className="add-sec-row">
                <label>{kmsProvider} KMS Key ID:</label>
                <input type="text" value={kmsKeyId} onChange={e => setKmsKeyId(e.target.value)} autoComplete="off" />
              </div>
              <div className="add-sec-row">
                <label>Default key:</label>
                <label className="add-sec-toggle">
                  <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                  <span className="add-sec-toggle-slider" />
                </label>
              </div>
            </>
          )}

          {error && <div className="add-sec-error">{error}</div>}
        </div>

        <div className="add-sec-footer">
          <button type="button" className="add-sec-save" onClick={handleSave} disabled={saveDisabled}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
