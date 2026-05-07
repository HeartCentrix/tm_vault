import { useState, useEffect, useMemo } from 'react';
import type { SnapshotItem, ResourceWithBackups } from '../services/snapshot';
import { SnapshotService } from '../services/snapshot';
import { API } from '../config/api';
import { fmtLocal } from '../utils/datetime';
import RoundedSelect from './RoundedSelect';
import './AzureDbRecoverModal.css';

/** Info icon + tooltip — same component as AzureDbRecoverModal so the
 *  two modals look uniform. Inlined here so this file stays self-
 *  contained; sharing the icon would mean a forced split. */
function InfoHint({ text }: { text: string }) {
  return (
    <span className="azdb-rec-info" tabIndex={0} aria-label={text}>
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M12 17V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="1" cy="1" r="1" transform="matrix(1 0 0 -1 11 9)" fill="currentColor" />
        <path d="M22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C21.5093 4.43821 21.8356 5.80655 21.9449 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="azdb-rec-info-tip" role="tooltip">{text}</span>
    </span>
  );
}

/**
 * Azure PostgreSQL Recover modal — much simpler than the Azure SQL
 * variant: only Source DB / Destination tenant / Destination server /
 * Destination DB name. PostgreSQL servers expose multiple databases
 * per server, so the user picks WHICH backed-up DB to restore in
 * addition to where it lands. Layout matches `VM/post_sql_rec.png`.
 */
export interface AzurePgRecoverModalProps {
  open: boolean;
  onClose: () => void;
  resource: ResourceWithBackups;
  snapshot: SnapshotItem;
}

export default function AzurePgRecoverModal({ open, onClose, resource, snapshot }: AzurePgRecoverModalProps) {
  const [sourceDb, setSourceDb] = useState('');
  const [destTenant, setDestTenant] = useState('');
  const [destServer, setDestServer] = useState('');
  const [destDbName, setDestDbName] = useState('');
  const [tenants, setTenants] = useState<Array<{ id: string; externalTenantId: string; displayName: string; domain?: string }>>([]);
  const [servers, setServers] = useState<string[]>([]);
  const [sourceDbs, setSourceDbs] = useState<string[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [serversLoading, setServersLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull AZURE_DB_DATABASE rows out of the snapshot's items so the user
  // can pick which backed-up database to restore. Falls back to the
  // resource's external_id when the snapshot has none.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await SnapshotService.listSnapshotFiles(snapshot.id, 1, 5000);
        if (cancelled) return;
        const dbs = (data.content || [])
          .filter((it: any) => (it.itemType || '').toUpperCase() === 'AZURE_DB_DATABASE')
          .map((it: any) => it.name)
          .filter(Boolean);
        const list = Array.from(new Set<string>(dbs));
        setSourceDbs(list);
        // Default to the source resource itself, else first DB in the list.
        const seed = resource.external_id && list.includes(resource.external_id)
          ? resource.external_id
          : list[0] || '';
        setSourceDb(seed);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open, snapshot.id, resource.external_id]);

  // Reset the destination name to empty whenever the modal opens so
  // the user types whatever name they want for the new database. We
  // intentionally don't pre-fill from the source — the user is in
  // control of what the new DB is called.
  useEffect(() => {
    if (open) {
      setDestDbName('');
      setError(null);
    }
  }, [open]);

  // Tenant list — same endpoint the SQL modal uses; domain comes back
  // from Microsoft Graph for the user-friendly label.
  useEffect(() => {
    if (!open) return;
    setTenantsLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API.BASE_URL}/azure/tenants`);
        if (!res.ok) return;
        const data = await res.json();
        const items = data.items || [];
        setTenants(items);
        const current = items.find((t: any) => t.id === resource.tenant_id);
        setDestTenant((current?.id) || items[0]?.id || '');
      } catch { /* ignore */ }
      finally { setTenantsLoading(false); }
    })();
  }, [open, resource.tenant_id]);

  // Server list scoped to the chosen tenant. The PG modal doesn't
  // expose subscription / RG filters so we fetch the union of every
  // PostgreSQL server visible to the SP across all subscriptions.
  useEffect(() => {
    if (!open || !destTenant) return;
    let cancelled = false;
    setServersLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `${API.BASE_URL}/azure/tenants/${destTenant}/options?dbType=postgresql`,
        );
        if (!res.ok) return;
        const o = await res.json();
        if (cancelled) return;
        const list: string[] = o.servers || [];
        setServers(list);
        const meta = (resource.data || {}) as Record<string, any>;
        const seed = meta.server_name && list.includes(meta.server_name)
          ? meta.server_name
          : list[0] || '';
        setDestServer(seed);
      } catch { /* ignore */ }
      finally { if (!cancelled) setServersLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, destTenant, resource.data]);

  const tenantOptions = useMemo(
    () => tenants.map(t => ({ value: t.id, label: t.domain || t.externalTenantId || t.displayName })),
    [tenants],
  );

  const recoverDisabled =
    !sourceDb ||
    !destTenant ||
    !destServer ||
    !destDbName.trim() ||
    tenantsLoading ||
    serversLoading ||
    submitting;

  const handleRecover = async () => {
    if (recoverDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API.BASE_URL}/jobs/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restoreType: 'OUT_OF_PLACE',
          snapshotIds: [snapshot.id],
          azureRestoreMode: 'FULL',
          // Snake-case keys to match the postgres_restore_handler
          // contract (target_server_name, target_database_name, ...).
          // The handler also reads `server_type` + `mode`; `mode` is
          // already supplied via azureRestoreMode at the top level.
          azureRestoreParams: {
            destination_tenant_id: destTenant,
            source_database_name: sourceDb,
            target_server_name: destServer,
            target_database_name: destDbName.trim(),
          },
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      onClose();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="azdb-rec-overlay" onClick={onClose} role="presentation">
      <div className="azdb-rec-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="azdb-rec-header">
          <h3>
            Recover database from backup version: {fmtLocal(snapshot.createdAt, {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            })}
          </h3>
          <button className="azdb-rec-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="azdb-rec-body">
          <div className="azdb-rec-field">
            <label>
              Source database <InfoHint text="Pick which backed-up database from this snapshot to restore." />
            </label>
            <RoundedSelect
              value={sourceDb}
              onChange={setSourceDb}
              placeholder="Select a source database"
              options={sourceDbs.map(d => ({ value: d, label: d }))}
            />
          </div>

          <div className="azdb-rec-field">
            <label>Destination tenant</label>
            <RoundedSelect
              value={destTenant}
              onChange={setDestTenant}
              placeholder={tenantsLoading ? 'Loading…' : 'Select a tenant'}
              disabled={tenantsLoading}
              options={tenantOptions}
            />
          </div>

          <div className="azdb-rec-field">
            <label>
              Destination server <InfoHint text="PostgreSQL server in the chosen tenant where the new database will be created." />
            </label>
            <RoundedSelect
              value={destServer}
              onChange={setDestServer}
              placeholder={serversLoading ? 'Loading…' : 'Select a server'}
              disabled={serversLoading}
              options={servers.map(s => ({ value: s, label: s }))}
            />
          </div>

          <div className="azdb-rec-field">
            <label>
              Destination database <InfoHint text="Name for the newly-created database on the destination server." />
            </label>
            <input
              type="text"
              value={destDbName}
              onChange={e => setDestDbName(e.target.value)}
              placeholder="Enter a destination database"
            />
          </div>

          {error && <div className="azdb-rec-error">{error}</div>}
        </div>

        <div className="azdb-rec-footer">
          <button type="button" className="azdb-rec-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="azdb-rec-submit"
            onClick={handleRecover}
            disabled={recoverDisabled}
          >
            {submitting ? 'Starting…' : 'Recover'}
          </button>
        </div>
      </div>
    </div>
  );
}
