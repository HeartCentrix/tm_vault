/**
 * Restore Service - Trigger and manage restore operations
 */
import { API } from '../config/api';

export type RestoreType =
  | 'IN_PLACE'
  | 'CROSS_USER'
  | 'CROSS_RESOURCE'
  | 'EXPORT_PST'
  | 'EXPORT_ZIP'
  | 'DOWNLOAD';

export interface RestoreRequest {
  restoreType: RestoreType;
  snapshotIds?: string[];
  itemIds?: string[];
  // Folder-checkbox scope (e.g. `/Inbox`, `Contacts`). Backend's
  // shared.folder_resolver expands these into item ids against the
  // folder_path index, so the UI doesn't have to materialise the full
  // list. Union with itemIds.
  folderPaths?: string[];
  targetUserId?: string;
  targetResourceId?: string;
  /** For Power Platform restores: target environment to restore the app/flow into.
   *  When omitted, the restore-worker falls back to the source environment from the snapshot. */
  targetEnvironmentId?: string;
  exportFormat?: string;
  targetFolder?: string;
  overwrite?: boolean;
  workloads?: string[];
  entraSections?: string[];
  format?: 'csv' | 'json';
  includeNestedDetail?: boolean;
  recoverMode?: 'selected' | 'directory';
  includeGroupMembership?: boolean;
  includeAuMembership?: boolean;
}

export interface RestoreResponse {
  jobId: string;
  status: string;
  restoreType: string;
  snapshotCount: number;
  itemCount: number;
}

export interface RestoreJobStatus {
  jobId: string;
  status: string;
  progress: number;
  result?: {
    restored_count?: number;
    failed_count?: number;
    exported_count?: number;
    download_url?: string;
  };
}

export interface RestoreJobHistory {
  content: Array<{
    id: string;
    status: string;
    createdAt: string;
    restoreType?: string;
  }>;
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

export const RestoreService = {
  async triggerRestore(request: RestoreRequest): Promise<RestoreResponse> {
    const res = await fetch(API.RESTORE.TRIGGER, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to trigger restore');
    return res.json();
  },

  async triggerMailboxRestore(request: RestoreRequest): Promise<RestoreResponse> {
    const res = await fetch(API.RESTORE.MAILBOX, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to trigger mailbox restore');
    return res.json();
  },

  async triggerOnedriveRestore(request: RestoreRequest): Promise<RestoreResponse> {
    const res = await fetch(API.RESTORE.ONEDRIVE, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to trigger OneDrive restore');
    return res.json();
  },

  async triggerSharepointRestore(request: RestoreRequest): Promise<RestoreResponse> {
    const res = await fetch(API.RESTORE.SHAREPOINT, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to trigger SharePoint restore');
    return res.json();
  },

  async triggerEntraRestore(request: RestoreRequest): Promise<RestoreResponse> {
    const res = await fetch(API.RESTORE.ENTRA_OBJECT, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error('Failed to trigger Entra restore');
    return res.json();
  },

  async getRestoreStatus(jobId: string): Promise<RestoreJobStatus> {
    const res = await fetch(API.RESTORE.STATUS(jobId));
    if (!res.ok) throw new Error('Failed to fetch restore status');
    return res.json();
  },

  async getRestoreHistory(page = 1, size = 20): Promise<RestoreJobHistory> {
    const res = await fetch(`${API.RESTORE.HISTORY}?page=${page}&size=${size}`);
    if (!res.ok) throw new Error('Failed to fetch restore history');
    return res.json();
  },

  async triggerExport(request: RestoreRequest): Promise<RestoreResponse> {
    // Exports use the same restore endpoint with EXPORT_ZIP or EXPORT_PST type
    return this.triggerRestore(request);
  },

  async getExportDownloadUrl(jobId: string): Promise<string> {
    return API.EXPORT.DOWNLOAD(jobId);
  },
};
