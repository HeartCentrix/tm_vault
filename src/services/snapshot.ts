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
    let url = API.SNAPSHOTS.ITEMS(snapshotId);
    url += `?page=${page}&size=${size}`;
    if (itemType) url += `&itemType=${itemType}`;

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot items');
    return res.json();
  },

  async getItemDetail(snapshotId: string, itemId: string): Promise<SnapshotItemDetail> {
    const url = API.SNAPSHOTS.ITEM_DETAIL(snapshotId, itemId);
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch snapshot item detail');
    return res.json();
  },
};
