import { useCallback, useEffect, useState } from 'react';
import { API } from '../config/api';
import AddSecretModal from './AddSecretModal';
import EncryptionPanel from './EncryptionPanel';
import './SecretsTab.css';

/**
 * Settings → Secrets tab. Matches sec_settings.png:
 *
 *   All backup data is encrypted with service-managed AES-256 encryption by
 *   default. You can configure the service to use an external Key Management
 *   System. ⓘ
 *
 *   ┌────────────┬───────────────────┬───────────────┐
 *   │ Type       │ Description       │ Details       │
 *   ├────────────┼───────────────────┼───────────────┤
 *   │ AES-256 Key│ Service-managed   │ default       │
 *   │ (default)  │ encryption key    │               │
 *   └────────────┴───────────────────┴───────────────┘
 *                                             [ + Secret ]
 *
 * Rows are clickable → opens a read-only detail modal (sec.png).
 * "+ Secret" opens the AddSecretModal (variant="kms") — users in
 * Azure DB Recover use the same table via variant="login".
 */
interface Secret {
  id: string;
  type: string;
  name: string;
  description: string;
  metadata: Record<string, any>;
  isDefault: boolean;
  createdAt?: string;
}

export default function SecretsTab({ tenantId }: { tenantId: string }) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detailSecret, setDetailSecret] = useState<Secret | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSecrets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API.BASE_URL}/tenants/${tenantId}/secrets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSecrets(data.items || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { fetchSecrets(); }, [fetchSecrets]);

  const deleteSecret = async (id: string) => {
    if (!window.confirm('Delete this secret?')) return;
    try {
      await fetch(`${API.BASE_URL}/tenants/${tenantId}/secrets/${id}`, {
        method: 'DELETE',
      });
      setSecrets(prev => prev.filter(s => s.id !== id));
      setDetailSecret(null);
    } catch (e) { /* no-op */ }
  };

  // Service-managed default row — always visible, matches the screenshot.
  // It's not a real DB row, so it has no id / delete affordance.
  const serviceManagedRow: Secret = {
    id: '__service_managed__',
    type: 'AES-256 Key',
    name: 'Service-managed encryption key',
    description: 'Service-managed encryption key',
    metadata: { default: true, managed: 'service' },
    isDefault: true,
  };

  // User-added AES-256 keys show their own "(default)" badge. Logins are
  // rendered by type string only — no default marker needed.
  const rows: Secret[] = [serviceManagedRow, ...secrets];

  return (
    <div className="secrets-tab">
      <EncryptionPanel />

      <p className="secrets-blurb">
        Connection secrets (database logins, KMS references) used during backup and restore.
        <span className="secrets-info-icon" title="Encryption keys are configured in the At-rest encryption panel above. Secret material is never stored here.">ⓘ</span>
      </p>

      {error && <div className="secrets-error">{error}</div>}
      {loading ? (
        <div className="empty-state"><p>Loading secrets…</p></div>
      ) : (
        <>
          <table className="secrets-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => {
                const isService = s.id === '__service_managed__';
                const typeLabel = s.type === 'AES_256_KEY' ? 'AES-256 Key' : s.type;
                const details: string[] = [];
                if (s.isDefault) details.push('default');
                if (s.metadata?.provider) details.push(String(s.metadata.provider));
                if (s.metadata?.login) details.push(`user: ${s.metadata.login}`);
                return (
                  <tr
                    key={s.id}
                    className={`secrets-row ${isService ? 'secrets-row-default' : ''}`}
                    onClick={() => setDetailSecret(s)}
                  >
                    <td className="secrets-type">
                      {typeLabel}
                      {s.isDefault && <div className="secrets-type-sub">(default)</div>}
                    </td>
                    <td><a href="#" onClick={e => e.preventDefault()}>{s.description || s.name}</a></td>
                    <td>{details.join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="secrets-actions">
            <button type="button" className="secrets-add-btn" onClick={() => setAddOpen(true)}>
              + Secret
            </button>
          </div>
        </>
      )}

      {/* Add secret — defaults to the KMS variant from this entry-
          point because the settings page is about encryption keys. */}
      <AddSecretModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        tenantId={tenantId}
        variant="kms"
        onCreated={() => { setAddOpen(false); fetchSecrets(); }}
      />

      {/* Read-only detail modal matching sec.png. */}
      {detailSecret && (
        <SecretDetailModal
          secret={detailSecret}
          onClose={() => setDetailSecret(null)}
          onDelete={detailSecret.id === '__service_managed__' ? undefined : () => deleteSecret(detailSecret.id)}
        />
      )}
    </div>
  );
}

function SecretDetailModal({
  secret, onClose, onDelete,
}: {
  secret: Secret;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const typeLabel = secret.type === 'AES_256_KEY'
    ? 'AES-256 Key'
    : secret.type === 'SQL_SERVER_LOGIN'
      ? 'SQL Server Login'
      : secret.type === 'POSTGRESQL_LOGIN'
        ? 'PostgreSQL Login'
        : secret.type;
  return (
    <div className="add-sec-overlay" onClick={onClose} role="presentation">
      <div className="add-sec-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="add-sec-x" onClick={onClose} aria-label="Close">×</button>

        <div className="add-sec-body">
          <div className="add-sec-row">
            <label>Type:</label>
            <input type="text" value={typeLabel} readOnly />
          </div>
          <div className="add-sec-row">
            <label>Description:</label>
            <input type="text" value={secret.description || secret.name} readOnly />
          </div>
          {secret.metadata?.login && (
            <div className="add-sec-row">
              <label>Login:</label>
              <input type="text" value={String(secret.metadata.login)} readOnly />
            </div>
          )}
          {secret.metadata?.provider && (
            <div className="add-sec-row">
              <label>KMS Key Provider:</label>
              <input type="text" value={String(secret.metadata.provider)} readOnly />
            </div>
          )}
          {secret.metadata?.keyId && (
            <div className="add-sec-row">
              <label>KMS Key ID:</label>
              <input type="text" value={String(secret.metadata.keyId)} readOnly />
            </div>
          )}
          {secret.type === 'AES_256_KEY' && (
            <div className="add-sec-row">
              <label>Default key:</label>
              <label className="add-sec-toggle">
                <input type="checkbox" checked={!!secret.isDefault} readOnly disabled />
                <span className="add-sec-toggle-slider" />
              </label>
            </div>
          )}
        </div>

        <div className="add-sec-footer">
          {onDelete && (
            <button
              type="button"
              className="secrets-delete-btn"
              onClick={onDelete}
              title="Delete this secret"
            >
              Delete
            </button>
          )}
          <button type="button" className="add-sec-save" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
