// ============================================================
// BANKERCHANGER — Advanced Search Service
// Implements full-text search, facets, filters, and highlighting
// ============================================================

import type { Market } from '../types';

export interface SearchFacet {
  name: string;
  value: string | number;
  count: number;
}

export interface SearchFacets {
  categories: SearchFacet[];
  statuses: SearchFacet[];
  dateRanges: SearchFacet[];
}

export interface SearchHighlight {
  field: string;
  snippet: string;
}

export interface SearchResult {
  market: Market;
  highlights?: SearchHighlight[];
  score: number;
}

export interface SearchFilter {
  categories?: string[];
  statuses?: string[];
  dateFrom?: string;
  dateTo?: string;
  minPool?: number;
  maxPool?: number;
  weightClasses?: string[];
}

export interface AdvancedSearchResponse {
  results: SearchResult[];
  facets: SearchFacets;
  total: number;
  page: number;
  limit: number;
}

/**
 * Performs full-text search with facets and highlighting
 */
export async function advancedSearch(
  query: string,
  filters?: SearchFilter,
  page = 1,
  limit = 20,
): Promise<AdvancedSearchResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('page', String(page));
  params.set('limit', String(Math.min(limit, 200)));

  if (filters) {
    if (filters.categories?.length) params.set('categories', filters.categories.join(','));
    if (filters.statuses?.length) params.set('statuses', filters.statuses.join(','));
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.minPool !== undefined) params.set('minPool', String(filters.minPool));
    if (filters.maxPool !== undefined) params.set('maxPool', String(filters.maxPool));
    if (filters.weightClasses?.length) params.set('weightClasses', filters.weightClasses.join(','));
  }

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const response = await fetch(`${API_BASE}/api/markets/search/advanced?${params.toString()}`);
  
  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  return response.json() as Promise<AdvancedSearchResponse>;
}

/**
 * Get available facets for search filtering without executing a full search
 */
export async function getSearchFacets(): Promise<SearchFacets> {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const response = await fetch(`${API_BASE}/api/markets/search/facets`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch facets: ${response.statusText}`);
  }

  return response.json() as Promise<SearchFacets>;
}

/**
 * Highlights search terms in a snippet, wrapping them in <mark> tags
 */
export function highlightSearchTerms(text: string, query: string): string {
  if (!query.trim()) return text;
  
  const terms = query.split(/\s+/).filter(t => t.length > 0);
  let highlighted = text;

  for (const term of terms) {
    const regex = new RegExp(`\\b(${term})\\b`, 'gi');
    highlighted = highlighted.replace(regex, '<mark>$1</mark>');
  }

  return highlighted;
}

/**
 * Creates a search snippet from full text, centered around matching terms
 */
export function createSearchSnippet(text: string, query: string, snippetLength = 150): string {
  if (!query.trim()) {
    return text.substring(0, snippetLength) + (text.length > snippetLength ? '...' : '');
  }

  const terms = query.split(/\s+/).filter(t => t.length > 0);
  const lowerText = text.toLowerCase();
  
  // Find first occurrence of any search term
  let firstMatchPos = -1;
  for (const term of terms) {
    const pos = lowerText.indexOf(term.toLowerCase());
    if (pos !== -1 && (firstMatchPos === -1 || pos < firstMatchPos)) {
      firstMatchPos = pos;
    }
  }

  if (firstMatchPos === -1) {
    return text.substring(0, snippetLength) + (text.length > snippetLength ? '...' : '');
  }

  // Create snippet centered around match
  const snippetStart = Math.max(0, firstMatchPos - 50);
  const snippetEnd = Math.min(text.length, firstMatchPos + snippetLength);
  
  let snippet = '';
  if (snippetStart > 0) snippet += '...';
  snippet += text.substring(snippetStart, snippetEnd);
  if (snippetEnd < text.length) snippet += '...';

  return snippet;
}

/**
 * Validates search query for security and performance
 */
export function validateSearchQuery(query: string): { valid: boolean; error?: string } {
  if (!query || query.trim().length === 0) {
    return { valid: false, error: 'Search query cannot be empty' };
  }

  if (query.length > 200) {
    return { valid: false, error: 'Search query too long (max 200 characters)' };
  }

  // Prevent potential injection attacks
  if (/<[^>]*>|javascript:|on\w+=/i.test(query)) {
    return { valid: false, error: 'Invalid search query' };
  }

  return { valid: true };
}

/**
 * Caches search facets to reduce API calls
 */
let cachedFacets: SearchFacets | null = null;
let facetsCacheTime = 0;
const FACETS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedSearchFacets(): Promise<SearchFacets> {
  const now = Date.now();
  if (cachedFacets && now - facetsCacheTime < FACETS_CACHE_TTL) {
    return cachedFacets;
  }

  cachedFacets = await getSearchFacets();
  facetsCacheTime = now;
  return cachedFacets;
}

/**
 * Clears the facets cache (useful after new markets are added)
 */
export function clearFacetsCache(): void {
  cachedFacets = null;
  facetsCacheTime = 0;
}
