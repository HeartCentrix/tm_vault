/**
 * Snapshot Service - List and browse backup snapshots
 */
import { API } from '../config/api';

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

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const SnapshotService = {
  async listByResource(resourceId: string, page = 1, size = 20): Promise<SnapshotListResponse> {
    const url = API.SNAPSHOTS.LIST(resourceId);
    const res = await fetch(`${url}?page=${page}&size=${size}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch snapshots');
    return res.json();
  },

  async getSnapshotDetail(snapshotId: string): Promise<SnapshotItem> {
    const url = API.SNAPSHOTS.DETAIL(snapshotId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot detail');
    return res.json();
  },

  async listItems(snapshotId: string, page = 1, size = 50, itemType?: string): Promise<SnapshotItemListResponse> {
    // Route to content-specific endpoint for richer fields
    const contentEndpoint: Record<string, string> = {
      EMAIL: API.SNAPSHOTS.EMAILS(snapshotId),
      TEAMS_CHAT_MESSAGE: API.SNAPSHOTS.MESSAGES(snapshotId),
      TEAMS_MESSAGE: API.SNAPSHOTS.MESSAGES(snapshotId),
      TEAMS_MESSAGE_REPLY: API.SNAPSHOTS.MESSAGES(snapshotId),
      CALENDAR_EVENT: API.SNAPSHOTS.CALENDAR(snapshotId),
    };
    const isContentSpecific = !!(itemType && contentEndpoint[itemType]);
    const base = isContentSpecific ? contentEndpoint[itemType!] : API.SNAPSHOTS.ITEMS(snapshotId);
    const url = `${base}?page=${page}&size=${size}${itemType && !isContentSpecific ? `&itemType=${itemType}` : ''}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot items');
    const data = await res.json();

    // For content-specific endpoints, ensure metadata.raw is populated
    // so preview components (EmailPreview, ChatPreview, CalendarPreview) work
    if (isContentSpecific && data.content) {
      data.content = data.content.map((item: any) => ({
        ...item,
        metadata: item.metadata && Object.keys(item.metadata).length > 0
          ? item.metadata
          : { raw: item },  // inject flat fields as raw so previews can read them
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
  async getFolders(snapshotId: string, itemType?: string): Promise<SnapshotFolder[]> {
    let url = `${API.SNAPSHOTS.FOLDERS}?snapshot_id=${snapshotId}`;
    if (itemType) url += `&item_type=${itemType}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch folders');
    return res.json();
  },

  /**
   * Get distinct content types available in a snapshot.
   */
  async getContentTypes(snapshotId: string): Promise<string[]> {
    const url = API.SNAPSHOTS.CONTENT_TYPES(snapshotId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch content types');
    const data = await res.json();
    return data.contentTypes || [];
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
