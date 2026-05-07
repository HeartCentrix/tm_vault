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
  details?: string;
  enrichment?: Record<string, any>;
  risk_signals?: Record<string, any>;
  risk_score?: number;
  risk_level?: string;
}

export interface AuditListParams {
  startDate?: string;
  endDate?: string;
  actorType?: string;
  action?: string;
  resourceId?: string;
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

export interface RiskSignalItem extends AuditItem {
  risk_signals: Record<string, any>;
  risk_score: number;
  risk_level: string;
}

export interface RiskSignalParams {
  startDate?: string;
  endDate?: string;
  riskLevel?: string;
  minRiskScore?: number;
  page?: number;
  size?: number;
}

export interface RiskSignalResponse {
  items: RiskSignalItem[];
  total: number;
  page: number;
  size: number;
  has_more: boolean;
}

// Map backend audit event to frontend expected format
function mapAuditEvent(event: any): AuditItem {
  const details = event.details || {};
  const enrichment = details.enrichment || {};
  const riskSignals = details.risk_signals || null;

  return {
    id: event.id,
    date: event.occurred_at,
    actor: event.actor_type,
    actor_email: event.actor_email,
    operation: event.action,
    object: event.resource_name || event.resource_type || 'N/A',
    object_type: event.resource_type,
    details: event.details ? JSON.stringify(event.details) : undefined,
    enrichment: Object.keys(enrichment).length > 0 ? enrichment : undefined,
    risk_signals: riskSignals || undefined,
    risk_score: riskSignals?.risk_score,
    risk_level: riskSignals?.risk_level,
  };
}

export async function getAudits(params?: AuditListParams): Promise<AuditListResponse> {
  let url = API.AUDIT.LIST;
  const queryParams = new URLSearchParams();

  if (params?.startDate) queryParams.append('from_date', params.startDate);
  if (params?.endDate) queryParams.append('to_date', params.endDate);
  if (params?.actorType) queryParams.append('actorType', params.actorType);
  if (params?.action) queryParams.append('action', params.action);
  if (params?.resourceId) queryParams.append('resourceId', params.resourceId);
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.size) queryParams.append('size', params.size.toString());

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch audits: ${res.statusText}`);
  const data = await res.json();

  return {
    items: (data.items || []).map(mapAuditEvent),
    total: data.total || 0,
    page: data.page || 1,
    size: data.size || 50,
    has_more: data.page < data.pages,
  };
}

export async function getAuditDetails(id: string): Promise<AuditDetailsResponse> {
  const res = await fetch(API.AUDIT.DETAILS(id));
  if (!res.ok) throw new Error(`Failed to fetch audit details: ${res.statusText}`);
  const event = await res.json();
  return mapAuditEvent(event);
}

export async function getRiskSignals(params?: RiskSignalParams): Promise<RiskSignalResponse> {
  let url = `${API.AUDIT.LIST.replace('/events', '')}/risk-signals`;
  const queryParams = new URLSearchParams();

  if (params?.startDate) queryParams.append('from_date', params.startDate);
  if (params?.endDate) queryParams.append('to_date', params.endDate);
  if (params?.riskLevel) queryParams.append('risk_level', params.riskLevel);
  if (params?.minRiskScore) queryParams.append('min_risk_score', params.minRiskScore.toString());
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.size) queryParams.append('size', params.size.toString());

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch risk signals: ${res.statusText}`);
  const data = await res.json();

  return {
    items: (data.items || []).map((item: any) => ({
      ...mapAuditEvent(item),
      risk_signals: item.risk_signals || {},
      risk_score: item.risk_score || 0,
      risk_level: item.risk_level || 'UNKNOWN',
    })),
    total: data.total || 0,
    page: data.page || 1,
    size: data.size || 50,
    has_more: data.has_more || false,
  };
}

export async function downloadAuditCSV(params?: AuditListParams): Promise<Blob> {
  let url = API.AUDIT.LIST.replace('/events', '/export');
  const queryParams = new URLSearchParams();

  if (params?.startDate) queryParams.append('from_date', params.startDate);
  if (params?.endDate) queryParams.append('to_date', params.endDate);
  if (params?.actorType) queryParams.append('actorType', params.actorType);
  if (params?.action) queryParams.append('action', params.action);
  if (params?.resourceId) queryParams.append('resourceId', params.resourceId);

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download audits: ${res.statusText}`);
  return res.blob();
}
