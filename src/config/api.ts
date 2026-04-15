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
    CALLBACK: `${API_URL}/auth/callback`,
    DATASOURCE_CALLBACK: `${API_URL}/auth/microsoft/datasource/callback`,
    AZURE_DATASOURCE_CALLBACK: `${API_URL}/auth/azure/datasource/callback`,
    REFRESH: `${API_URL}/auth/refresh`,
    LOGOUT: `${API_URL}/auth/logout`,
    ME: `${API_URL}/auth/me`,
  },

  // Admin Consent (status only - URL/callback use existing datasource APIs)
  ADMIN_CONSENT: {
    M365_STATUS: `${API_URL}/admin-consent/m365/status`,
    AZURE_STATUS: `${API_URL}/admin-consent/azure/status`,
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
    DETAIL: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}`,
    ITEMS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/items`,
    ITEM_DETAIL: (snapshotId: string, itemId: string) => `${API_URL}/resources/snapshots/${snapshotId}/items/${itemId}`,
    FOLDERS: `${API_URL}/resources/snapshots/folders`,
    CONTENT_TYPES: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/content-types`,
    EMAILS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/emails`,
    MESSAGES: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/messages`,
    CALENDAR: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/calendar`,
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
    DELETE: (id: string) => `${API_URL}/policies/${id}`,
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
};
