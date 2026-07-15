import { useEffect, useState } from 'react';
import { API } from '../config/api';
import './EncryptionPanel.css';

/**
 * Settings → Secrets: at-rest encryption provider selector.
 *
 * Lets an operator choose the KEK provider that wraps the per-tenant DEK
 * (env master key / AWS KMS / Azure Key Vault), supply a NON-SECRET key
 * reference (KMS key ARN / Key Vault key URL), and enable encryption for new
 * writes. Secret material (env master key, cloud credentials) is provisioned in
 * the server environment / managed identity and is never entered here.
 *
 * Persists to tenant-service PUT /api/v1/encryption/config; the crypto services
 * apply the choice on their next restart.
 */
type Provider = 'env' | 'aws_kms' | 'azure_key_vault';

const PROVIDERS: { value: Provider; label: string; blurb: string }[] = [
  { value: 'env', label: 'Server key', blurb: 'Master key provisioned in the server environment (on-prem / self-managed).' },
  { value: 'aws_kms', label: 'AWS KMS', blurb: 'DEK wrapped by an AWS KMS key. Credentials come from the instance role.' },
  { value: 'azure_key_vault', label: 'Azure Key Vault', blurb: 'DEK wrapped by an Azure Key Vault key via managed identity.' },
];

const REFERENCE_FIELD: Record<Provider, { label: string; placeholder: string; help: string } | null> = {
  env: null,
  aws_kms: {
    label: 'KMS key ARN',
    placeholder: 'arn:aws:kms:us-east-1:123456789012:key/abcd-…',
    help: 'The KMS key identifier (an ARN or key id) — not a secret.',
  },
  azure_key_vault: {
    label: 'Key Vault key URL',
    placeholder: 'https://my-vault.vault.azure.net/keys/my-key/version',
    help: 'The full Key Vault key identifier URL — not a secret.',
  },
};

export default function EncryptionPanel() {
  const [provider, setProvider] = useState<Provider>('env');
  const [keyReference, setKeyReference] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API.BASE_URL}/encryption/config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        setProvider((d.provider as Provider) || 'env');
        setKeyReference(d.key_reference || '');
        setEnabled(Boolean(d.enabled));
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ref = REFERENCE_FIELD[provider];
  const refMissing = !!ref && !keyReference.trim();

  const save = async () => {
    setError(null);
    setSaved(false);
    if (refMissing) {
      setError(`${ref!.label} is required for this provider.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API.BASE_URL}/encryption/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          key_reference: ref ? keyReference.trim() : null,
          enabled,
        }),
      });
      if (res.status === 409) {
        const b = await res.json().catch(() => ({}));
        throw new Error(
          (b.detail || 'Existing encrypted data uses the current key.') +
            ' Re-wrap existing keys before switching provider so data stays decryptable.',
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="enc-panel enc-panel--loading">Loading encryption settings…</div>;
  }

  return (
    <section className="enc-panel" aria-labelledby="enc-panel-title">
      <div className="enc-panel-head">
        <h3 id="enc-panel-title">At-rest encryption</h3>
        <span className={`enc-status ${enabled ? 'enc-status--on' : 'enc-status--off'}`}>
          <span className="enc-status-dot" aria-hidden="true" />
          {enabled ? 'Encrypting new backups' : 'Not encrypting'}
        </span>
      </div>
      <p className="enc-panel-sub">
        Backup blobs are sealed with AES-256 envelope encryption. Choose which key management
        system wraps the per-tenant data key.
      </p>

      <label className="enc-label">Key provider</label>
      <div className="enc-seg" role="radiogroup" aria-label="Key provider">
        {PROVIDERS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={provider === p.value}
            className={`enc-seg-btn ${provider === p.value ? 'is-active' : ''}`}
            onClick={() => { setProvider(p.value); setSaved(false); setError(null); }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="enc-help">{PROVIDERS.find((p) => p.value === provider)!.blurb}</p>

      {ref && (
        <div className="enc-field">
          <label className="enc-label" htmlFor="enc-ref">
            {ref.label} <span className="enc-req" aria-hidden="true">*</span>
          </label>
          <input
            id="enc-ref"
            className="enc-input"
            type="text"
            value={keyReference}
            placeholder={ref.placeholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => { setKeyReference(e.target.value); setSaved(false); }}
          />
          <p className="enc-help">{ref.help}</p>
        </div>
      )}

      <label className="enc-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
        />
        <span>Encrypt new backup writes</span>
      </label>

      <div className="enc-note" role="note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>
          Never enter secret keys here. Master keys and cloud credentials are provisioned in the
          server environment / managed identity — this form only records the provider and a
          non-secret key reference.
        </span>
      </div>

      {error && <div className="enc-error" role="alert">{error}</div>}
      {saved && <div className="enc-ok" role="status">Saved. Encryption services apply this on their next restart.</div>}

      <div className="enc-actions">
        <button type="button" className="enc-save" onClick={save} disabled={saving || refMissing}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}
