import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getResources, resourceMatchesQuery, type ResourceItem, type ResourceListResponse, assignPolicy, unassignPolicy, bulkAssignPolicy, bulkAssignPolicyByFilter, triggerBackup, triggerDiscovery, backupUserWithDiscovery } from '../services/resource';
import { buildBulkFilter, selectAllBannerState } from '../utils/bulkSelection';
import { getSlaPolicies, type SlaPolicy } from '../services/sla';
// import { SnapshotService, type SnapshotItem as SnapshotListItem } from '../services/snapshot';
import { usePersistentTab } from '../hooks/usePersistentTab';
import { fmtLocalDate, fmtLocalTime, parseAsUtc } from '../utils/datetime';
import { prettifyEnumLabel } from '../utils/display';
import AvatarInitials from '../components/AvatarInitials';
import './Protection.css';

// ONE page size for the query AND for the page-count arithmetic.
//
// 2026-08-11 (TMV-006): the previous shape had each fetcher pass its own
// literal while `totalPages` was always `item_number / 50`. When one
// fetcher used a different size the indicator and the row set described
// different queries — the same view rendered "1 / 563", then "1 / 15",
// then "1 / 1", and clicking next gave "2 / 1". Every read of the list
// goes through this constant so that divergence cannot be reintroduced by
// editing one call site.
const PAGE_SIZE = 50;

type ResourceTab = 'all' | 'users' | 'shared' | 'rooms' | 'sharepoint' | 'groups' | 'entra' | 'power' | 'dynamic' | 'entra-groups' | 'virtual-machines' | 'sql-databases' | 'postgresql-servers' | 'resource-groups' | 'dynamic-groups';

const m365Tabs: { key: ResourceTab; label: string }[] = [
  { key: 'all', label: 'All resources' },
  { key: 'users', label: 'Users' },
  { key: 'shared', label: 'Shared mailboxes' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'sharepoint', label: 'SharePoint sites' },
  { key: 'groups', label: 'Groups & Teams' },
  { key: 'entra', label: 'Entra ID' },
  { key: 'power', label: 'Power Platform' },
  { key: 'dynamic', label: 'Dynamic groups' },
  { key: 'entra-groups', label: 'Entra ID groups' },
];

const azureTabs: { key: ResourceTab; label: string }[] = [
  { key: 'all', label: 'All resources' },
  { key: 'virtual-machines', label: 'Virtual machines' },
  { key: 'sql-databases', label: 'Azure SQL databases' },
  { key: 'postgresql-servers', label: 'Azure PostgreSQL servers' },
];

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 GB';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function getSlaDescription(p: SlaPolicy): string {
  if (p.name === 'Manual') return 'Manual backups only';
  const freq = p.frequency === 'THREE_DAILY' ? 'Every day, 3x per day' : 'Every day';
  if (p.backupWindowStart && p.frequency !== 'THREE_DAILY') {
    const hour = parseInt(p.backupWindowStart.split(':')[0], 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${freq} at ${h}:00 ${ampm}`;
  }
  return freq;
}

type PolicyCoverageRule = {
  workloadLabel: string;
  covers: (policy: SlaPolicy) => boolean;
};

const POLICY_COVERAGE_RULES: Record<string, PolicyCoverageRule> = {
  office_user: { workloadLabel: 'Exchange mailbox backups', covers: (policy) => !!policy.backupExchange },
  shared_mailbox: { workloadLabel: 'Exchange mailbox backups', covers: (policy) => !!policy.backupExchange },
  room_mailbox: { workloadLabel: 'Exchange mailbox backups', covers: (policy) => !!policy.backupExchange },
  onedrive: { workloadLabel: 'OneDrive backups', covers: (policy) => !!policy.backupOneDrive },
  onenote: { workloadLabel: 'OneDrive and OneNote backups', covers: (policy) => !!policy.backupOneDrive },
  sharepoint_site: { workloadLabel: 'SharePoint backups', covers: (policy) => !!policy.backupSharepoint },
  teams_channel: { workloadLabel: 'Teams channel backups', covers: (policy) => !!policy.backupTeams },
  teams_chat: { workloadLabel: 'Teams chat backups', covers: (policy) => !!policy.backupTeamsChats },
  entra_user: {
    workloadLabel: 'any user backup workload',
    covers: (policy) => !!(
      policy.backupExchange
      || policy.backupOneDrive
      || policy.backupTeamsChats
      || policy.contacts
      || policy.calendars
      || policy.backupEntraId
    ),
  },
  entra_group: {
    workloadLabel: 'Entra group or group mailbox backups',
    covers: (policy) => !!(policy.backupEntraId || policy.groupMailbox),
  },
  dynamic_group: {
    workloadLabel: 'Entra group or group mailbox backups',
    covers: (policy) => !!(policy.backupEntraId || policy.groupMailbox),
  },
  // M365 unified groups are the parent container for Teams + SharePoint +
  // shared mailbox + Planner — any one of those backup flags covers them.
  m365_group: {
    workloadLabel: 'Entra, Teams, SharePoint or group mailbox backups',
    covers: (policy) => !!(
      policy.backupEntraId || policy.backupTeams || policy.backupSharepoint || policy.groupMailbox
    ),
  },
  entra_app: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_device: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_directory: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_service_principal: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_role: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_admin_unit: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_conditional_access: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_bitlocker_key: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  intune_managed_device: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  teams_chat_export: { workloadLabel: 'Teams chat backups', covers: (policy) => !!policy.backupTeamsChats },
  power_bi: { workloadLabel: 'Power Platform backups', covers: (policy) => !!policy.backupPowerPlatform },
  power_apps: { workloadLabel: 'Power Platform backups', covers: (policy) => !!policy.backupPowerPlatform },
  power_automate: { workloadLabel: 'Power Platform backups', covers: (policy) => !!policy.backupPowerPlatform },
  power_dlp: { workloadLabel: 'Power Platform backups', covers: (policy) => !!policy.backupPowerPlatform },
  copilot: { workloadLabel: 'Copilot backups', covers: (policy) => !!policy.backupCopilot },
  planner: { workloadLabel: 'Planner backups', covers: (policy) => !!policy.planner },
  todo: { workloadLabel: 'Tasks backups', covers: (policy) => !!policy.tasks },
  azure_vm: { workloadLabel: 'Azure virtual machine backups', covers: (policy) => !!policy.backupAzureVm },
  azure_sql: { workloadLabel: 'Azure SQL database backups', covers: (policy) => !!policy.backupAzureSql },
  azure_postgresql: { workloadLabel: 'Azure PostgreSQL backups', covers: (policy) => !!policy.backupAzurePostgresql },
  azure_postgresql_single: { workloadLabel: 'Azure PostgreSQL backups', covers: (policy) => !!policy.backupAzurePostgresql },
  // Tier 2 per-content-category children under an ENTRA_USER parent.
  // Default listings hide these (see UI_HIDDEN_TYPES in resource-service);
  // the rules below keep admins who opt into includeHidden=true from
  // seeing a spurious "workload not mapped" warning.
  user_mail: { workloadLabel: 'Exchange mailbox backups', covers: (policy) => !!policy.backupExchange },
  user_onedrive: { workloadLabel: 'OneDrive backups', covers: (policy) => !!policy.backupOneDrive },
  user_contacts: { workloadLabel: 'Contact backups', covers: (policy) => !!(policy.contacts || policy.backupEntraId) },
  user_calendar: { workloadLabel: 'Calendar backups', covers: (policy) => !!(policy.calendars || policy.backupEntraId) },
  user_chats: { workloadLabel: 'Teams chat backups', covers: (policy) => !!policy.backupTeamsChats },
};

function getPolicyCoverageWarning(resource: ResourceItem, policy?: SlaPolicy): string | null {
  if (!policy) return null;

  const rule = POLICY_COVERAGE_RULES[resource.kind];
  if (!rule) {
    return `Scheduled backups may skip this resource because its workload is not mapped to an SLA coverage flag yet.`;
  }

  if (rule.covers(policy)) {
    return null;
  }

  return `Scheduled backups will skip this resource because '${policy.name}' does not include ${rule.workloadLabel}.`;
}

function SlaCell({ resource, policies, onChange, onSettings }: {
  resource: ResourceItem;
  policies: SlaPolicy[];
  onChange: (resourceId: string, policyId: string) => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const policyId = resource.protections?.[0]?.policy_id;
  const selected = policies.find(p => p.id === policyId);
  const isProtected = !!policyId;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const menuHeight = 320; // approximate max height of SLA menu
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp = spaceBelow < menuHeight && rect.top > menuHeight;
      setMenuStyle(flipUp
        ? { bottom: window.innerHeight - rect.top + 4, left: rect.left }
        : { top: rect.bottom + 4, left: rect.left }
      );
    }
  }, [open]);

  return (
    <div className="sla-dropdown" ref={ref}>
      <button className={`sla-header ${!isProtected ? 'not-protected' : ''}`} onClick={() => setOpen(!open)}>
        {!isProtected && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="sla-header-icon-left">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="2" y1="2" x2="22" y2="22" stroke="#dc2626" strokeWidth="2" />
          </svg>
        )}
        <span className="sla-header-text">
          {isProtected ? selected?.name : 'Not protected'}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="sla-header-icon-right">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="sla-menu" ref={menuRef} style={menuStyle}>
          <button className="sla-item" onClick={() => { onChange(resource.id, ''); setOpen(false); }}>
            <div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 8, flexShrink: 0, marginTop: 2 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <line x1="2" y1="2" x2="22" y2="22" stroke="#dc2626" strokeWidth="2" />
              </svg>
              <div className="sla-item-text"><span className="sla-item-name">Not protected</span></div>
            </div>
          </button>
          {policies.map(p => (
            <button key={p.id} className={`sla-item ${policyId === p.id ? 'selected' : ''}`} onClick={() => { onChange(resource.id, p.id); setOpen(false); }}>
              <div className="sla-item-text">
                <span className="sla-item-name">{p.name}</span>
                <span className="sla-item-desc">{getSlaDescription(p)}</span>
              </div>
            </button>
          ))}
          <div className="sla-divider" />
          <button className="sla-footer" onClick={() => { onSettings(); setOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 8, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Customize SLA policies in Settings
          </button>
        </div>
      )}
    </div>
  );
}

export default function Protection() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const navigate = useNavigate();
  const tabs = serviceType === 'azure' ? azureTabs : m365Tabs;
  const tabKeys = tabs.map(t => t.key) as ResourceTab[];
  const [activeTab, setActiveTab] = usePersistentTab<ResourceTab>(
    '/protection',
    'all',
    tabKeys,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  // Total rows matching the current view across ALL pages (item_number)
  // — drives the "Select all N matching" offer.
  const [totalItems, setTotalItems] = useState(0);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);

  // Gmail-style select-all-across-pages. When true, the selection is the
  // FILTER (tab + query + status + sla), not the id list — bulk actions
  // go down the server-side filter path and the id list is only what
  // keeps the visible page's checkboxes painted.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  // Dismissible result/status banner for bulk SLA actions. Every outcome
  // lands here — the failures used to die in console.error and the page
  // gave no sign anything had been attempted.
  const [bulkNotice, setBulkNotice] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  // Pending confirm for the filter path: dry-run resolved `matched`
  // resources; nothing is written until the user confirms. Mandatory —
  // policyId '' is bulk-UNASSIGN, and a mis-click must not silently strip
  // protection at scale.
  const [confirmBulk, setConfirmBulk] = useState<{ policyId: string; policyName: string; matched: number } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkModalRef = useRef<HTMLDivElement>(null);
  // Read inside the modal's keydown listener without re-binding it on
  // every busy toggle.
  const bulkBusyRef = useRef(bulkBusy);
  useEffect(() => { bulkBusyRef.current = bulkBusy; }, [bulkBusy]);

  const [resourceFilter, setResourceFilter] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null); // 'all' | 'top_total' | 'top_7d' | 'top_30d' | 'top_365d'
  const [slaFilter, setSlaFilter] = useState<string | null>(null);
  // Server-side SLA filter param: the UI stores the policy NAME, the API
  // filters by policy UUID ('none' = unprotected). Client-side filtering
  // over the fetched page broke once 4,204 newly-discovered SharePoint
  // sites pushed every SLA'd resource out of the newest-first window
  // (2026-07-15: "Gold" filter matched nothing).
  const slaParam = useMemo(() => {
    if (!slaFilter) return undefined;
    if (slaFilter === 'Not protected') return 'none';
    return policies.find(p => p.name === slaFilter)?.id;
  }, [slaFilter, policies]);

  const [showSlaDropdown, setShowSlaDropdown] = useState(false);
  const slaDropdownRef = useRef<HTMLDivElement>(null);

  const [refreshing, setRefreshing] = useState(false);

  // ---- "latest response wins" guard for the resource list (TMV-006) ----
  //
  // FOUR independent code paths replace the whole `resources` array: the
  // view-params effect, the focus/visibility reconcile, the 8-second
  // in-flight-backup poll, and handleRefresh's discovery poll. Each used
  // to carry its own local `cancelled` flag, which only covers the case
  // where that effect's own deps changed — it does nothing when two live
  // paths race each other, and the slower one then repaints the table
  // with rows for a query the user has already moved on from while the
  // page indicator still describes the newer one.
  //
  // issuedRef is stamped when a request goes out; appliedRef records the
  // highest stamp that has been rendered. A response whose stamp is not
  // strictly newer than what is already on screen is discarded, so an
  // older in-flight response can never stomp newer state no matter which
  // path issued it or in what order they land.
  const issuedRef = useRef(0);
  const appliedRef = useRef(0);
  const beginListRequest = useCallback(() => ++issuedRef.current, []);
  const applyListResponse = useCallback((seq: number, data: ResourceListResponse) => {
    if (seq <= appliedRef.current) return false;
    appliedRef.current = seq;
    setResources(data.items || []);
    setTotalItems(data.item_number || 0);
    // Every path refreshes the count too. The poll used to update only
    // the rows, so a discovery run that grew the tenant left the
    // indicator pinned at the count from page load.
    const pages = data.item_number > 0 ? Math.ceil(data.item_number / PAGE_SIZE) : 1;
    setTotalPages(pages);
    // Keep the cursor inside the count in the same commit that changes
    // the count. When a filter (or a discovery run that removed rows)
    // shrank item_number while the user was deep in the list, `page`
    // kept its old value: the indicator read "7 / 3", both arrows were
    // disabled (page <= 1 false, page >= totalPages true) and the table
    // said "No resources found." with no way back.
    setPage(p => (p > pages ? Math.max(1, pages) : p));
    return true;
  }, []);

  // Track which resources have a pending backup. Persisted so status survives navigation/refresh.
  // Map: resource_id -> ISO timestamp the backup was triggered. When a subsequent refetch shows
  // the resource's last_backup_at is newer than triggeredAt, we clear the entry.
  const STORAGE_KEY = `backingUp_${tenantId}`;
  const [backingUp, setBackingUp] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  });

  // Tier 2 discovery now runs server-side via backupUserWithDiscovery, so
  // the UI no longer tracks a "discovering" phase. Stable empty set kept
  // so the existing badge/button checks (`discovering.has(id)`) stay
  // truthy-safe without restructuring the JSX.
  const [discovering] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      if (Object.keys(backingUp).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(backingUp));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* quota */ }
  }, [backingUp, STORAGE_KEY]);

  useEffect(() => {
    function handleSlaClick(e: MouseEvent) {
      if (slaDropdownRef.current && !slaDropdownRef.current.contains(e.target as Node)) {
        setShowSlaDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleSlaClick);
    return () => document.removeEventListener('mousedown', handleSlaClick);
  }, []);

  // Refresh resource list + reconcile pending backups when the tab regains focus.
  // (Replaces the old 2s progress-polling loop — progress % is no longer tracked in the UI.)
  useEffect(() => {
    if (!tenantId) return;
    // Guard against a reconcile fetched for a previous tab/page/search
    // landing after the deps changed — it would replace the newer view's
    // rows with stale ones. `cancelled` covers this effect's own teardown;
    // applyListResponse covers races against the other three fetchers.
    let cancelled = false;
    const reconcile = async () => {
      try {
        const seq = beginListRequest();
        const data = await getResources(
          tenantId, activeTab, page, PAGE_SIZE, searchQuery,
          slaParam, resourceFilter || undefined, serviceType,
        );
        if (cancelled) return;
        const items = data.items || [];
        if (!applyListResponse(seq, data)) return;
        // Clear backingUp entries once the server reflects any non-pending
        // state for that resource — either a fresh successful backup
        // (last_backup_at advanced past the trigger time) OR the latest job
        // reaching a terminal/active status (CANCELLED / FAILED / RUNNING /
        // COMPLETED). Without the status check, a cancelled job leaves the
        // optimistic "Starting…" flag stuck because last_backup_at never
        // advances.
        setBackingUp(prev => {
          const next = { ...prev };
          const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'FAILED', 'RUNNING']);
          for (const r of items) {
            const triggered = next[r.id];
            if (!triggered) continue;
            const lastBackup = parseAsUtc(r.last_backup);
            const trig = parseAsUtc(triggered);
            const advanced = !!(lastBackup && trig && lastBackup.getTime() >= trig.getTime());
            const settled = r.last_backup_status && TERMINAL.has(r.last_backup_status);
            if (advanced || settled) {
              delete next[r.id];
            }
          }
          return next;
        });
      } catch (err) {
        console.error(err);
      }
    };
    const onFocus = () => { reconcile(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') reconcile(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tenantId, activeTab, page, searchQuery, slaParam, resourceFilter, serviceType, beginListRequest, applyListResponse]);

  useEffect(() => {
    if (!tenantId) return;
    getSlaPolicies(tenantId, serviceType === 'azure' ? 'azure' : 'm365').then(setPolicies).catch(console.error);
  }, [tenantId, serviceType]);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setResources([]);

    // Fresh data on load is authoritative — wipe the optimistic backingUp
    // map so a "Starting…" / "In Progress" flag from a previous interaction
    // can't outlive the resource it was attached to. The reconcile-on-focus
    // effect handles in-session updates; this handles every navigation.
    setBackingUp({});

    // Search pages SERVER-side, exactly like the unfiltered list.
    //
    // This used to be a "fetch everything then filter client-side" mode
    // (page=1&size=10000). Once getResources' multi-type branch started
    // mapping the requested window onto real per-type offsets, a
    // 10,000-wide window starting at 0 was swallowed whole by the FIRST
    // type: any query matching >=10,000 of the pilot tenant's 11,190
    // ENTRA_USERs ('com', '@', a common letter) returned 10,000 users and
    // ZERO matching SharePoint sites / groups / flows. `query=` is honored
    // server-side (build_by_type_search_filters), and item_number is the
    // true match count, so ordinary pagination reaches every match in
    // every type — and pulls 50 rows per page instead of 10,000.
    // Stale-response guard: a slow response for a since-abandoned
    // tab/page/search must not overwrite the newer view's rows — the
    // header would say one tab while the rows (and any select-all +
    // bulk SLA action over them) belonged to another.
    let cancelled = false;
    const seq = beginListRequest();
    getResources(tenantId, activeTab, page, PAGE_SIZE, searchQuery, slaParam, resourceFilter || undefined, serviceType)
      .then((data: ResourceListResponse) => {
        if (cancelled) return;
        applyListResponse(seq, data);
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, activeTab, page, searchQuery, slaParam, resourceFilter, serviceType, beginListRequest, applyListResponse]);

  useEffect(() => { setPage(1); }, [activeTab, searchQuery, slaFilter, resourceFilter]);

  // Selection must not survive a change of the visible set. Row ids used
  // to accumulate across pages/tabs/searches, and the next bulk SLA
  // action (including 'Not protected', which the backend treats as
  // unassign) then silently stripped backup coverage from resources the
  // user could no longer see.
  //
  // selectAllMatching exits on the same guard: the mode is defined by the
  // view's filter, so ANY change of tab/page/query/status/sla means the
  // selection the user confirmed is no longer the selection on screen. A
  // pending confirm modal is stale for the same reason.
  useEffect(() => {
    setSelectedResources([]);
    setSelectAllMatching(false);
    setConfirmBulk(null);
  }, [tenantId, activeTab, page, searchQuery, slaFilter, resourceFilter, serviceType]);

  // The bulk result banner describes an action taken against a specific
  // view — carrying "Assigned N resource(s)." (or a role=alert error) into
  // another tab/query reads as describing rows it never touched. `page` is
  // deliberately excluded from the deps: paging within the same filtered
  // view keeps the notice relevant, and the post-write refetch can clamp
  // the page cursor (applyListResponse) — clearing on that would wipe the
  // result of the very action the banner reports.
  useEffect(() => {
    setBulkNotice(null);
  }, [tenantId, activeTab, searchQuery, slaFilter, resourceFilter, serviceType]);

  // Keyboard support for the bulk confirm modal: Escape cancels (unless a
  // write is in flight) and Tab is trapped inside the dialog. Without
  // this, focus stayed behind the overlay and keyboard users had no
  // non-pointer way to close it. Cancel — the safe action — is first in
  // DOM order, so it takes initial focus; the previously focused element
  // gets focus back when the modal closes.
  useEffect(() => {
    if (!confirmBulk) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const modal = bulkModalRef.current;
    const focusables = () =>
      modal ? Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled])')) : [];
    focusables()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!bulkBusyRef.current) setConfirmBulk(null);
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      const inside = modal ? modal.contains(active) : false;
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [confirmBulk]);

  // Silent auto-refresh while any resource has an in-flight backup.
  // Polls every 8s and stops the moment every row settles on a
  // terminal status, so the UI stays live without requiring the user
  // to hit Refresh — and no perpetual network chatter when idle.
  //
  // Uses getResources() (same as the initial fetch + focus-reconcile)
  // so the poll is scoped to the active tab's resource types. The
  // prior inline fetch sent `type=<tab-name>` (e.g. `type=users`) to
  // /api/v1/resources, but:
  //   1. The backend expects the param `types` (plural).
  //   2. It expects ENUM values (`ENTRA_USER`), not tab names.
  // Both wrong → the backend silently ignored the filter and returned
  // every resource in the tenant, so stray rows from other types
  // leaked into the list mid-backup. getResources() maps tab → enum
  // list via getTabTypeMap and handles the special "all" tab.
  //
  // The poll MUST re-issue the user's current query verbatim — same tab,
  // same page, same PAGE_SIZE, same search/filters. Anything else and the
  // refresh silently teleports the user: an earlier revision of this
  // effect asked for `size = searchQuery ? 10000 : 50` and
  // `page = searchQuery ? 1 : page`, so every 8 seconds the table was
  // replaced by page 1 of a 10,000-row query while the indicator kept
  // dividing item_number by 50. That is why one query rendered as
  // "1 / 563", then "1 / 15", then "1 / 1", and why clicking next gave
  // "2 / 1". PAGE_SIZE is now the only size any caller can pass.
  const IN_FLIGHT_STATUSES = useMemo(() => new Set(['RUNNING', 'QUEUED', 'DISPATCHED']), []);
  // Read inside the interval callback rather than through the dep array:
  // the poll writes `resources`, so listing `resources` as a dependency
  // tore the interval down and recreated it on every single response (and
  // on every optimistic SLA edit), which reset the 8-second countdown and
  // could starve the poll entirely on a busy list.
  const anyLive = resources.some(
    r => !!r.last_backup_status && IN_FLIGHT_STATUSES.has(r.last_backup_status),
  );
  const anyLiveRef = useRef(anyLive);
  useEffect(() => { anyLiveRef.current = anyLive; }, [anyLive]);
  useEffect(() => {
    if (!tenantId) return;
    // cancelled stops a response issued by THIS effect after its deps
    // changed; applyListResponse independently drops any response that is
    // older than what is already rendered, whichever fetcher issued it.
    let cancelled = false;
    const tick = async () => {
      if (!anyLiveRef.current) return; // idle — no network chatter
      try {
        const seq = beginListRequest();
        const data = await getResources(
          tenantId, activeTab, page, PAGE_SIZE, searchQuery,
          slaParam, resourceFilter || undefined, serviceType,
        );
        if (cancelled) return;
        applyListResponse(seq, data);
      } catch { /* ignore transient failures — next tick retries */ }
    };
    const t = setInterval(tick, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, [tenantId, activeTab, page, searchQuery, slaParam, resourceFilter, serviceType, beginListRequest, applyListResponse]);

  // Belt-and-braces client-side pass over the already server-filtered page.
  // resourceMatchesQuery is deliberately a SUPERSET of the server's
  // predicate (it adds `kind`, which has no column) — a narrower predicate
  // here would drop rows the server matched on web_url and leave holes in
  // the page now that search is server-paginated.
  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return resources;
    return resources.filter(resource => resourceMatchesQuery(resource, searchQuery));
  }, [resources, searchQuery]);

  // Apply SLA filtering, then the ordering the user explicitly asked for.
  //
  // 2026-08-11 (TMV-006) — THE DEFAULT ALPHABETICAL SORT IS GONE. Read
  // this before putting it back.
  //
  // The old code sorted every page by display_name before rendering. That
  // sort is PAGE-LOCAL: it can only order the 50 rows the server just
  // sent, never the other 29,591. The server orders by `created_at DESC,
  // id DESC`, so page 1 is an arbitrary-looking 50 names that this code
  // then rendered as a tidy A→Z run, and page 2 was a DIFFERENT arbitrary
  // 50 names rendered as another tidy A→Z run. The list therefore looked
  // like "page 2 restarts the alphabet, with entries interleaved between
  // the pages" — which is how QA read it, and reasonably concluded that
  // rows were being duplicated across pages and others made unreachable.
  //
  // They are not. Measured against production on 2026-08-11, the endpoint
  // this page actually calls — /api/v1/resources/by-type, one request per
  // type, which the multi-type branch of getResources() windows onto real
  // per-type offsets — returns for type=ENTRA_USER (item_number 13,812):
  //     page 1 ∩ page 2 = 0 ids
  //     page 1 ∩ page 3 = 0 ids
  //     page 2 ∩ page 3 = 0 ids
  //     page 1 requested twice = byte-identical id order
  // Pagination is sound and every row is reachable; the alphabet was the
  // lie. (The bare /api/v1/resources LIST endpoint IS unstable — 22 of 50
  // ids shared between its page 1 and page 2 in the same measurement —
  // but this page only reaches that endpoint for a tab with no type
  // mapping. Flagged to the backend separately.)
  //
  // So the rendered order is now exactly the server's order: what the
  // page indicator counts and what the table shows are the same
  // sequence. When the backend lands a global ORDER BY display_name, id,
  // the list becomes genuinely alphabetical across all 593 pages with no
  // change here. An explicit size filter still sorts client-side — that
  // one is a user-chosen "top N on this page" view, not a claim about
  // total order.
  const sortedResources = useMemo(() => {
    let filtered = [...filteredResources];

    // SLA filter — belt-and-braces over the server's own `sla` param.
    //
    // Named-policy filtering maps NAME -> id through `policies`. Until
    // that request lands `policies` is [], so every row failed the
    // predicate and the table rendered "No resources found." while the
    // indicator still said "1 / 12" — a row set that disagreed with the
    // page count for as long as the policy fetch took. slaParam is
    // likewise undefined in that window, so the server has not filtered
    // either: the honest thing is to show the unfiltered page rather
    // than an empty one. 'Not protected' needs no lookup and still
    // filters immediately.
    if (slaFilter === 'Not protected') {
      filtered = filtered.filter(r => !r.protections || r.protections.length === 0 || !r.protections[0]?.policy_id);
    } else if (slaFilter && policies.length > 0) {
      filtered = filtered.filter(r => {
        const policyId = r.protections?.[0]?.policy_id;
        if (!policyId) return false;
        const policy = policies.find(p => p.id === policyId);
        return policy?.name === slaFilter;
      });
    }

    // Tie-break only — never the primary key of the default view.
    const byName = (a: ResourceItem, b: ResourceItem) => {
      const an = String(a.name || '').toLowerCase();
      const bn = String(b.name || '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      // Stable secondary to avoid id-order drift across refetches.
      return String(a.id || '').localeCompare(String(b.id || ''));
    };

    // No size filter: render the server's page order verbatim.
    if (!sizeFilter) {
      return filtered;
    }

    // `as const` + the narrow type annotation gives TS the specific
    // keyof usage values so `b.usage?.[key]` doesn't trip TS7053 under
    // strict index checking.
    type UsageKey = 'size' | 'size_delta_week' | 'size_delta_month' | 'size_delta_year';
    const sizeKey: Record<string, UsageKey> = {
      top_total: 'size',
      top_7d: 'size_delta_week',
      top_30d: 'size_delta_month',
      top_365d: 'size_delta_year',
    };
    const key = sizeKey[sizeFilter];
    // Unknown filter value — leave the server order alone rather than
    // re-introducing the page-local alphabet described above.
    if (!key) return filtered;

    return filtered.sort((a, b) => {
      const delta = (b.usage?.[key] || 0) - (a.usage?.[key] || 0);
      if (delta !== 0) return delta;
      return byName(a, b);
    });
  }, [filteredResources, sizeFilter, slaFilter, policies]);

  // Search is server-paginated now (page, 50) exactly like the unfiltered
  // list, so the page the server returned IS the page to render — slicing
  // it again by `page` would blank every page after the first.
  const displayedResources = sortedResources;

  // The view-param effect above misses refetches that swap the visible
  // window with no user-driven change: the discovery poll, the
  // focus/visibility reconcile and the 8s in-flight-backup poll all
  // replace `resources` on their own, and the server pages newest-first
  // — a discovery run (4,204 SharePoint sites, 2026-07-15) can hand
  // page 1 a completely different row set under a live selection, and a
  // bulk 'Not protected' then strips backup coverage from rows the user
  // can no longer see. Reconcile against the ids actually rendered.
  useEffect(() => {
    setSelectedResources(prev => {
      if (prev.length === 0) return prev;
      const visible = new Set(displayedResources.map(r => r.id));
      const next = prev.filter(id => visible.has(id));
      // Same reference when nothing dropped — no re-render, no loop.
      return next.length === prev.length ? prev : next;
    });
  }, [displayedResources]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) setShowFilter(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeFilterCount = (resourceFilter ? 1 : 0) + (sizeFilter ? 1 : 0) + (slaFilter ? 1 : 0);

  const toggleSelectAll = () => {
    if (selectAllMatching || selectedResources.length === displayedResources.length) {
      setSelectAllMatching(false);
      setSelectedResources([]);
    } else {
      setSelectedResources(displayedResources.map(r => r.id));
    }
  };

  const toggleSelect = (id: string) => {
    // Touching an individual checkbox narrows the intent back to explicit
    // ids — "all matching" no longer describes what's checked. Unchecking
    // one row from that mode keeps the rest of the visible page selected.
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedResources(displayedResources.filter(r => r.id !== id).map(r => r.id));
      return;
    }
    setSelectedResources(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSlaChange = async (resourceId: string, policyId: string) => {
    try {
      if (policyId) await assignPolicy(resourceId, policyId);
      else await unassignPolicy(resourceId);
      setResources(prev => prev.map(r =>
        r.id === resourceId ? { ...r, protections: policyId ? [{ policy_id: policyId }] : null } : r
      ));
    } catch (err) {
      console.error('Failed to update SLA:', err);
    }
  };

  // Re-pull the current page after a filter-path bulk write — the rows'
  // protections changed server-side, and unlike the id path there is no
  // local list to patch optimistically. Returns whether the refresh
  // landed: the caller just WROTE, so a failed follow-up read means the
  // table still shows pre-write protections and the caller must say so
  // instead of leaving an unqualified success banner over stale rows.
  const refetchCurrentView = useCallback(async (): Promise<boolean> => {
    if (!tenantId) return true; // nothing rendered, nothing to be stale
    try {
      const seq = beginListRequest();
      const data = await getResources(
        tenantId, activeTab, page, PAGE_SIZE, searchQuery,
        slaParam, resourceFilter || undefined, serviceType,
      );
      applyListResponse(seq, data);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }, [tenantId, activeTab, page, searchQuery, slaParam, resourceFilter, serviceType, beginListRequest, applyListResponse]);

  const currentBulkFilter = useCallback(() => {
    if (!tenantId) return null;
    return buildBulkFilter({
      tenantId,
      tab: activeTab,
      serviceType,
      searchQuery,
      resourceFilter,
      slaParam,
    });
  }, [tenantId, activeTab, serviceType, searchQuery, resourceFilter, slaParam]);

  const handleBulkSlaAssign = async (policyId: string) => {
    setBulkNotice(null);

    // ---- Select-all-matching: server-side FILTER path. ----
    // Dry-run first for the authoritative matched count, then a mandatory
    // confirm modal (executeBulkByFilter) before anything is written —
    // policyId '' is bulk-unassign across the whole match set.
    if (selectAllMatching) {
      setShowSlaDropdown(false);
      const filter = currentBulkFilter();
      if (!filter) {
        setBulkNotice({ kind: 'error', text: 'Select all matching is not available for this view.' });
        return;
      }
      try {
        const dry = await bulkAssignPolicyByFilter(filter, policyId, true);
        if (dry.matched === 0) {
          // Exit select-all mode too: leaving it on kept the "All N
          // matching resources are selected" banner (with a stale
          // totalItems) sitting directly above this zero-match notice.
          setSelectAllMatching(false);
          setSelectedResources([]);
          setBulkNotice({ kind: 'info', text: 'No resources match the current filters — nothing to change.' });
          return;
        }
        setConfirmBulk({
          policyId,
          policyName: policyId ? (policies.find(p => p.id === policyId)?.name || 'SLA policy') : '',
          matched: dry.matched,
        });
      } catch (err) {
        setBulkNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (selectedResources.length === 0) return;
    // Second gate on top of the reconcile effect: a refetch landing
    // between render and this click would otherwise post ids that are no
    // longer on screen, and policyId='' means unassign. Never act on a
    // row the user can't see — and say how many were left out.
    const visible = new Set(displayedResources.map(r => r.id));
    const targets = selectedResources.filter(id => visible.has(id));
    const skippedStale = selectedResources.length - targets.length;
    if (targets.length === 0) {
      setSelectedResources([]);
      setShowSlaDropdown(false);
      setBulkNotice({
        kind: 'info',
        text: 'The selected rows are no longer on this page (the list refreshed underneath) — nothing was changed. Re-select and try again.',
      });
      return;
    }
    try {
      const result = await bulkAssignPolicy(targets, policyId);
      // Update local state
      setResources(prev => prev.map(r =>
        targets.includes(r.id)
          ? { ...r, protections: policyId ? [{ policy_id: policyId }] : null }
          : r
      ));
      setSelectedResources([]);
      setShowSlaDropdown(false);
      const parts = [policyId
        ? `Assigned ${result.assigned} resource(s).`
        : `Removed protection from ${result.assigned} resource(s).`];
      const notFound = result.not_found?.length || 0;
      if (notFound > 0) parts.push(`${notFound} skipped (no longer found).`);
      if (skippedStale > 0) parts.push(`${skippedStale} skipped (no longer on this page).`);
      setBulkNotice({ kind: 'success', text: parts.join(' ') });
    } catch (err) {
      setShowSlaDropdown(false);
      setBulkNotice({
        kind: 'error',
        text: `Failed to update SLA: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Confirmed filter-path execution — the only place a non-dry filter
  // request is sent.
  const executeBulkByFilter = async () => {
    if (!confirmBulk || bulkBusy) return;
    const { policyId, policyName, matched: confirmedCount } = confirmBulk;
    const filter = currentBulkFilter();
    if (!filter) {
      setConfirmBulk(null);
      return;
    }
    setBulkBusy(true);
    try {
      const result = await bulkAssignPolicyByFilter(filter, policyId, false);
      setConfirmBulk(null);
      setSelectAllMatching(false);
      setSelectedResources([]);
      const parts = [policyId
        ? `Assigned ${policyName} to ${result.assigned} resource(s).`
        : `Removed protection from ${result.assigned} resource(s).`];
      // The filter is re-resolved server-side at apply time, so the match
      // set can drift between the dry-run count the user confirmed and
      // what was actually written (a discovery run landing, another
      // admin's edits). Surface the drift whenever the counts disagree —
      // a true pre-write guard (send expectedMatched, backend 409s on
      // mismatch) needs the backend contract and is flagged there.
      if (result.matched !== confirmedCount) {
        parts.push(
          `Note: the set of matching resources changed while you were confirming (${confirmedCount} when the dialog opened, ${result.matched} when applied).`,
        );
      }
      const successText = parts.join(' ');
      setBulkNotice({ kind: 'success', text: successText });
      // A write just happened; if this read fails the table still shows
      // pre-write protections — downgrade the banner rather than leave
      // stale coverage under an unqualified success message.
      const refreshed = await refetchCurrentView();
      if (!refreshed) {
        setBulkNotice({
          kind: 'info',
          text: `${successText} The table could not be refreshed and may show outdated protection — use Refresh.`,
        });
      }
    } catch (err) {
      setConfirmBulk(null);
      setBulkNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBackupNow = async (resource: ResourceItem) => {
    const resourceId = resource.id;
    if (backingUp[resourceId] || discovering.has(resourceId)) return; // Already pending
    const triggeredAt = new Date().toISOString();
    setBackingUp(prev => ({ ...prev, [resourceId]: triggeredAt }));

    // resource-service serializes the ResourceType enum to lowercase
    // ("entra_user"), so accept either form.
    const isEntraUser = (resource.kind || '').toLowerCase() === 'entra_user';

    try {
      if (isEntraUser && tenantId) {
        // Fire-and-forget. The backend runs Tier 2 discovery (which talks
        // to Microsoft Graph) AND queues the bulk backup for parent +
        // children — all in a background task. We return as soon as it's
        // accepted (~milliseconds) so the user can navigate away.
        await backupUserWithDiscovery(tenantId, resourceId);
      } else {
        await triggerBackup(resourceId);
      }
    } catch (err) {
      console.error('Failed to trigger backup:', err);
      setBackingUp(prev => { const n = { ...prev }; delete n[resourceId]; return n; });
    }
  };

  const handleRecover = (resource: ResourceItem) => {
    // Navigate to Recovery page with the selected resource
    navigate(`/tenants/${tenantId}/${serviceType}/protection/recovery?resourceId=${resource.id}`);
  };

  const handleRefresh = async () => {
    if (refreshing || !tenantId) return;
    try {
      setRefreshing(true);
      // Trigger discovery — serviceType picks azure vs m365 queue.
      await triggerDiscovery(tenantId, serviceType);
      
      // Wait for discovery to complete by polling
      const pollDiscovery = async (attempts = 0) => {
        if (attempts >= 100) { // Timeout after 5 minutes
          setRefreshing(false);
          return;
        }
        
        try {
          // Fetch resources to check if discovery completed
          const seq = beginListRequest();
          const data = await getResources(
            tenantId,
            activeTab,
            page,
            PAGE_SIZE,
            searchQuery,
            slaParam,
            resourceFilter || undefined,
            serviceType
          );

          // Update resources (dropped if newer state has since rendered)
          applyListResponse(seq, data);
          setRefreshing(false);
        } catch (err) {
          console.error('Error fetching resources during discovery poll:', err);
          // Continue polling
          setTimeout(() => pollDiscovery(attempts + 1), 3000);
        }
      };
      
      // Start polling after a short delay to allow discovery to run
      setTimeout(() => pollDiscovery(), 3000);
    } catch (err) {
      console.error('Failed to trigger discovery:', err);
      setRefreshing(false);
    }
  };

  return (
    <div className="protection-page">
      <div className="resource-tabs">
        {serviceType === 'azure' ? (
          // Azure-specific tabs layout — auto-protection (Resource
          // groups / Dynamic groups) is intentionally omitted here
          // while the auto-protection rail is paused.
          <>
            {tabs.map(tab => (
              <button key={tab.key} className={`resource-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
            ))}
          </>
        ) : (
          // M365 tabs layout
          <>
            {tabs.map(tab => (
              tab.key === 'sharepoint' ? (
                <Fragment key={`d-${tab.key}`}><div className="tab-divider" /><button className={`resource-tab pill ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button></Fragment>
              ) : tab.key !== 'dynamic' && tab.key !== 'entra-groups' ? (
                <button key={tab.key} className={`resource-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
              ) : null
            ))}
            {/* Auto-protection group (Entra ID groups / Dynamic groups) —
                hidden for now. Uncomment when auto-protection is ready.
            <fieldset className="auto-protection-group">
              <legend className="auto-protection-label">Auto-protection</legend>
              <div className="auto-protection-tabs">
                <button className={`resource-tab ${activeTab === 'entra-groups' ? 'active' : ''}`} onClick={() => setActiveTab('entra-groups')}>Entra ID groups</button>
                <button className={`resource-tab ${activeTab === 'dynamic' ? 'active' : ''}`} onClick={() => setActiveTab('dynamic')}>Dynamic groups</button>
              </div>
            </fieldset>
            */}
          </>
        )}
      </div>

      <div className="action-bar">
        <div className="action-bar-left">
          <div className="search-wrapper">
            <input type="text" placeholder="Search resources" className="search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            <svg className="search-icon" viewBox="0 0 15 15" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 8.5L10.5 10.5M7 9.5C5.61929 9.5 4.5 8.38071 4.5 7C4.5 5.61929 5.61929 4.5 7 4.5C8.38071 4.5 9.5 5.61929 9.5 7C9.5 8.38071 8.38071 9.5 7 9.5Z" /></svg>
          </div>
          <div className="action-buttons">
            {/*}
            <div className="action-btn-wrapper" style={{ position: 'relative' }}>
              <button
                className="action-btn"
                disabled={selectedResources.length === 0 || hasUnprotectedSelected}
                onClick={handleBatchBackup}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polygon points="5 3 19 12 5 21 5 3" /></svg>
                Backup now{selectedResources.length > 0 ? ` (${selectedResources.length})` : ''}
              </button>
              {hasUnprotectedSelected && selectedResources.length > 0 && (
                <div className="tooltip-box">
                  Resources that are not protected can't get data backups
                </div>
              )}
              </div>
              */}
            <div className="sla-assign-wrapper" ref={slaDropdownRef} style={{ position: 'relative' }}>
              <button className="action-btn" disabled={!selectAllMatching && selectedResources.length === 0} onClick={() => setShowSlaDropdown(!showSlaDropdown)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                Assign SLA{selectAllMatching ? ` (${totalItems})` : selectedResources.length > 0 ? ` (${selectedResources.length})` : ''}
              </button>
              {showSlaDropdown && (
                <div className="sla-dropdown-menu">
                  <button className="sla-dropdown-item" onClick={() => handleBulkSlaAssign('')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 8, flexShrink: 0 }}>
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <line x1="2" y1="2" x2="22" y2="22" stroke="#dc2626" strokeWidth="2" />
                    </svg>
                    Not protected
                  </button>
                  {policies.map(p => (
                    <button key={p.id} className="sla-dropdown-item" onClick={() => handleBulkSlaAssign(p.id)}>
                      <div className="sla-item-text">
                        <span className="sla-item-name">{p.name}</span>
                        <span className="sla-item-desc">{getSlaDescription(p)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="filter-wrapper" ref={filterRef}>
              <button className={`action-btn filter-btn ${activeFilterCount > 0 ? 'has-filters' : ''}`} onClick={() => setShowFilter(!showFilter)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>Filter
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginLeft: 4 }}><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {showFilter && (
                <div className="filter-dropdown">
                  <div className="filter-section">
                    <div className={`filter-section-header ${resourceFilter === null ? 'active' : ''}`} onClick={() => setResourceFilter(null)}>
                      <span className="section-check" style={{ visibility: resourceFilter === null ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>All resources
                    </div>
                    <div className={`filter-section-item ${resourceFilter === 'active' ? 'active' : ''}`} onClick={() => setResourceFilter('active')}>
                      <span className="section-check" style={{ visibility: resourceFilter === 'active' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Active only
                    </div>
                    <div className={`filter-section-item ${resourceFilter === 'archived' ? 'active' : ''}`} onClick={() => setResourceFilter('archived')}>
                      <span className="section-check" style={{ visibility: resourceFilter === 'archived' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Archived only
                    </div>
                  </div>
                  <div className="filter-divider" />
                  <div className="filter-section">
                    <div className={`filter-section-header ${sizeFilter === null ? 'active' : ''}`} onClick={() => setSizeFilter(null)}>
                      <span className="section-check" style={{ visibility: sizeFilter === null ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>All sizes
                    </div>
                    <div className={`filter-section-item ${sizeFilter === 'top_total' ? 'active' : ''}`} onClick={() => setSizeFilter('top_total')}>
                      <span className="section-check" style={{ visibility: sizeFilter === 'top_total' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Top by total size
                    </div>
                    <div className={`filter-section-item ${sizeFilter === 'top_7d' ? 'active' : ''}`} onClick={() => setSizeFilter('top_7d')}>
                      <span className="section-check" style={{ visibility: sizeFilter === 'top_7d' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Top by storage growth (7d)
                    </div>
                    <div className={`filter-section-item ${sizeFilter === 'top_30d' ? 'active' : ''}`} onClick={() => setSizeFilter('top_30d')}>
                      <span className="section-check" style={{ visibility: sizeFilter === 'top_30d' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Top by storage growth (30d)
                    </div>
                    <div className={`filter-section-item ${sizeFilter === 'top_365d' ? 'active' : ''}`} onClick={() => setSizeFilter('top_365d')}>
                      <span className="section-check" style={{ visibility: sizeFilter === 'top_365d' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Top by storage growth (365d)
                    </div>
                  </div>
                  <div className="filter-divider" />
                  <div className="filter-section">
                    <div className={`filter-section-header ${slaFilter === null ? 'active' : ''}`} onClick={() => setSlaFilter(null)}>
                      <span className="section-check" style={{ visibility: slaFilter === null ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>All SLAs
                    </div>
                    {['Not protected', ...policies.map(p => p.name)].map(sla => (
                      <div key={sla} className={`filter-section-item ${slaFilter === sla ? 'active' : ''}`} onClick={() => setSlaFilter(sla)}>
                        <span className="section-check" style={{ visibility: slaFilter === sla ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>{sla}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button 
              className="action-btn icon-only" 
              title="Refresh" 
              disabled={refreshing}
              onClick={handleRefresh}
              style={refreshing ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
        </div>
        <div className="pagination">
          <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}><polyline points="15 18 9 12 15 6" /></svg></button>
          <span className="pagination-page">{page} / {totalPages || 1}</span>
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}><polyline points="9 18 15 12 9 6" /></svg></button>
        </div>
      </div>

      <div className="resources-table-container">
        {/* Bulk SLA result / status. Dismissible; errors used to die in
            console.error and the page gave no sign anything happened. */}
        {bulkNotice && (
          <div className={`bulk-notice ${bulkNotice.kind}`} role={bulkNotice.kind === 'error' ? 'alert' : 'status'}>
            <span>{bulkNotice.text}</span>
            <button
              type="button"
              className="bulk-notice-dismiss"
              aria-label="Dismiss"
              onClick={() => setBulkNotice(null)}
            >
              ×
            </button>
          </div>
        )}
        {(() => {
          const banner = selectAllBannerState({
            selectAllMatching,
            selectedCount: selectedResources.length,
            visibleCount: displayedResources.length,
            totalItems,
          });
          if (banner === 'offer-all') {
            return (
              <div className="selectall-banner" role="status">
                <span>All {displayedResources.length} on this page are selected.</span>
                <button type="button" className="selectall-link" onClick={() => setSelectAllMatching(true)}>
                  Select all {totalItems} matching
                </button>
              </div>
            );
          }
          if (banner === 'all-matching') {
            return (
              <div className="selectall-banner" role="status">
                <span>All {totalItems} matching resources are selected.</span>
                <button
                  type="button"
                  className="selectall-link"
                  onClick={() => { setSelectAllMatching(false); setSelectedResources([]); }}
                >
                  Clear selection
                </button>
              </div>
            );
          }
          return null;
        })()}
        <table className="resources-table">
          <thead>
            <tr>
              {/* TMV-030: the header checkbox was a bare <input> — the
                  accessibility tree exposed no name at all, so a screen
                  reader announced "checkbox, not checked" with nothing to
                  say what it selects. */}
              <th className="checkbox-cell"><input
                type="checkbox"
                checked={displayedResources.length > 0 && (selectAllMatching || selectedResources.length === displayedResources.length)}
                onChange={toggleSelectAll}
                disabled={displayedResources.length === 0}
                aria-label={`Select all ${displayedResources.length} resources on this page`}
              /></th>
              <th>Resources <span className="th-icon"></span></th>
              <th>SLA <span className="th-icon"></span></th>
              <th className="size-col"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 4, verticalAlign: 'middle' }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>Total size</th>
              <th>Last backup</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>Loading...</td></tr>}
            {!loading && displayedResources.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>No resources found.</td></tr>}
            {!loading && displayedResources.map(resource => {
              const selectedPolicy = policies.find(p => p.id === resource.protections?.[0]?.policy_id);
              const coverageWarning = getPolicyCoverageWarning(resource, selectedPolicy);
              // Workloads the user has no M365 license for → "Limited" pill.
              const unbackable = resource.unbackable_workloads ?? [];
              const limitedTitle = unbackable.length > 0
                ? `No M365 license — can't back up: ${unbackable.map(w => w.workload).join(', ')}. `
                  + `Backup resumes automatically once a license is assigned.`
                : '';
              const backupButtonTitle = !resource.protections?.[0]?.policy_id
                ? 'Assign an SLA policy before triggering backup'
                : coverageWarning
                  ? `${coverageWarning} Manual backup still runs.`
                  : '';

              return (
              <tr key={resource.id}>
                <td className="checkbox-cell">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectAllMatching || selectedResources.includes(resource.id)}
                      onChange={() => toggleSelect(resource.id)}
                      aria-label={`Select ${resource.name || 'unnamed resource'}`}
                    />
                  </label>
                </td>
                <td className="resource-name-cell">
                  <AvatarInitials name={resource.name} />
                  <div className="resource-info">
                    <div className="resource-display-name">
                      <span className="name-text">{resource.name}</span>
                      {unbackable.length > 0 && (
                        <span
                          className="license-limited-pill"
                          data-tooltip={limitedTitle}
                          aria-label={limitedTitle}
                          role="note"
                          tabIndex={0}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" />
                          </svg>
                          Limited
                        </span>
                      )}
                      {resource.group_connected && (
                        <span
                          className="group-connected-badge"
                          title="This site is backed by a Microsoft 365 group / Teams channel. Group backups don't include site content — assign an SLA here to protect the site itself."
                        >
                          group-connected
                        </span>
                      )}
                    </div>
                    {resource.email && <div className="resource-email">{resource.email}</div>}
                    {/* TMV-027: was `kind.replace(/_/g,' ')`, which printed
                        the raw enum as the subtitle — "entra service
                        principal", "azure sql", "sharepoint site".
                        prettifyEnumLabel capitalises and keeps the product's
                        acronyms intact (SQL / ID / OneDrive / SharePoint). */}
                    {resource.kind && !resource.email && <div className="resource-email">{prettifyEnumLabel(resource.kind)}</div>}
                  </div>
                </td>
                <td className="sla-cell">
                  <SlaCell resource={resource} policies={policies} onChange={handleSlaChange} onSettings={() => navigate(`/tenants/${tenantId}/${serviceType}/protection/settings`)} />
                  {coverageWarning && (
                    <div className="sla-coverage-warning" title={coverageWarning}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <span>{coverageWarning}</span>
                    </div>
                  )}
                </td>
                <td className="size-cell">
                  <div className="size-main">{formatSize(resource.usage?.size || 0)}</div>
                </td>
                <td className="backup-cell">
                  {(() => {
                    // Display rules (per spec):
                    //   1. Backup is actively RUNNING → show "In Progress"
                    //      indicator only (no date, no historical label).
                    //   2. Has any backed-up data (size > 0) → show the
                    //      last-backup date and time. No status badge — old
                    //      terminal states (Done / Failed / Canceled) are
                    //      already discoverable from the Activity page.
                    //   3. Otherwise → "No backups yet".
                    // The local `backingUp` flag lets us show "In Progress"
                    // optimistically right after a click, until the next
                    // resource refresh confirms it from server data.
                    const sizeBytes = resource.usage?.size || 0;
                    const status = resource.last_backup_status;
                    const isDiscovering = discovering.has(resource.id);
                    // Treat QUEUED / DISPATCHED the same as RUNNING —
                    // from the user's perspective the backup is already
                    // in flight, and we don't want a refresh to flip the
                    // cell back to the previous date just because the
                    // worker hasn't picked the message up yet. The
                    // "In Progress" state only clears once the latest
                    // job settles on a terminal status.
                    const IN_PROGRESS_STATUSES = new Set(['RUNNING', 'QUEUED', 'DISPATCHED']);
                    const isRunning = (status && IN_PROGRESS_STATUSES.has(status))
                      || !!backingUp[resource.id];

                    if (isDiscovering) {
                      return (
                        <span className="backup-status in-progress" title="Discovering content before backup">
                          <span className="bps-spinner" />
                          Discovering…
                        </span>
                      );
                    }

                    if (isRunning) {
                      return (
                        <span className="backup-status in-progress">
                          <span className="bps-spinner" />
                          In Progress
                        </span>
                      );
                    }

                    if (sizeBytes > 0 && resource.last_backup) {
                      return (
                        <>
                          <div className="backup-date">{fmtLocalDate(resource.last_backup, { month: 'short', day: 'numeric' })}</div>
                          <div className="backup-time">{fmtLocalTime(resource.last_backup, { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                        </>
                      );
                    }

                    return <span className="backup-status never">No backups yet</span>;
                  })()}
                </td>
                <td className="actions-cell">
                  {(() => {
                    // Disable "Backup now" while the resource already
                    // has a backup in flight. Mirrors the "In Progress"
                    // status cell logic so clicks can't stack up
                    // duplicate jobs during QUEUED/RUNNING/DISPATCHED.
                    const IN_FLIGHT = new Set(['RUNNING', 'QUEUED', 'DISPATCHED']);
                    const rowInFlight = !!resource.last_backup_status
                      && IN_FLIGHT.has(resource.last_backup_status);
                    const label = discovering.has(resource.id)
                      ? 'Discovering…'
                      : backingUp[resource.id]
                        ? 'Starting…'
                        : rowInFlight
                          ? 'In Progress'
                          : 'Backup now';
                    return (
                      <button
                        className="action-btn-sm"
                        onClick={() => handleBackupNow(resource)}
                        disabled={
                          !!backingUp[resource.id]
                          || discovering.has(resource.id)
                          || rowInFlight
                          || !resource.protections?.[0]?.policy_id
                        }
                        title={rowInFlight ? 'A backup is already running for this resource' : backupButtonTitle}
                      >
                        {label}
                      </button>
                    );
                  })()}
                  <button
                    className="action-btn-sm"
                    onClick={() => handleRecover(resource)}
                    disabled={!resource.protections?.[0]?.policy_id || !resource.last_backup}
                    title={!resource.protections?.[0]?.policy_id ? 'Assign an SLA policy before recovering' : !resource.last_backup ? 'No backups available' : 'Recover from backup'}
                  >
                    Recover <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginLeft: 2, verticalAlign: 'middle' }}><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                  {/* <button
                    className="action-btn-sm"
                    onClick={() => handleViewSnapshots(resource)}
                    disabled={!resource.protections?.[0]?.policy_id}
                    title={!resource.protections?.[0]?.policy_id ? 'Assign an SLA policy before viewing snapshots' : ''}
                  >
                    Snapshots
                  </button> */}
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* Mandatory confirm for the select-all-matching bulk path. The
          count comes from the server's dry run — nothing has been written
          when this renders, and nothing is until Confirm. */}
      {confirmBulk && (
        <div className="bulk-confirm-overlay" onClick={() => { if (!bulkBusy) setConfirmBulk(null); }}>
          <div
            ref={bulkModalRef}
            className="bulk-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-confirm-title"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="bulk-confirm-title">{confirmBulk.policyId ? 'Assign SLA policy' : 'Remove protection'}</h3>
            <p className="bulk-confirm-text">
              {confirmBulk.policyId
                ? `Assign ${confirmBulk.policyName} to ${confirmBulk.matched} resources?`
                : `Remove protection from ${confirmBulk.matched} resources?`}
            </p>
            <p className="bulk-confirm-sub">
              This applies to every resource matching the current tab, search and filters — including pages not shown.
              {!confirmBulk.policyId && ' Resources without a policy are excluded from scheduled backups.'}
            </p>
            <div className="bulk-confirm-actions">
              <button type="button" className="action-btn" onClick={() => setConfirmBulk(null)} disabled={bulkBusy}>
                Cancel
              </button>
              <button
                type="button"
                className={`bulk-confirm-primary${confirmBulk.policyId ? '' : ' danger'}`}
                onClick={executeBulkByFilter}
                disabled={bulkBusy}
              >
                {bulkBusy ? 'Applying…' : confirmBulk.policyId ? `Assign to ${confirmBulk.matched} resources` : `Remove from ${confirmBulk.matched} resources`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Modal - Currently disabled
      {snapshotModalOpen && selectedResource && (
        <div className="modal-overlay" onClick={() => setSnapshotModalOpen(false)}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Snapshots for {selectedResource.name}</h2>
              <button className="modal-close" onClick={() => setSnapshotModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {snapshotsLoading ? (
                <div className="loading-container">
                  <div className="spinner" />
                  <p>Loading snapshots...</p>
                </div>
              ) : snapshots.length === 0 ? (
                <div className="empty-state">
                  <p>No snapshots found for this resource</p>
                </div>
              ) : (
                <table className="snapshots-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Label</th>
                      <th>Items</th>
                      <th>Size</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map(snap => (
                      <tr key={snap.id}>
                        <td>{snap.type}</td>
                        <td>{snap.label || '-'}</td>
                        <td>{snap.itemCount}</td>
                        <td>{formatSize(snap.size)}</td>
                        <td>{fmtLocal(snap.createdAt)}</td>
                        <td>
                          <span className={`status-badge ${snap.status.toLowerCase()}`}>{snap.status}</span>
                        </td>
                        <td>
                          <button
                            className="action-btn-sm"
                            onClick={() => handleRecoverFromSnapshot(snap.id)}
                          >
                            Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      */}
    </div>
  );
}
