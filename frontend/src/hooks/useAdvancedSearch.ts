// ============================================================
// BANKERCHANGER — useAdvancedSearch Hook
// Integrates advanced search with URL state and caching
// ============================================================

import { useState, useCallback, useEffect } from 'react';
import { useSearchState } from './useUrlState';
import { advancedSearch, getSearchFacets, validateSearchQuery, highlightSearchTerms } from '../services/search';
import type { SearchResult, SearchFacets, SearchFilter, AdvancedSearchResponse } from '../services/search';

export interface UseAdvancedSearchResult {
  results: SearchResult[];
  facets: SearchFacets | null;
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: Error | null;
  search: string;
  setSearch: (q: string) => void;
  filters: SearchFilter;
  setFilters: (filters: SearchFilter) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  refetch: () => void;
  hasMore: boolean;
  highlightQuery: (text: string) => string;
}

/**
 * Advanced search hook with URL state synchronization
 * Features:
 * - Full-text search with highlighting
 * - Facet-based filtering
 * - Deep linking via URL parameters
 * - Browser history support
 * - Results caching
 */
export function useAdvancedSearch(): UseAdvancedSearchResult {
  const { search, setSearch, filters, setFilters, page, setPage, limit, setLimit } = useSearchState();
  
  const [results, setResults] = useState<SearchResult[]>([]);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [cache, setCache] = useState<Map<string, AdvancedSearchResponse>>(new Map());

  const cacheKey = `${search}:${JSON.stringify(filters)}:${page}:${limit}`;

  // Fetch facets on mount
  useEffect(() => {
    const fetchFacets = async () => {
      try {
        const f = await getSearchFacets();
        setFacets(f);
      } catch (err) {
        console.error('Failed to fetch facets:', err);
      }
    };

    fetchFacets();
  }, []);

  // Fetch search results when query/filters/pagination changes
  const performSearch = useCallback(async () => {
    if (!search || search.trim().length === 0) {
      setResults([]);
      setTotal(0);
      return;
    }

    // Validate query
    const validation = validateSearchQuery(search);
    if (!validation.valid) {
      setError(new Error(validation.error));
      setResults([]);
      return;
    }

    // Check cache
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey)!;
      setResults(cached.results);
      setTotal(cached.total);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await advancedSearch(search, filters, page, limit);
      setResults(response.results);
      setTotal(response.total);
      
      // Cache results
      setCache((prev) => {
        const newCache = new Map(prev);
        newCache.set(cacheKey, response);
        // Keep cache size reasonable
        if (newCache.size > 10) {
          const firstKey = newCache.keys().next().value;
          newCache.delete(firstKey);
        }
        return newCache;
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Search failed');
      setError(error);
      setResults([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [search, filters, page, limit, cacheKey, cache]);

  useEffect(() => {
    performSearch();
  }, [performSearch]);

  const refetch = useCallback(() => {
    setCache(new Map());
    performSearch();
  }, [performSearch]);

  const highlightQuery = useCallback(
    (text: string) => highlightSearchTerms(text, search),
    [search],
  );

  const hasMore = results.length < total;

  return {
    results,
    facets,
    total,
    page: page || 1,
    limit: limit || 20,
    isLoading,
    error,
    search: search || '',
    setSearch,
    filters: filters || {},
    setFilters,
    setPage,
    setLimit,
    refetch,
    hasMore,
    highlightQuery,
  };
}
