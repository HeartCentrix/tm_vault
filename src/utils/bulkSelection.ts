// Pure logic for the Protection page's select-all-across-pages mode.
// Kept out of the component so it is unit-testable (see
// bulkSelection.test.ts) and so the filter the bulk endpoint receives is
// provably derived from the SAME inputs the list fetch uses.

import { getTypesForTab, type BulkAssignFilter } from '../services/resource';

export interface BulkFilterParams {
  tenantId: string;
  tab: string;
  serviceType?: string;
  /** Verbatim search box value — getResources sends it untrimmed, so the
   * filter must too, or the match set diverges from the listed rows. */
  searchQuery?: string;
  /** Protection's resource filter: 'active' | 'archived' | null. */
  resourceFilter?: string | null;
  /** 'none' or a policy UUID — the same value getResources sends as `sla`. */
  slaParam?: string;
}

/**
 * Build the bulk-assign filter describing exactly the rows the tab lists
 * across ALL pages: same tab→types mapping, same query/status/sla params
 * getResources puts on the wire. Returns null when the tab resolves to no
 * types (the API rejects an empty types list with a 400) — the caller
 * must refuse select-all-matching for that view rather than send it.
 */
export function buildBulkFilter(params: BulkFilterParams): BulkAssignFilter | null {
  const types = getTypesForTab(params.tab, params.serviceType);
  if (types.length === 0) return null;
  const filter: BulkAssignFilter = { tenantId: params.tenantId, types };
  if (params.searchQuery) filter.query = params.searchQuery;
  if (params.resourceFilter === 'active') filter.status = 'ACTIVE';
  if (params.resourceFilter === 'archived') filter.status = 'ARCHIVED';
  if (params.slaParam) filter.sla = params.slaParam;
  return filter;
}

export type SelectAllBannerState = 'none' | 'offer-all' | 'all-matching';

/**
 * Which select-all banner (if any) the page shows.
 *  - 'offer-all':   every visible row is selected and more rows exist on
 *                    other pages — offer "Select all N matching".
 *  - 'all-matching': selectAllMatching mode is active — show the total and
 *                    a "Clear selection" escape hatch.
 *  - 'none':        otherwise (partial selection, empty page, or the whole
 *                    result set already fits on this page).
 */
export function selectAllBannerState(args: {
  selectAllMatching: boolean;
  selectedCount: number;
  visibleCount: number;
  totalItems: number;
}): SelectAllBannerState {
  if (args.selectAllMatching) return 'all-matching';
  if (
    args.visibleCount > 0
    && args.selectedCount === args.visibleCount
    && args.totalItems > args.visibleCount
  ) {
    return 'offer-all';
  }
  return 'none';
}
