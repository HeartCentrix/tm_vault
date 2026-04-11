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
const TAB_TYPE_MAP: Record<string, string[]> = {
  all: [],
  users: ['MAILBOX', 'SHARED_MAILBOX', 'ROOM_MAILBOX', 'ONEDRIVE', 'ENTRA_USER'],
  shared: ['SHARED_MAILBOX'],
  rooms: ['ROOM_MAILBOX'],
  sharepoint: ['SHAREPOINT_SITE'],
  groups: ['TEAMS_CHANNEL', 'TEAMS_CHAT', 'ENTRA_GROUP'],
  entra: ['ENTRA_USER', 'ENTRA_GROUP', 'ENTRA_APP', 'ENTRA_DEVICE'],
  power: ['POWER_BI', 'POWER_APPS', 'POWER_AUTOMATE', 'POWER_DLP', 'COPILOT', 'PLANNER'],
  dynamic: [],
  'entra-groups': ['ENTRA_GROUP'],
};

export async function getResources(
  tenantId: string,
  tab: string,
  page: number = 1,
  size: number = 50,
  searchQuery?: string,
  _slaFilter?: string,
  resourceFilter?: string
): Promise<ResourceListResponse> {
  const token = localStorage.getItem('access_token');
  const types = TAB_TYPE_MAP[tab] || [];

  let url: string;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  if (types.length === 1) {
    // Single type - use /by-type endpoint
    url = `${API.RESOURCES.BY_TYPE}?type=${types[0]}&tenantId=${tenantId}&page=${page}&size=${size}`;
  } else if (types.length === 0) {
    // All resources
    url = `${API.RESOURCES.LIST}?tenantId=${tenantId}&page=${page}&size=${size}`;
  } else {
    // Multiple types - fetch all and filter client-side
    url = `${API.RESOURCES.LIST}?tenantId=${tenantId}&page=${page}&size=500`;
  }

  if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
  if (resourceFilter === 'active') url += `&status=ACTIVE`;
  if (resourceFilter === 'archived') url += `&status=ARCHIVED`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch resources: ${res.statusText}`);

  const data = await res.json();

  // If multiple types were requested, filter client-side
  if (types.length > 1 && data.items) {
    data.items = data.items.filter((item: ResourceItem) =>
      types.some(t => item.kind === t.toLowerCase())
    );
    data.item_number = data.items.length;
  }

  return data;
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
