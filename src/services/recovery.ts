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
  // True when selection came from a folder checkbox (preserve folder
  // tree in the output ZIP even if expansion is a single file).
  preserveTree?: boolean;
  // Optional folder filter for USER_CONTACT exports. Omit (or empty) to
  // include all contact folders. Backend filters items by parentFolderName.
  contactFolders?: string[];
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

  async triggerChatExport(req: {
    resourceId: string;
    snapshotIds: string[];
    threadPath?: string;
    itemIds: string[];
    exportFormat: 'HTML' | 'JSON' | 'PDF';
    includeAttachments: boolean;
    force?: boolean;
    idempotencyKey?: string;
  }) {
    const headers: Record<string, string> = {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    };
    if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
    const res = await fetch(API.EXPORT.CHAT.TRIGGER, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    if (res.status === 409) throw { status: 409, body: await res.json() };
    if (res.status === 429) throw { status: 429, body: await res.json() };
    if (!res.ok) throw new Error(`Trigger failed: ${res.status}`);
    return (await res.json()) as {
      jobId: string;
      estimatedMessages: number;
      estimatedBytes: number;
      softCapWarning: boolean;
    };
  },

  async estimateChatExport(req: {
    resourceId: string;
    snapshotIds: string[];
    threadPath?: string;
    itemIds: string[];
    exportFormat: 'HTML' | 'JSON' | 'PDF';
    includeAttachments: boolean;
  }) {
    const res = await fetch(API.EXPORT.CHAT.ESTIMATE, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Estimate failed: ${res.status}`);
    return (await res.json()) as {
      messages: number;
      attachmentBytes: number;
      estimatedZipBytes: number;
      layoutMode: 'single_thread' | 'per_message';
      softCapExceeded: boolean;
      hardCapExceeded: boolean;
    };
  },

  subscribeChatExportStatus(jobId: string, cb: {
    onProgress: (p: any) => void;
    onComplete: (c: { url: string; sizeBytes: number; sha256: string }) => void;
    onError:    (e: any) => void;
  }): () => void {
    const url = API.EXPORT.CHAT.STATUS(jobId);
    const token = localStorage.getItem('access_token');
    const es = new EventSource(`${url}?access_token=${token ?? ''}`, { withCredentials: true });
    let fallback: number | null = null;

    es.addEventListener('progress', (e: MessageEvent) => {
      try { cb.onProgress(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    es.addEventListener('complete', (e: MessageEvent) => {
      try { cb.onComplete(JSON.parse(e.data)); } catch { cb.onComplete({ url: '', sizeBytes: 0, sha256: '' }); }
      es.close();
    });
    es.addEventListener('error', async () => {
      es.close();
      fallback = window.setInterval(async () => {
        const r = await fetch(url, { headers: getAuthHeaders() });
        if (!r.ok) return;
        const body = await r.json();
        if (body.status === 'COMPLETED') {
          cb.onComplete(body.download);
          if (fallback) { window.clearInterval(fallback); fallback = null; }
        } else if (body.status === 'FAILED' || body.status === 'CANCELLED') {
          cb.onError(body.error ?? { code: body.status });
          if (fallback) { window.clearInterval(fallback); fallback = null; }
        } else {
          cb.onProgress(body);
        }
      }, 2000);
    });

    return () => {
      es.close();
      if (fallback) { window.clearInterval(fallback); fallback = null; }
    };
  },
};
