/**
 * Search Service - Full-text search across backup snapshot items
 */
import { API } from '../config/api';

export interface SearchResult {
  id: string;
  snapshotId: string;
  itemType: string;
  name: string;
  externalId: string;
  contentSize: number;
  createdAt: string;
  preview: string;
  source: {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    tenantId: string;
    tenantName: string;
  };
  snapshot: {
    id: string;
    type: string;
    label?: string;
    createdAt: string;
  };
  blobPath?: string;
  downloadUrl: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalResults: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: {
    tenantId?: string;
    workloadType?: string;
    itemType?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}

export interface SearchSuggestion {
  text: string;
  type: string;
  count: number;
}

export interface SearchSuggestionsResponse {
  suggestions: SearchSuggestion[];
  query: string;
}

export const SearchService = {
  async search(
    query: string,
    options?: {
      tenantId?: string;
      workloadType?: string;
      itemType?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      size?: number;
    }
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (options?.tenantId) params.append('tenantId', options.tenantId);
    if (options?.workloadType) params.append('workloadType', options.workloadType);
    if (options?.itemType) params.append('itemType', options.itemType);
    if (options?.dateFrom) params.append('dateFrom', options.dateFrom);
    if (options?.dateTo) params.append('dateTo', options.dateTo);
    if (options?.page) params.append('page', String(options.page));
    if (options?.size) params.append('size', String(options.size));

    const res = await fetch(`${API.SEARCH.SEARCH}?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to perform search');
    return res.json();
  },

  async getSuggestions(query: string, limit = 10): Promise<SearchSuggestionsResponse> {
    const res = await fetch(`${API.SEARCH.SUGGESTIONS}?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch suggestions');
    return res.json();
  },

  async reindex(snapshotIds?: string[]): Promise<{ indexed: number }> {
    const res = await fetch(API.SEARCH.REINDEX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshotIds || null),
    });
    if (!res.ok) throw new Error('Failed to reindex');
    return res.json();
  },
};
