/**
 * Recovery Service - Browse and recover items from backups
 */
import { API } from '../config/api';

export interface RecoveryItem {
  id: string;
  snapshotId: string;
  externalId: string;
  itemType: string;
  name: string;
  // Generic
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  preview?: string;
  body?: string;
  bodyContentType?: string;
  folderPath?: string;
  contentSize: number;
  blobPath?: string;
  metadata: Record<string, any>;
  isDeleted: boolean;
  createdAt: string;
  hasAttachments?: boolean;
  attachments?: any[];
  // Email
  bodyPreview?: string;
  // Chat
  sender?: string;
  senderEmail?: string;
  chatTopic?: string;
  channelName?: string;
  mentions?: any[];
  isReply?: boolean;
  // Calendar
  start?: string;
  end?: string;
  timeZone?: string;
  isAllDay?: boolean;
  location?: string;
  organizer?: string;
  attendees?: any[];
  isOnlineMeeting?: boolean;
  recurrence?: any;
  showAs?: string;
}

export interface RecoveryItemListResponse {
  content: RecoveryItem[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}

export interface RecoveryRequest {
  restoreType: 'IN_PLACE' | 'CROSS_USER' | 'EXPORT_ZIP' | 'DOWNLOAD';
  snapshotIds: string[];
  itemIds: string[];
  targetUserId?: string;
  exportFormat?: string;
  workloads?: string[];
  includeAttachments?: boolean;
}

export interface RecoveryResponse {
  jobId: string;
  status: string;
  restoreType: string;
  snapshotCount: number;
  itemCount: number;
}

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const RecoveryService = {
  /**
   * List items in a snapshot for a given content type and folder
   */
  async listItems(
    snapshotId: string,
    folderPath: string,
    contentType: string,
    page = 1,
    size = 50,
    searchQuery?: string
  ): Promise<RecoveryItemListResponse> {
    let url = `${API.SNAPSHOTS.ITEMS(snapshotId)}?page=${page}&size=${size}`;
    if (contentType) url += `&contentType=${contentType}`;
    if (folderPath && folderPath !== 'all') url += `&folderPath=${encodeURIComponent(folderPath)}`;
    if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch items');
    return res.json();
  },

  /**
   * Get item detail/preview
   */
  async getItemDetail(snapshotId: string, itemId: string): Promise<RecoveryItem> {
    const url = API.SNAPSHOTS.ITEM_DETAIL(snapshotId, itemId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch item detail');
    return res.json();
  },

  /**
   * Trigger recovery/restore for selected items
   */
  async triggerRecovery(request: RecoveryRequest): Promise<RecoveryResponse> {
    const url = API.RESTORE.TRIGGER;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to trigger recovery');
    return res.json();
  },

  /**
   * Trigger export/download for selected items
   */
  async triggerExport(request: RecoveryRequest): Promise<RecoveryResponse> {
    const url = API.EXPORT.TRIGGER;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to trigger export');
    return res.json();
  },

  /**
   * Search across all snapshots for a resource
   */
  async search(
    resourceId: string,
    query: string,
    contentType?: string,
    page = 1,
    size = 50
  ): Promise<RecoveryItemListResponse> {
    let url = `${API.SEARCH.SEARCH}?query=${encodeURIComponent(query)}&resourceId=${resourceId}&page=${page}&size=${size}`;
    if (contentType) url += `&contentType=${contentType}`;

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to search');
    return res.json();
  },
};
