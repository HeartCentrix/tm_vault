/**
 * Snapshot Service - List and browse backup snapshots
 */
import { API } from '../config/api';

// Five fixed content tabs rendered on Recovery. Hardcoded — no longer derived
// from snapshot contents at runtime.
// 'archive' is NOT a top-level tab — the Online Archive shows as a folder
// inside the Mail/Contacts tabs. It stays in the type/labels/byContent because
// content-snapshots + exportFormats key on it.
export type ContentTab = 'mail' | 'onedrive' | 'contacts' | 'calendar' | 'chats' | 'archive';
export const CONTENT_TABS: ContentTab[] = ['mail', 'onedrive', 'contacts', 'calendar', 'chats'];
export const CONTENT_TAB_LABELS: Record<ContentTab, string> = {
  mail: 'Mail',
  onedrive: 'OneDrive',
  contacts: 'Contacts',
  calendar: 'Calendar',
  chats: 'Chats',
  archive: 'Online Archive',
};

export interface SnapshotItem {
  id: string;
  resourceId: string;
  createdAt: string;
  size: number;
  status: string;
  type: string;
  itemCount: number;
  label?: string;
  durationSecs?: number;
  jobId?: string;
  // `batch_id` from the parent Job's spec — shared across the
  // Tier-1 + Tier-2-urgent + Tier-2-heavy Jobs of one bulk click.
  // Recovery toolbar buckets the version dropdown by this so a single
  // "Backup now" click collapses to one entry even when it fans out
  // into multiple resource snapshots (mail / chats / OneDrive).
  batchId?: string;
}

/**
 * Backend-computed "actually-used storage" rollup for a resource +
 * its child subtree. Replaces client-side bytes_total summing which
 * double-counted unchanged items across incremental snapshots.
 */
export interface StorageSummary {
  resourceId: string;
  subtreeSize: number;
  totalBytes: number;
  deltas: { week: number; month: number; year: number };
  dailySeries: Array<{
    date: string;
    bytesAdded: number | null;
    isFuture: boolean;
  }>;
}

export interface SnapshotItemDetail {
  id: string;
  snapshotId: string;
  externalId: string;
  itemType: string;
  name: string;
  folderPath?: string;
  contentSize: number;
  metadata: Record<string, any>;
  isDeleted: boolean;
  createdAt: string;
  blobPath?: string;
}

export interface SnapshotListResponse {
  content: SnapshotItem[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}

export interface SnapshotItemListResponse {
  content: SnapshotItemDetail[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}

export interface CalendarEvent {
  id: string;
  snapshotId: string;
  externalId: string;
  subject: string;
  name: string;
  start: string | null;
  end: string | null;
  timeZone: string;
  isAllDay: boolean;
  isCancelled: boolean;
  location: string;
  organizer: string | null;
  organizerEmail: string;
  attendees: any[];
  body: string;
  bodyContentType: string;
  isOnlineMeeting: boolean;
  recurrence: any;
  recurrenceType: string | null;
  graphType: string;
  showAs: string;
  importance: string;
  sensitivity: string;
  categories: string[];
  eventType: string;
  folderPath: string;
  date: string;
  metadata: { raw: any };
}

export interface CalendarEventListResponse {
  content: CalendarEvent[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

/** A resource that has at least one completed backup */
export interface ResourceWithBackups {
  id: string;
  tenant_id: string;
  kind: string;
  provider: string;
  external_id: string;
  name: string;
  email?: string;
  data: Record<string, any>;
  storage_bytes: number;
  last_backup_at?: string;
  last_backup_status?: string;
  snapshot_count: number;
  total_items: number;
}

export interface ResourceWithBackupsListResponse {
  item_number: number;
  page_number: number;
  next_page_token: string | null;
  items: ResourceWithBackups[];
}

/** Folder path with item count */
export interface SnapshotFolder {
  path: string;
  count: number;
}

/** Per-content latest-snapshot resolver. Backend computes the latest
 *  COMPLETED snapshot for each content tab (resolves through Tier 2
 *  children automatically) so Recovery doesn't need to surface a snapshot
 *  picker to the user. */
export interface ContentSnapshotEntry {
  snapshotId: string;
  childResourceId: string;
  itemCount: number;
  bytesTotal: number;
  createdAt: string | null;
}
export interface ContentSnapshotsResponse {
  resourceId: string;
  snapshotCount: number;
  /** Distinct backup attempts ("versions" / recovery points) across this
   *  identity's parent + Tier-2 child subtree. One "Backup now" click
   *  fans out to ~5 surface snapshots but is a single recovery point —
   *  this is the number the Recovery header surfaces to the user. */
  versionCount?: number;
  byContent: Record<ContentTab, ContentSnapshotEntry | null>;
}

// Auth rides on the HttpOnly cookie set at login; fetch() picks it up via
// the credentials: 'include' default in main.tsx. This shim is kept to
// avoid touching every call-site below — it just adds Content-Type when
// callers spread it.
const getAuthHeaders = (): Record<string, string> => ({});

/** Max cached full-calendar walks (see listAllCalendarEventsCached). Two =
 *  the account being viewed plus the one before it, which is what a
 *  Calendar → Mail → Calendar / A → B → A round trip needs. Each entry can
 *  hold 35k events with their inline Graph payloads, so this stays small on
 *  purpose. */
export const CALENDAR_EVENT_CACHE_MAX = 2;

/** Per-session cache of completed calendar walks, keyed by snapshotId.
 *  Insertion-ordered (Map) so the oldest entry is evicted first. */
const calendarEventCache = new Map<
  string, { events: CalendarEvent[]; total: number; truncated: boolean }
>();

/** Drop every cached calendar walk. Exported for the regression scripts —
 *  nothing in the app needs it, because a new backup produces a new
 *  snapshot id and therefore a natural cache miss. */
export function clearCalendarEventCache(): void {
  calendarEventCache.clear();
}

/**
 * Hard ceiling on how many item ids the UI will ever enumerate into one
 * export/restore POST body.
 *
 * The SPA's own nginx (frontend pod, nginx.conf) declares no
 * `client_max_body_size`, so nginx's 1 MiB default applies — and every
 * /api request is proxied through that pod (`location /api/` →
 * api-gateway). A JSON id costs ~39 bytes ('"<uuid>",'), so the heaviest
 * pilot account's 35,026 calendar events came to ~1.30 MiB and the
 * frontend pod answered 413 before job-service ever saw the request.
 * 12,000 ids ≈ 468 KB — under half the limit even with every other field
 * present. Raising this means raising the proxy limit first.
 */
export const MAX_ENUMERATED_ITEM_IDS = 12000;

/** The ambiguous folderPath /calendar emits when `folder_path` is NULL on
 *  the row (`i.folder_path or "Calendar"` in list_snapshot_calendar). The
 *  ENTRA_USER backup path writes CALENDAR_EVENT rows with no folder_path
 *  at all, and shared.folder_resolver matches `folder_path IN ('Calendar')`
 *  / LIKE 'Calendar/%' — neither matches NULL. A folder scope built on this
 *  value would silently omit those events from an export, so it is treated
 *  as un-scopable. */
const AMBIGUOUS_CALENDAR_PATH = 'Calendar';

export interface CalendarSelectionScope {
  /** Explicit ids to send. Empty when a folder scope is used instead. */
  itemIds: string[];
  /** Server-resolved scope (shared.folder_resolver, sibling-snapshot
   *  aware). Empty when ids are sent instead. */
  folderPaths: string[];
  /** Real size of the selection regardless of how it is expressed — the
   *  toolbar/modal labels read this. */
  count: number;
  /** Set when the selection can be expressed neither way. The caller must
   *  surface it and NOT submit: an approximation would either export
   *  events the filter excluded (over-restore) or silently drop some. */
  error?: string;
}

/**
 * Decide how to express a Calendar-tab Download / Recover selection so the
 * request body stays inside the proxy's 1 MiB limit without ever changing
 * WHICH events are in scope.
 *
 *   1. ids fit the budget            → send the exact ids (unchanged path)
 *   2. over budget, no type filter   → send the calendars the selection
 *                                      covers as `folderPaths`; the backend
 *                                      resolves the same rows itself
 *   3. anything else                 → refuse, loudly
 *
 * Case 3 exists because the Event Type labels ("Recurring", "Meeting", …)
 * are derived in snapshot-service from raw Graph fields and have no
 * server-side equivalent, so a type-filtered subset can only travel as
 * ids. Sending folderPaths anyway would widen the scope past what the grid
 * shows; truncating the ids would silently export the wrong set.
 */
export function calendarSelectionScope(
  events: { id: string; folderPath?: string | null }[],
  opts: { typeFiltered: boolean; maxItemIds?: number },
): CalendarSelectionScope {
  const max = opts.maxItemIds ?? MAX_ENUMERATED_ITEM_IDS;
  const count = events.length;
  const empty = { itemIds: [] as string[], folderPaths: [] as string[], count };

  if (count <= max) {
    return { itemIds: events.map(e => e.id), folderPaths: [], count };
  }
  if (opts.typeFiltered) {
    return {
      ...empty,
      error: `${count.toLocaleString()} events is too many to send in one `
        + `request. Narrow the sidebar selection to `
        + `${max.toLocaleString()} events or fewer — tick a single calendar, `
        + `or fewer event types.`,
    };
  }
  const paths = Array.from(new Set(events.map(e => e.folderPath || '')));
  const unscopable = paths.filter(
    p => p === '' || p === AMBIGUOUS_CALENDAR_PATH,
  );
  if (paths.length === 0 || unscopable.length > 0) {
    return {
      ...empty,
      error: `${count.toLocaleString()} events can't be sent in one request, `
        + `and some of them aren't filed under a named calendar so the `
        + `whole-calendar scope can't be used safely either. Narrow the `
        + `sidebar selection to ${max.toLocaleString()} events or fewer.`,
    };
  }
  return { itemIds: [], folderPaths: paths, count };
}

export const SnapshotService = {
  /** Backend-computed "actually-used storage" rollup for the protection
   *  tab. The headline + 1w/1m/1y deltas + 7-day sparkline all come from
   *  one call so the FE never re-sums snapshot bytes locally (which had
   *  double-counted incremental fan-out). */
  async getStorageSummary(resourceId: string): Promise<StorageSummary> {
    const url = API.SNAPSHOTS.STORAGE_SUMMARY(resourceId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch storage summary');
    return res.json();
  },

  async listByResource(resourceId: string, page = 1, size = 20, includeChildren = false): Promise<SnapshotListResponse> {
    const url = API.SNAPSHOTS.LIST(resourceId);
    // `includeChildren` rolls in snapshots from Tier 2 child resources
    // (USER_MAIL/USER_ONEDRIVE/... under an ENTRA_USER parent). Needed
    // so the Recovery sparkline charts actual content bytes instead of
    // just the parent's metadata row.
    const suffix = includeChildren ? '&include_children=true' : '';
    const res = await fetch(`${url}?page=${page}&size=${size}${suffix}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch snapshots');
    return res.json();
  },

  async getChatGroups(snapshotId: string): Promise<Array<{ chatId: string; displayName: string; count: number; lastMessageAt: string | null }>> {
    const url = API.SNAPSHOTS.CHAT_GROUPS(snapshotId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch chat groups');
    return res.json();
  },

  /** Distinct contact folder names present in a snapshot. Sorted with
   *  well-known folders (Contacts, Recipient Cache, Deleted Items,
   *  Recoverable Items) first, then custom folders alphabetically.
   *  Powers the folder-grain checkbox subgroup in DownloadModal. */
  async listContactFolders(snapshotId: string): Promise<string[]> {
    const url = API.SNAPSHOTS.CONTACT_FOLDERS(snapshotId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch contact folders');
    const data = await res.json();
    return Array.isArray(data?.folders) ? data.folders : [];
  },

  async getItemAttachments(snapshotId: string, itemId: string): Promise<Array<{
    id: string;
    name: string;
    size: number;
    kind: string | null;
    contentType: string | null;
    isInline: boolean;
    // MIME Content-ID the email body references via <img src="cid:...">.
    // EmailPreview rewrites those cid: URLs to real content-endpoint URLs
    // before rendering. Populated by the backend at services/snapshot-
    // service/main.py:2102.
    contentId: string | null;
    resolved: boolean;
    sourceUrl: string | null;
  }>> {
    const url = API.SNAPSHOTS.ITEM_ATTACHMENTS(snapshotId, itemId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch attachments: ${res.statusText}`);
    return res.json();
  },

  /** Return EVERY item in a snapshot as a uniform file-row shape. Used by
   *  the Recovery page for resource kinds outside the five fixed tabs
   *  (Power BI workspaces today; SharePoint sites, Azure workloads, etc.
   *  can share the same render path). No item_type filter — whatever was
   *  backed up shows up. */
  async listSnapshotFiles(snapshotId: string, page = 1, size = 200, search?: string): Promise<SnapshotItemListResponse> {
    let url = `${API.SNAPSHOTS.DETAIL(snapshotId)}/files?page=${page}&size=${size}`;
    if (search && search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot files');
    const data = await res.json();
    if (data.content) {
      data.content = data.content.map((item: any) => ({
        ...item,
        metadata: item.metadata && Object.keys(item.metadata).length > 0
          ? item.metadata
          : { raw: item },
      }));
    }
    return data;
  },

  /** @deprecated Use the Files folder-select v2 flow (see
   *  `useFolderSelection` hook + `RecoveryService.exportOrRestore`).
   *  The new flow sends `folderPaths` in the payload so the server
   *  resolves descendants server-side instead of materialising
   *  potentially-huge id lists in the browser. Kept for back-compat
   *  with the legacy OneDrive branch until FILES_FOLDER_SELECT_V2
   *  reaches GA. */
  async getOneDriveIdsByPrefix(snapshotId: string, folderPrefix: string): Promise<string[]> {
    const url = `${API.SNAPSHOTS.ONEDRIVE(snapshotId)}/ids?folder_prefix=${encodeURIComponent(folderPrefix)}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch folder file ids');
    const data = await res.json();
    return Array.isArray(data.ids) ? data.ids : [];
  },

  /** Live Graph lookup for subsites of a SharePoint site resource. Used by
   *  the Recovery page's Subsites panel. Returns whatever the tenant has
   *  now — not a snapshot-frozen view. */
  async listSharePointSubsites(resourceId: string): Promise<{ resourceId: string; subsites: any[]; count: number }> {
    const url = `${API.RESOURCES.LIST}/${resourceId}/subsites`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch subsites');
    return res.json();
  },

  async getContentSnapshots(resourceId: string): Promise<ContentSnapshotsResponse> {
    const url = API.SNAPSHOTS.CONTENT_SNAPSHOTS(resourceId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch content snapshots');
    return res.json();
  },

  async getSnapshotDetail(snapshotId: string): Promise<SnapshotItem> {
    const url = API.SNAPSHOTS.DETAIL(snapshotId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot detail');
    return res.json();
  },

  async listItems(snapshotId: string, page = 1, size = 50, contentType?: ContentTab, group?: string, search?: string, sort?: string): Promise<SnapshotItemListResponse> {
    // Recovery passes one of the 5 fixed tabs (mail/onedrive/contacts/
    // calendar/chats). Each maps to its own backend endpoint — no more
    // /items?itemType=X fallback, no /content-types lookup.
    //
    // `group` narrows to a single grouping bucket from the left panel:
    //   mail / onedrive / contacts → folder path
    //   chats                       → chatId (uses ?chatId= per the messages handler)
    const endpoint: Record<ContentTab, string> = {
      mail: API.SNAPSHOTS.MAIL(snapshotId),
      onedrive: API.SNAPSHOTS.ONEDRIVE(snapshotId),
      contacts: API.SNAPSHOTS.CONTACTS(snapshotId),
      calendar: API.SNAPSHOTS.CALENDAR(snapshotId),
      chats: API.SNAPSHOTS.CHATS(snapshotId),
      archive: API.SNAPSHOTS.ARCHIVE(snapshotId),
    };
    const base = contentType ? endpoint[contentType] : API.SNAPSHOTS.MAIL(snapshotId);
    let url = `${base}?page=${page}&size=${size}`;
    if (!contentType || contentType === 'mail') {
      // List rows render only subject/from/date/bodyPreview — full HTML
      // bodies made a 50-row page ~471KB (vs ~45KB slim) and dominated
      // tab-in latency. EmailPreview lazy-fetches the selected email's
      // body via getItemDetail (see its needsBody effect).
      url += '&bodies=none';
    }
    if (group !== undefined && group !== '' && group !== 'all') {
      // Uniform `folder` filter across all tabs — chats now also have
      // folder_path set ("chats/<friendly name>") by the backup handler.
      url += `&folder=${encodeURIComponent(group)}`;
    }
    if (search && search.trim()) {
      url += `&search=${encodeURIComponent(search.trim())}`;
    }
    if (sort) {
      url += `&sort=${encodeURIComponent(sort)}`;
    }
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot items');
    const data = await res.json();

    // Preview components (EmailPreview, ChatPreview, CalendarPreview, etc.)
    // expect metadata.raw — inject the flat row as raw when the backend hasn't
    // already nested one inside metadata.
    if (data.content) {
      data.content = data.content.map((item: any) => ({
        ...item,
        metadata: item.metadata && Object.keys(item.metadata).length > 0
          ? item.metadata
          : { raw: item },
      }));
    }
    return data;
  },

  // Online Archive items for a content tab's archive folder. Hits the archive
  // child's OWN snapshot with a category filter (mail/contacts/calendar). Same
  // response shape + metadata.raw fallback as listItems.
  async listArchive(archiveSnapshotId: string, category: ContentTab, page = 1, size = 50, search?: string, folder?: string): Promise<SnapshotItemListResponse> {
    // Served via the gateway-allowed /mail path with source=archive — the
    // api-gateway does not forward a dedicated /archive path.
    let url = `${API.SNAPSHOTS.MAIL(archiveSnapshotId)}?page=${page}&size=${size}&source=archive&category=${encodeURIComponent(category)}`;
    if (search && search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
    // folder scopes to one archive folder (full nested path e.g. "Archive/2024").
    if (folder) url += `&folder=${encodeURIComponent(folder)}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch archive items');
    const data = await res.json();
    if (data.content) {
      data.content = data.content.map((item: any) => ({
        ...item,
        metadata: item.metadata && Object.keys(item.metadata).length > 0 ? item.metadata : { raw: item },
      }));
    }
    return data;
  },

  async getItemDetail(snapshotId: string, itemId: string): Promise<SnapshotItemDetail> {
    const url = API.SNAPSHOTS.ITEM_DETAIL(snapshotId, itemId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot item detail');
    return res.json();
  },

  async getItemContent(snapshotId: string, itemId: string): Promise<{ source: string; content: any }> {
    const url = `${API.SNAPSHOTS.ITEM_DETAIL(snapshotId, itemId)}/content`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch item content');
    return res.json();
  },

  /**
   * List all resources for a tenant that have at least one completed snapshot.
   */
  async listResourcesWithBackups(tenantId: string, page = 1, size = 50): Promise<ResourceWithBackupsListResponse> {
    const url = API.RECOVERY.RESOURCES_WITH_BACKUPS;
    const res = await fetch(`${url}?tenantId=${tenantId}&page=${page}&size=${size}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch resources with backups');
    return res.json();
  },

  /**
   * Get distinct folder paths for items in a snapshot, optionally filtered by item type.
   */
  async getAzureDbTable(
    snapshotId: string,
    itemId: string,
    opts: { page?: number; size?: number; op?: string; val?: string } = {},
  ): Promise<{ columns: string[]; rows: any[]; total: number; page: number; size: number; hasMore: boolean; firstColumn: string | null }> {
    const params = new URLSearchParams();
    params.set('item_id', itemId);
    params.set('page', String(opts.page ?? 1));
    params.set('size', String(opts.size ?? 50));
    if (opts.op) params.set('search_op', opts.op);
    if (opts.val !== undefined) params.set('search_val', opts.val);
    const url = `${API.SNAPSHOTS.AZURE_DB_TABLE(snapshotId)}?${params}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to load table rows');
    return res.json();
  },

  async getFolders(
    snapshotId: string,
    itemType?: string,
    page: number = 1,
    size: number = 50,
  ): Promise<{ content: SnapshotFolder[]; total: number; page: number; size: number; hasMore: boolean }> {
    let url = `${API.SNAPSHOTS.FOLDERS}?snapshot_id=${snapshotId}&page=${page}&size=${size}`;
    if (itemType) url += `&item_type=${itemType}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch folders');
    const data = await res.json();
    // Tolerate servers still returning a plain array (older snapshot-service builds).
    if (Array.isArray(data)) {
      return { content: data, total: data.length, page: 1, size: data.length, hasMore: false };
    }
    return data;
  },

  // Archive folders + counts for ONE kind (mail|contacts|calendar). Archive
  // folders are shared across kinds, so a kind-agnostic count would show the
  // mail total on the Contacts tab — category makes the count match the items.
  async getArchiveFolders(
    archiveSnapshotId: string,
    category: ContentTab,
  ): Promise<{ content: SnapshotFolder[]; total: number; page: number; size: number; hasMore: boolean }> {
    const url = `${API.SNAPSHOTS.FOLDERS}?snapshot_id=${archiveSnapshotId}&item_type=ARCHIVE_ITEM&category=${encodeURIComponent(category)}&size=500`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch archive folders');
    const data = await res.json();
    if (Array.isArray(data)) return { content: data, total: data.length, page: 1, size: data.length, hasMore: false };
    return data;
  },

  /**
   * Fetch ONE page of calendar events for a snapshot (reads from blob storage).
   */
  async listCalendarEvents(snapshotId: string, page = 1, size = 500, signal?: AbortSignal): Promise<CalendarEventListResponse> {
    const url = `${API.SNAPSHOTS.CALENDAR(snapshotId)}?page=${page}&size=${size}`;
    const res = await fetch(url, { headers: getAuthHeaders(), signal });
    if (!res.ok) throw new Error('Failed to fetch calendar events');
    return res.json();
  },

  /**
   * Walk EVERY page of /calendar for a snapshot.
   *
   * The month grid, the type/calendar filter sidebar and the
   * filtered-id set Download scopes off are all derived from one array,
   * so a partial load isn't a partial view — it's silently missing
   * events. /calendar dedups then paginates ordered by created_at DESC,
   * so the old single `listCalendarEvents(id, 1, 1000)` call kept only
   * the 1,000 most-recently-CAPTURED rows; accounts here hold 5,112 /
   * 7,953 / 35,026 events.
   *
   * Bounded by `maxPages` (100 × 1,000 = 100k events) so a runaway
   * totalPages can't spin forever, and `truncated` is set whenever
   * fewer than `total` events were loaded — callers must never present
   * a bounded load as the complete calendar. Pages after the first are
   * fetched `concurrency`-at-a-time (35k events = 36 round trips) and
   * reassembled in page order so capture order is preserved.
   *
   * Rejects on the first failed page and on abort rather than resolving
   * with a partial set: a caller that switched accounts mid-walk must
   * not be handed events that look complete. The first failure also
   * aborts the remaining workers — each page is a COUNT(DISTINCT …) plus
   * a DISTINCT ON dedup over the 22M-row snapshot_items table on a
   * single-replica 500m-CPU pod, and a walk whose result has already been
   * thrown away must not keep paying for 30 more of them behind an
   * on-screen "Could not load events".
   */
  async listAllCalendarEvents(
    snapshotId: string,
    opts: {
      pageSize?: number;
      maxPages?: number;
      concurrency?: number;
      signal?: AbortSignal;
      onProgress?: (loaded: number, total: number) => void;
      /** Fired once, with page 1, as soon as it lands — before the
       *  remaining pages are walked. Lets the caller paint a real (if
       *  partial) month immediately instead of holding a blank grid for
       *  the whole walk: 2026-08-11, page 1 of the 5,418-event pilot
       *  calendar answers in ~1.3 s while the full six-page walk takes
       *  ~3–4 s (QA TMV-023). The resolved value still carries the
       *  COMPLETE, deduped set and must replace whatever this emitted —
       *  page 1 is 1,000 of 5,418 events and is never the answer. */
      onFirstPage?: (events: CalendarEvent[], total: number) => void;
    } = {},
  ): Promise<{ events: CalendarEvent[]; total: number; truncated: boolean }> {
    const pageSize = opts.pageSize ?? 1000;
    const maxPages = opts.maxPages ?? 100;
    const concurrency = opts.concurrency ?? 4;
    const { signal, onProgress, onFirstPage } = opts;

    // Internal controller: cancels the in-flight siblings the moment any
    // page fails. Chained to the caller's signal so an unmount still
    // aborts everything.
    const walk = new AbortController();
    const relayAbort = () => walk.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) relayAbort();
      else signal.addEventListener('abort', relayAbort);
    }
    // The first REAL error, kept so the rejection isn't replaced by the
    // AbortError the internal cancel raises in the sibling workers — the
    // caller swallows AbortError as teardown, which would leave a failed
    // load with no message on screen.
    let failure: unknown = null;
    const fail = (err: unknown) => {
      if (failure === null) failure = err;
      walk.abort();
    };

    try {
      const first = await SnapshotService.listCalendarEvents(snapshotId, 1, pageSize, walk.signal);
      const total = first.totalElements ?? (first.content || []).length;
      const pages = Math.min(Math.max(1, first.totalPages || 1), maxPages);
      // Indexed by page-1 so out-of-order completions still flatten in
      // created_at DESC order.
      const buckets: CalendarEvent[][] = [first.content || []];
      let loaded = buckets[0].length;
      onProgress?.(loaded, total);
      // Paint-now hook. Guarded so a throwing consumer can't take down
      // the walk it is only observing.
      if (onFirstPage) {
        try { onFirstPage(buckets[0], total); } catch { /* observer only */ }
      }

      let nextPage = 2;
      const worker = async () => {
        for (;;) {
          walk.signal.throwIfAborted();
          const page = nextPage++;
          // `pages` is the only loop bound — an empty page mid-walk does NOT
          // stop it. totalPages over-reporting is a snapshot-changed-under-us
          // anomaly, and later pages may still hold real events; skipping them
          // would drop recoverable data to save a round trip.
          if (page > pages) return;
          try {
            const data = await SnapshotService.listCalendarEvents(snapshotId, page, pageSize, walk.signal);
            const batch = data.content || [];
            buckets[page - 1] = batch;
            loaded += batch.length;
            onProgress?.(loaded, total);
          } catch (err) {
            fail(err);
            throw err;
          }
        }
      };
      walk.signal.throwIfAborted();
      try {
        await Promise.all(
          Array.from({ length: Math.min(concurrency, Math.max(0, pages - 1)) }, worker),
        );
      } catch (err) {
        throw failure ?? err;
      }

      // Dedupe by id before reporting. Each page is an independent
      // LIMIT/OFFSET over the sibling snapshots ordered by si.created_at
      // DESC, so a CALENDAR_EVENT insert during the walk shifts that
      // ordering and one row can be served on two pages while another is
      // skipped. Duplicates would otherwise reach the month grid's React
      // keys and the Download id set, AND pad the count up to `total` so
      // `truncated` read false while events were genuinely missing.
      const seen = new Set<string>();
      const events: CalendarEvent[] = [];
      for (const ev of buckets.flat()) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        events.push(ev);
      }
      return { events, total, truncated: events.length < total };
    } catch (err) {
      fail(err);
      throw failure ?? err;
    } finally {
      signal?.removeEventListener('abort', relayAbort);
    }
  },

  /**
   * Session-cached wrapper around `listAllCalendarEvents`.
   *
   * CalendarMonthView unmounts on every tab switch, so Calendar → Mail →
   * Calendar used to re-walk all 36 pages of the heaviest account against
   * snapshot-service. Same per-session SWR shape as `itemsCacheRef` /
   * `foldersCacheRef` on Recovery, keyed strictly by snapshotId — a new
   * Gold batch resolves to a NEW snapshot id, so a fresh backup misses
   * naturally and there is nothing to revalidate: the event set behind a
   * given snapshot id (that snapshot plus its older siblings) is fixed.
   * Deliberately no background revalidate — revalidating would re-pay the
   * exact 36-request cost this cache exists to remove.
   *
   * Only successful walks are cached; a failed or aborted walk must be
   * retryable.
   */
  async listAllCalendarEventsCached(
    snapshotId: string,
    opts: {
      pageSize?: number;
      maxPages?: number;
      concurrency?: number;
      signal?: AbortSignal;
      onProgress?: (loaded: number, total: number) => void;
      onFirstPage?: (events: CalendarEvent[], total: number) => void;
    } = {},
  ): Promise<{ events: CalendarEvent[]; total: number; truncated: boolean }> {
    const hit = calendarEventCache.get(snapshotId);
    if (hit) {
      opts.onProgress?.(hit.events.length, hit.total);
      return hit;
    }
    const result = await SnapshotService.listAllCalendarEvents(snapshotId, opts);
    // Bounded: one entry is up to 35k events with their full Graph
    // payloads inline (`body` + `metadata.raw`), so this is real browser
    // memory — keep the current account plus the previous one, no more.
    calendarEventCache.set(snapshotId, result);
    while (calendarEventCache.size > CALENDAR_EVENT_CACHE_MAX) {
      const oldest = calendarEventCache.keys().next().value;
      if (oldest === undefined) break;
      calendarEventCache.delete(oldest);
    }
    return result;
  },

  /**
   * Search snapshot items for a resource with optional filters.
   */
  async searchItems(
    resourceId: string,
    params: {
      query?: string;
      itemType?: string;
      folderPath?: string;
      snapshotId?: string;
      page?: number;
      size?: number;
    }
  ): Promise<SnapshotItemListResponse> {
    let url = `${API.RECOVERY.SEARCH_ITEMS(resourceId)}?`;
    const qp = new URLSearchParams();
    if (params.query) qp.set('query', params.query);
    if (params.itemType) qp.set('item_type', params.itemType);
    if (params.folderPath) qp.set('folder_path', params.folderPath);
    if (params.snapshotId) qp.set('snapshot_id', params.snapshotId);
    if (params.page) qp.set('page', String(params.page));
    if (params.size) qp.set('size', String(params.size));
    const queryStr = qp.toString();
    if (queryStr) url += queryStr;

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to search snapshot items');
    return res.json();
  },
};
