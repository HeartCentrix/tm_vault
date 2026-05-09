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

  // Encryption (BYOK on Azure backend only)
  encryptionMode?: 'VAULT_MANAGED' | 'CUSTOMER_KEY';
  keyVaultUri?: string | null;
  keyName?: string | null;
  keyVersion?: string | null;
  // Resolved version (filled by the reconciler after looking up "latest"
  // in Key Vault, or after rotation). Lets the UI show what's actually
  // applied right now even when the operator left key_version blank.
  keyVersionResolved?: string | null;
  // Reconciler-set: '', 'OK', 'KEY_VAULT_ACCESS_DENIED', 'ERROR'.
  // Empty when encryption mode is VAULT_MANAGED.
  encryptionStatus?: string;

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

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

// ── SLA Policies ─────────────────────────────────────────────────────────────

export interface PoliciesPage {
  items: SlaPolicy[];
  total: number;
  limit: number;
  offset: number;
}

// Returns the policies list. Server now returns a paginated envelope
// `{items,total,limit,offset}` — we accept both that and the legacy
// unwrapped array for any older deployment.
export async function getSlaPolicies(
  tenantId: string,
  serviceType?: 'm365' | 'azure',
  opts?: { limit?: number; offset?: number },
): Promise<SlaPolicy[]> {
  const page = await getSlaPoliciesPage(tenantId, serviceType, opts);
  return page.items;
}

export async function getSlaPoliciesPage(
  tenantId: string,
  serviceType?: 'm365' | 'azure',
  opts?: { limit?: number; offset?: number },
): Promise<PoliciesPage> {
  const queryParams = new URLSearchParams();
  if (tenantId) queryParams.set('tenantId', tenantId);
  if (serviceType) queryParams.set('serviceType', serviceType);
  if (opts?.limit != null) queryParams.set('limit', String(opts.limit));
  if (opts?.offset != null) queryParams.set('offset', String(opts.offset));
  const url = queryParams.size ? `${API.POLICIES.LIST}?${queryParams.toString()}` : API.POLICIES.LIST;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch SLA policies: ${res.statusText}`);
  const body: any = await res.json();
  if (Array.isArray(body)) {
    // Legacy server — wrap to match the new shape.
    return { items: body as SlaPolicy[], total: body.length, limit: body.length, offset: 0 };
  }
  return body as PoliciesPage;
}

// Crypto-strong opaque key used by the server to deduplicate retried
// POSTs (operator double-click Save, network flake). Generated once per
// "Save" attempt — the same retry should reuse it; a brand-new save
// gets a fresh key.
function newIdempotencyKey(): string {
  // crypto.randomUUID is ubiquitous in modern browsers + Vite tooling.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function createSlaPolicy(
  data: Partial<SlaPolicy>,
  opts?: { idempotencyKey?: string },
): Promise<SlaPolicy> {
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    'Idempotency-Key': opts?.idempotencyKey ?? newIdempotencyKey(),
  };
  const res = await fetch(API.POLICIES.CREATE, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    // Surface the server's typed validation error so the wizard can
    // show field-level guidance instead of generic "failed".
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to create SLA policy: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function updateSlaPolicy(
  id: string,
  data: Partial<SlaPolicy>,
  opts?: { ifMatch?: string },
): Promise<SlaPolicy> {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (opts?.ifMatch) headers['If-Match'] = opts.ifMatch;
  const res = await fetch(API.POLICIES.UPDATE(id), {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  });
  if (res.status === 412) {
    throw new Error(
      'This policy was changed by someone else after you loaded it. ' +
      'Reload and re-apply your changes.'
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to update SLA policy: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function deleteSlaPolicy(id: string): Promise<void> {
  const res = await fetch(API.POLICIES.DELETE(id), { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete SLA policy: ${res.statusText}`);
}

// ── Exclusions ───────────────────────────────────────────────────────────────

export async function getExclusions(policyId: string): Promise<SlaExclusion[]> {
  const res = await fetch(API.POLICIES.EXCLUSIONS(policyId));
  if (!res.ok) throw new Error(`Failed to fetch exclusions: ${res.statusText}`);
  return res.json();
}

export async function createExclusion(policyId: string, data: Partial<SlaExclusion>): Promise<SlaExclusion> {
  const res = await fetch(API.POLICIES.EXCLUSIONS(policyId), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create exclusion: ${res.statusText}`);
  return res.json();
}

export async function deleteExclusion(policyId: string, exclusionId: string): Promise<void> {
  const res = await fetch(API.POLICIES.EXCLUSION(policyId, exclusionId), { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete exclusion: ${res.statusText}`);
}

// ── Resource Groups ──────────────────────────────────────────────────────────

export async function listResourceGroups(tenantId: string): Promise<ResourceGroup[]> {
  const res = await fetch(`${API.RESOURCE_GROUPS.LIST}?tenantId=${encodeURIComponent(tenantId)}`);
  if (!res.ok) throw new Error(`Failed to list resource groups: ${res.statusText}`);
  return res.json();
}

export async function createResourceGroup(data: Partial<ResourceGroup>): Promise<ResourceGroup> {
  const res = await fetch(API.RESOURCE_GROUPS.CREATE, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create resource group: ${res.statusText}`);
  return res.json();
}

export async function updateResourceGroup(id: string, data: Partial<ResourceGroup>): Promise<ResourceGroup> {
  const res = await fetch(API.RESOURCE_GROUPS.UPDATE(id), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update resource group: ${res.statusText}`);
  return res.json();
}

export async function deleteResourceGroup(id: string): Promise<void> {
  const res = await fetch(API.RESOURCE_GROUPS.DELETE(id), { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete resource group: ${res.statusText}`);
}

export async function attachPolicyToGroup(groupId: string, policyId: string): Promise<void> {
  const res = await fetch(API.RESOURCE_GROUPS.ATTACH_POLICY(groupId), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ policyId }),
  });
  if (!res.ok) throw new Error(`Failed to attach policy: ${res.statusText}`);
}

export async function detachPolicyFromGroup(groupId: string, policyId: string): Promise<void> {
  const res = await fetch(API.RESOURCE_GROUPS.DETACH_POLICY(groupId, policyId), { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to detach policy: ${res.statusText}`);
}
