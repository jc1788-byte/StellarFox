/**
 * Database Query Optimization Service
 * 
 * Provides strategies for:
 * - Query result caching with TTL
 * - N+1 query prevention via batch loading
 * - Query performance analysis
 * - Indexing recommendations
 */

import { pool } from '../config/db';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import * as cache from './cache.service';

/**
 * Query optimization statistics for monitoring and analysis
 */
interface QueryStats {
  query: string;
  fingerprint: string;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  execCount: number;
  lastExecuted: Date;
}

/**
 * Batch loader for preventing N+1 queries
 * Collects requests and executes a single optimized query
 */
export class DataLoader<K, V> {
  private queue: Map<K, {
    resolve: (value: V) => void;
    reject: (reason: Error) => void;
  }> = new Map();

  private scheduled = false;

  constructor(
    private batchFn: (keys: K[]) => Promise<Map<K, V>>,
    private options?: {
      batchScheduleFn?: (callback: () => void) => void;
      cache?: boolean;
    },
  ) {}

  async load(key: K): Promise<V> {
    // Return from queue if already pending
    if (this.queue.has(key)) {
      return new Promise((resolve, reject) => {
        const existing = this.queue.get(key)!;
        const origResolve = existing.resolve;
        const origReject = existing.reject;
        existing.resolve = (v: V) => {
          resolve(v);
          origResolve(v);
        };
        existing.reject = (e: Error) => {
          reject(e);
          origReject(e);
        };
      });
    }

    return new Promise<V>((resolve, reject) => {
      this.queue.set(key, { resolve, reject });

      if (!this.scheduled) {
        this.scheduled = true;
        const schedule = this.options?.batchScheduleFn || setImmediate;
        schedule(() => this.executeBatch());
      }
    });
  }

  private async executeBatch(): Promise<void> {
    const keys = Array.from(this.queue.keys());
    const promises = this.queue.values();

    try {
      const results = await this.batchFn(keys);

      for (const [key, { resolve }] of this.queue) {
        const value = results.get(key);
        if (value !== undefined) {
          resolve(value);
        }
      }
    } catch (err) {
      for (const { reject } of this.queue.values()) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.queue.clear();
      this.scheduled = false;
    }
  }
}

/**
 * Cached query executor with automatic TTL management
 */
export async function executeCachedQuery<T>(
  key: string,
  query: string,
  params: unknown[],
  ttl: number = 300, // 5 minutes default
): Promise<T[]> {
  // Try cache first
  const cached = await cache.get<T[]>(key);
  if (cached !== null) {
    logger.debug({ key }, 'Query cache hit');
    return cached;
  }

  // Execute query
  const result = await pool.query(query, params);
  const rows = result.rows as T[];

  // Store in cache
  await cache.set(key, rows, ttl);

  return rows;
}

/**
 * Prevent N+1 queries by batch loading related records
 * Example: Load all markets for a list of market IDs in one query
 */
export function createBatchLoader<T>(
  query: string,
  keyColumn: string,
  valueColumn: string,
  options?: {
    batchSize?: number;
    ttl?: number;
  },
): DataLoader<string, T> {
  return new DataLoader(
    async (keys: string[]) => {
      const cacheKey = `batch:${keyColumn}:${valueColumn}:${keys.length}`;
      
      // Try cache first for entire batch
      const cached = await cache.get<Map<string, T>>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
      const sql = `SELECT ${keyColumn}, ${valueColumn} FROM data WHERE ${keyColumn} IN (${placeholders})`;
      
      const result = await pool.query(sql, keys);
      const map = new Map<string, T>();

      for (const row of result.rows) {
        map.set(String(row[keyColumn]), row as T);
      }

      // Cache the batch result
      await cache.set(cacheKey, map, options?.ttl || 300);

      return map;
    },
    { batchScheduleFn: setImmediate, cache: true },
  );
}

/**
 * Get query optimization recommendations based on slow query log
 */
export async function getOptimizationRecommendations(): Promise<string[]> {
  const recommendations: string[] = [];

  try {
    // Analyze table sizes to identify candidates for caching
    const result = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        n_live_tup as row_count
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      LIMIT 10
    `);

    for (const row of result.rows) {
      if (row.row_count > 100000) {
        recommendations.push(
          `Table "${row.tablename}" has ${row.row_count} rows. Consider query caching and pagination.`,
        );
      }
    }

    // Check for missing indexes on frequently filtered columns
    const indexResult = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        attname as column_name,
        n_distinct
      FROM pg_stats
      WHERE n_distinct > 10
        AND schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n_distinct DESC
      LIMIT 20
    `);

    const columnsNeedingIndexes = indexResult.rows.filter(r => r.n_distinct > 100);
    if (columnsNeedingIndexes.length > 0) {
      recommendations.push(
        `High-cardinality columns found without indexes: ${columnsNeedingIndexes.map(r => r.column_name).join(', ')}`,
      );
    }

  } catch (err) {
    logger.warn({ err }, 'Could not generate optimization recommendations');
  }

  return recommendations;
}

/**
 * Enable query statistics tracking
 * Run this at application startup
 */
export async function enableQueryStats(): Promise<void> {
  try {
    // Ensure pg_stat_statements is available
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    logger.info('Query statistics enabled via pg_stat_statements');
  } catch (err) {
    logger.warn({ err }, 'Could not enable query statistics');
  }
}

/**
 * Get top slow queries from statistics
 */
export async function getTopSlowQueries(limit: number = 10): Promise<QueryStats[]> {
  try {
    const result = await pool.query(`
      SELECT 
        query,
        mean_exec_time::numeric::integer as avg_duration,
        max_exec_time::numeric::integer as max_duration,
        min_exec_time::numeric::integer as min_duration,
        calls as exec_count
      FROM pg_stat_statements
      WHERE query NOT LIKE 'pg_%'
      ORDER BY mean_exec_time DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(row => ({
      query: row.query,
      fingerprint: row.query.substring(0, 100),
      avgDuration: row.avg_duration,
      maxDuration: row.max_duration,
      minDuration: row.min_duration,
      execCount: row.exec_count,
      lastExecuted: new Date(),
    }));
  } catch (err) {
    logger.warn({ err }, 'Could not retrieve query statistics');
    return [];
  }
}

/**
 * Analyze and suggest indexes for a table
 */
export async function suggestIndexes(tableName: string): Promise<string[]> {
  const suggestions: string[] = [];

  try {
    // Find columns frequently used in WHERE clauses
    const indexResult = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        attname as column_name,
        n_distinct,
        avg_width
      FROM pg_stats
      WHERE tablename = $1
        AND n_distinct > 10
      ORDER BY n_distinct DESC
    `, [tableName]);

    for (const row of indexResult.rows) {
      if (row.n_distinct > 100) {
        suggestions.push(
          `CREATE INDEX idx_${tableName}_${row.column_name} ON ${tableName}(${row.column_name});`,
        );
      }
    }

    // Suggest composite indexes for frequently joined columns
    const joinResult = await pool.query(`
      SELECT 
        constraint_name,
        table_name,
        column_name
      FROM information_schema.key_column_usage
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    if (joinResult.rows.length > 1) {
      const columns = joinResult.rows.map(r => r.column_name).join(',');
      suggestions.push(
        `-- Consider composite index for frequent joins: CREATE INDEX idx_${tableName}_composite ON ${tableName}(${columns});`,
      );
    }
  } catch (err) {
    logger.warn({ err }, `Could not suggest indexes for table ${tableName}`);
  }

  return suggestions;
}
