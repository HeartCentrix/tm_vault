import { useState, useEffect, useMemo, useCallback } from 'react';
import type { SnapshotItem, ResourceWithBackups } from '../services/snapshot';
import { API } from '../config/api';
import { fmtLocal } from '../utils/datetime';
import AddSecretModal from './AddSecretModal';
import RoundedSelect from './RoundedSelect';
import './AzureDbRecoverModal.css';

/** Info icon + floating tooltip. Used next to each field label so the
 *  user gets contextual help on what to type, without cluttering the
 *  label row. The native `title` attribute looks rough (OS-rendered,
 *  slow, no markup) so we draw our own panel on hover / focus. */
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
 * Modal shown when the user clicks Recover on an Azure SQL or Azure
 * Postgres resource. Matches the layout in azure/azure_recover.png:
 *
 *   Recover SQL DB from backup version: <timestamp>       [×]
 *   Database name            [ TestDB-qkgxv        ]
 *   Destination tenant       [ qfion.com           ]
 *   Basic
 *     Subscription           [ Azure subscription 1]
 *     Resource group         [ tmvault             ]
 *     Location               [ Central India       ]
 *   SQL Server
 *     Server                 [ tmvault-sql-test    ]
 *     Secret                 [ Select a secret ▾   ]
 *                            Create a new secret for SQL Server access
 *                                                      [ Cancel ] [ Recover ]
 *
 * Content type (Configuration / Database / Schema) doesn't matter —
 * restore always recreates the whole database from the chosen backup.
 */
export interface AzureDbRecoverModalProps {
  open: boolean;
  onClose: () => void;
  resource: ResourceWithBackups;
  snapshot: SnapshotItem;
  tenantDomain?: string;
}

interface SecretOption { id: string; name: string; type: string; }

/** Lowercase-alphabet 6-char suffix used to avoid name collisions when
 *  restoring into the same server. Generated fresh on every modal open
 *  so consecutive restores don't reuse the same suffix. */
const randomSuffix = () => {
  const alpha = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 6; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
  return out;
};

function kindLabel(kind: string): 'SQL' | 'PostgreSQL' {
  return kind === 'azure_sql' ? 'SQL' : 'PostgreSQL';
}

export default function AzureDbRecoverModal({
  open, onClose, resource, snapshot, tenantDomain: _tenantDomain,
}: AzureDbRecoverModalProps) {
  // `tenantDomain` is no longer used directly — kept in the props for
  // back-compat with callers; the Destination tenant is now picked
  // from the /azure/tenants list below.
  void _tenantDomain;
  const meta = (resource.data || {}) as Record<string, any>;

  // Pre-fill base — the DB name defaults to `<original>-<6 alphas>`
  // so the user doesn't clobber the source by accident. The suffix is
  // regenerated on every modal open (see the open-effect below), not
  // memoised, so consecutive restores don't reuse the same name.
  const dbBase = useMemo(
    () => String(meta.database_name || resource.external_id || 'restored-db'),
    [resource.id],
  );

  // Destination tenant / subscription / RG / location / server are all
  // dropdowns sourced from the backend so the user can only pick a
  // destination that actually exists. They cascade off `destTenant`:
  // whenever the tenant changes we re-fetch options for that tenant.
  const [dbName, setDbName] = useState(() => `${dbBase}-${randomSuffix()}`);
  const [destTenant, setDestTenant] = useState('');
  const [subscription, setSubscription] = useState('');
  const [resourceGroup, setResourceGroup] = useState('');
  const [location, setLocation] = useState('');
  const [server, setServer] = useState('');
  const [tenants, setTenants] = useState<Array<{ id: string; externalTenantId: string; displayName: string; domain?: string }>>([]);
  // `subscriptions` + `locations` carry a displayName separate from
  // the value (subscription GUID, region code) so the dropdown shows
  // user-friendly labels like "Azure subscription 1" / "Central India"
  // while we submit the underlying IDs. `servers` now carry their RG
  // and location so picking a server can auto-fill the RG field.
  const [opts, setOpts] = useState<{
    subscriptions: Array<{ id: string; displayName: string }>;
    resourceGroups: string[];
    locations: Array<{ name: string; displayName: string }>;
    servers: Array<{ name: string; resourceGroup: string; location: string }>;
  }>({ subscriptions: [], resourceGroups: [], locations: [], servers: [] });
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [optsLoading, setOptsLoading] = useState(false);
  const [secret, setSecret] = useState(''); // selected secret id
  const [secrets, setSecrets] = useState<SecretOption[]>([]);
  const [addSecretOpen, setAddSecretOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDbName(`${dbBase}-${randomSuffix()}`);
      setSecret('');
      setError(null);
      // Reset cascading state so we always reflect a fresh discovery
      // pass — never serve stale values from a prior open.
      setOpts({ subscriptions: [], resourceGroups: [], locations: [], servers: [] });
      setSubscription(''); setResourceGroup(''); setLocation(''); setServer('');
    }
  }, [open, dbBase]);

  // Fetch Azure tenants on open — default to the one owning the source
  // resource so the user lands on an expected restore target. Domain
  // comes back from /azure/tenants (Graph-discovered) so the dropdown
  // can show "qfion.com" instead of a tenant GUID.
  useEffect(() => {
    if (!open) return;
    setTenantsLoading(true);
    (async () => {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(`${API.BASE_URL}/azure/tenants`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        const items = data.items || [];
        setTenants(items);
        const current = items.find((t: any) => t.id === resource.tenant_id);
        setDestTenant((current?.id) || items[0]?.id || '');
      } catch { /* ignore */ }
      finally { setTenantsLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset the cascade state to the source resource's values whenever
  // the chosen tenant changes. The fetch effect below then runs with
  // those seeds so the modal opens pre-filled with the source's
  // sub/RG/location/server. Resource discovery stores location
  // inconsistently (display name for PG, region code on the
  // `azure_region` column for SQL) so we coerce to the canonical
  // lowercase-no-spaces form before matching against AZURE_REGIONS.
  const sourceLocationRaw =
    meta.location || meta.azure_region ||
    (resource as any).azure_region || '';
  const sourceLocation = String(sourceLocationRaw).toLowerCase().replace(/\s+/g, '');
  const sourceSubscription = meta.subscription_id || meta.azure_subscription_id || '';
  const sourceResourceGroup = meta.resource_group || meta.azure_resource_group || '';

  useEffect(() => {
    if (!open || !destTenant) return;
    setSubscription(sourceSubscription);
    setResourceGroup(sourceResourceGroup);
    setLocation(sourceLocation);
    setServer(meta.server_name || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, destTenant]);

  // Cascading discovery — re-runs whenever any narrower filter
  // changes. Subscriptions are always full (visible to the SP);
  // RGs are filtered by sub; servers are filtered by sub + RG +
  // location; locations are the static Azure-region catalogue. After
  // each fetch we re-validate the user's current picks against the
  // new options and snap to the first entry when invalid.
  useEffect(() => {
    if (!open || !destTenant) return;
    let cancelled = false;
    setOptsLoading(true);
    (async () => {
      try {
        const token = localStorage.getItem('access_token');
        const dbType = resource.kind === 'azure_sql' ? 'sql' : 'postgresql';
        const params = new URLSearchParams({ dbType });
        if (subscription)  params.set('subscription', subscription);
        if (resourceGroup) params.set('resourceGroup', resourceGroup);
        if (location)      params.set('location', location);
        const res = await fetch(
          `${API.BASE_URL}/azure/tenants/${destTenant}/options?${params}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) return;
        const o = await res.json();
        if (cancelled) return;
        setOpts(o);
        // Snap each pick to the first available option when the
        // current value isn't in the (possibly-narrower) new list.
        const subIds: string[] = (o.subscriptions || []).map((s: any) => s.id);
        const locNames: string[] = (o.locations || []).map((l: any) => l.name);
        const rgList: string[] = o.resourceGroups || [];
        const srvObjs: Array<{ name: string; resourceGroup: string; location: string }> = o.servers || [];
        const srvNames: string[] = srvObjs.map(s => s.name);
        if (!subIds.includes(subscription)) setSubscription(subIds[0] || '');
        if (location && !locNames.includes(location)) setLocation(locNames[0] || '');
        else if (!location && locNames.length) setLocation(locNames[0]);
        // Server picks from location-filtered list. When the chosen
        // server changes, snap the RG to the server's actual RG so
        // the "new DB lands here" value matches reality.
        const nextServerName = server && srvNames.includes(server)
          ? server
          : (srvNames[0] || '');
        if (nextServerName !== server) setServer(nextServerName);
        const chosenServer = srvObjs.find(s => s.name === nextServerName);
        const serverRg = chosenServer?.resourceGroup || '';
        // Prefer server's RG; fall back to preserving user's pick if
        // it's still valid in the sub's RG list, else first entry.
        if (serverRg) {
          if (resourceGroup !== serverRg) setResourceGroup(serverRg);
        } else if (resourceGroup && !rgList.includes(resourceGroup)) {
          setResourceGroup(rgList[0] || '');
        } else if (!resourceGroup && rgList.length) {
          setResourceGroup(rgList[0]);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setOptsLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, destTenant, subscription, resourceGroup, location]);

  // Secret dropdown sources its options from tenant secrets filtered by
  // the login flavor matching the resource kind. Refreshed when the
  // modal opens and after AddSecretModal creates a new one so the fresh
  // entry is immediately selectable.
  const loginType = resource.kind === 'azure_sql' ? 'SQL_SERVER_LOGIN' : 'POSTGRESQL_LOGIN';
  const fetchSecrets = useCallback(async () => {
    if (!resource.tenant_id) return;
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(
        `${API.BASE_URL}/tenants/${resource.tenant_id}/secrets?type=${loginType}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) return;
      const data = await res.json();
      setSecrets((data.items || []).map((s: any) => ({ id: s.id, name: s.name, type: s.type })));
    } catch { /* ignore */ }
  }, [resource.tenant_id, loginType]);

  useEffect(() => {
    if (open) fetchSecrets();
  }, [open, fetchSecrets]);

  if (!open) return null;

  // Recover requires every destination field to be resolved + a secret
  // chosen. While discovery is in-flight, block submission so the user
  // can't fire a restore against an empty dropdown.
  const recoverDisabled =
    !dbName.trim() ||
    !destTenant ||
    !subscription ||
    !resourceGroup ||
    !location ||
    !server ||
    !secret ||
    tenantsLoading ||
    optsLoading ||
    submitting;

  const headerLabel = `Recover ${kindLabel(resource.kind)} DB from backup version: ${
    fmtLocal(snapshot.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  }`;

  const handleRecover = async () => {
    if (recoverDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`${API.BASE_URL}/jobs/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          restoreType: 'OUT_OF_PLACE',
          snapshotIds: [snapshot.id],
          azureRestoreMode: 'FULL',
          // Snake-case keys to match the sql_restore_handler contract
          // (target_server_name, target_database_name, target_resource_group,
          // target_subscription_id, target_region, secret_id, ...).
          azureRestoreParams: {
            destination_tenant_id: destTenant,
            target_subscription_id: subscription,
            target_resource_group: resourceGroup,
            target_region: location,
            target_server_name: server,
            target_database_name: dbName.trim(),
            secret_id: secret,
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

  return (
    <div className="azdb-rec-overlay" onClick={onClose} role="presentation">
      <div className="azdb-rec-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="azdb-rec-header">
          <h3>{headerLabel}</h3>
          <button className="azdb-rec-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="azdb-rec-body">
          <div className="azdb-rec-field">
            <label>Database name</label>
            <input
              type="text"
              value={dbName}
              onChange={e => setDbName(e.target.value)}
              placeholder="new-database-name"
            />
          </div>
          <div className="azdb-rec-field">
            <label>Destination tenant</label>
            <RoundedSelect
              value={destTenant}
              onChange={setDestTenant}
              placeholder={tenantsLoading ? 'Loading…' : 'Select a tenant'}
              disabled={tenantsLoading}
              options={tenants.map(t => ({
                value: t.id,
                label: t.domain || t.externalTenantId || t.displayName,
              }))}
            />
          </div>

          <h4 className="azdb-rec-section">Basic</h4>
          <div className="azdb-rec-field">
            <label>Subscription <InfoHint text="Destination Azure subscription. Pick from subscriptions this tenant already owns." /></label>
            <RoundedSelect
              value={subscription}
              onChange={setSubscription}
              options={opts.subscriptions.map(s => ({ value: s.id, label: s.displayName || s.id }))}
              placeholder={optsLoading ? 'Loading…' : '—'}
              disabled={optsLoading}
            />
          </div>
          <div className="azdb-rec-field">
            <label>Resource group <InfoHint text="Destination resource group the restored database will land in. Pick from groups known for this tenant." /></label>
            <RoundedSelect
              value={resourceGroup}
              onChange={setResourceGroup}
              options={opts.resourceGroups.map(r => ({ value: r, label: r }))}
              placeholder={optsLoading ? 'Loading…' : '—'}
              disabled={optsLoading}
            />
          </div>
          <div className="azdb-rec-field">
            <label>Location <InfoHint text="Azure region where the restored database will be created." /></label>
            <RoundedSelect
              value={location}
              onChange={setLocation}
              options={opts.locations.map(l => ({ value: l.name, label: l.displayName || l.name }))}
              placeholder={optsLoading ? 'Loading…' : '—'}
              disabled={optsLoading}
            />
          </div>

          <h4 className="azdb-rec-section">{kindLabel(resource.kind)} Server</h4>
          <div className="azdb-rec-field">
            <label>Server <InfoHint text={`Destination ${kindLabel(resource.kind)} server that will host the restored database.`} /></label>
            <RoundedSelect
              value={server}
              onChange={setServer}
              options={opts.servers.map(sv => ({ value: sv.name, label: sv.name }))}
              placeholder={optsLoading ? 'Loading…' : '—'}
              disabled={optsLoading}
            />
          </div>
          <div className="azdb-rec-field">
            <label>Secret <InfoHint text="Admin credential used to connect to the destination server. Pick one the tenant already has or click 'new secret' to add one." /></label>
            <RoundedSelect
              value={secret}
              onChange={setSecret}
              options={secrets.map(s => ({ value: s.id, label: s.name }))}
              placeholder="Select a secret"
            />
            <div className="azdb-rec-hint">
              Create a <a
                href="#"
                onClick={e => { e.preventDefault(); setAddSecretOpen(true); }}
              >new secret</a> for {kindLabel(resource.kind)} Server access
            </div>
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

      {/* Stacked on top of this modal — creating a new Secret without
          losing the half-filled restore form. On success we append the
          freshly-created secret and auto-select it. */}
      <AddSecretModal
        open={addSecretOpen}
        onClose={() => setAddSecretOpen(false)}
        tenantId={resource.tenant_id}
        variant="login"
        defaultLoginKind={resource.kind === 'azure_sql' ? 'sql' : 'postgresql'}
        onCreated={s => { setSecrets(prev => [s, ...prev]); setSecret(s.id); }}
      />
    </div>
  );
}
