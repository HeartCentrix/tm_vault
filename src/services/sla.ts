import { API } from '../config/api';

export interface SlaPolicy {
  id: string;
  tenantId: string;
  serviceType: 'm365' | 'azure';
  name: string;
  frequency: string;
  backupDays?: string[];
  backupWindowStart?: string;
  backupWindowEnd?: string;

  // Workloads
  backupExchange?: boolean;
  backupExchangeArchive?: boolean;
  backupExchangeRecoverable?: boolean;
  backupOneDrive?: boolean;
  backupSharepoint?: boolean;
  backupTeams?: boolean;
  backupTeamsChats?: boolean;
  backupEntraId?: boolean;
  backupPowerPlatform?: boolean;
  backupCopilot?: boolean;
  contacts?: boolean;
  calendars?: boolean;
  tasks?: boolean;
  groupMailbox?: boolean;
  planner?: boolean;
  backupAzureVm?: boolean;
  backupAzureSql?: boolean;
  backupAzurePostgresql?: boolean;

  // Retention
  retentionType?: string;
  retentionDays?: number;
  retentionVersions?: number;
  retentionMode?: 'FLAT' | 'GFS' | 'ITEM_LEVEL' | 'HYBRID';
  retentionHotDays?: number;
  retentionCoolDays?: number;
  retentionArchiveDays?: number | null;
  gfsDailyCount?: number | null;
  gfsWeeklyCount?: number | null;
  gfsMonthlyCount?: number | null;
  gfsYearlyCount?: number | null;
  itemRetentionDays?: number | null;
  itemRetentionBasis?: 'SNAPSHOT' | 'ITEM_DATE';

  // Archived-resource handling
  archivedRetentionMode?: 'SAME' | 'KEEP_ALL' | 'KEEP_LAST' | 'CUSTOM';
  archivedRetentionDays?: number | null;

  // Compliance
  legalHoldEnabled?: boolean;
  legalHoldUntil?: string | null;
  immutabilityMode?: 'None' | 'Unlocked' | 'Locked';

  // Storage / encryption (BYOK)
  storageRegion?: string | null;
  encryptionMode?: 'VAULT_MANAGED' | 'CUSTOMER_KEY';
  keyVaultUri?: string | null;
  keyName?: string | null;
  keyVersion?: string | null;

  // Auto-apply hook
  autoApplyToMatching?: boolean;

  enabled?: boolean;
  isDefault?: boolean;
  createdAt?: string;
}

export interface SlaExclusion {
  id: string;
  policyId: string;
  exclusionType: 'FOLDER_PATH' | 'FILE_EXTENSION' | 'SUBJECT_REGEX' | 'MIME_TYPE' | 'EMAIL_ADDRESS' | 'FILENAME_GLOB';
  pattern: string;
  workload?: 'EMAIL' | 'FILE' | 'CALENDAR' | 'CONTACT' | 'TEAMS_MESSAGE' | 'CHAT_MESSAGE' | 'ALL' | null;
  applyToHistorical?: boolean;
  enabled?: boolean;
  createdAt?: string;
}

export interface ResourceGroupRule {
  field: 'NAME' | 'EMAIL' | 'DEPARTMENT' | 'CITY' | 'COUNTRY' | 'JOB_TITLE' | 'RESOURCE_TYPE' | 'EXTERNAL_ID' | 'TAG_VALUE';
  operator: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'NOT_CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH' | 'IN';
  value: string;
}

export interface ResourceGroup {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  groupType?: 'STATIC' | 'DYNAMIC' | 'PROVIDER_NATIVE';
  combinator?: 'AND' | 'OR';
  rules: ResourceGroupRule[];
  priority?: number;
  enabled?: boolean;
  autoProtectNew?: boolean;
  attachedPolicyIds?: string[];
  createdAt?: string;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem('access_token');
  const base: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return { ...base, ...(extra || {}) };
}

// ── SLA Policies ─────────────────────────────────────────────────────────────

export async function getSlaPolicies(tenantId: string, serviceType?: 'm365' | 'azure'): Promise<SlaPolicy[]> {
  const queryParams = new URLSearchParams();
  if (tenantId) queryParams.set('tenantId', tenantId);
  if (serviceType) queryParams.set('serviceType', serviceType);
  const url = queryParams.size ? `${API.POLICIES.LIST}?${queryParams.toString()}` : API.POLICIES.LIST;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch SLA policies: ${res.statusText}`);
  return res.json();
}

export async function createSlaPolicy(data: Partial<SlaPolicy>): Promise<SlaPolicy> {
  const res = await fetch(API.POLICIES.CREATE, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create SLA policy: ${res.statusText}`);
  return res.json();
}

export async function updateSlaPolicy(id: string, data: Partial<SlaPolicy>): Promise<SlaPolicy> {
  const res = await fetch(API.POLICIES.UPDATE(id), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update SLA policy: ${res.statusText}`);
  return res.json();
}

export async function deleteSlaPolicy(id: string): Promise<void> {
  const res = await fetch(API.POLICIES.DELETE(id), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete SLA policy: ${res.statusText}`);
}

// ── Exclusions ───────────────────────────────────────────────────────────────

export async function getExclusions(policyId: string): Promise<SlaExclusion[]> {
  const res = await fetch(API.POLICIES.EXCLUSIONS(policyId), { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch exclusions: ${res.statusText}`);
  return res.json();
}

export async function createExclusion(policyId: string, data: Partial<SlaExclusion>): Promise<SlaExclusion> {
  const res = await fetch(API.POLICIES.EXCLUSIONS(policyId), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create exclusion: ${res.statusText}`);
  return res.json();
}

export async function deleteExclusion(policyId: string, exclusionId: string): Promise<void> {
  const res = await fetch(API.POLICIES.EXCLUSION(policyId, exclusionId), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete exclusion: ${res.statusText}`);
}

// ── Resource Groups ──────────────────────────────────────────────────────────

export async function listResourceGroups(tenantId: string): Promise<ResourceGroup[]> {
  const url = `${API.RESOURCE_GROUPS.LIST}?tenantId=${encodeURIComponent(tenantId)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to list resource groups: ${res.statusText}`);
  return res.json();
}

export async function createResourceGroup(data: Partial<ResourceGroup>): Promise<ResourceGroup> {
  const res = await fetch(API.RESOURCE_GROUPS.CREATE, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create resource group: ${res.statusText}`);
  return res.json();
}

export async function updateResourceGroup(id: string, data: Partial<ResourceGroup>): Promise<ResourceGroup> {
  const res = await fetch(API.RESOURCE_GROUPS.UPDATE(id), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update resource group: ${res.statusText}`);
  return res.json();
}

export async function deleteResourceGroup(id: string): Promise<void> {
  const res = await fetch(API.RESOURCE_GROUPS.DELETE(id), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete resource group: ${res.statusText}`);
}

export async function attachPolicyToGroup(groupId: string, policyId: string): Promise<void> {
  const res = await fetch(API.RESOURCE_GROUPS.ATTACH_POLICY(groupId), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ policyId }),
  });
  if (!res.ok) throw new Error(`Failed to attach policy: ${res.statusText}`);
}

export async function detachPolicyFromGroup(groupId: string, policyId: string): Promise<void> {
  const res = await fetch(API.RESOURCE_GROUPS.DETACH_POLICY(groupId, policyId), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to detach policy: ${res.statusText}`);
}
