// ============================================================
// API Configuration
// Change the value below to switch between dev and prod
// ============================================================

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1';

export const API = {
  // Base URL - change this or set VITE_API_URL in .env
  BASE_URL: API_URL,

  // Auth
  AUTH: {
    LOGIN_URL: `${API_URL}/auth/microsoft/url`,
    DATASOURCE_URL: `${API_URL}/auth/microsoft/datasource/url`,
    AZURE_DATASOURCE_URL: `${API_URL}/auth/azure/datasource/url`,
    POWER_BI_URL: (tenantId: string) => `${API_URL}/auth/power-bi/url?tenantId=${tenantId}`,
    CALLBACK: `${API_URL}/auth/callback`,
    DATASOURCE_CALLBACK: `${API_URL}/auth/microsoft/datasource/callback`,
    AZURE_DATASOURCE_CALLBACK: `${API_URL}/auth/azure/datasource/callback`,
    POWER_BI_CALLBACK: `${API_URL}/auth/power-bi/callback`,
    REFRESH: `${API_URL}/auth/refresh`,
    LOGOUT: `${API_URL}/auth/logout`,
    ME: `${API_URL}/auth/me`,
  },

  // Admin Consent (status only - URL/callback use existing datasource APIs)
  ADMIN_CONSENT: {
    M365_STATUS: `${API_URL}/admin-consent/m365/status`,
    AZURE_STATUS: `${API_URL}/admin-consent/azure/status`,
    POWER_BI_READINESS: (tenantId: string) => `${API_URL}/admin-consent/power-bi/readiness?tenantId=${tenantId}`,
  },

  // Dashboard
  DASHBOARD: {
    OVERVIEW: `${API_URL}/dashboard/overview`,
    STATUS_24H: `${API_URL}/dashboard/status/24hour`,
    STATUS_7D: `${API_URL}/dashboard/status/7day`,
    PROTECTION: `${API_URL}/dashboard/protection/status`,
    BACKUP_SIZE: `${API_URL}/dashboard/backup/size`,
  },

  // Tenants
  TENANTS: {
    LIST: `${API_URL}/tenants`,
    CREATE: `${API_URL}/tenants`,
    INFO: (id: string) => `${API_URL}/tenants/${id}/info`,
    USAGE_REPORT: (id: string) => `${API_URL}/tenants/${id}/usage-report`,
  },

  // Organizations
  ORGANIZATIONS: {
    LIST: `${API_URL}/organizations`,
  },

  // Resources
  RESOURCES: {
    LIST: `${API_URL}/resources`,
    USERS: `${API_URL}/resources/users`,
    SEARCH: `${API_URL}/resources/search`,
    BY_TYPE: `${API_URL}/resources/by-type`,
    ASSIGN_POLICY: (id: string) => `${API_URL}/resources/${id}/assign-policy`,
    UNASSIGN_POLICY: (id: string) => `${API_URL}/resources/${id}/unassign-policy`,
    BULK_ASSIGN: `${API_URL}/resources/bulk-assign-policy`,
    BULK_UNASSIGN: `${API_URL}/resources/bulk-unassign-policy`,
    ARCHIVE: (id: string) => `${API_URL}/resources/${id}/archive`,
    UNARCHIVE: (id: string) => `${API_URL}/resources/${id}/unarchive`,
    DELETE: (id: string) => `${API_URL}/resources/${id}`,
    // Files folder-select v2 — unified download+restore entry for
    // OneDrive / SharePoint / Teams Files / Groups Files. Accepts
    // `folderPaths` so the server resolves descendants via the
    // folder_path index instead of the UI materialising item ids.
    EXPORT_OR_RESTORE: (id: string) => `${API_URL}/resources/${id}/export-or-restore`,
  },

  // Jobs
  JOBS: {
    LIST: `${API_URL}/jobs`,
    CANCEL: (id: string) => `${API_URL}/jobs/${id}/cancel`,
    RETRY: (id: string) => `${API_URL}/jobs/${id}/retry`,
    PROGRESS: (id: string) => `${API_URL}/jobs/${id}/progress`,
    TRIGGER_BACKUP: `${API_URL}/backups/trigger`,
    TRIGGER_BULK: `${API_URL}/backups/trigger-bulk`,
    TRIGGER_DATASOURCE: `${API_URL}/backups/trigger-datasource`,
  },

  // Snapshots
  SNAPSHOTS: {
    LIST: (resourceId: string) => `${API_URL}/resources/${resourceId}/snapshots`,
    CONTENT_SNAPSHOTS: (resourceId: string) => `${API_URL}/resources/${resourceId}/content-snapshots`,
    DETAIL: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}`,
    ITEMS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/items`,
    ITEM_DETAIL: (snapshotId: string, itemId: string) => `${API_URL}/resources/snapshots/${snapshotId}/items/${itemId}`,
    ITEM_ATTACHMENTS: (snapshotId: string, itemId: string) => `${API_URL}/resources/snapshots/${snapshotId}/items/${itemId}/attachments`,
    ITEM_CONTENT_DOWNLOAD: (snapshotId: string, itemId: string) => `${API_URL}/resources/snapshots/${snapshotId}/items/${itemId}/content?download=1`,
    AZURE_DB_EXPORT: (snapshotId: string, itemIds: string[]) =>
      `${API_URL}/resources/snapshots/${snapshotId}/azure-db/export?items=${encodeURIComponent(itemIds.join(','))}`,
    AZURE_DB_EXPORT_BY_TYPE: (snapshotId: string, itemType: string) =>
      `${API_URL}/resources/snapshots/${snapshotId}/azure-db/export?item_type=${encodeURIComponent(itemType)}`,
    FOLDERS: `${API_URL}/resources/snapshots/folders`,
    // Five fixed per-content-type endpoints — replace the dynamic
    // /content-types lookup. Recovery hardcodes its tabs and queries these.
    MAIL: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/mail`,
    ONEDRIVE: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/onedrive`,
    CONTACTS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/contacts`,
    CALENDAR: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/calendar`,
    CHATS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/chats`,
    CHAT_GROUPS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/chats/groups`,
    CONTACT_FOLDERS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/contact-folders`,
    AZURE_DB_TABLE: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/azure-db/table`,
  },

  // Recovery
  RECOVERY: {
    RESOURCES_WITH_BACKUPS: `${API_URL}/resources/with-backups`,
    SEARCH_ITEMS: (resourceId: string) => `${API_URL}/resources/${resourceId}/snapshots/search`,
  },

  // Restore
  RESTORE: {
    TRIGGER: `${API_URL}/jobs/restore`,
    MAILBOX: `${API_URL}/jobs/restore/mailbox`,
    ONEDRIVE: `${API_URL}/jobs/restore/onedrive`,
    SHAREPOINT: `${API_URL}/jobs/restore/sharepoint`,
    ENTRA_OBJECT: `${API_URL}/jobs/restore/entra-object`,
    STATUS: (jobId: string) => `${API_URL}/jobs/restore/${jobId}/status`,
    HISTORY: `${API_URL}/jobs/restore/history`,
  },

  // Export
  EXPORT: {
    TRIGGER: `${API_URL}/jobs/export`,
    STATUS: (jobId: string) => `${API_URL}/jobs/export/${jobId}/status`,
    DOWNLOAD: (jobId: string) => `${API_URL}/jobs/export/${jobId}/download`,
    CHAT: {
      TRIGGER:  `${API_URL}/exports/chat`,
      ESTIMATE: `${API_URL}/exports/chat/estimate`,
      STATUS:   (id: string) => `${API_URL}/exports/chat/${id}`,
      CANCEL:   (id: string) => `${API_URL}/exports/chat/${id}/cancel`,
    },
  },

  // Search (full-text search service on port 8013, proxied via API gateway)
  SEARCH: {
    SEARCH: `${API_URL}/search`,
    SUGGESTIONS: `${API_URL}/search/suggestions`,
    REINDEX: `${API_URL}/search/reindex`,
  },

  // SLA Policies
  POLICIES: {
    LIST: `${API_URL}/policies`,
    CREATE: `${API_URL}/policies`,
    UPDATE: (id: string) => `${API_URL}/policies/${id}`,
    DELETE: (id: string) => `${API_URL}/policies/${id}`,
    EXCLUSIONS: (policyId: string) => `${API_URL}/policies/${policyId}/exclusions`,
    EXCLUSION: (policyId: string, exclusionId: string) =>
      `${API_URL}/policies/${policyId}/exclusions/${exclusionId}`,
  },

  // Resource Groups (Phase 2 — afi.ai-style auto-protection)
  RESOURCE_GROUPS: {
    LIST: `${API_URL}/resource-groups`,
    CREATE: `${API_URL}/resource-groups`,
    GET: (id: string) => `${API_URL}/resource-groups/${id}`,
    UPDATE: (id: string) => `${API_URL}/resource-groups/${id}`,
    DELETE: (id: string) => `${API_URL}/resource-groups/${id}`,
    ATTACH_POLICY: (id: string) => `${API_URL}/resource-groups/${id}/policies`,
    DETACH_POLICY: (id: string, policyId: string) =>
      `${API_URL}/resource-groups/${id}/policies/${policyId}`,
  },

  // Alerts
  ALERTS: {
    LIST: `${API_URL}/alerts`,
    RESOLVE: (id: string) => `${API_URL}/alerts/${id}/resolve`,
  },

  // Access Groups
  ACCESS_GROUPS: {
    LIST: `${API_URL}/access-groups`,
  },

  // Activity
  ACTIVITY: {
    LIST: `${API_URL}/activity`,
  },

  // Audit
  AUDIT: {
    LIST: `${API_URL}/audit/events`,
    DETAILS: (id: string) => `${API_URL}/audit/events/${id}`,
  },

  // Reports
  REPORTS: {
    CONFIG: `${API_URL}/reports/config`,
    HISTORY: `${API_URL}/reports/history`,
    HISTORY_DETAIL: (id: string) => `${API_URL}/reports/history/${id}`,
    SEND: `${API_URL}/reports/generate`,
  },

  // Admin: Storage backend + toggle. These live on the gateway itself at
  // /api/admin/storage/* (no /v1 segment) — derive the base by stripping
  // the trailing /v1 from API_URL so this works with custom deployments.
  ADMIN_STORAGE: (() => {
    const base = API_URL.replace(/\/v1\/?$/, '');
    const root = `${base}/admin/storage`;
    return {
      STATUS: `${root}/status`,
      BACKENDS: `${root}/backends`,
      TOGGLE: `${root}/toggle`,
      EVENTS: `${root}/events`,
      EVENT_DETAIL: (id: string) => `${root}/events/${id}`,
      EVENT_STREAM: (id: string) => `${root}/events/${id}/stream`,
      ABORT: (id: string) => `${root}/toggle/${id}/abort`,
    };
  })(),
};
