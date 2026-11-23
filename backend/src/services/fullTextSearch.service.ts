/**
 * Full-Text Search Service
 *
 * Provides powerful text search capabilities with full-text indexing,
 * query optimization, ranking, and faceted search.
 */

import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import * as pino from 'pino';

const logger = pino.default();

export interface SearchResult<T> {
  id: number;
  item: T;
  score: number;
  highlights: Record<string, string[]>;
}

export interface SearchQuery {
  query: string;
  searchType: 'simple' | 'phrase' | 'boolean'; // simple, phrase, or boolean operators
  limit?: number;
  offset?: number;
  filters?: Record<string, any>;
}

export interface SearchIndexConfig {
  table: string;
  fields: string[];
  languageConfig?: string; // 'english', 'simple', etc.
  indexed: boolean;
}

/**
 * Initialize full-text search indexes
 */
export async function initializeFullTextIndexes(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Enable text search extensions
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE EXTENSION IF NOT EXISTS unaccent;

      -- Create GIN indexes for full-text search on markets
      CREATE INDEX IF NOT EXISTS idx_markets_fts ON markets 
        USING gin(to_tsvector('english', 
          coalesce(fighter_a, '') || ' ' ||
          coalesce(fighter_b, '') || ' ' ||
          coalesce(weight_class, '') || ' ' ||
          coalesce(venue, '')
        ));

      -- Create trigram indexes for fuzzy search
      CREATE INDEX IF NOT EXISTS idx_markets_fighter_a_trgm ON markets 
        USING gin (fighter_a gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_markets_fighter_b_trgm ON markets 
        USING gin (fighter_b gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_markets_venue_trgm ON markets 
        USING gin (venue gin_trgm_ops);

      -- Create full-text indexes on disputes
      CREATE INDEX IF NOT EXISTS idx_disputes_fts ON disputes
        USING gin(to_tsvector('english', 
          coalesce(reason, '') || ' ' ||
          coalesce(admin_notes, '')
        ));

      -- Create indexes for blockchain events
      CREATE INDEX IF NOT EXISTS idx_blockchain_events_fts ON blockchain_events
        USING gin(to_tsvector('english', 
          coalesce(event_type, '') || ' ' ||
          jsonb_to_text(payload)
        ));
    `);

    logger.info('Full-text search indexes initialized');
  } finally {
    client.release();
  }
}

/**
 * Create a custom search index
 */
export async function createSearchIndex(
  tableName: string,
  indexName: string,
  fields: string[],
  language: string = 'english',
): Promise<void> {
  const fieldConcatenation = fields
    .map((field) => `coalesce(${field}, '')`)
    .join(" || ' ' || ");

  const query = `
    CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}
    USING gin(to_tsvector('${language}', ${fieldConcatenation}));
  `;

  await pool.query(query);
  logger.info(`Created search index ${indexName} on ${tableName}`);
}

/**
 * Simple text search with ranking
 */
export async function searchMarkets(
  searchQuery: SearchQuery,
): Promise<SearchResult<any>[]> {
  const { query, limit = 20, offset = 0, filters = {}, searchType = 'simple' } = searchQuery;

  let tsQuery: string;
  switch (searchType) {
    case 'phrase':
      tsQuery = `phraseto_tsquery('english', $1)`;
      break;
    case 'boolean':
      tsQuery = `to_tsquery('english', $1)`;
      break;
    case 'simple':
    default:
      tsQuery = `plainto_tsquery('english', $1)`;
  }

  const statusFilter = filters.status ? `AND status = $3` : '';
  const categoryFilter = filters.category ? `AND LOWER(weight_class) = LOWER($4)` : '';

  const result = await pool.query<any>(
    `
    SELECT 
      id,
      market_id,
      fighter_a,
      fighter_b,
      weight_class,
      venue,
      status,
      scheduled_at,
      pool_a,
      pool_b,
      ts_rank(
        to_tsvector('english', 
          coalesce(fighter_a, '') || ' ' ||
          coalesce(fighter_b, '') || ' ' ||
          coalesce(weight_class, '') || ' ' ||
          coalesce(venue, '')
        ),
        ${tsQuery}
      ) as score,
      ts_headline('english',
        coalesce(fighter_a, '') || ' ' || coalesce(fighter_b, ''),
        ${tsQuery},
        'StartSel=<strong>, StopSel=</strong>'
      ) as headline
    FROM markets
    WHERE 
      to_tsvector('english', 
        coalesce(fighter_a, '') || ' ' ||
        coalesce(fighter_b, '') || ' ' ||
        coalesce(weight_class, '') || ' ' ||
        coalesce(venue, '')
      ) @@ ${tsQuery}
      AND deleted_at IS NULL
      ${statusFilter}
      ${categoryFilter}
    ORDER BY score DESC, scheduled_at DESC
    LIMIT $2 OFFSET $5;
    `,
    [
      query,
      limit,
      filters.status,
      filters.category,
      offset,
    ],
  );

  return result.rows.map((row) => ({
    id: row.id,
    item: {
      market_id: row.market_id,
      fighter_a: row.fighter_a,
      fighter_b: row.fighter_b,
      weight_class: row.weight_class,
      venue: row.venue,
      status: row.status,
      scheduled_at: row.scheduled_at,
      pools: {
        a: row.pool_a,
        b: row.pool_b,
      },
    },
    score: parseFloat(row.score),
    highlights: {
      headline: [row.headline],
    },
  }));
}

/**
 * Fuzzy search using trigram similarity
 */
export async function fuzzySearchFighters(
  query: string,
  limit: number = 10,
): Promise<Array<{ name: string; similarity: number }>> {
  const result = await pool.query<any>(
    `
    SELECT DISTINCT fighter_a as name, similarity(fighter_a, $1) as similarity
    FROM markets
    WHERE fighter_a % $1
    UNION ALL
    SELECT DISTINCT fighter_b as name, similarity(fighter_b, $1) as similarity
    FROM markets
    WHERE fighter_b % $1
    ORDER BY similarity DESC
    LIMIT $2;
    `,
    [query, limit],
  );

  return result.rows;
}

/**
 * Advanced search with facets
 */
export async function searchWithFacets(
  query: string,
  limit: number = 20,
): Promise<{
  results: SearchResult<any>[];
  facets: {
    categories: Array<{ value: string; count: number }>;
    statuses: Array<{ value: string; count: number }>;
    venues: Array<{ value: string; count: number }>;
  };
}> {
  const tsQuery = `plainto_tsquery('english', $1)`;

  // Main search results
  const resultsQuery = await pool.query<any>(
    `
    SELECT 
      id, market_id, fighter_a, fighter_b, weight_class, venue, status,
      ts_rank(
        to_tsvector('english', 
          coalesce(fighter_a, '') || ' ' || coalesce(fighter_b, '') || ' ' ||
          coalesce(weight_class, '') || ' ' || coalesce(venue, '')
        ),
        ${tsQuery}
      ) as score
    FROM markets
    WHERE to_tsvector('english', 
            coalesce(fighter_a, '') || ' ' || coalesce(fighter_b, '') || ' ' ||
            coalesce(weight_class, '') || ' ' || coalesce(venue, '')
          ) @@ ${tsQuery}
      AND deleted_at IS NULL
    ORDER BY score DESC
    LIMIT $2;
    `,
    [query, limit],
  );

  // Facet counts
  const facetsQuery = await pool.query<any>(
    `
    SELECT
      (SELECT json_object_agg(weight_class, cnt ORDER BY cnt DESC)
       FROM (SELECT weight_class, COUNT(*) as cnt FROM markets
             WHERE to_tsvector('english',
                   coalesce(fighter_a, '') || ' ' || coalesce(fighter_b, '') || ' ' ||
                   coalesce(weight_class, '') || ' ' || coalesce(venue, '')
                 ) @@ ${tsQuery}
             AND deleted_at IS NULL
             GROUP BY weight_class) t) as categories,
      (SELECT json_object_agg(status, cnt ORDER BY cnt DESC)
       FROM (SELECT status, COUNT(*) as cnt FROM markets
             WHERE to_tsvector('english',
                   coalesce(fighter_a, '') || ' ' || coalesce(fighter_b, '') || ' ' ||
                   coalesce(weight_class, '') || ' ' || coalesce(venue, '')
                 ) @@ ${tsQuery}
             AND deleted_at IS NULL
             GROUP BY status) t) as statuses,
      (SELECT json_object_agg(venue, cnt ORDER BY cnt DESC)
       FROM (SELECT venue, COUNT(*) as cnt FROM markets
             WHERE to_tsvector('english',
                   coalesce(fighter_a, '') || ' ' || coalesce(fighter_b, '') || ' ' ||
                   coalesce(weight_class, '') || ' ' || coalesce(venue, '')
                 ) @@ ${tsQuery}
             AND deleted_at IS NULL
             GROUP BY venue) t) as venues
    `,
    [query],
  );

  const facetData = facetsQuery.rows[0];

  return {
    results: resultsQuery.rows.map((row) => ({
      id: row.id,
      item: {
        market_id: row.market_id,
        fighter_a: row.fighter_a,
        fighter_b: row.fighter_b,
        weight_class: row.weight_class,
        venue: row.venue,
        status: row.status,
      },
      score: parseFloat(row.score),
      highlights: {},
    })),
    facets: {
      categories: Object.entries(facetData.categories || {}).map(([value, count]) => ({
        value,
        count: count as number,
      })),
      statuses: Object.entries(facetData.statuses || {}).map(([value, count]) => ({
        value,
        count: count as number,
      })),
      venues: Object.entries(facetData.venues || {}).map(([value, count]) => ({
        value,
        count: count as number,
      })),
    },
  };
}

/**
 * Get search suggestions
 */
export async function getSearchSuggestions(prefix: string, limit: number = 5): Promise<string[]> {
  const result = await pool.query<any>(
    `
    SELECT DISTINCT fighter_a as suggestion
    FROM markets
    WHERE fighter_a ILIKE $1 || '%'
    UNION ALL
    SELECT DISTINCT fighter_b
    FROM markets
    WHERE fighter_b ILIKE $1 || '%'
    UNION ALL
    SELECT DISTINCT weight_class
    FROM markets
    WHERE weight_class ILIKE $1 || '%'
    ORDER BY suggestion
    LIMIT $2;
    `,
    [prefix, limit],
  );

  return result.rows.map((row) => row.suggestion);
}

/**
 * Search disputes with full-text
 */
export async function searchDisputes(
  query: string,
  limit: number = 20,
  offset: number = 0,
): Promise<SearchResult<any>[]> {
  const result = await pool.query<any>(
    `
    SELECT
      id,
      market_id,
      reason,
      status,
      raised_at,
      ts_rank(
        to_tsvector('english', coalesce(reason, '') || ' ' || coalesce(admin_notes, '')),
        plainto_tsquery('english', $1)
      ) as score
    FROM disputes
    WHERE to_tsvector('english', coalesce(reason, '') || ' ' || coalesce(admin_notes, ''))
      @@ plainto_tsquery('english', $1)
    ORDER BY score DESC, raised_at DESC
    LIMIT $2 OFFSET $3;
    `,
    [query, limit, offset],
  );

  return result.rows.map((row) => ({
    id: row.id,
    item: {
      market_id: row.market_id,
      reason: row.reason,
      status: row.status,
      raised_at: row.raised_at,
    },
    score: parseFloat(row.score),
    highlights: {},
  }));
}

/**
 * Reindex all full-text search indexes
 */
export async function reindexSearchIndexes(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      REINDEX INDEX CONCURRENTLY idx_markets_fts;
      REINDEX INDEX CONCURRENTLY idx_disputes_fts;
      REINDEX INDEX CONCURRENTLY idx_blockchain_events_fts;
    `);
    logger.info('Search indexes reindexed');
  } finally {
    client.release();
  }
}

/**
 * Get index statistics
 */
export async function getIndexStatistics(): Promise<any> {
  const result = await pool.query(`
    SELECT
      schemaname,
      tablename,
      indexname,
      idx_scan as scans,
      idx_tup_read as tuples_read,
      idx_tup_fetch as tuples_fetched,
      pg_size_pretty(pg_relation_size(indexrelid)) as size
    FROM pg_stat_user_indexes
    WHERE indexname LIKE 'idx_%fts%' OR indexname LIKE 'idx_%trgm%'
    ORDER BY idx_scan DESC;
  `);

  return result.rows;
}
