import { API } from '../config/api';

export interface ResourceItem {
  id: string;
  tenant_id: string;
  owner: string | null;
  kind: string;
  provider: string;
  external_id: string;
  name: string;
  email?: string;
  data: Record<string, any>;
  archived: boolean;
  deleted: boolean;
  protections: { policy_id: string }[] | null;
  usage: {
    resource_id: string;
    tenant_id: string;
    backups: number;
    size: number;
    size_delta_year: number;
    size_delta_month: number;
    size_delta_week: number;
  };
  backupSize?: string;  // Formatted size string from backend (e.g., "1.15 GB")
  status: string;
  sla?: string;
  last_backup?: string;
  last_backup_status?: string;
  group_ids: string[];
}

export interface ResourceListResponse {
  item_number: number;
  page_number: number;
  next_page_token: string | null;
  items: ResourceItem[];
}

// Map Protection tabs to backend resource types (must match ResourceType enum in DB)
// M365 resource types
const M365_TAB_TYPE_MAP: Record<string, string[]> = {
  all: [],
  users: ['ENTRA_USER'],
  shared: ['SHARED_MAILBOX'],
  rooms: ['ROOM_MAILBOX'],
  sharepoint: ['SHAREPOINT_SITE'],
  groups: ['TEAMS_CHANNEL', 'TEAMS_CHAT', 'ENTRA_GROUP'],
  entra: ['ENTRA_USER', 'ENTRA_GROUP', 'ENTRA_APP', 'ENTRA_DEVICE'],
  power: ['POWER_BI', 'POWER_APPS', 'POWER_AUTOMATE', 'POWER_DLP', 'COPILOT', 'PLANNER'],
  dynamic: [],
  'entra-groups': ['ENTRA_GROUP'],
};

// Azure resource types
const AZURE_TAB_TYPE_MAP: Record<string, string[]> = {
  all: [],
  'virtual-machines': ['VIRTUAL_MACHINE'],
  'sql-databases': ['AZURE_SQL_DATABASE'],
  'postgresql-servers': ['AZURE_POSTGRESQL_SERVER'],
  'resource-groups': ['RESOURCE_GROUP'],
  'dynamic-groups': ['DYNAMIC_GROUP'],
};

// Full resource type lists for filtering "all" tab by service type
const M365_ALL_TYPES = ['MAILBOX', 'SHARED_MAILBOX', 'ROOM_MAILBOX', 'ONEDRIVE', 'SHAREPOINT_SITE', 'TEAMS_CHANNEL', 'TEAMS_CHAT', 'ENTRA_USER', 'ENTRA_GROUP', 'ENTRA_APP', 'ENTRA_DEVICE', 'POWER_BI', 'POWER_APPS', 'POWER_AUTOMATE', 'POWER_DLP', 'COPILOT', 'PLANNER'];
const AZURE_ALL_TYPES = ['AZURE_VM', 'AZURE_SQL_DB', 'AZURE_POSTGRESQL', 'AZURE_POSTGRESQL_SINGLE', 'RESOURCE_GROUP'];

export function getTabTypeMap(serviceType?: string): Record<string, string[]> {
  if (serviceType === 'azure') {
    return AZURE_TAB_TYPE_MAP;
  }
  return M365_TAB_TYPE_MAP;
}

export async function getResources(
  tenantId: string,
  tab: string,
  page: number = 1,
  size: number = 50,
  searchQuery?: string,
  _slaFilter?: string,
  resourceFilter?: string,
  serviceType?: string
): Promise<ResourceListResponse> {
  const token = localStorage.getItem('access_token');
  const tabTypeMap = getTabTypeMap(serviceType);
  let types = tabTypeMap[tab] || [];

  // When "all" tab is selected and serviceType is known, filter by that service's resource types
  if (tab === 'all' && serviceType === 'azure') {
    types = AZURE_ALL_TYPES;
  } else if (tab === 'all' && serviceType === 'm365') {
    types = M365_ALL_TYPES;
  }

  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  // For tabs with multiple types (groups, entra, power), fetch each type separately
  if (types.length > 1) {
    const allItems: ResourceItem[] = [];
    let totalItems = 0;

    // Fetch each type separately
    const fetchPromises = types.map(async (type) => {
      let url = `${API.RESOURCES.BY_TYPE}?type=${type}&tenantId=${tenantId}&page=1&size=500`;
      if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
      if (resourceFilter === 'active') url += `&status=ACTIVE`;
      if (resourceFilter === 'archived') url += `&status=ARCHIVED`;

      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Failed to fetch resources for type ${type}: ${res.statusText}`);
      return res.json();
    });

    const results = await Promise.all(fetchPromises);
    results.forEach((data: ResourceListResponse) => {
      if (data.items) {
        allItems.push(...data.items);
        totalItems += data.item_number || 0;
      }
    });

    // Apply pagination on the combined results
    const startIndex = (page - 1) * size;
    const paginatedItems = allItems.slice(startIndex, startIndex + size);

    return {
      item_number: totalItems,
      page_number: page,
      next_page_token: startIndex + size < totalItems ? String(page + 1) : null,
      items: paginatedItems,
    };
  }

  // Single type or no type - use existing logic
  let url: string;

  if (types.length === 1) {
    // Single type - use /by-type endpoint
    url = `${API.RESOURCES.BY_TYPE}?type=${types[0]}&tenantId=${tenantId}&page=${page}&size=${size}`;
  } else {
    // All resources (no filtering)
    url = `${API.RESOURCES.LIST}?tenantId=${tenantId}&page=${page}&size=${size}`;
  }

  if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
  if (resourceFilter === 'active') url += `&status=ACTIVE`;
  if (resourceFilter === 'archived') url += `&status=ARCHIVED`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch resources: ${res.statusText}`);

  const data = await res.json();
  return data;
}

export async function getResourcesByType(
  tenantId: string,
  resourceType: string,
  page: number = 1,
  size: number = 500,
  searchQuery?: string,
  resourceFilter?: string
): Promise<ResourceListResponse> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let url = `${API.RESOURCES.BY_TYPE}?type=${encodeURIComponent(resourceType)}&tenantId=${tenantId}&page=${page}&size=${size}`;
  if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
  if (resourceFilter === 'active') url += `&status=ACTIVE`;
  if (resourceFilter === 'archived') url += `&status=ARCHIVED`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch ${resourceType} resources: ${res.statusText}`);

  return res.json();
}

export async function assignPolicy(resourceId: string, policyId: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.RESOURCES.ASSIGN_POLICY(resourceId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ policyId }),
  });
  if (!res.ok) throw new Error(`Failed to assign policy: ${res.statusText}`);
}

export async function unassignPolicy(resourceId: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.RESOURCES.UNASSIGN_POLICY(resourceId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to unassign policy: ${res.statusText}`);
}

export async function bulkAssignPolicy(resourceIds: string[], policyId: string): Promise<{ assigned: number; not_found: string[] }> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(API.RESOURCES.BULK_ASSIGN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ resourceIds, policyId }),
  });
  if (!res.ok) throw new Error(`Failed to bulk assign policy: ${res.statusText}`);
  return res.json();
}

export async function bulkUnassignPolicy(resourceIds: string[]): Promise<{ unassigned: number; not_found: string[] }> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(API.RESOURCES.BULK_UNASSIGN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ resourceIds }),
  });
  if (!res.ok) throw new Error(`Failed to bulk unassign policy: ${res.statusText}`);
  return res.json();
}

export async function archiveResource(resourceId: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.RESOURCES.ARCHIVE(resourceId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to archive resource: ${res.statusText}`);
}

export async function unarchiveResource(resourceId: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.RESOURCES.UNARCHIVE(resourceId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to unarchive resource: ${res.statusText}`);
}

export async function deleteResource(resourceId: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.RESOURCES.DELETE(resourceId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to delete resource: ${res.statusText}`);
}

export async function triggerBackup(resourceId: string, fullBackup: boolean = false): Promise<{ jobId: string; status: string; resourceId: string }> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(API.JOBS.TRIGGER_BACKUP, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ resourceId, fullBackup, priority: 1 }),
  });
  if (!res.ok) throw new Error(`Failed to trigger backup: ${res.statusText}`);
  return res.json();
}

export async function getResourceProgress(resourceId: string): Promise<{
  resource_id: string;
  status: string;
  progress_pct: number;
  total_bytes: number;
  processed_bytes: number;
  total_items: number;
  processed_items: number;
  eta_seconds: number | null;
  started_at?: string;
}> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.BASE_URL}/progress/resource/${resourceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to get progress: ${res.statusText}`);
  return res.json();
}

export async function triggerBatchBackup(resourceIds: string[]): Promise<{ jobId: string; status: string; resourceId: string }[]> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(API.JOBS.TRIGGER_BULK, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ resourceIds, priority: 1 }),
  });
  if (!res.ok) throw new Error(`Failed to trigger batch backup: ${res.statusText}`);
  return res.json();
}

export async function triggerDatasourceBackup(
  tenantId: string,
  serviceType: 'm365' | 'azure',
  fullBackup: boolean = true
): Promise<{ jobId: string; status: string; resourceId: string; resourceCount?: number }[]> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(API.JOBS.TRIGGER_DATASOURCE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tenantId, serviceType, fullBackup, priority: 1 }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `Failed to trigger datasource backup: ${res.statusText}`);
  }

  return res.json();
}

export async function triggerDiscovery(
  tenantId: string
): Promise<{ discoveryId: string; resourcesFound: number }> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.BASE_URL}/tenants/${tenantId}/discover-m365`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to trigger discovery: ${res.statusText}`);
  }

  return res.json();
}
