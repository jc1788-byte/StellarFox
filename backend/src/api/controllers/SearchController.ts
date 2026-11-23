// ============================================================
// BANKERCHANGER — Search Controller
// Implements advanced search with full-text search, facets, and highlighting
// ============================================================

import type { Request, Response } from 'express';
import { db } from '../../db';
import type { Market } from '../../types';

interface SearchHighlight {
  field: string;
  snippet: string;
}

interface SearchResult {
  market: Market;
  highlights?: SearchHighlight[];
  score: number;
}

interface SearchFacet {
  name: string;
  value: string | number;
  count: number;
}

interface SearchFacets {
  categories: SearchFacet[];
  statuses: SearchFacet[];
  dateRanges: SearchFacet[];
}

interface AdvancedSearchResponse {
  results: SearchResult[];
  facets: SearchFacets;
  total: number;
  page: number;
  limit: number;
}

/**
 * Advanced search with full-text search, filters, facets, and highlighting
 * GET /api/markets/search/advanced
 */
export async function advancedSearch(req: Request, res: Response): Promise<void> {
  try {
    const {
      q = '',
      page = '1',
      limit = '20',
      categories,
      statuses,
      dateFrom,
      dateTo,
      minPool,
      maxPool,
      weightClasses,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 20));
    const query = String(q).trim().substring(0, 200);

    if (!query) {
      res.status(400).json({
        success: false,
        error: 'Search query required',
      });
      return;
    }

    // Build SQL query with full-text search
    let sql = `
      SELECT 
        m.*,
        ts_rank(fts, plainto_tsquery('english', $1)) as search_rank
      FROM markets m
      WHERE 
        fts @@ plainto_tsquery('english', $1)
    `;
    const params: any[] = [query];
    let paramIndex = 2;

    // Apply status filter
    if (statuses) {
      const statusList = String(statuses).split(',').filter(s => s.trim());
      if (statusList.length > 0) {
        sql += ` AND m.status = ANY($${paramIndex})`;
        params.push(statusList);
        paramIndex++;
      }
    }

    // Apply category filter
    if (categories) {
      const categoryList = String(categories).split(',').filter(c => c.trim());
      if (categoryList.length > 0) {
        sql += ` AND m.category = ANY($${paramIndex})`;
        params.push(categoryList);
        paramIndex++;
      }
    }

    // Apply weight class filter
    if (weightClasses) {
      const classList = String(weightClasses).split(',').filter(c => c.trim());
      if (classList.length > 0) {
        sql += ` AND m.weight_class = ANY($${paramIndex})`;
        params.push(classList);
        paramIndex++;
      }
    }

    // Apply date range filter
    if (dateFrom) {
      sql += ` AND m.scheduled_date >= $${paramIndex}::timestamp`;
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      sql += ` AND m.scheduled_date <= $${paramIndex}::timestamp`;
      params.push(dateTo);
      paramIndex++;
    }

    // Apply pool size filter
    if (minPool !== undefined) {
      sql += ` AND m.total_pool >= $${paramIndex}`;
      params.push(parseFloat(String(minPool)));
      paramIndex++;
    }
    if (maxPool !== undefined) {
      sql += ` AND m.total_pool <= $${paramIndex}`;
      params.push(parseFloat(String(maxPool)));
      paramIndex++;
    }

    // Get total count
    const countResult = await db.query(
      sql.replace('SELECT m.*, ts_rank(fts, plainto_tsquery(\'english\', $1)) as search_rank FROM markets m', 
                  'SELECT COUNT(*) as count FROM markets m'),
      params,
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Get paginated results sorted by search rank
    sql += ` ORDER BY search_rank DESC, m.scheduled_date DESC`;
    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum);
    params.push((pageNum - 1) * limitNum);

    const result = await db.query(sql, params);
    const markets = result.rows as Array<Market & { search_rank: number }>;

    // Build highlights for each result
    const resultsWithHighlights: SearchResult[] = markets.map((market) => ({
      market,
      highlights: generateHighlights(market, query),
      score: market.search_rank || 0,
    }));

    // Generate facets based on filtered results
    const facets = await generateFacets(query, statuses, categories, weightClasses, dateFrom, dateTo);

    const response: AdvancedSearchResponse = {
      results: resultsWithHighlights,
      facets,
      total,
      page: pageNum,
      limit: limitNum,
    };

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
    });
  }
}

/**
 * Get search facets for filtering
 * GET /api/markets/search/facets
 */
export async function getSearchFacets(req: Request, res: Response): Promise<void> {
  try {
    const facets = await generateFacets('', undefined, undefined, undefined, undefined, undefined);

    res.json({
      success: true,
      data: facets,
    });
  } catch (error) {
    console.error('Failed to fetch facets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch facets',
    });
  }
}

/**
 * Generates highlights for search results
 */
function generateHighlights(market: Market, query: string): SearchHighlight[] {
  const highlights: SearchHighlight[] = [];
  const queryTerms = query.split(/\s+/).filter(t => t.length > 0);
  const fieldsToSearch = [
    { field: 'fighter_a_name', value: market.fighter_a_name },
    { field: 'fighter_b_name', value: market.fighter_b_name },
    { field: 'weight_class', value: market.weight_class },
    { field: 'venue', value: market.venue || '' },
  ];

  for (const { field, value } of fieldsToSearch) {
    if (!value) continue;

    for (const term of queryTerms) {
      const regex = new RegExp(term, 'gi');
      if (regex.test(value)) {
        const snippet = createSnippet(value, term, 100);
        highlights.push({
          field,
          snippet: highlightTerms(snippet, term),
        });
        break;
      }
    }
  }

  return highlights;
}

/**
 * Creates a snippet around a matched term
 */
function createSnippet(text: string, term: string, maxLength: number): string {
  const lowerText = text.toLowerCase();
  const termIndex = lowerText.indexOf(term.toLowerCase());

  if (termIndex === -1) {
    return text.substring(0, maxLength);
  }

  const snippetStart = Math.max(0, termIndex - 25);
  const snippetEnd = Math.min(text.length, termIndex + term.length + 25);

  let snippet = '';
  if (snippetStart > 0) snippet += '...';
  snippet += text.substring(snippetStart, snippetEnd);
  if (snippetEnd < text.length) snippet += '...';

  return snippet;
}

/**
 * Highlights search terms in a snippet
 */
function highlightTerms(text: string, term: string): string {
  const regex = new RegExp(`(${term})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Generates facets for search filtering
 */
async function generateFacets(
  query: string,
  statuses?: string | string[],
  categories?: string | string[],
  weightClasses?: string | string[],
  dateFrom?: string,
  dateTo?: string,
): Promise<SearchFacets> {
  const facets: SearchFacets = {
    categories: [],
    statuses: [],
    dateRanges: [],
  };

  try {
    // Get category facets
    const categoryResults = await db.query(`
      SELECT category, COUNT(*) as count
      FROM markets
      WHERE category IS NOT NULL
      GROUP BY category
      ORDER BY count DESC
    `);

    facets.categories = categoryResults.rows.map((row) => ({
      name: row.category,
      value: row.category,
      count: parseInt(row.count, 10),
    }));

    // Get status facets
    const statusResults = await db.query(`
      SELECT status, COUNT(*) as count
      FROM markets
      WHERE status IS NOT NULL
      GROUP BY status
      ORDER BY count DESC
    `);

    facets.statuses = statusResults.rows.map((row) => ({
      name: row.status.toUpperCase(),
      value: row.status,
      count: parseInt(row.count, 10),
    }));

    // Get date range facets
    facets.dateRanges = [
      { name: 'Next 7 days', value: '7d', count: 0 },
      { name: 'Next 30 days', value: '30d', count: 0 },
      { name: 'Next 90 days', value: '90d', count: 0 },
    ];

    for (const range of facets.dateRanges) {
      const days = parseInt(String(range.value), 10);
      const result = await db.query(
        `SELECT COUNT(*) as count FROM markets WHERE scheduled_date BETWEEN NOW() AND NOW() + INTERVAL '${days} days'`,
      );
      range.count = parseInt(result.rows[0]?.count || '0', 10);
    }
  } catch (error) {
    console.error('Error generating facets:', error);
  }

  return facets;
}
