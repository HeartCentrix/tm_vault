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
  },

  // Snapshots
  SNAPSHOTS: {
    LIST: (resourceId: string) => `${API_URL}/resources/${resourceId}/snapshots`,
    ITEMS: (snapshotId: string) => `${API_URL}/resources/snapshots/${snapshotId}/items`,
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
};
