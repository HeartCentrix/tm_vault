import { API } from '../config/api';

/**
 * Detect a "stale tenant id" 404 from the backend and self-heal the
 * cached nav state so the next navigation picks up a fresh tenant.
 * Triggered when a DB reset changed the tenant UUID but the frontend
 * was still using a localStorage copy of the old one.
 *
 * Signals a page reload via the `tm:tenant-stale` event so the
 * shell can present a "re-select tenant" state without a hard refresh
 * that would lose other unsaved UI state.
 */
async function handleStaleTenant(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  try {
    const body = await res.clone().json();
    const detail = String(body?.detail || '');
    if (!/tenant.*not found|stale/i.test(detail)) return false;
    // Clear only the tenant-scoped bits of nav state; keep auth token
    // and sub-route so the user stays on the same page after re-select.
    try {
      const raw = localStorage.getItem('tm_vault_nav_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.tenantId = null;
        localStorage.setItem(
          'tm_vault_nav_state', JSON.stringify(parsed),
        );
      }
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('tm:tenant-stale', {
      detail: { reason: detail },
    }));
    return true;
  } catch {
    return false;
  }
}

export interface ResourceItem {
  id: string;
  tenant_id: string;
  owner: string | null;
  kind: string;
  provider: string;
  external_id: string;
  name: string;
  email?: string;
  data: Record<string, any>;
  /** SharePoint site backed by an M365 group / Teams channel. Group
   * backups don't capture site content, so these are listed (badged)
   * rather than hidden behind the Groups & Teams tab. */
  group_connected?: boolean;
  archived: boolean;
  deleted: boolean;
  protections: { policy_id: string }[] | null;
  usage: {
    resource_id: string;
    tenant_id: string;
    backups: number;
    size: number;
    size_delta_year: number;
    size_delta_month: number;
    size_delta_week: number;
  };
  backupSize?: string;  // Formatted size string from backend (e.g., "1.15 GB")
  status: string;
  sla?: string;
  last_backup?: string;
  last_backup_status?: string;
  // Workloads this user has no M365 license for (empty/absent when fully
  // licensed). Populated on the parent user row; drives the "Limited" pill.
  unbackable_workloads?: UnbackableWorkload[];
  // This resource's OWN license state (set on Tier-2 children).
  license_missing?: boolean;
  license_hint?: string | null;
  group_ids: string[];
}

export interface UnbackableWorkload {
  workload: string;        // friendly label, e.g. "Mailbox", "OneDrive"
  resource_type: string;   // e.g. "USER_MAIL"
  license_hint?: string | null; // e.g. "Exchange Online"
}

export interface ResourceListResponse {
  item_number: number;
  page_number: number;
  next_page_token: string | null;
  items: ResourceItem[];
}

// Map Protection tabs to backend resource types (must match ResourceType enum in DB)
//
// Post-Tier-2-refactor: only Tier 1 container types appear here. Per-user
// content (USER_MAIL / USER_ONEDRIVE / USER_CONTACTS / USER_CALENDAR /
// USER_CHATS) is fetched on demand via the discover-content endpoint and
// rendered under each user — not as standalone Protection rows.
const M365_TAB_TYPE_MAP: Record<string, string[]> = {
  all: [],
  users: ['ENTRA_USER'],
  shared: ['SHARED_MAILBOX'],
  rooms: ['ROOM_MAILBOX'],
  sharepoint: ['SHAREPOINT_SITE'],
  // Groups & Teams: group containers + channel containers (chats moved to Tier 2).
  groups: ['ENTRA_GROUP', 'M365_GROUP', 'TEAMS_CHANNEL'],
  // Entra ID: a single per-tenant "Azure Active Directory" row — mirrors
  // AFI's office_directory model. All Entra-wide content (users, groups,
  // roles, applications, audit, etc.) lives under this one resource as
  // snapshot items, exposed via 8 content-tabs on the Recovery page.
  entra: ['ENTRA_DIRECTORY'],
  // Power Platform — DLP/Copilot/Planner aren't in Tier 1.
  power: ['POWER_BI', 'POWER_APPS', 'POWER_AUTOMATE'],
  // Auto-protection bucket: Entra groups + dynamic groups.
  'entra-groups': ['ENTRA_GROUP', 'M365_GROUP'],
  dynamic: ['DYNAMIC_GROUP'],
};

// Azure resource types — only the Tier 1 set the user listed.
const AZURE_TAB_TYPE_MAP: Record<string, string[]> = {
  all: [],
  'virtual-machines': ['AZURE_VM'],
  'sql-databases': ['AZURE_SQL_DB'],
  'postgresql-servers': ['AZURE_POSTGRESQL', 'AZURE_POSTGRESQL_SINGLE'],
  // Auto-protection
  'resource-groups': ['RESOURCE_GROUP'],
  dynamic: ['DYNAMIC_GROUP'],
};

const M365_ALL_TYPES = [
  'ENTRA_USER',
  'SHARED_MAILBOX',
  'ROOM_MAILBOX',
  'SHAREPOINT_SITE',
  'ENTRA_GROUP',
  'M365_GROUP',
  'TEAMS_CHANNEL',
  'ENTRA_DIRECTORY',
  'POWER_BI',
  'POWER_APPS',
  'POWER_AUTOMATE',
  'DYNAMIC_GROUP',
];
const AZURE_ALL_TYPES = [
  'AZURE_VM',
  'AZURE_SQL_DB',
  'AZURE_POSTGRESQL',
  'AZURE_POSTGRESQL_SINGLE',
  'RESOURCE_GROUP',
  'DYNAMIC_GROUP',
];

/**
 * Client-side row matcher for the Protection search box.
 *
 * `query=` is applied SERVER-side on every list path that supports it
 * (build_by_type_search_filters in resource-service ORs display_name /
 * email / metadata->>'web_url'), so this pass exists only as a belt-and-
 * braces filter over an already-filtered page — plus the `kind` axis the
 * server has no column for.
 *
 * It MUST therefore stay a superset of the server-side predicate: a row
 * the server matched on web_url only (SharePoint titles routinely differ
 * from the URL slug — "IT OPS NOTES" lives at /sites/ITOPS) used to fall
 * back out here, which punched holes in a server-paginated page.
 */
export function resourceMatchesQuery(
  resource: Pick<ResourceItem, 'name' | 'email' | 'kind' | 'data'>,
  query: string,
): boolean {
  const q = (query || '').toLowerCase().trim();
  if (!q) return true;
  const hay = [
    resource.name,
    resource.email,
    resource.kind,
    // Server-side OR includes metadata->>'web_url'; `data` is that
    // metadata blob verbatim (see the /by-type row mapping).
    resource.data?.web_url,
  ];
  return hay.some(v => typeof v === 'string' && v.toLowerCase().includes(q));
}

export function getTabTypeMap(serviceType?: string): Record<string, string[]> {
  if (serviceType === 'azure') {
    return AZURE_TAB_TYPE_MAP;
  }
  return M365_TAB_TYPE_MAP;
}

/**
 * The ONE tab → resource-types resolution, shared by the list fetch and
 * the select-all-matching bulk filter. The bulk filter MUST describe
 * exactly the rows the tab lists, so both paths read the same mapping —
 * including the "all" special case, which expands to the service's full
 * Tier 1 type list rather than the map's empty sentinel.
 */
export function getTypesForTab(tab: string, serviceType?: string): string[] {
  if (tab === 'all') {
    if (serviceType === 'azure') return AZURE_ALL_TYPES;
    if (serviceType === 'm365') return M365_ALL_TYPES;
    return [];
  }
  return getTabTypeMap(serviceType)[tab] || [];
}

export async function getResources(
  tenantId: string,
  tab: string,
  page: number = 1,
  size: number = 50,
  searchQuery?: string,
  // 'none' (unprotected) or an SLA policy UUID — filtered SERVER-side.
  // This used to be ignored here and filtered client-side over the
  // fetched page only, so once pagination pushed SLA'd resources out of
  // the newest-first window the filter matched nothing (2026-07-15).
  slaParam?: string,
  resourceFilter?: string,
  serviceType?: string
): Promise<ResourceListResponse> {
  const types = getTypesForTab(tab, serviceType);

  const headers: Record<string, string> = {};

  // Tabs with multiple types (all, groups, entra, power) have no
  // multi-type backend endpoint — /by-type takes exactly ONE type. It does
  // guarantee a stable total order per type (ORDER BY created_at DESC,
  // id DESC — see BY_TYPE_ORDER_BY in resource-service), so the requested
  // page window is mapped onto real per-type offsets: one cheap count
  // probe per type, then only the pages the window actually covers.
  //
  // This used to fetch page=1&size=500 for every type, concatenate and
  // slice client-side while still reporting the summed REAL totals as
  // item_number. On the pilot tenant (ENTRA_USER 11,190 / SHAREPOINT_SITE
  // 4,204 / M365_GROUP 6,574 / … = 24,642 rows) all but the newest 500
  // rows of each type were unreachable, and Protection rendered 493 pages
  // of which everything past the truncated data was empty.
  if (types.length > 1) {
    const byTypeUrl = (type: string, p: number, s: number) => {
      let url = `${API.RESOURCES.BY_TYPE}?type=${type}&tenantId=${tenantId}&page=${p}&size=${s}`;
      if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
      if (resourceFilter === 'active') url += `&status=ACTIVE`;
      if (resourceFilter === 'archived') url += `&status=ARCHIVED`;
      if (slaParam) url += `&sla=${encodeURIComponent(slaParam)}`;
      return url;
    };

    // no-store for the same reason the single-type path below busts cache:
    // a heuristically-cached response here would feed stale per-type totals
    // into the window arithmetic, which shifts every offset — not just the
    // displayed count.
    const fetchByType = async (type: string, p: number, s: number): Promise<ResourceListResponse> => {
      const res = await fetch(byTypeUrl(type, p, s), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to fetch resources for type ${type}: ${res.statusText}`);
      return res.json();
    };

    // Count probe per type. size=1 because only item_number is wanted —
    // it is the count of rows matching the SAME query/status/sla filters,
    // so the window maths below is over exactly the rows being listed.
    const counts = await Promise.all(types.map(async (type) => ({
      type,
      total: (await fetchByType(type, 1, 1)).item_number || 0,
    })));
    const totalItems = counts.reduce((sum, c) => sum + c.total, 0);

    // Rows are laid out type-by-type in `types` order (unchanged from the
    // concatenate-and-slice behavior), so the global window [start, end)
    // maps to a contiguous offset range within each type it overlaps.
    const start = (page - 1) * size;
    const end = start + size;
    const slices: { type: string; pages: number[]; skip: number; count: number }[] = [];
    let cursor = 0;
    for (const { type, total } of counts) {
      const typeStart = cursor;
      cursor += total;
      const from = Math.max(start, typeStart);
      const to = Math.min(end, typeStart + total);
      if (to <= from) continue;
      // An offset inside a type is not a multiple of `size`, and /by-type
      // only accepts page+size — so read `size`-aligned pages covering the
      // offset (at most two, since the window is at most `size` wide) and
      // trim the surplus head.
      const offset = from - typeStart;
      const firstPage = Math.floor(offset / size) + 1;
      const skip = offset - (firstPage - 1) * size;
      const pageCount = Math.ceil((skip + (to - from)) / size);
      slices.push({
        type,
        pages: Array.from({ length: pageCount }, (_, i) => firstPage + i),
        skip,
        count: to - from,
      });
    }

    const windows = await Promise.all(slices.map(async (slice) => {
      const pages = await Promise.all(
        slice.pages.map((p) => fetchByType(slice.type, p, size)),
      );
      const rows = pages.flatMap((d) => d.items || []);
      return rows.slice(slice.skip, slice.skip + slice.count);
    }));

    return {
      item_number: totalItems,
      page_number: page,
      next_page_token: end < totalItems ? String(page + 1) : null,
      items: windows.flat(),
    };
  }

  // Single type or no type - use existing logic
  let url: string;

  if (types.length === 1) {
    // Single type - use /by-type endpoint
    url = `${API.RESOURCES.BY_TYPE}?type=${types[0]}&tenantId=${tenantId}&page=${page}&size=${size}`;
  } else {
    // All resources (no filtering)
    url = `${API.RESOURCES.LIST}?tenantId=${tenantId}&page=${page}&size=${size}`;
  }

  if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
  if (resourceFilter === 'active') url += `&status=ACTIVE`;
  if (resourceFilter === 'archived') url += `&status=ARCHIVED`;
  if (slaParam) url += `&sla=${encodeURIComponent(slaParam)}`;

  // Bust browser cache + add query param so any intermediate proxy can't
  // serve a stale response. Without this, after a backfill / size
  // correction on the backend the Protection page kept showing the old
  // accumulated total (e.g. 6 GB when reality is 1.5 GB) for the
  // browser-cache lifetime of the previous response.
  const sep = url.includes('?') ? '&' : '?';
  url = `${url}${sep}_t=${Date.now()}`;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch resources: ${res.statusText}`);

  const data = await res.json();
  return data;
}

export async function getResourcesByType(
  tenantId: string,
  resourceType: string,
  page: number = 1,
  size: number = 500,
  searchQuery?: string,
  resourceFilter?: string,
  includeHidden: boolean = false,
): Promise<ResourceListResponse> {
  const headers: Record<string, string> = {};

  let url = `${API.RESOURCES.BY_TYPE}?type=${encodeURIComponent(resourceType)}&tenantId=${tenantId}&page=${page}&size=${size}`;
  if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
  if (resourceFilter === 'active') url += `&status=ACTIVE`;
  if (resourceFilter === 'archived') url += `&status=ARCHIVED`;
  if (includeHidden) url += `&includeHidden=true`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (await handleStaleTenant(res)) {
      throw new Error(
        'Cached tenant is stale — re-select your tenant and retry',
      );
    }
    throw new Error(`Failed to fetch ${resourceType} resources: ${res.statusText}`);
  }

  return res.json();
}

export async function assignPolicy(resourceId: string, policyId: string): Promise<void> {
  const res = await fetch(`${API.RESOURCES.ASSIGN_POLICY(resourceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policyId }),
  });
  if (!res.ok) throw new Error(`Failed to assign policy: ${res.statusText}`);
}

export async function unassignPolicy(resourceId: string): Promise<void> {
  const res = await fetch(`${API.RESOURCES.UNASSIGN_POLICY(resourceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to unassign policy: ${res.statusText}`);
}

/**
 * Build an Error carrying the backend's JSON `detail` (the FastAPI error
 * convention) so callers can surface the real reason — e.g. a 403's
 * "Administrator role required" — instead of a bare statusText, which for
 * 403 is just "Forbidden" and told the user nothing.
 */
export async function apiError(res: Response, fallback: string): Promise<Error> {
  let detail = '';
  try {
    const body = await res.clone().json();
    const d = body?.detail;
    if (typeof d === 'string') {
      detail = d;
    } else if (Array.isArray(d)) {
      // FastAPI 422 validation errors arrive as an array of
      // {loc, msg, type} objects. Render "field: message" lines — the
      // previous JSON.stringify put the raw Pydantic list in the banner,
      // and against the deployed backend EVERY select-all-matching
      // attempt hits this shape (its BulkAssignRequest still requires
      // resourceIds) until the filter-capable backend ships.
      detail = d
        .map((e) => {
          const msg = typeof e?.msg === 'string' ? e.msg : '';
          if (!msg) return '';
          const loc = Array.isArray(e?.loc)
            ? e.loc.filter((p: unknown) => typeof p === 'string' && p !== 'body').join('.')
            : '';
          return loc ? `${loc}: ${msg}` : msg;
        })
        .filter(Boolean)
        .join('; ');
    }
    // Any other non-string detail shape: leave `detail` empty and fall
    // through to the statusText fallback rather than dumping serialized
    // JSON at the user.
  } catch { /* body was not JSON — fall through to statusText */ }
  return new Error(detail || `${fallback}: ${res.status} ${res.statusText}`);
}

export async function bulkAssignPolicy(resourceIds: string[], policyId: string): Promise<{ assigned: number; not_found: string[] }> {
  const res = await fetch(API.RESOURCES.BULK_ASSIGN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceIds, policyId }),
  });
  if (!res.ok) throw await apiError(res, 'Failed to bulk assign policy');
  return res.json();
}

/**
 * Filter descriptor for the select-all-across-pages bulk path. Mirrors the
 * server-side BulkAssignRequest.filter: the backend resolves the matching
 * ids with the SAME predicates the /by-type listing uses, so this must be
 * built from exactly what the tab is showing (getTypesForTab + the current
 * query/status/sla params) — see buildBulkFilter in utils/bulkSelection.
 */
export interface BulkAssignFilter {
  tenantId: string;
  types: string[];
  query?: string;
  status?: string;
  sla?: string;
}

export interface BulkAssignByFilterResult {
  matched: number;
  assigned: number; // 0 when dryRun
  dryRun: boolean;
}

/**
 * Same POST /resources/bulk-assign-policy route as bulkAssignPolicy, but
 * addressing resources by filter instead of by id list (the request must
 * carry exactly one of the two). policyId '' = unassign, as on the id
 * path. dryRun resolves + validates and returns counts with ZERO writes —
 * used to get the authoritative matched count for the confirm modal.
 */
export async function bulkAssignPolicyByFilter(
  filter: BulkAssignFilter,
  policyId: string,
  dryRun: boolean = false,
): Promise<BulkAssignByFilterResult> {
  const res = await fetch(API.RESOURCES.BULK_ASSIGN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, policyId, dryRun }),
  });
  if (!res.ok) throw await apiError(res, 'Failed to bulk assign policy');
  return res.json();
}

export async function bulkUnassignPolicy(resourceIds: string[]): Promise<{ unassigned: number; not_found: string[] }> {
  const res = await fetch(API.RESOURCES.BULK_UNASSIGN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceIds }),
  });
  if (!res.ok) throw new Error(`Failed to bulk unassign policy: ${res.statusText}`);
  return res.json();
}

export async function archiveResource(resourceId: string): Promise<void> {
  const res = await fetch(`${API.RESOURCES.ARCHIVE(resourceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to archive resource: ${res.statusText}`);
}

export async function unarchiveResource(resourceId: string): Promise<void> {
  const res = await fetch(`${API.RESOURCES.UNARCHIVE(resourceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to unarchive resource: ${res.statusText}`);
}

export async function deleteResource(resourceId: string): Promise<void> {
  const res = await fetch(`${API.RESOURCES.DELETE(resourceId)}`, {
    method: 'DELETE',
    headers: {},
  });
  if (!res.ok) throw new Error(`Failed to delete resource: ${res.statusText}`);
}

export async function triggerBackup(resourceId: string, fullBackup: boolean = false): Promise<{ jobId: string; status: string; resourceId: string }> {
  const res = await fetch(API.JOBS.TRIGGER_BACKUP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceId, fullBackup, priority: 1 }),
  });
  if (!res.ok) throw new Error(`Failed to trigger backup: ${res.statusText}`);
  return res.json();
}

export interface ResourceProgress {
  resource_id: string;
  status: string;
  progress_pct: number;
  data_backed_up: number;
  total_data: number;
  eta_seconds: number | null;
  started_at?: string;
}

export async function getResourceProgress(resourceId: string): Promise<ResourceProgress> {
  const res = await fetch(`${API.BASE_URL}/progress/resource/${resourceId}`, {
    headers: {},
  });
  if (!res.ok) throw new Error(`Failed to get progress: ${res.statusText}`);
  return res.json();
}

export async function getAllProgress(tenantId: string): Promise<ResourceProgress[]> {
  const res = await fetch(`${API.BASE_URL}/progress/resources?tenant_id=${tenantId}`, {
    headers: {},
  });
  if (!res.ok) throw new Error(`Failed to get all progress: ${res.statusText}`);
  const data = await res.json();
  return data.resources || [];
}

export async function triggerBatchBackup(resourceIds: string[]): Promise<{ jobId: string; status: string; resourceId: string }[]> {
  const res = await fetch(API.JOBS.TRIGGER_BULK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceIds, priority: 1 }),
  });
  if (!res.ok) throw new Error(`Failed to trigger batch backup: ${res.statusText}`);
  return res.json();
}

export async function triggerDatasourceBackup(
  tenantId: string,
  serviceType: 'm365' | 'azure',
  fullBackup: boolean = true
): Promise<{ jobId: string; status: string; resourceId: string; resourceCount?: number }[]> {
  const res = await fetch(API.JOBS.TRIGGER_DATASOURCE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, serviceType, fullBackup, priority: 1 }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `Failed to trigger datasource backup: ${res.statusText}`);
  }

  return res.json();
}

export async function triggerDiscovery(
  tenantId: string,
  serviceType?: string,
): Promise<{ discoveryId: string; resourcesFound: number }> {
  // Route by service type — AZURE tenants publish to discovery.azure
  // queue (VMs, SQL DBs, Postgres); M365 tenants publish to
  // discovery.m365 (users, groups, OneDrive, etc.). Sending every tenant
  // through /discover-m365 meant Azure refreshes were a no-op.
  const path = serviceType === 'azure' ? 'discover-azure' : 'discover-m365';
  const res = await fetch(`${API.BASE_URL}/tenants/${tenantId}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    if (await handleStaleTenant(res)) {
      throw new Error(
        'Cached tenant is stale — re-select your tenant and retry',
      );
    }
    throw new Error(`Failed to trigger discovery: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Fire-and-forget: kick off Tier 2 content discovery + bulk backup for a
 * user in one server-side hop. Returns 202 immediately; the actual work
 * (Graph round-trips for Mail/OneDrive/Contacts/Calendar/Chats and the
 * subsequent bulk-backup queueing) runs in the backend's background, so
 * the UI can navigate away the moment this resolves.
 */
export async function backupUserWithDiscovery(
  tenantId: string,
  userResourceId: string,
): Promise<{ accepted: boolean; message: string }> {
  const res = await fetch(
    `${API.BASE_URL}/tenants/${tenantId}/users/${userResourceId}/backup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to queue user backup: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Tier 2 discovery only — kept for callers that just want to materialize
 * child rows without queueing a backup. The Protection page no longer uses
 * this directly; it goes through `backupUserWithDiscovery` so the user
 * doesn't have to wait on a Graph round-trip.
 */
export async function discoverUserContent(
  tenantId: string,
  userResourceId: string,
): Promise<{ contentDiscovered: number; categories: string[]; childResourceIds: string[] }> {
  const res = await fetch(
    `${API.BASE_URL}/tenants/${tenantId}/users/${userResourceId}/discover-content`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to discover user content: ${res.statusText}`);
  }
  return res.json();
}
