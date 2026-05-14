/**
 * Snapshot Service - List and browse backup snapshots
 */
import { API } from '../config/api';

// Five fixed content tabs rendered on Recovery. Hardcoded — no longer derived
// from snapshot contents at runtime.
export type ContentTab = 'mail' | 'onedrive' | 'contacts' | 'calendar' | 'chats';
export const CONTENT_TABS: ContentTab[] = ['mail', 'onedrive', 'contacts', 'calendar', 'chats'];
export const CONTENT_TAB_LABELS: Record<ContentTab, string> = {
  mail: 'Mail',
  onedrive: 'OneDrive',
  contacts: 'Contacts',
  calendar: 'Calendar',
  chats: 'Chats',
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
    };
    const base = contentType ? endpoint[contentType] : API.SNAPSHOTS.MAIL(snapshotId);
    let url = `${base}?page=${page}&size=${size}`;
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

  /**
   * Fetch all calendar events for a snapshot (reads from blob storage).
   */
  async listCalendarEvents(snapshotId: string, page = 1, size = 500): Promise<CalendarEventListResponse> {
    const url = `${API.SNAPSHOTS.CALENDAR(snapshotId)}?page=${page}&size=${size}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch calendar events');
    return res.json();
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
