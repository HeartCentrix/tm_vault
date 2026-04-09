// API endpoints for tenants / data sources
import { API } from '../config/api';

export type DataSourceType = {
  id: string;
  name: string;
  type: 'm365' | 'azure' | 'kubernetes';
  status: string;
};

let cachedDataSources: DataSourceType[] | null = null;
let fetchPromise: Promise<DataSourceType[]> | null = null;

export async function getDataSources(): Promise<DataSourceType[]> {
  if (cachedDataSources) return cachedDataSources;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const token = localStorage.getItem('access_token');
    const res = await fetch(API.TENANTS.LIST, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to fetch data sources: ${res.statusText}`);
    const tenants: any[] = await res.json();
    cachedDataSources = tenants.map((t: any): DataSourceType => ({
      id: t.id,
      name: t.displayName,
      type: mapType(t.type),
      status: t.status,
    }));
    return cachedDataSources;
  })();

  return fetchPromise;
}

function mapType(type: string): 'm365' | 'azure' | 'kubernetes' {
  switch (type?.toUpperCase()) {
    case 'AZURE': return 'azure';
    case 'M365': return 'm365';
    default: return 'm365';
  }
}

export function invalidateDataSourceCache() {
  cachedDataSources = null;
  fetchPromise = null;
}
