import { useState, useRef, useEffect, useMemo, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getResources, type ResourceItem, type ResourceListResponse, assignPolicy, unassignPolicy, bulkAssignPolicy, triggerBackup, triggerDiscovery, backupUserWithDiscovery } from '../services/resource';
import { getSlaPolicies, type SlaPolicy } from '../services/sla';
// import { SnapshotService, type SnapshotItem as SnapshotListItem } from '../services/snapshot';
import { usePersistentTab } from '../hooks/usePersistentTab';
import './Protection.css';

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
  // Auto-protection
  { key: 'resource-groups', label: 'Resource groups' },
  { key: 'dynamic', label: 'Dynamic groups' },
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

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
    workloadLabel: 'Entra user, contacts, or calendar backups',
    covers: (policy) => !!(policy.backupEntraId || policy.contacts || policy.calendars),
  },
  entra_group: {
    workloadLabel: 'Entra group or group mailbox backups',
    covers: (policy) => !!(policy.backupEntraId || policy.groupMailbox),
  },
  dynamic_group: {
    workloadLabel: 'Entra group or group mailbox backups',
    covers: (policy) => !!(policy.backupEntraId || policy.groupMailbox),
  },
  entra_app: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
  entra_device: { workloadLabel: 'Entra ID backups', covers: (policy) => !!policy.backupEntraId },
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
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);

  const [resourceFilter, setResourceFilter] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null); // 'all' | 'top_total' | 'top_7d' | 'top_30d' | 'top_365d'
  const [slaFilter, setSlaFilter] = useState<string | null>(null);

  const [showSlaDropdown, setShowSlaDropdown] = useState(false);
  const slaDropdownRef = useRef<HTMLDivElement>(null);

  const [refreshing, setRefreshing] = useState(false);

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
    const reconcile = async () => {
      try {
        const data = searchQuery
          ? await getResources(tenantId, activeTab, 1, 10000, searchQuery, slaFilter || undefined, resourceFilter || undefined, serviceType)
          : await getResources(tenantId, activeTab, page, 50, searchQuery, slaFilter || undefined, resourceFilter || undefined, serviceType);
        const items = data.items || [];
        setResources(items);
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
            const advanced = r.last_backup && new Date(r.last_backup).getTime() >= new Date(triggered).getTime();
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
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tenantId, activeTab, page, searchQuery, slaFilter, resourceFilter, serviceType]);

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

    // If there's a search query, fetch all resources and filter client-side
    if (searchQuery) {
      getResources(tenantId, activeTab, 1, 10000, searchQuery, slaFilter || undefined, resourceFilter || undefined, serviceType)
        .then((data: ResourceListResponse) => {
          const filtered = data.items || [];
          setResources(filtered);
          setTotalPages(filtered.length > 0 ? Math.ceil(filtered.length / 50) : 1);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      // No search query - use normal pagination
      getResources(tenantId, activeTab, page, 50, searchQuery, slaFilter || undefined, resourceFilter || undefined, serviceType)
        .then((data: ResourceListResponse) => {
          setResources(data.items || []);
          setTotalPages(data.item_number > 0 ? Math.ceil(data.item_number / 50) : 1);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [tenantId, activeTab, page, searchQuery, slaFilter, resourceFilter, serviceType]);

  useEffect(() => { setPage(1); }, [activeTab, searchQuery, slaFilter, resourceFilter]);

  // Apply client-side search filtering
  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return resources;
    
    const query = searchQuery.toLowerCase().trim();
    return resources.filter(resource => {
      // Search in name
      if (resource.name.toLowerCase().includes(query)) return true;
      // Search in email
      if (resource.email && resource.email.toLowerCase().includes(query)) return true;
      // Search in kind
      if (resource.kind && resource.kind.toLowerCase().includes(query)) return true;
      return false;
    });
  }, [resources, searchQuery]);

  // Apply size-based sorting/filtering and SLA filtering to resources
  const sortedResources = useMemo(() => {
    let filtered = [...filteredResources];

    // Apply SLA filter first
    if (slaFilter) {
      if (slaFilter === 'Not protected') {
        filtered = filtered.filter(r => !r.protections || r.protections.length === 0 || !r.protections[0]?.policy_id);
      } else {
        filtered = filtered.filter(r => {
          const policyId = r.protections?.[0]?.policy_id;
          if (!policyId) return false;
          const policy = policies.find(p => p.id === policyId);
          return policy?.name === slaFilter;
        });
      }
    }

    // Apply size filter (sorting)
    if (!sizeFilter || sizeFilter === null) return filtered;

    switch (sizeFilter) {
      case 'top_total':
        // Sort by total size (descending)
        return filtered.sort((a, b) => (b.usage?.size || 0) - (a.usage?.size || 0));

      case 'top_7d':
        // Sort by 7-day growth (descending)
        return filtered.sort((a, b) => (b.usage?.size_delta_week || 0) - (a.usage?.size_delta_week || 0));

      case 'top_30d':
        // Sort by 30-day growth (descending)
        return filtered.sort((a, b) => (b.usage?.size_delta_month || 0) - (a.usage?.size_delta_month || 0));

      case 'top_365d':
        // Sort by yearly growth (descending)
        return filtered.sort((a, b) => (b.usage?.size_delta_year || 0) - (a.usage?.size_delta_year || 0));

      default:
        return filtered;
    }
  }, [resources, sizeFilter, slaFilter, policies]);

  // Apply client-side pagination when searching
  const displayedResources = useMemo(() => {
    if (searchQuery) {
      const startIndex = (page - 1) * 50;
      return sortedResources.slice(startIndex, startIndex + 50);
    }
    return sortedResources;
  }, [sortedResources, searchQuery, page]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) setShowFilter(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeFilterCount = (resourceFilter ? 1 : 0) + (sizeFilter ? 1 : 0) + (slaFilter ? 1 : 0);

  const toggleSelectAll = () => {
    setSelectedResources(selectedResources.length === displayedResources.length ? [] : displayedResources.map(r => r.id));
  };

  const toggleSelect = (id: string) => {
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

  const handleBulkSlaAssign = async (policyId: string) => {
    if (selectedResources.length === 0) return;
    try {
      const result = await bulkAssignPolicy(selectedResources, policyId);
      // Update local state
      setResources(prev => prev.map(r =>
        selectedResources.includes(r.id)
          ? { ...r, protections: policyId ? [{ policy_id: policyId }] : null }
          : r
      ));
      setSelectedResources([]);
      setShowSlaDropdown(false);
      console.log(`Assigned SLA to ${result.assigned} resources`);
    } catch (err) {
      console.error('Failed to bulk assign SLA:', err);
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
      // Trigger discovery
      await triggerDiscovery(tenantId);
      
      // Wait for discovery to complete by polling
      const pollDiscovery = async (attempts = 0) => {
        if (attempts >= 100) { // Timeout after 5 minutes
          setRefreshing(false);
          return;
        }
        
        try {
          // Fetch resources to check if discovery completed
          const data = await getResources(
            tenantId,
            activeTab,
            searchQuery ? 1 : page,
            searchQuery ? 10000 : 50,
            searchQuery,
            slaFilter || undefined,
            resourceFilter || undefined,
            serviceType
          );

          // Update resources
          if (searchQuery) {
            const filtered = data.items || [];
            setResources(filtered);
            setTotalPages(filtered.length > 0 ? Math.ceil(filtered.length / 50) : 1);
          } else {
            setResources(data.items || []);
            setTotalPages(data.item_number > 0 ? Math.ceil(data.item_number / 50) : 1);
          }
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
          // Azure-specific tabs layout
          <>
            {tabs.map(tab => (
              tab.key === 'resource-groups' ? (
                <Fragment key={`d-${tab.key}`}><div className="tab-divider" /><button className={`resource-tab pill ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button></Fragment>
              ) : (
                <button key={tab.key} className={`resource-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
              )
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
            <fieldset className="auto-protection-group">
              <legend className="auto-protection-label">Auto-protection</legend>
              <div className="auto-protection-tabs">
                <button className={`resource-tab ${activeTab === 'entra-groups' ? 'active' : ''}`} onClick={() => setActiveTab('entra-groups')}>Entra ID groups</button>
                <button className={`resource-tab ${activeTab === 'dynamic' ? 'active' : ''}`} onClick={() => setActiveTab('dynamic')}>Dynamic groups</button>
              </div>
            </fieldset>
          </>
        )}
      </div>

      <div className="action-bar">
        <div className="action-bar-left">
          <div className="search-wrapper">
            <input type="text" placeholder="Search resources" className="search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
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
              <button className="action-btn" disabled={selectedResources.length === 0} onClick={() => setShowSlaDropdown(!showSlaDropdown)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                Assign SLA{selectedResources.length > 0 ? ` (${selectedResources.length})` : ''}
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
        <table className="resources-table">
          <thead>
            <tr>
              <th className="checkbox-cell"><input type="checkbox" checked={displayedResources.length > 0 && selectedResources.length === displayedResources.length} onChange={toggleSelectAll} /></th>
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
                      checked={selectedResources.includes(resource.id)}
                      onChange={() => toggleSelect(resource.id)}
                    />
                  </label>
                </td>
                <td className="resource-name-cell">
                  <div className="resource-avatar">{getInitials(resource.name)}</div>
                  <div className="resource-info">
                    <div className="resource-display-name">{resource.name}</div>
                    {resource.email && <div className="resource-email">{resource.email}</div>}
                    {resource.kind && !resource.email && <div className="resource-email">{resource.kind.replace(/_/g, ' ')}</div>}
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
                    const isRunning = status === 'RUNNING' || !!backingUp[resource.id];

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
                          <div className="backup-date">{new Date(resource.last_backup).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                          <div className="backup-time">{new Date(resource.last_backup).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                        </>
                      );
                    }

                    return <span className="backup-status never">No backups yet</span>;
                  })()}
                </td>
                <td className="actions-cell">
                  <button
                    className="action-btn-sm"
                    onClick={() => handleBackupNow(resource)}
                    disabled={!!backingUp[resource.id] || discovering.has(resource.id) || !resource.protections?.[0]?.policy_id}
                    title={backupButtonTitle}
                  >
                    {discovering.has(resource.id) ? 'Discovering…' : backingUp[resource.id] ? 'Starting…' : 'Backup now'}
                  </button>
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
                        <td>{new Date(snap.createdAt).toLocaleString()}</td>
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
