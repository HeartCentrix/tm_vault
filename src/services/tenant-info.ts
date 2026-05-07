import { API } from '../config/api';

export interface TenantInfo {
  customerId: string;
  tenantId: string;
  region: string;
}

export async function getTenantInfo(tenantId: string): Promise<TenantInfo> {
  const res = await fetch(API.TENANTS.INFO(tenantId));
  if (!res.ok) throw new Error(`Failed to fetch tenant info: ${res.statusText}`);
  return res.json();
}

export async function downloadUsageReport(tenantId: string, tenantName: string): Promise<void> {
  const res = await fetch(API.TENANTS.USAGE_REPORT(tenantId));
  if (!res.ok) throw new Error(`Failed to download usage report: ${res.statusText}`);
  
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  // Extract filename from Content-Disposition header or generate one
  const contentDisposition = res.headers.get('Content-Disposition');
  let filename = `${tenantName}_report.csv`;
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    if (filenameMatch) {
      filename = filenameMatch[1];
    }
  }
  
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
