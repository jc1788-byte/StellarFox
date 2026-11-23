import { db } from '../db';
import { sql } from 'drizzle-orm';
import { Logger } from '../utils/logger';

export interface DatabaseMetrics {
  timestamp: Date;
  connections_active: number;
  connections_total: number;
  connections_max: number;
  cache_hit_ratio: number;
  avg_query_time_ms: number;
  slow_queries_count: number;
  lock_count: number;
  sequential_scans_per_sec: number;
  index_scans_per_sec: number;
  disk_usage_mb: number;
  memory_usage_mb: number;
}

export interface QueryMetrics {
  query_hash: string;
  query_text: string;
  execution_count: number;
  total_time_ms: number;
  mean_time_ms: number;
  max_time_ms: number;
  min_time_ms: number;
  stddev_time_ms: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface TableMetrics {
  table_name: string;
  row_count: number;
  size_mb: number;
  seq_scan_count: number;
  idx_scan_count: number;
  last_vacuum: Date | null;
  last_analyze: Date | null;
  growth_rate_mb_per_day: number;
}

export interface Anomaly {
  id: string;
  type: 'performance' | 'resource' | 'query' | 'lock';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  metric_value: number;
  threshold: number;
  detected_at: Date;
  resolved_at?: Date;
}

const logger = Logger.getLogger('MonitoringService');

export class MonitoringService {
  private slowQueryThreshold: number = 1000; // ms
  private connectionThreshold: number = 80; // percentage

  constructor(slowQueryThreshold: number = 1000, connectionThreshold: number = 80) {
    this.slowQueryThreshold = slowQueryThreshold;
    this.connectionThreshold = connectionThreshold;
  }

  /**
   * Collect current database metrics
   */
  async collectMetrics(): Promise<DatabaseMetrics> {
    try {
      const [
        connections,
        cacheHitRatio,
        queryMetrics,
        slowQueries,
        locks,
        sequentialScans,
        indexScans,
      ] = await Promise.all([
        this.getConnectionMetrics(),
        this.getCacheHitRatio(),
        this.getQueryMetrics(),
        this.getSlowQueryCount(),
        this.getLockCount(),
        this.getSequentialScans(),
        this.getIndexScans(),
      ]);

      return {
        timestamp: new Date(),
        connections_active: connections.active,
        connections_total: connections.total,
        connections_max: connections.max,
        cache_hit_ratio: cacheHitRatio,
        avg_query_time_ms: queryMetrics.avg_time,
        slow_queries_count: slowQueries,
        lock_count: locks,
        sequential_scans_per_sec: sequentialScans,
        index_scans_per_sec: indexScans,
        disk_usage_mb: 0,
        memory_usage_mb: 0,
      };
    } catch (error) {
      logger.error('Error collecting metrics', { error: String(error) });
      throw error;
    }
  }

  /**
   * Get connection metrics
   */
  private async getConnectionMetrics(): Promise<{
    active: number;
    total: number;
    max: number;
  }> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            (SELECT count(*) FROM pg_stat_activity) as active,
            (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
          FROM pg_stat_activity
          LIMIT 1;
        `),
      );

      const active = result[0]?.active || 0;
      const max = result[0]?.max || 100;

      return {
        active,
        total: active,
        max,
      };
    } catch (error) {
      logger.error('Error getting connection metrics', { error: String(error) });
      return { active: 0, total: 0, max: 100 };
    }
  }

  /**
   * Get cache hit ratio
   */
  private async getCacheHitRatio(): Promise<number> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            ROUND(
              sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read))::numeric * 100,
              2
            )::float as ratio
          FROM pg_statio_user_tables
          WHERE (heap_blks_hit + heap_blks_read) > 0;
        `),
      );

      return result[0]?.ratio || 0;
    } catch (error) {
      logger.warn('Error getting cache hit ratio', { error: String(error) });
      return 0;
    }
  }

  /**
   * Get query metrics
   */
  private async getQueryMetrics(): Promise<{ avg_time: number }> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            AVG(mean_time) as avg_time
          FROM pg_stat_statements
          WHERE query NOT LIKE '%pg_stat%';
        `),
      );

      return {
        avg_time: result[0]?.avg_time || 0,
      };
    } catch (error) {
      logger.warn('Error getting query metrics', { error: String(error) });
      return { avg_time: 0 };
    }
  }

  /**
   * Get slow query count
   */
  private async getSlowQueryCount(): Promise<number> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT count(*) as count
          FROM pg_stat_statements
          WHERE mean_time > ${this.slowQueryThreshold}
          AND query NOT LIKE '%pg_stat%';
        `),
      );

      return result[0]?.count || 0;
    } catch (error) {
      logger.warn('Error getting slow query count', { error: String(error) });
      return 0;
    }
  }

  /**
   * Get lock count
   */
  private async getLockCount(): Promise<number> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT count(*) as count
          FROM pg_locks
          WHERE NOT granted;
        `),
      );

      return result[0]?.count || 0;
    } catch (error) {
      logger.warn('Error getting lock count', { error: String(error) });
      return 0;
    }
  }

  /**
   * Get sequential scans per second
   */
  private async getSequentialScans(): Promise<number> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            COALESCE(SUM(seq_scan), 0) as total_seq_scans
          FROM pg_stat_user_tables;
        `),
      );

      return (result[0]?.total_seq_scans || 0) / 60; // Average per second
    } catch (error) {
      logger.warn('Error getting sequential scans', { error: String(error) });
      return 0;
    }
  }

  /**
   * Get index scans per second
   */
  private async getIndexScans(): Promise<number> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            COALESCE(SUM(idx_scan), 0) as total_idx_scans
          FROM pg_stat_user_indexes;
        `),
      );

      return (result[0]?.total_idx_scans || 0) / 60; // Average per second
    } catch (error) {
      logger.warn('Error getting index scans', { error: String(error) });
      return 0;
    }
  }

  /**
   * Get table metrics
   */
  async getTableMetrics(): Promise<TableMetrics[]> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            schemaname,
            tablename,
            n_live_tup as row_count,
            pg_total_relation_size(schemaname||'.'||tablename) / (1024 * 1024)::numeric as size_mb,
            seq_scan,
            idx_scan,
            last_vacuum,
            last_analyze
          FROM pg_stat_user_tables
          ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
        `),
      );

      return result.map((row: any) => ({
        table_name: row.tablename,
        row_count: row.row_count,
        size_mb: parseFloat(row.size_mb),
        seq_scan_count: row.seq_scan,
        idx_scan_count: row.idx_scan,
        last_vacuum: row.last_vacuum ? new Date(row.last_vacuum) : null,
        last_analyze: row.last_analyze ? new Date(row.last_analyze) : null,
        growth_rate_mb_per_day: 0, // Would need historical data
      }));
    } catch (error) {
      logger.error('Error getting table metrics', { error: String(error) });
      return [];
    }
  }

  /**
   * Get query metrics
   */
  async getQueryStatistics(): Promise<QueryMetrics[]> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            query_hash,
            query,
            calls,
            total_time,
            mean_time,
            max_time,
            min_time,
            stddev_time
          FROM pg_stat_statements
          WHERE query NOT LIKE '%pg_stat%'
          ORDER BY total_time DESC
          LIMIT 20;
        `),
      );

      return result.map((row: any) => {
        const meanTime = parseFloat(row.mean_time);
        return {
          query_hash: row.query_hash,
          query_text: row.query,
          execution_count: row.calls,
          total_time_ms: parseFloat(row.total_time),
          mean_time_ms: meanTime,
          max_time_ms: parseFloat(row.max_time),
          min_time_ms: parseFloat(row.min_time),
          stddev_time_ms: parseFloat(row.stddev_time) || 0,
          severity: this.determineSeverity(meanTime),
        };
      });
    } catch (error) {
      logger.error('Error getting query statistics', { error: String(error) });
      return [];
    }
  }

  /**
   * Detect anomalies in metrics
   */
  async detectAnomalies(): Promise<Anomaly[]> {
    try {
      const anomalies: Anomaly[] = [];

      // Check connection spike
      const connections = await this.getConnectionMetrics();
      if (connections.active > (connections.max * this.connectionThreshold) / 100) {
        anomalies.push({
          id: `conn_${Date.now()}`,
          type: 'resource',
          severity: 'high',
          message: `High connection count: ${connections.active}/${connections.max}`,
          metric_value: connections.active,
          threshold: (connections.max * this.connectionThreshold) / 100,
          detected_at: new Date(),
        });
      }

      // Check lock wait
      const locks = await this.getLockCount();
      if (locks > 10) {
        anomalies.push({
          id: `lock_${Date.now()}`,
          type: 'lock',
          severity: 'high',
          message: `Lock wait detected: ${locks} waiting locks`,
          metric_value: locks,
          threshold: 10,
          detected_at: new Date(),
        });
      }

      // Check cache hit ratio
      const cacheRatio = await this.getCacheHitRatio();
      if (cacheRatio < 80) {
        anomalies.push({
          id: `cache_${Date.now()}`,
          type: 'performance',
          severity: 'medium',
          message: `Low cache hit ratio: ${cacheRatio.toFixed(2)}%`,
          metric_value: cacheRatio,
          threshold: 80,
          detected_at: new Date(),
        });
      }

      // Check slow queries
      const slowCount = await this.getSlowQueryCount();
      if (slowCount > 5) {
        anomalies.push({
          id: `slow_${Date.now()}`,
          type: 'query',
          severity: 'medium',
          message: `High slow query count: ${slowCount}`,
          metric_value: slowCount,
          threshold: 5,
          detected_at: new Date(),
        });
      }

      return anomalies;
    } catch (error) {
      logger.error('Error detecting anomalies', { error: String(error) });
      return [];
    }
  }

  /**
   * Determine severity based on metric value
   */
  private determineSeverity(value: number): 'critical' | 'high' | 'medium' | 'low' {
    if (value > 5000) return 'critical';
    if (value > 2000) return 'high';
    if (value > 1000) return 'medium';
    return 'low';
  }

  /**
   * Store metrics for historical analysis
   */
  async storeMetrics(metrics: DatabaseMetrics): Promise<void> {
    try {
      // In production, store in time-series database or metrics table
      logger.info('Metrics collected', {
        connections: metrics.connections_active,
        cache_hit_ratio: metrics.cache_hit_ratio,
        slow_queries: metrics.slow_queries_count,
      });
    } catch (error) {
      logger.error('Error storing metrics', { error: String(error) });
    }
  }
}

export default new MonitoringService();
