import { API } from '../config/api';

export interface ActivityItem {
  id: string;
  start_time: string;
  operation: string;
  object: string;
  status: 'Done' | 'In Progress' | 'Failed' | 'Canceled';
  finish_time: string;
  details?: string;
  data_backed_up?: number;
  total_data?: number;
}

export interface ActivityListParams {
  tenantId?: string;
  startDate?: string;
  endDate?: string;
  operation?: string;
  status?: string;
  page?: number;
  size?: number;
}

export interface ActivityListResponse {
  items: ActivityItem[];
  total: number;
  page: number;
  size: number;
  has_more: boolean;
}

export async function getActivities(params?: ActivityListParams): Promise<ActivityListResponse> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let url = API.ACTIVITY.LIST;
  const queryParams = new URLSearchParams();

  if (params?.tenantId) queryParams.append('tenantId', params.tenantId);
  if (params?.startDate) queryParams.append('start_date', params.startDate);
  if (params?.endDate) queryParams.append('end_date', params.endDate);
  if (params?.operation) queryParams.append('operation', params.operation);
  if (params?.status) queryParams.append('status', params.status);
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.size) queryParams.append('size', params.size.toString());

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch activities: ${res.statusText}`);
  const data = await res.json();

  return {
    items: data.items || [],
    total: data.total || 0,
    page: data.page || 1,
    size: data.size || 50,
    has_more: data.has_more || false,
  };
}

export async function downloadActivityCSV(params?: ActivityListParams): Promise<Blob> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let url = `${API.ACTIVITY.LIST}/export`;
  const queryParams = new URLSearchParams();

  if (params?.tenantId) queryParams.append('tenantId', params.tenantId);
  if (params?.startDate) queryParams.append('start_date', params.startDate);
  if (params?.endDate) queryParams.append('end_date', params.endDate);
  if (params?.operation) queryParams.append('operation', params.operation);
  if (params?.status) queryParams.append('status', params.status);

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to download activities: ${res.statusText}`);
  return res.blob();
}
