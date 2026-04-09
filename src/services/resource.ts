import { API } from '../config/api';

export interface ResourceItem {
  id: string;
  name: string;
  email?: string;
  type: string;
  sla?: string;
  totalSize: string;
  lastBackup?: string;
  status: string;
  tenantId?: string;
  archived: boolean;
}

export interface ResourceListResponse {
  content: ResourceItem[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
  first: boolean;
  last: boolean;
}

// Map Protection tabs to backend resource types
const TAB_TYPE_MAP: Record<string, string[]> = {
  all: [],
  users: ['MAILBOX', 'SHARED_MAILBOX', 'ROOM_MAILBOX', 'ONEDRIVE', 'TEAMS_CHAT'],
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
  slaFilter?: string,
  resourceFilter?: string
): Promise<ResourceListResponse> {
  const token = localStorage.getItem('access_token');
  const types = TAB_TYPE_MAP[tab] || [];

  let url: string;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  if (tab === 'users') {
    // Use the /users endpoint for the Users tab
    url = `${API.RESOURCES.USERS}?tenantId=${tenantId}`;
  } else if (tab === 'all' && !searchQuery && !slaFilter && !resourceFilter) {
    url = `${API.RESOURCES.LIST}?tenantId=${tenantId}&page=${page}&size=${size}`;
  } else if (types.length === 1) {
    url = `${API.RESOURCES.BY_TYPE}?type=${types[0]}&tenantId=${tenantId}&page=${page}&size=${size}`;
  } else {
    url = `${API.RESOURCES.LIST}?tenantId=${tenantId}&page=${page}&size=${size}`;
    if (searchQuery) url += `&query=${encodeURIComponent(searchQuery)}`;
    if (resourceFilter === 'active') url += `&status=ACTIVE`;
    if (resourceFilter === 'archived') url += `&status=ARCHIVED`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch resources: ${res.statusText}`);

  const data = await res.json();

  // If endpoint returns paginated structure, use it; otherwise wrap
  if (data.content !== undefined) {
    return data as ResourceListResponse;
  }
  // If it's a plain array (from /by-type or /search), wrap it
  if (Array.isArray(data)) {
    return {
      content: data,
      totalPages: 1,
      totalElements: data.length,
      size: data.length,
      number: 1,
      first: true,
      last: true,
    };
  }

  return {
    content: [],
    totalPages: 0,
    totalElements: 0,
    size,
    number: page,
    first: true,
    last: true,
  };
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
