import { API } from '../config/api';

export type HealthStatusValue = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: HealthStatusValue;
  detail?: string;
  no_consumer?: string[];
  dlq_nonempty?: string[];
  live?: Record<string, number>;
  heavy_pool?: boolean;
}

export interface ServiceMatrix {
  up: number;
  down: number;
  down_list?: string[];
  detail?: Record<string, { name: string; up: boolean; error?: string }>;
}

export interface HealthStatus {
  status: HealthStatusValue;
  timestamp: string;
  services?: ServiceMatrix;
  components: Record<string, ComponentHealth>;
}

/** Fetch the aggregated application health. The endpoint returns a coarse
 *  summary when unauthenticated and full detail for a logged-in session. */
export async function getHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API.HEALTH.STATUS}?_t=${Date.now()}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to fetch health: ${res.status} ${res.statusText}`);
  return res.json();
}
