import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SnapshotService } from '../services/snapshot';
import { parseAsUtc, fmtLocal } from '../utils/datetime';
import { API } from '../config/api';
import type { SnapshotItem as SnapshotVersion } from '../services/snapshot';
import './AzureVmView.css';

// ── Module-level cache for snapshot-item listings ──────────────────
// A completed snapshot is immutable once written, so once we've
// pulled its items (potentially thousands of rows on a VM with many
// disks/NICs) we can hold them for the rest of the session without
// re-hitting the snapshot-service. Keyed on snapshot id so switching
// between multiple VMs still works. 10-min soft TTL as a backstop
// against a long-running tab that drifts off a new backup landing.
const _ITEMS_TTL_MS = 10 * 60 * 1000;
const _itemsCache: Map<string, { items: any[]; expiresAt: number; inflight?: Promise<any[]> }> = new Map();

function _cachedListItems(snapshotId: string): Promise<any[]> {
  const now = Date.now();
  const hit = _itemsCache.get(snapshotId);
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.items);
  if (hit?.inflight) return hit.inflight;
  const promise = SnapshotService.listSnapshotFiles(snapshotId, 1, 5000)
    .then(data => {
      const items = data.content || [];
      _itemsCache.set(snapshotId, { items, expiresAt: Date.now() + _ITEMS_TTL_MS });
      return items;
    })
    .catch(err => {
      // Don't poison the cache on transient failures — just let the
      // next caller retry. Drop the inflight entry so we don't leave
      // a rejected promise behind.
      _itemsCache.delete(snapshotId);
      throw err;
    });
  _itemsCache.set(snapshotId, { items: [], expiresAt: 0, inflight: promise });
  return promise;
}

/** Pull the live ARM payload for a given VM-flavored SnapshotItem.
 *  Returns null on any failure so callers can render a muted state
 *  without throwing. Cached for the lifetime of the component via
 *  useLiveDetail below. */
async function fetchLiveDetail(itemId: string): Promise<any | null> {
  try {
    const token = localStorage.getItem('access_token');
    const res = await fetch(`${API.BASE_URL}/snapshot-items/${itemId}/azure-vm-detail`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function useLiveDetail(itemId: string | null | undefined) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!itemId) { setData(null); return; }
    setLoading(true);
    fetchLiveDetail(itemId).then(setData).finally(() => setLoading(false));
  }, [itemId]);
  return { data, loading };
}

// ── Module-level cache for volume file listings ────────────────────
// Each entry is `(volumeItemId, path) → { items, error, expiresAt }`.
// The backend already caches for 30s but every hit still costs a
// full gateway hop; folding that into the browser saves the round
// trip entirely when the user backs out of a folder. Inflight dedup
// guarantees simultaneous requests share a single fetch.
type VolEntry = { items: any[]; error: string; expiresAt: number; inflight?: Promise<VolEntry> };
const _VOL_TTL_MS = 5 * 60 * 1000;
const _volCache: Map<string, VolEntry> = new Map();
const _volKey = (id: string, path: string) => `${id}::${path}`;

async function _cachedVolumeFiles(itemId: string, path: string): Promise<VolEntry> {
  const key = _volKey(itemId, path);
  const now = Date.now();
  const hit = _volCache.get(key);
  if (hit && hit.expiresAt > now) return hit;
  if (hit?.inflight) return hit.inflight;

  const token = localStorage.getItem('access_token');
  const inflight = (async (): Promise<VolEntry> => {
    try {
      const res = await fetch(
        `${API.BASE_URL}/snapshot-items/${itemId}/vm-volume-files?path=${encodeURIComponent(path)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entry: VolEntry = {
        items: Array.isArray(data.items) ? data.items : [],
        error: data.error || '',
        expiresAt: Date.now() + _VOL_TTL_MS,
      };
      _volCache.set(key, entry);
      return entry;
    } catch (e: any) {
      _volCache.delete(key);
      throw e;
    }
  })();

  _volCache.set(key, { items: [], error: '', expiresAt: 0, inflight });
  return inflight;
}

/**
 * 5-tab Recovery surface for Azure VM resources:
 *   Virtual machine / Volumes / Disks / Network interfaces / Public IP addresses
 *
 * Backs onto AZURE_VM_CONFIG / AZURE_VM_VOLUME / AZURE_VM_DISK /
 * AZURE_VM_NIC / AZURE_VM_PUBLIC_IP rows emitted by the backup
 * handler. Layout follows the screenshots under `/VM/` — a single
 * pane for the VM tab and a two-panel (left list + right detail)
 * shape for the other four.
 */

type VmTab = 'virtual_machine' | 'volumes' | 'disks' | 'network_interfaces' | 'public_ips';

const TAB_LABELS: Record<VmTab, string> = {
  virtual_machine: 'Virtual machine',
  volumes: 'Volumes',
  disks: 'Disks',
  network_interfaces: 'Network interfaces',
  public_ips: 'Public IP addresses',
};

interface Props {
  resourceId: string;
  snapshots: SnapshotVersion[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
  overrideSnapshotId?: string;
}

/** Compact label/value row reused by every detail panel. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="vm-field">
      <span className="vm-field-label">{label}</span>
      <span className="vm-field-val">
        {empty ? <span className="vm-muted">—</span> : value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vm-section">
      <h4 className="vm-section-title">{title}</h4>
      <div className="vm-grid">{children}</div>
    </section>
  );
}

/** Reused from the OneDrive Recovery view — same silhouette so the
 *  two file browsers feel like one product. */
const VmFolderIcon = (
  <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M0.5 12.5V2.5C0.5 1.94772 0.947715 1.5 1.5 1.5H5.5L7.5 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V12.5C14.5 13.0523 14.0523 13.5 13.5 13.5H1.5C0.947715 13.5 0.5 13.0523 0.5 12.5Z" />
  </svg>
);
const VmFileIcon = (
  <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM12.5 14H2.5V15H12.5V14ZM2 13.5V1.5H1V13.5H2ZM2.5 1H10.5V0H2.5V1ZM13 3.5V13.5H14V3.5H13ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2.5 14C2.22386 14 2 13.7761 2 13.5H1C1 14.3284 1.67157 15 2.5 15V14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671574 1 1.5H2Z" />
  </svg>
);

function boolLabel(v: any): string {
  if (v === true || v === 'Enabled' || v === 'enabled') return 'Enabled';
  if (v === false || v === 'Disabled' || v === 'disabled') return 'Disabled';
  return '';
}

function fmtGb(sizeBytes?: number, sizeGb?: number): string {
  if (sizeGb != null && !Number.isNaN(sizeGb)) return `${Math.round(sizeGb)} GB`;
  if (sizeBytes != null && sizeBytes > 0) return `${Math.round(sizeBytes / (1024 ** 3))} GB`;
  return '';
}

/** ——— Virtual machine (single-pane) ——— */
function VirtualMachinePane({ item, cfg }: { item: any; cfg: any }) {
  // Live ARM detail takes precedence over the snapshot's captured
  // metadata — the Portal fields (security type, hibernation, image
  // reference, etc.) reflect Azure's current state rather than what
  // was denormalized at backup time.
  const { data: live, loading } = useLiveDetail(item?.id);
  if (loading && !live) {
    return <div className="vm-pane"><div className="vm-card">Loading VM details…</div></div>;
  }
  const p = live?.properties || {};
  const storageProfile = p.storageProfile || {};
  const osDisk = storageProfile.osDisk || {};
  const imageRef = storageProfile.imageReference || {};
  const security = p.securityProfile || {};
  const uefi = security.uefiSettings || {};
  const hw = p.hardwareProfile || {};
  const osProfile = p.osProfile || {};
  const netProfile = p.networkProfile || {};
  const nicRefs: any[] = netProfile.networkInterfaces || [];
  const primaryNicName = (nicRefs[0]?.id || '').split('/').pop() || '';
  const dataDiskCount = (storageProfile.dataDisks || []).length;
  const extensions: any[] = Array.isArray(p.resources) ? p.resources : [];

  const subId = (live?.id || '').split('/')[2] || cfg.subscription_id || '';
  const rg = (live?.id || '').split('/')[4] || cfg.resource_group || '';

  return (
    <div className="vm-pane">
      <div className="vm-card">
        <Section title="Essential">
          <Field label="Subscription ID" value={subId} />
          <Field label="Resource Group" value={rg} />
          <Field label="Location" value={live?.location || cfg.location || ''} />
          <Field label="Operating System" value={osDisk.osType || ''} />
          <Field label="Size" value={hw.vmSize || ''} />
          <Field label="Time created" value={p.timeCreated ? fmtLocal(p.timeCreated) : ''} />
        </Section>

        <div className="vm-card-2col">
          <div className="vm-card-col">
            <Section title="Virtual machine">
              <Field label="Computer name" value={osProfile.computerName || ''} />
              <Field label="Operating System" value={osDisk.osType || ''} />
              <Field label="Hibernation" value={boolLabel(p.additionalCapabilities?.hibernationEnabled)} />
              <Field label="Proximity placement group" value={(p.proximityPlacementGroup?.id || '').split('/').pop() || ''} />
              <Field label="Capacity reservation group" value={(p.capacityReservation?.capacityReservationGroup?.id || '').split('/').pop() || ''} />
              <Field label="Disk controller type" value={storageProfile.diskControllerType || ''} />
            </Section>

            <Section title="Availability + scaling">
              <Field label="Availability zone" value={(live?.zones || []).join(', ')} />
              <Field label="Availability set" value={(p.availabilitySet?.id || '').split('/').pop() || ''} />
              <Field label="Scale set" value={(p.virtualMachineScaleSet?.id || '').split('/').pop() || ''} />
            </Section>

            <Section title="Security">
              <Field label="Security type" value={security.securityType || ''} />
              <Field label="Enable secure boot" value={boolLabel(uefi.secureBootEnabled)} />
              <Field label="Enable vTPM" value={boolLabel(uefi.vTpmEnabled)} />
            </Section>

            <Section title="Extensions + applications">
              <Field label="Extensions" value={extensions.length ? extensions.map((e: any) => e.name).join(', ') : ''} />
              <Field label="Applications" value={(p.applicationProfile?.galleryApplications || []).map((a: any) => a.packageReferenceId?.split('/').pop()).filter(Boolean).join(', ')} />
            </Section>
          </div>

          <div className="vm-card-col">
            <Section title="Networking">
              <Field label="Network interface" value={primaryNicName} />
            </Section>

            <Section title="Source image details">
              <Field label="Publisher" value={imageRef.publisher || ''} />
              <Field label="Offer" value={imageRef.offer || ''} />
              <Field label="Plan" value={imageRef.sku || ''} />
            </Section>

            <Section title="Disk">
              <Field label="OS disk" value={osDisk.name || ''} />
              <Field label="Encryption at host" value={boolLabel(security.encryptionAtHost)} />
              <Field label="Data disks" value={dataDiskCount} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ——— Shared two-panel layout for Volumes / Disks / NICs / Public IPs ——— */
function TwoPane({
  items, selectedItems, onToggleItem, renderRow, renderDetail, leftHeader,
}: {
  items: any[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  renderRow: (item: any) => React.ReactNode;
  renderDetail: (item: any) => React.ReactNode;
  leftHeader?: React.ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id || null);
  useEffect(() => { if (items.length && !items.find(i => i.id === activeId)) setActiveId(items[0]?.id || null); }, [items, activeId]);
  const active = items.find(i => i.id === activeId) || null;

  return (
    <div className="vm-two-pane">
      <aside className="vm-left">
        {leftHeader && <div className="vm-left-head">{leftHeader}</div>}
        {items.length === 0 ? (
          <div className="vm-left-empty">No items captured</div>
        ) : (
          items.map(it => (
            <div
              key={it.id}
              className={`vm-left-row ${it.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(it.id)}
            >
              <input
                type="checkbox"
                checked={selectedItems.has(it.id)}
                onClick={e => e.stopPropagation()}
                onChange={() => onToggleItem(it.id)}
              />
              <div className="vm-left-row-body">{renderRow(it)}</div>
            </div>
          ))
        )}
      </aside>
      <main className="vm-right">
        {active ? renderDetail(active) : <div className="vm-pane-empty">Select an item</div>}
      </main>
    </div>
  );
}

/** ——— Disks tab detail ——— */
function DiskDetail({ item, cfg }: { item: any; cfg: any }) {
  const { data: live, loading } = useLiveDetail(item?.id);
  if (loading && !live) return <div className="vm-pane"><div className="vm-card">Loading disk…</div></div>;
  const p = live?.properties || {};
  const sku = live?.sku || {};
  const subId = (live?.id || '').split('/')[2] || cfg.subscription_id || '';
  const rg = (live?.id || '').split('/')[4] || cfg.resource_group || '';
  const cd = p.creationData || {};
  const sc = p.supportedCapabilities || {};
  const enc = p.encryption || {};
  const sp = p.securityProfile || {};
  return (
    <div className="vm-pane">
      <div className="vm-card">
        <Section title="Essential">
          <Field label="Name" value={live?.name || item.name} />
          <Field label="Subscription ID" value={subId} />
          <Field label="Resource Group" value={rg} />
          <Field label="Last ownership update time" value={p.lastOwnershipUpdateTime ? fmtLocal(p.lastOwnershipUpdateTime) : ''} />
          <Field label="Location" value={live?.location || ''} />
          <Field label="Time created" value={p.timeCreated ? fmtLocal(p.timeCreated) : ''} />
          <Field label="Tags" value={Object.keys(live?.tags || {}).length ? Object.entries(live.tags).map(([k, v]) => `${k}=${v}`).join(', ') : ''} />
        </Section>
        <div className="vm-card-2col">
          <div className="vm-card-col">
            <Section title="Disk">
              <Field label="Operating system type" value={p.osType || ''} />
              <Field label="Creation option" value={cd.createOption || ''} />
              <Field label="VM generation" value={p.hyperVGeneration || ''} />
              <Field label="VM architecture" value={sc.architecture || ''} />
              <Field label="Availability zone" value={(live?.zones || []).join(', ')} />
              <Field label="Hibernation supported" value={boolLabel(sc.supportedHibernation ?? sc.acceleratedNetwork)} />
            </Section>
            <Section title="Encryption">
              <Field label="Encryption type" value={enc.type ? enc.type.replace(/_/g, ' ').replace('EncryptionAtRestWith', '') : 'Platform-managed key'} />
            </Section>
            <Section title="Networking">
              <Field label="Connection type" value={p.networkAccessPolicy || 'AllowAll'} />
            </Section>
          </div>
          <div className="vm-card-col">
            <Section title="Size">
              <Field label="Size" value={p.diskSizeGB != null ? `${p.diskSizeGB} GB` : ''} />
              <Field label="Storage type" value={sku.name || ''} />
              <Field label="IOPS" value={p.diskIOPSReadWrite ?? ''} />
              <Field label="Throughput (MBps)" value={p.diskMBpsReadWrite ?? ''} />
              <Field label="Disk tier" value={p.tier || ''} />
            </Section>
            <Section title="Security type">
              <Field label="Security type" value={sp.securityType || 'Standard'} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ——— NIC tab detail ——— */
function NicDetail({ item, cfg }: { item: any; cfg: any }) {
  const { data: live, loading } = useLiveDetail(item?.id);
  if (loading && !live) return <div className="vm-pane"><div className="vm-card">Loading NIC…</div></div>;
  const p = live?.properties || {};
  const subId = (live?.id || '').split('/')[2] || cfg.subscription_id || '';
  const rg = (live?.id || '').split('/')[4] || cfg.resource_group || '';
  const ips: any[] = p.ipConfigurations || [];
  const primary = ips.find(i => i.properties?.primary) || ips[0] || {};
  const pp = primary.properties || {};
  const subnetSeg = (pp.subnet?.id || '').split('/');
  const vnetName = subnetSeg[subnetSeg.indexOf('virtualNetworks') + 1] || '';
  const subnetName = subnetSeg.slice(-1)[0] || '';
  const vnetSubnet = vnetName ? `${vnetName}/${subnetName}` : '';
  const pubName = (pp.publicIPAddress?.id || '').split('/').pop() || '';
  return (
    <div className="vm-pane">
      <div className="vm-card">
        <Section title="Essential">
          <Field label="Name" value={live?.name || item.name} />
          <Field label="Subscription ID" value={subId} />
          <Field label="Resource group" value={rg} />
          <Field label="Location" value={live?.location || ''} />
          <Field label="Virtual network/subnet" value={vnetSubnet} />
          <Field label="Tags" value={Object.keys(live?.tags || {}).length ? Object.entries(live.tags).map(([k, v]) => `${k}=${v}`).join(', ') : ''} />
        </Section>
        <div className="vm-card-2col">
          <div className="vm-card-col">
            <Section title="Network interface">
              <Field label="Resource GUID" value={p.resourceGuid || ''} />
              <Field label="Virtual network/subnet" value={vnetSubnet} />
              <Field label="Type" value={(live?.type || '').split('/').pop() || 'Standard'} />
              <Field label="MAC address" value={p.macAddress || ''} />
            </Section>
            <Section title="Accelerated networking">
              <Field label="Accelerated networking" value={boolLabel(p.enableAcceleratedNetworking)} />
            </Section>
            <Section title="Network security group">
              <Field label="Associated to" value={(p.networkSecurityGroup?.id || '').split('/').pop() || ''} />
            </Section>
          </div>
          <div className="vm-card-col">
            <Section title="IP configurations">
              <Field label="Private IPv4 address" value={pp.privateIPAddress || ''} />
              <Field label="Public IPv4 address" value={pubName} />
              <Field label="Private IPv6 address" value="" />
              <Field label="Public IPv6 address" value="" />
              <Field label="Private IP allocation method" value={pp.privateIPAllocationMethod || ''} />
              <Field label="Public IP allocation method" value={pp.publicIPAddress?.properties?.publicIPAllocationMethod || ''} />
              <Field label="IP config count" value={ips.length} />
              <Field label="IP Forwarding" value={boolLabel(p.enableIPForwarding)} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ——— Public IP tab detail ——— */
function PublicIpDetail({ item, cfg }: { item: any; cfg: any }) {
  const { data: live, loading } = useLiveDetail(item?.id);
  if (loading && !live) return <div className="vm-pane"><div className="vm-card">Loading public IP…</div></div>;
  const p = live?.properties || {};
  const sku = live?.sku || {};
  const subId = (live?.id || '').split('/')[2] || cfg.subscription_id || '';
  const rg = (live?.id || '').split('/')[4] || cfg.resource_group || '';
  const assocSeg = (p.ipConfiguration?.id || '').split('/');
  const assoc = assocSeg.length >= 3 ? assocSeg.slice(-3).join('/') : '';
  return (
    <div className="vm-pane">
      <div className="vm-card">
        <Section title="Essential">
          <Field label="Name" value={live?.name || item.name} />
          <Field label="Subscription ID" value={subId} />
          <Field label="Resource group" value={rg} />
          <Field label="Location" value={live?.location || ''} />
          <Field label="Tags" value={Object.keys(live?.tags || {}).length ? Object.entries(live.tags).map(([k, v]) => `${k}=${v}`).join(', ') : ''} />
          <Field label="SKU" value={sku.name || ''} />
          <Field label="Tier" value={sku.tier || ''} />
          <Field label="IP address" value={p.ipAddress || ''} />
          <Field label="DNS name" value={p.dnsSettings?.fqdn || ''} />
          <Field label="Domain name label scope" value={p.dnsSettings?.domainNameLabelScope || ''} />
          <Field label="Associated to" value={assoc} />
        </Section>
        <div className="vm-card-2col">
          <div className="vm-card-col">
            <Section title="Public IP address">
              <Field label="Resource GUID" value={p.resourceGuid || ''} />
              <Field label="IP address" value={p.ipAddress || ''} />
              <Field label="IP address version" value={p.publicIPAddressVersion || 'IPv4'} />
              <Field label="Allocation method" value={p.publicIPAllocationMethod || ''} />
              <Field label="Idle timeout" value={p.idleTimeoutInMinutes ?? ''} />
            </Section>
          </div>
          <div className="vm-card-col">
            <Section title="DDoS Protection">
              <Field label="Protection Type" value={p.ddosSettings?.protectionMode || 'Network inherited protection'} />
              <Field label="Plan ID" value={p.ddosSettings?.ddosProtectionPlan?.id || ''} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ——— Volumes tab right pane ———
 *  For Raw block device rows the extra_data flags the volume as having
 *  no filesystem, so we render the portal-matching "not detected" panel.
 *  For filesystem rows we hit the live-file endpoint which runs
 *  Get-ChildItem / ls on the source VM via Azure Run Command and
 *  returns the entries at `path`. Clicking a folder re-fetches with
 *  the new path; the search box filters the current folder. */
function VolumeDetail({ item }: { item: any }) {
  const meta = item?.metadata || {};
  const os = (meta.os_type || '').toLowerCase();
  // Legacy volume rows (captured before the backup handler emitted
  // raw/fs pairs) don't carry `volume_kind`. For those, infer from
  // `os_type`: OS disks on Windows/Linux get treated as filesystem
  // volumes so the user can still browse files; non-OS disks stay
  // Raw. Newer rows use the explicit `volume_kind` value directly.
  const inferredFs = !meta.volume_kind && (os === 'windows' || os === 'linux');
  const isFs = meta.volume_kind === 'filesystem' || inferredFs;
  const isRaw = !isFs;
  const inferredFsType = os === 'windows' ? 'NTFS' : os === 'linux' ? 'ext4' : '';
  const inferredMount = os === 'windows' ? 'C:\\' : os === 'linux' ? '/' : '';
  const fsType = (meta.file_system || inferredFsType || '').toUpperCase();
  const defaultPath = meta.mount_point || inferredMount || (fsType === 'NTFS' ? 'C:\\' : '/');
  const [path, setPath] = useState<string>(defaultPath);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [q, setQ] = useState('');
  const isWindows = fsType === 'NTFS';

  // Reset state when the user picks a different volume so we don't
  // flash the previous volume's files while the new fetch is pending.
  useEffect(() => {
    setPath(defaultPath);
    setEntries([]);
    setError('');
    setQ('');
  }, [item?.id, defaultPath]);

  useEffect(() => {
    if (isRaw || !item?.id) return;
    let cancelled = false;
    // Warm-cache path: render the cached folder instantly, no spinner.
    const hit = _volCache.get(_volKey(item.id, path));
    const warm = hit && hit.expiresAt > Date.now() ? hit : null;
    if (warm) {
      setEntries(warm.items);
      setError(warm.error);
      setLoading(false);
    } else {
      setLoading(true);
      setError('');
    }
    _cachedVolumeFiles(item.id, path)
      .then(entry => {
        if (cancelled) return;
        setEntries(entry.items);
        setError(entry.error);
      })
      .catch(e => { if (!cancelled) { setError(String(e?.message || e)); setEntries([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item?.id, path, isRaw]);

  const sep = isWindows ? '\\' : '/';
  const openFolder = (name: string) => {
    const base = path.endsWith(sep) ? path : `${path}${sep}`;
    setPath(`${base}${name}`);
  };
  const goUp = () => {
    const trimmed = path.replace(/[\\/]+$/, '');
    const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
    if (idx <= 2) { setPath(defaultPath); return; }
    setPath(trimmed.slice(0, idx));
  };

  if (isRaw) {
    return (
      <div className="vm-pane vm-pane-vol">
        <div className="vm-vol-head">{item.name}</div>
        <div className="vm-vol-sub-head">Name</div>
        <div className="vm-vol-empty">The file system is not detected</div>
      </div>
    );
  }

  const visible = q ? entries.filter(e => e.name.toLowerCase().includes(q.toLowerCase())) : entries;

  return (
    <div className="vm-pane vm-pane-vol">
      <div className="vm-vol-head">
        <span className="vm-vol-path">{path}</span>
        <input
          className="vm-vol-search"
          placeholder="Search in this folder"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <div className="vm-vol-sub-head">Name</div>
      {loading ? (
        <div className="vm-vol-empty">Loading files…</div>
      ) : error ? (
        <div className="vm-vol-empty">{error}</div>
      ) : visible.length === 0 ? (
        <div className="vm-vol-empty">No files in this folder</div>
      ) : (
        <div className="vm-vol-list">
          {path !== defaultPath && (
            <div className="vm-vol-row" onClick={goUp}>
              <span className="vm-vol-ico vm-vol-ico-folder">{VmFolderIcon}</span>
              <span className="vm-vol-name">..</span>
            </div>
          )}
          {visible.map(e => (
            <div
              key={e.name}
              className="vm-vol-row"
              onClick={() => e.isDirectory && openFolder(e.name)}
              style={{ cursor: e.isDirectory ? 'pointer' : 'default' }}
            >
              <input type="checkbox" onClick={ev => ev.stopPropagation()} />
              <span className={`vm-vol-ico ${e.isDirectory ? 'vm-vol-ico-folder' : 'vm-vol-ico-file'}`}>
                {e.isDirectory ? VmFolderIcon : VmFileIcon}
              </span>
              <span className="vm-vol-name">{e.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AzureVmView({
  resourceId, snapshots, selectedItems, onToggleItem, onSelectAll, overrideSnapshotId,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = (searchParams.get('tab') || '') as VmTab;
  const activeTab: VmTab = (['virtual_machine','volumes','disks','network_interfaces','public_ips'] as VmTab[])
    .includes(urlTab) ? urlTab : 'virtual_machine';
  const setActiveTab = (tab: VmTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const latestSnapshot = useMemo(() => {
    const completed = snapshots
      .filter(s => s.resourceId === resourceId && s.status === 'COMPLETED')
      .sort((a, b) => (parseAsUtc(b.createdAt)?.getTime() ?? 0) - (parseAsUtc(a.createdAt)?.getTime() ?? 0));
    if (overrideSnapshotId) {
      const picked = completed.find(s => s.id === overrideSnapshotId);
      if (picked) return picked;
    }
    return completed[0] || null;
  }, [snapshots, resourceId, overrideSnapshotId]);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!latestSnapshot) { setItems([]); return; }
    let cancelled = false;
    // Only show the spinner for a real network fetch; a warm cache
    // entry resolves synchronously and we'd just flash a spinner.
    const hit = _itemsCache.get(latestSnapshot.id);
    const cached = hit && hit.expiresAt > Date.now() ? hit.items : null;
    if (cached) {
      setItems(cached);
    } else {
      setLoading(true);
    }
    _cachedListItems(latestSnapshot.id)
      .then(list => { if (!cancelled) setItems(list); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [latestSnapshot?.id]);

  const byType = (suffix: string) => items.filter(i => (i.itemType || '').toUpperCase() === `AZURE_VM_${suffix}`);

  const configItem = useMemo(() => byType('CONFIG')[0] || null, [items]);
  const cfg = configItem?.metadata || {};

  const disks = useMemo(() => byType('DISK'), [items]);
  const volumes = useMemo(() => byType('VOLUME'), [items]);
  const nics = useMemo(() => byType('NIC'), [items]);
  const pips = useMemo(() => byType('PUBLIC_IP'), [items]);

  const activeList = activeTab === 'disks' ? disks : activeTab === 'volumes' ? volumes
    : activeTab === 'network_interfaces' ? nics : activeTab === 'public_ips' ? pips : [];

  const allChecked = activeList.length > 0 && activeList.every(i => selectedItems.has(i.id));
  const toggleAll = () => onSelectAll(activeList.map(i => i.id), !allChecked);

  return (
    <>
      <div className="content-type-tabs">
        {(['virtual_machine','volumes','disks','network_interfaces','public_ips'] as VmTab[]).map(tab => (
          <button
            key={tab}
            className={`content-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {!latestSnapshot ? (
        <div className="pbi-empty"><p>No completed backup for this VM yet.</p></div>
      ) : loading ? (
        <div className="loading-container"><div className="spinner" /><p>Loading…</p></div>
      ) : activeTab === 'virtual_machine' ? (
        !configItem
          ? <div className="pbi-empty"><p>No VM configuration captured in this snapshot.</p></div>
          : <VirtualMachinePane item={configItem} cfg={cfg} />
      ) : activeTab === 'disks' ? (
        <TwoPane
          items={disks}
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          leftHeader={<label className="vm-left-allchk"><input type="checkbox" checked={allChecked} onChange={toggleAll}/>Select all</label>}
          renderRow={d => (
            <div>
              <div className="vm-left-row-title">{d.name}</div>
              <div className="vm-left-row-sub">Type: {d.metadata?.os_type ? 'OS disk' : 'Data disk'}, Size: {fmtGb(d.metadata?.size_bytes, d.metadata?.size_gb) || '—'}</div>
            </div>
          )}
          renderDetail={d => <DiskDetail item={d} cfg={cfg} />}
        />
      ) : activeTab === 'volumes' ? (
        <TwoPane
          items={volumes}
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          leftHeader={<div className="vm-left-cols"><span>Name</span><span>File System</span></div>}
          renderRow={v => (
            <div className="vm-left-row-inline">
              <span className="vm-left-row-title">{v.name}</span>
              <span className="vm-left-row-fs">{v.metadata?.file_system || ''}</span>
            </div>
          )}
          renderDetail={v => <VolumeDetail item={v} />}
        />
      ) : activeTab === 'network_interfaces' ? (
        <TwoPane
          items={nics}
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          leftHeader={<label className="vm-left-allchk"><input type="checkbox" checked={allChecked} onChange={toggleAll}/>Select all</label>}
          renderRow={n => <div className="vm-left-row-title">{n.name}</div>}
          renderDetail={n => <NicDetail item={n} cfg={cfg} />}
        />
      ) : (
        <TwoPane
          items={pips}
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          leftHeader={<label className="vm-left-allchk"><input type="checkbox" checked={allChecked} onChange={toggleAll}/>Select all</label>}
          renderRow={p => (
            <div>
              <div className="vm-left-row-title">{p.name}</div>
              <div className="vm-left-row-sub">{p.metadata?.ip_address || ''}</div>
            </div>
          )}
          renderDetail={p => <PublicIpDetail item={p} cfg={cfg} />}
        />
      )}
    </>
  );
}
