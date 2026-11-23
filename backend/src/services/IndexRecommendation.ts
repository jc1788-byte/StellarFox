import { db } from '../db';
import { sql } from 'drizzle-orm';
import { Logger } from '../utils/logger';

export interface IndexRecommendation {
  table_name: string;
  column_name: string;
  index_name: string;
  reason: string;
  estimated_benefit: 'high' | 'medium' | 'low';
  create_statement: string;
  created_at?: Date;
}

export interface IndexPerformance {
  index_name: string;
  table_name: string;
  columns: string[];
  size_mb: number;
  scan_count: number;
  tuple_read: number;
  tuple_fetched: number;
  idx_scan: number;
  last_vacuum: Date | null;
  unused: boolean;
}

const logger = Logger.getLogger('IndexRecommendation');

export class IndexRecommendationService {
  /**
   * Get all index recommendations
   */
  async getRecommendations(): Promise<IndexRecommendation[]> {
    try {
      const recommendations: IndexRecommendation[] = [];

      // Get missing index recommendations
      recommendations.push(...(await this.getMissingIndexes()));

      // Get redundant index recommendations
      recommendations.push(...(await this.getRedundantIndexes()));

      // Get unused index recommendations
      recommendations.push(...(await this.getUnusedIndexes()));

      return recommendations;
    } catch (error) {
      logger.error('Error getting recommendations', { error: String(error) });
      return [];
    }
  }

  /**
   * Find missing indexes based on query patterns
   */
  private async getMissingIndexes(): Promise<IndexRecommendation[]> {
    try {
      const recommendations: IndexRecommendation[] = [];

      // Analyze sequential scans
      const result = await db.execute(
        sql.raw(`
          SELECT 
            schemaname,
            tablename,
            seq_scan,
            seq_tup_read,
            idx_scan,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
          FROM pg_stat_user_tables
          WHERE seq_scan > 1000 AND idx_scan < 100
          ORDER BY seq_tup_read DESC
          LIMIT 10;
        `),
      );

      result.forEach((row: any) => {
        recommendations.push({
          table_name: row.tablename,
          column_name: 'TBD',
          index_name: `idx_${row.tablename}_seq_scan`,
          reason: `High sequential scans (${row.seq_scan}) detected. Consider adding indexes on frequently filtered columns.`,
          estimated_benefit: 'high',
          create_statement: `-- Analyze table to determine best columns\nSELECT * FROM ${row.tablename} LIMIT 0;`,
        });
      });

      return recommendations;
    } catch (error) {
      logger.warn('Error analyzing sequential scans', { error: String(error) });
      return [];
    }
  }

  /**
   * Find redundant indexes
   */
  private async getRedundantIndexes(): Promise<IndexRecommendation[]> {
    try {
      const recommendations: IndexRecommendation[] = [];

      const result = await db.execute(
        sql.raw(`
          SELECT 
            idx1.indrelname as index1,
            idx2.indrelname as index2,
            t.relname as table_name,
            pg_size_pretty(pg_relation_size(idx1.indexrelid)) as size
          FROM 
            pg_class t
            JOIN pg_index idx1 ON t.oid = idx1.indrelid
            JOIN pg_index idx2 ON t.oid = idx2.indrelid
            JOIN pg_class ci1 ON idx1.indexrelid = ci1.oid
            JOIN pg_class ci2 ON idx2.indexrelid = ci2.oid
          WHERE 
            idx1.indrelname < idx2.indrelname
            AND idx1.indkey @> idx2.indkey
            AND idx1.indtype = idx2.indtype
          LIMIT 10;
        `),
      );

      result.forEach((row: any) => {
        recommendations.push({
          table_name: row.table_name,
          column_name: 'multiple',
          index_name: row.index1,
          reason: `Redundant index. ${row.index1} is a superset of ${row.index2}.`,
          estimated_benefit: 'high',
          create_statement: `DROP INDEX IF EXISTS ${row.index1};`,
        });
      });

      return recommendations;
    } catch (error) {
      logger.warn('Error detecting redundant indexes', { error: String(error) });
      return [];
    }
  }

  /**
   * Find unused indexes
   */
  private async getUnusedIndexes(): Promise<IndexRecommendation[]> {
    try {
      const recommendations: IndexRecommendation[] = [];

      const result = await db.execute(
        sql.raw(`
          SELECT 
            t.relname as table_name,
            i.relname as index_name,
            pg_size_pretty(pg_relation_size(i.oid)) as size,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch
          FROM 
            pg_class t
            JOIN pg_index idx ON t.oid = idx.indrelid
            JOIN pg_class i ON idx.indexrelid = i.oid
            JOIN pg_stat_user_indexes si ON i.relname = si.indexrelname
          WHERE 
            idx_scan = 0
            AND i.relname NOT LIKE 'pg_toast%'
            AND pg_relation_size(i.oid) > 1024 * 1024  -- > 1MB
          ORDER BY pg_relation_size(i.oid) DESC
          LIMIT 10;
        `),
      );

      result.forEach((row: any) => {
        recommendations.push({
          table_name: row.table_name,
          column_name: 'N/A',
          index_name: row.index_name,
          reason: `Unused index (${row.size}) consuming disk space. Never scanned since creation.`,
          estimated_benefit: 'high',
          create_statement: `DROP INDEX IF EXISTS ${row.index_name};`,
        });
      });

      return recommendations;
    } catch (error) {
      logger.warn('Error detecting unused indexes', { error: String(error) });
      return [];
    }
  }

  /**
   * Analyze index performance
   */
  async analyzeIndexPerformance(): Promise<IndexPerformance[]> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            schemaname,
            tablename,
            indexname,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch,
            pg_size_pretty(pg_relation_size(indexrelid)) as size,
            last_vacuum
          FROM pg_stat_user_indexes
          ORDER BY idx_scan DESC;
        `),
      );

      return result.map((row: any) => ({
        index_name: row.indexname,
        table_name: row.tablename,
        columns: [], // Would need additional query to get column names
        size_mb: parseFloat(row.size),
        scan_count: row.idx_scan,
        tuple_read: row.idx_tup_read,
        tuple_fetched: row.idx_tup_fetch,
        idx_scan: row.idx_scan,
        last_vacuum: row.last_vacuum ? new Date(row.last_vacuum) : null,
        unused: row.idx_scan === 0,
      }));
    } catch (error) {
      logger.error('Error analyzing index performance', { error: String(error) });
      return [];
    }
  }

  /**
   * Get index bloat analysis
   */
  async analyzeIndexBloat(): Promise<
    Array<{
      index_name: string;
      table_name: string;
      bloat_percentage: number;
      action: string;
    }>
  > {
    try {
      const result = await db.execute(
        sql.raw(`
          WITH idx_data AS (
            SELECT 
              indexrelname,
              tablename,
              round(100 * (pg_relation_size(indexrelid) - 
                pg_relation_size(indexrelid, 'main')) / 
                NULLIF(pg_relation_size(indexrelid), 0)::numeric, 2) as bloat_pct
            FROM pg_stat_user_indexes
          )
          SELECT * FROM idx_data WHERE bloat_pct > 20;
        `),
      );

      return result.map((row: any) => ({
        index_name: row.indexrelname,
        table_name: row.tablename,
        bloat_percentage: row.bloat_pct,
        action: row.bloat_pct > 50 ? 'REINDEX IMMEDIATELY' : 'SCHEDULE REINDEX',
      }));
    } catch (error) {
      logger.warn('Error analyzing index bloat', { error: String(error) });
      return [];
    }
  }

  /**
   * Create recommended index
   */
  async createIndex(recommendation: IndexRecommendation): Promise<boolean> {
    try {
      await db.execute(sql.raw(recommendation.create_statement));
      logger.info('Index created', {
        index_name: recommendation.index_name,
        table: recommendation.table_name,
      });
      return true;
    } catch (error) {
      logger.error('Error creating index', {
        index_name: recommendation.index_name,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Drop unused index
   */
  async dropUnusedIndex(indexName: string): Promise<boolean> {
    try {
      await db.execute(sql.raw(`DROP INDEX IF EXISTS ${indexName} CASCADE;`));
      logger.info('Index dropped', { index_name: indexName });
      return true;
    } catch (error) {
      logger.error('Error dropping index', { index_name: indexName, error: String(error) });
      return false;
    }
  }

  /**
   * Reindex table
   */
  async reindexTable(tableName: string): Promise<boolean> {
    try {
      await db.execute(sql.raw(`REINDEX TABLE CONCURRENTLY ${tableName};`));
      logger.info('Table reindexed', { table_name: tableName });
      return true;
    } catch (error) {
      logger.error('Error reindexing table', { table_name: tableName, error: String(error) });
      return false;
    }
  }

  /**
   * Analyze table
   */
  async analyzeTable(tableName: string): Promise<boolean> {
    try {
      await db.execute(sql.raw(`ANALYZE ${tableName};`));
      logger.info('Table analyzed', { table_name: tableName });
      return true;
    } catch (error) {
      logger.error('Error analyzing table', { table_name: tableName, error: String(error) });
      return false;
    }
  }

  /**
   * Vacuum table
   */
  async vacuumTable(tableName: string, full: boolean = false): Promise<boolean> {
    try {
      const command = full ? `VACUUM FULL ANALYZE ${tableName};` : `VACUUM ANALYZE ${tableName};`;
      await db.execute(sql.raw(command));
      logger.info('Table vacuumed', { table_name: tableName, full });
      return true;
    } catch (error) {
      logger.error('Error vacuuming table', { table_name: tableName, error: String(error) });
      return false;
    }
  }
}

export default new IndexRecommendationService();
