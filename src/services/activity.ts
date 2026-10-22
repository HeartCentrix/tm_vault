import { API } from '../config/api';
import { collectIncompleteResourceIds, RETRY_DISPATCH_LIMIT } from '../utils/retryEligibility';

export interface ActivityItem {
  id: string;
  jobIds?: string[];
  start_time: string;
  operation: string;
  object: string;
  status: 'Done' | 'In Progress' | 'Failed' | 'Canceled' | 'Warning' | 'Partial' | 'Expired';
  finish_time: string;
  details?: string;
  data_backed_up?: number;
  total_data?: number;
  batchId?: string;
  phase?: 'discovering' | 'urgent' | 'heavy' | 'in_progress' | 'done';
  progress_pct?: number;
  cancellable?: boolean;
  counts?: {
    total: number;
    done: number;
    partial: number;
    failed: number;
    in_progress: number;
    queued: number;
  };
  warnings?: { partial?: number; failed?: number; skipped_no_license?: number; sample?: string } | null;
  batchSource?: 'manual_bulk' | 'manual_user' | 'scheduler';
  progressPct?: number;
  bytesDone?: number;
  bytesExpected?: number | null;
}

export interface BatchChildResource {
  resourceId: string;
  displayName: string;
  type: string;
  tier: 1 | 2;
  snapshotId?: string;
  status?: string;
  // itemCount / bytesAdded are scoped to THE batch clicked, not
  // "current vault state". bytesTotal carries the cumulative size so
  // the UI can show both "added this run" and "total in vault".
  itemCount?: number;
  // Lifetime retained inventory for this resource. Useful as context
  // ("0 added this run / 29 092 in vault") so a clean no-op
  // incremental doesn't get mis-read as "we re-fetched everything."
  itemCountTotal?: number;
  bytesAdded?: number;
  bytesTotal?: number;
  partitions?: { total: number; done: number; pending: number; failed: number };
  // Set when the workload was skipped for lack of an M365 license (status
  // === 'SKIPPED_NO_LICENSE'). licenseHint names the missing service.
  skippedNoLicense?: boolean;
  licenseHint?: string | null;
  children?: BatchChildResource[];
}

export interface BatchChildren {
  batchId: string;
  resources: BatchChildResource[];
}

export interface ActivityListParams {
  tenantId?: string;
  serviceType?: 'm365' | 'azure';
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

export async function getActivities(
  params?: ActivityListParams,
  signal?: AbortSignal,
): Promise<ActivityListResponse> {
  let url = API.ACTIVITY.LIST;
  const queryParams = new URLSearchParams();

  if (params?.tenantId) queryParams.append('tenantId', params.tenantId);
  if (params?.serviceType) queryParams.append('serviceType', params.serviceType);
  if (params?.startDate) queryParams.append('start_date', params.startDate);
  if (params?.endDate) queryParams.append('end_date', params.endDate);
  if (params?.operation) queryParams.append('operation', params.operation);
  if (params?.status) queryParams.append('status', params.status);
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.size) queryParams.append('size', params.size.toString());

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  // `signal` lets the caller abandon a superseded request instead of
  // queueing another on top of it — five stacked date-filter fetches is
  // what turned an 8s load into a >60s frozen tab (BUG-005).
  const res = await fetch(url, signal ? { signal } : undefined);
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

export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(API.JOBS.CANCEL(jobId), { method: 'POST' });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to cancel job: ${res.statusText}`);
  }
}

export interface RetryOutcome {
  /** Resource ids we dispatched successfully. */
  dispatched: string[];
  /** Resource ids whose dispatch call failed. */
  failed: string[];
  /** Incomplete resources left over after the per-click cap. */
  remaining: number;
}

/**
 * Re-run only the resources in a batch that did not complete.
 *
 * Fetches the batch's children, selects the PARTIAL/FAILED ones (see
 * `collectIncompleteResourceIds` — IN_PROGRESS is deliberately excluded)
 * and dispatches each one individually.
 *
 * Dispatches sequentially rather than with Promise.all: a wide batch
 * could otherwise fire dozens of simultaneous triggers at the scheduler,
 * and pool pressure is the root of the failures this button exists to
 * recover from. Slower by a few hundred ms, and much better behaved.
 *
 * Never throws for a partial result — per-resource failures come back in
 * `failed` so the UI can report "re-ran 3 of 4" honestly.
 */
export async function retryIncompleteResources(
  batchId: string,
): Promise<RetryOutcome> {
  const children = await fetchBatchChildren(batchId);
  const allTargets = collectIncompleteResourceIds(children.resources);

  // Cap how many go out per click. Sequential dispatch paces the trigger
  // calls but NOT the resulting walks — the scheduler runs everything it
  // has been handed concurrently, which is how six at once saturated the
  // DB pool and blanked this very page. See RETRY_DISPATCH_LIMIT.
  const targets = allTargets.slice(0, RETRY_DISPATCH_LIMIT);
  const remaining = allTargets.length - targets.length;

  const dispatched: string[] = [];
  const failed: string[] = [];

  for (const resourceId of targets) {
    try {
      const res = await fetch(API.JOBS.TRIGGER_USER(resourceId), { method: 'POST' });
      if (res.ok) dispatched.push(resourceId);
      else failed.push(resourceId);
    } catch {
      failed.push(resourceId);
    }
  }

  return { dispatched, failed, remaining };
}

export async function fetchBatchChildren(batchId: string): Promise<BatchChildren> {
  const url = `${API.ACTIVITY.LIST}/batches/${encodeURIComponent(batchId)}/children`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch batch children: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return {
    batchId: data.batchId || batchId,
    resources: data.resources || [],
  };
}

export async function downloadActivityCSV(params?: ActivityListParams): Promise<Blob> {
  let url = `${API.ACTIVITY.LIST}/export`;
  const queryParams = new URLSearchParams();

  if (params?.tenantId) queryParams.append('tenantId', params.tenantId);
  if (params?.serviceType) queryParams.append('serviceType', params.serviceType);
  if (params?.startDate) queryParams.append('start_date', params.startDate);
  if (params?.endDate) queryParams.append('end_date', params.endDate);
  if (params?.operation) queryParams.append('operation', params.operation);
  if (params?.status) queryParams.append('status', params.status);

  const queryString = queryParams.toString();
  if (queryString) url += `?${queryString}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download activities: ${res.statusText}`);
  return res.blob();
}
