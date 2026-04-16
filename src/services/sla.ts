import { API } from '../config/api';

export interface SlaPolicy {
  id: string;
  tenantId: string;
  serviceType: 'm365' | 'azure';
  name: string;
  frequency: string;
  backupDays?: string[];
  backupWindowStart?: string;
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
  retentionType?: string;
  retentionDays?: number;
  enabled?: boolean;
  isDefault?: boolean;
  createdAt?: string;
}

export async function getSlaPolicies(tenantId: string, serviceType?: 'm365' | 'azure'): Promise<SlaPolicy[]> {
  const token = localStorage.getItem('access_token');
  const queryParams = new URLSearchParams();
  if (tenantId) queryParams.set('tenantId', tenantId);
  if (serviceType) queryParams.set('serviceType', serviceType);
  const url = queryParams.size ? `${API.POLICIES.LIST}?${queryParams.toString()}` : API.POLICIES.LIST;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to fetch SLA policies: ${res.statusText}`);
  return res.json();
}

export async function createSlaPolicy(data: Partial<SlaPolicy>): Promise<SlaPolicy> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(API.POLICIES.CREATE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create SLA policy: ${res.statusText}`);
  return res.json();
}

export async function deleteSlaPolicy(id: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API.POLICIES.DELETE(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to delete SLA policy: ${res.statusText}`);
}
