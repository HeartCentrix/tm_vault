// API endpoints for tenants / data sources
import { API } from '../config/api';

export type DataSourceType = {
  id: string;
  name: string;
  type: 'm365' | 'azure';
  status: string;
};

let cachedDataSources: DataSourceType[] | null = null;
let fetchPromise: Promise<DataSourceType[]> | null = null;

export async function getDataSources(): Promise<DataSourceType[]> {
  if (cachedDataSources) return cachedDataSources;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const res = await fetch(API.TENANTS.LIST);
    if (!res.ok) throw new Error(`Failed to fetch data sources: ${res.statusText}`);
    const tenants: any[] = await res.json();
    const sources: DataSourceType[] = [];
    for (const t of tenants) {
      const types = mapType(t.type);
      for (const type of types) {
        sources.push({
          id: t.id,
          name: t.displayName,
          type,
          status: t.status,
        });
      }
    }
    cachedDataSources = sources;
    return cachedDataSources;
  })();

  return fetchPromise;
}

function mapType(type: string): ('m365' | 'azure')[] {
  // Legacy 'BOTH' removed — a tenant is now exactly one workload type.
  switch (type?.toUpperCase()) {
    case 'AZURE': return ['azure'];
    case 'M365': return ['m365'];
    default: return ['m365'];
  }
}

export function invalidateDataSourceCache() {
  cachedDataSources = null;
  fetchPromise = null;
}

// Call this after adding a new datasource
export async function refreshDataSources(): Promise<DataSourceType[]> {
  invalidateDataSourceCache();
  return getDataSources();
}
