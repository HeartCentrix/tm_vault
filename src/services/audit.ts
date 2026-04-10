import { API } from '../config/api';

export interface AuditItem {
  id: string;
  date: string;
  actor: string;
  actor_email?: string;
  operation: string;
  object: string;
  object_type?: string;
  actor_ip?: string;
  actor_location?: string;
  show_content?: boolean;
  details?: string;
}

export interface AuditListParams {
  startDate?: string;
  endDate?: string;
  actor?: string;
  operation?: string;
  object?: string;
  page?: number;
  size?: number;
}

export interface AuditListResponse {
  items: AuditItem[];
  total: number;
  page: number;
  size: number;
  has_more: boolean;
}

export interface AuditDetailsResponse extends AuditItem {
  additional_info?: Record<string, any>;
}

export async function getAudits(params?: AuditListParams): Promise<AuditListResponse> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let url = API.AUDIT.LIST;
  const queryParams = new URLSearchParams();

  if (params?.startDate) queryParams.append('start_date', params.startDate);
  if (params?.endDate) queryParams.append('end_date', params.endDate);
  if (params?.actor) queryParams.append('actor', params.actor);
  if (params?.operation) queryParams.append('operation', params.operation);
  if (params?.object) queryParams.append('object', params.object);
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.size) queryParams.append('size', params.size.toString());

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch audits: ${res.statusText}`);
  return res.json();
}

export async function getAuditDetails(id: string): Promise<AuditDetailsResponse> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const url = API.AUDIT.DETAILS(id);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch audit details: ${res.statusText}`);
  return res.json();
}

export async function downloadAuditCSV(params?: AuditListParams): Promise<Blob> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let url = `${API.AUDIT.LIST}/export`;
  const queryParams = new URLSearchParams();

  if (params?.startDate) queryParams.append('start_date', params.startDate);
  if (params?.endDate) queryParams.append('end_date', params.endDate);
  if (params?.actor) queryParams.append('actor', params.actor);
  if (params?.operation) queryParams.append('operation', params.operation);
  if (params?.object) queryParams.append('object', params.object);

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to download audits: ${res.statusText}`);
  return res.blob();
}
