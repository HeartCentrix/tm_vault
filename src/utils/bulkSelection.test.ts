import { describe, it, expect } from 'vitest';
import { buildBulkFilter, selectAllBannerState } from './bulkSelection';
import { getTypesForTab } from '../services/resource';

describe('buildBulkFilter', () => {
  const base = { tenantId: 't-1', tab: 'users', serviceType: 'm365' };

  it('resolves types through the SAME tab mapping the list fetch uses', () => {
    expect(buildBulkFilter(base)?.types).toEqual(['ENTRA_USER']);
    expect(buildBulkFilter({ ...base, tab: 'groups' })?.types)
      .toEqual(['ENTRA_GROUP', 'M365_GROUP', 'TEAMS_CHANNEL']);
    // "all" expands to the service's full type list, not the map's empty
    // sentinel — identical to what getResources queries for that tab.
    expect(buildBulkFilter({ ...base, tab: 'all' })?.types)
      .toEqual(getTypesForTab('all', 'm365'));
    expect(buildBulkFilter({ tenantId: 't-1', tab: 'all', serviceType: 'azure' })?.types)
      .toEqual(getTypesForTab('all', 'azure'));
    expect(getTypesForTab('all', 'm365').length).toBeGreaterThan(0);
    expect(getTypesForTab('all', 'azure').length).toBeGreaterThan(0);
  });

  it('returns null when the tab resolves to no types — the API 400s an empty list', () => {
    expect(buildBulkFilter({ tenantId: 't-1', tab: 'nonsense' })).toBeNull();
    // "all" with an unknown service has no type list either (the list
    // fetch falls back to the untyped LIST endpoint there).
    expect(buildBulkFilter({ tenantId: 't-1', tab: 'all', serviceType: undefined })).toBeNull();
  });

  it('carries the tenant and maps resourceFilter to the status param', () => {
    expect(buildBulkFilter(base)).toEqual({ tenantId: 't-1', types: ['ENTRA_USER'] });
    expect(buildBulkFilter({ ...base, resourceFilter: 'active' })?.status).toBe('ACTIVE');
    expect(buildBulkFilter({ ...base, resourceFilter: 'archived' })?.status).toBe('ARCHIVED');
    expect(buildBulkFilter({ ...base, resourceFilter: null })?.status).toBeUndefined();
  });

  it('passes query and sla through verbatim, omitting them when falsy — parity with getResources', () => {
    const f = buildBulkFilter({ ...base, searchQuery: 'IT OPS', slaParam: 'none' });
    expect(f?.query).toBe('IT OPS');
    expect(f?.sla).toBe('none');
    const empty = buildBulkFilter({ ...base, searchQuery: '', slaParam: undefined });
    expect(empty && 'query' in empty).toBe(false);
    expect(empty && 'sla' in empty).toBe(false);
  });
});

describe('selectAllBannerState', () => {
  const state = (over: Partial<Parameters<typeof selectAllBannerState>[0]>) =>
    selectAllBannerState({
      selectAllMatching: false,
      selectedCount: 0,
      visibleCount: 50,
      totalItems: 500,
      ...over,
    });

  it('offers select-all only when the whole visible page is selected and more rows exist', () => {
    expect(state({ selectedCount: 50 })).toBe('offer-all');
  });

  it('stays silent for partial or empty selections', () => {
    expect(state({ selectedCount: 0 })).toBe('none');
    expect(state({ selectedCount: 49 })).toBe('none');
  });

  it('stays silent when the result set already fits on this page — nothing more to select', () => {
    expect(state({ selectedCount: 30, visibleCount: 30, totalItems: 30 })).toBe('none');
  });

  it('never offers on an empty page', () => {
    expect(state({ selectedCount: 0, visibleCount: 0, totalItems: 500 })).toBe('none');
  });

  it('reports all-matching mode regardless of what the visible page shows', () => {
    // A background refetch can reshuffle the visible rows under the mode;
    // the mode is filter-defined, not id-defined, so the banner holds.
    expect(state({ selectAllMatching: true, selectedCount: 12 })).toBe('all-matching');
    expect(state({ selectAllMatching: true, selectedCount: 0, visibleCount: 0 })).toBe('all-matching');
  });
});
