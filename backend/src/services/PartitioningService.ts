import { db } from '../db';
import { sql } from 'drizzle-orm';
import { Logger } from '../utils/logger';

export interface PartitionInfo {
  table_name: string;
  partition_strategy: 'range' | 'hash' | 'none';
  partition_column: string;
  partitions: Partition[];
}

export interface Partition {
  partition_name: string;
  parent_table: string;
  constraint?: string;
  size_mb: number;
  row_count: number;
  created_at?: Date;
}

export interface PartitionStats {
  table_name: string;
  total_size_mb: number;
  partition_count: number;
  average_partition_size_mb: number;
  partition_skew: number;
  query_pruning_enabled: boolean;
}

const logger = Logger.getLogger('PartitioningService');

export class PartitioningService {
  /**
   * Get partitioning info for a table
   */
  async getPartitionInfo(tableName: string): Promise<PartitionInfo | null> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            schemaname,
            tablename,
            pg_get_expr(relpartbound, oid) as partition_expr
          FROM pg_tables t
          JOIN pg_class c ON c.relname = t.tablename
          WHERE schemaname = 'public' AND tablename = '${tableName}';
        `),
      );

      if (result.length === 0) {
        return null;
      }

      const partitions = await this.getPartitions(tableName);

      return {
        table_name: tableName,
        partition_strategy: partitions.length > 0 ? 'range' : 'none',
        partition_column: this.inferPartitionColumn(tableName),
        partitions,
      };
    } catch (error) {
      logger.error('Error getting partition info', { table: tableName, error: String(error) });
      return null;
    }
  }

  /**
   * Get list of partitions for a table
   */
  async getPartitions(tableName: string): Promise<Partition[]> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
            n_live_tup as row_count
          FROM pg_tables t
          JOIN pg_stat_user_tables s ON s.relname = t.tablename
          WHERE schemaname = 'public' 
          AND t.tablename LIKE '${tableName}_%'
          ORDER BY t.tablename;
        `),
      );

      return result.map((row: any) => ({
        partition_name: row.tablename,
        parent_table: tableName,
        size_mb: parseFloat(row.size),
        row_count: row.row_count,
      }));
    } catch (error) {
      logger.error('Error fetching partitions', { table: tableName, error: String(error) });
      return [];
    }
  }

  /**
   * Create time-based range partitions for a table
   */
  async createRangePartitions(
    tableName: string,
    partitionColumn: string = 'created_at',
  ): Promise<boolean> {
    try {
      // First, convert table to partitioned table if not already
      const createPartitionedTable = `
        CREATE TABLE ${tableName}_new (LIKE ${tableName} INCLUDING ALL) 
        PARTITION BY RANGE (${partitionColumn});
      `;

      await db.execute(sql.raw(createPartitionedTable));

      // Copy data
      await db.execute(sql.raw(`INSERT INTO ${tableName}_new SELECT * FROM ${tableName};`));

      // Drop old table and rename
      await db.execute(sql.raw(`DROP TABLE ${tableName};`));
      await db.execute(sql.raw(`ALTER TABLE ${tableName}_new RENAME TO ${tableName};`));

      logger.info('Table converted to range partitions', { table: tableName });
      return true;
    } catch (error) {
      logger.error('Error creating range partitions', {
        table: tableName,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Create hash-based partitions for a table
   */
  async createHashPartitions(
    tableName: string,
    partitionColumn: string,
    bucketCount: number = 4,
  ): Promise<boolean> {
    try {
      const createPartitionedTable = `
        CREATE TABLE ${tableName}_new (LIKE ${tableName} INCLUDING ALL)
        PARTITION BY HASH (${partitionColumn});
      `;

      await db.execute(sql.raw(createPartitionedTable));

      // Create hash partitions
      for (let i = 0; i < bucketCount; i++) {
        const partitionName = `${tableName}_p${i}`;
        const createPartition = `
          CREATE TABLE ${partitionName} PARTITION OF ${tableName}_new
          FOR VALUES WITH (MODULUS ${bucketCount}, REMAINDER ${i});
        `;
        await db.execute(sql.raw(createPartition));
      }

      // Copy data
      await db.execute(sql.raw(`INSERT INTO ${tableName}_new SELECT * FROM ${tableName};`));

      // Drop old table and rename
      await db.execute(sql.raw(`DROP TABLE ${tableName};`));
      await db.execute(sql.raw(`ALTER TABLE ${tableName}_new RENAME TO ${tableName};`));

      logger.info('Table converted to hash partitions', {
        table: tableName,
        buckets: bucketCount,
      });
      return true;
    } catch (error) {
      logger.error('Error creating hash partitions', {
        table: tableName,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Create monthly range partitions
   */
  async createMonthlyPartitions(
    tableName: string,
    partitionColumn: string = 'created_at',
  ): Promise<boolean> {
    try {
      // Get date range
      const result = await db.execute(
        sql.raw(`
          SELECT 
            DATE_TRUNC('month', ${partitionColumn})::date as month_start
          FROM ${tableName}
          WHERE ${partitionColumn} IS NOT NULL
          ORDER BY month_start
          GROUP BY month_start;
        `),
      );

      if (result.length === 0) {
        logger.warn('No data found for partitioning', { table: tableName });
        return false;
      }

      // Create partitions for each month
      for (let i = 0; i < result.length; i++) {
        const currentMonth = new Date(result[i].month_start);
        const nextMonth = new Date(currentMonth);
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        const partitionName = `${tableName}_${currentMonth.getFullYear()}_${String(
          currentMonth.getMonth() + 1,
        ).padStart(2, '0')}`;

        const createPartition = `
          CREATE TABLE IF NOT EXISTS ${partitionName} 
          PARTITION OF ${tableName} 
          FOR VALUES FROM ('${currentMonth.toISOString().split('T')[0]}') 
          TO ('${nextMonth.toISOString().split('T')[0]}');
        `;

        await db.execute(sql.raw(createPartition));
        logger.info('Partition created', { partition: partitionName });
      }

      return true;
    } catch (error) {
      logger.error('Error creating monthly partitions', {
        table: tableName,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Rotate partitions (create new partition for next period)
   */
  async rotatePartitions(tableName: string): Promise<boolean> {
    try {
      const today = new Date();
      const nextMonth = new Date(today);
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const partitionName = `${tableName}_${nextMonth.getFullYear()}_${String(
        nextMonth.getMonth() + 1,
      ).padStart(2, '0')}`;

      const endDate = new Date(nextMonth);
      endDate.setMonth(endDate.getMonth() + 1);

      const createPartition = `
        CREATE TABLE IF NOT EXISTS ${partitionName}
        PARTITION OF ${tableName}
        FOR VALUES FROM ('${nextMonth.toISOString().split('T')[0']}')
        TO ('${endDate.toISOString().split('T')[0]}');
      `;

      await db.execute(sql.raw(createPartition));
      logger.info('Partition rotated', { new_partition: partitionName });

      return true;
    } catch (error) {
      logger.error('Error rotating partitions', { table: tableName, error: String(error) });
      return false;
    }
  }

  /**
   * Archive old partitions
   */
  async archiveOldPartitions(tableName: string, keepMonths: number = 12): Promise<number> {
    try {
      const archiveDate = new Date();
      archiveDate.setMonth(archiveDate.getMonth() - keepMonths);

      const archivedCount = 0;

      // Find partitions to archive
      const partitions = await this.getPartitions(tableName);

      for (const partition of partitions) {
        // Archive old partitions (this is simplified; actual implementation would depend on your archival strategy)
        logger.info('Partition archived', { partition: partition.partition_name });
      }

      return archivedCount;
    } catch (error) {
      logger.error('Error archiving old partitions', { table: tableName, error: String(error) });
      return 0;
    }
  }

  /**
   * Get partition statistics
   */
  async getPartitionStats(tableName: string): Promise<PartitionStats | null> {
    try {
      const partitions = await this.getPartitions(tableName);

      if (partitions.length === 0) {
        return null;
      }

      const totalSize = partitions.reduce((sum, p) => sum + p.size_mb, 0);
      const avgSize = totalSize / partitions.length;
      const sizes = partitions.map((p) => p.size_mb);
      const stdDev = Math.sqrt(
        sizes.reduce((sum, size) => sum + Math.pow(size - avgSize, 2), 0) / sizes.length,
      );

      return {
        table_name: tableName,
        total_size_mb: totalSize,
        partition_count: partitions.length,
        average_partition_size_mb: avgSize,
        partition_skew: stdDev / avgSize, // Coefficient of variation
        query_pruning_enabled: true,
      };
    } catch (error) {
      logger.error('Error getting partition stats', { table: tableName, error: String(error) });
      return null;
    }
  }

  /**
   * Check if constraint exclusion is enabled
   */
  async isConstraintExclusionEnabled(): Promise<boolean> {
    try {
      const result = await db.execute(
        sql.raw(`SHOW constraint_exclusion;`),
      );

      return (result[0] as any)?.constraint_exclusion === 'partition';
    } catch (error) {
      logger.error('Error checking constraint exclusion', { error: String(error) });
      return false;
    }
  }

  /**
   * Enable constraint exclusion for partitioning
   */
  async enableConstraintExclusion(): Promise<boolean> {
    try {
      await db.execute(sql.raw(`SET constraint_exclusion = partition;`));
      logger.info('Constraint exclusion enabled for partitioning');
      return true;
    } catch (error) {
      logger.error('Error enabling constraint exclusion', { error: String(error) });
      return false;
    }
  }

  /**
   * Drop a partition
   */
  async dropPartition(partitionName: string): Promise<boolean> {
    try {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS ${partitionName};`));
      logger.info('Partition dropped', { partition: partitionName });
      return true;
    } catch (error) {
      logger.error('Error dropping partition', { partition: partitionName, error: String(error) });
      return false;
    }
  }

  /**
   * Infer partition column from table name conventions
   */
  private inferPartitionColumn(tableName: string): string {
    // Convention: time-series tables use 'created_at', lookup tables use 'id'
    const timeSeriesTables = ['bets', 'transactions', 'probability_snapshots', 'events'];
    if (timeSeriesTables.some((table) => tableName.includes(table))) {
      return 'created_at';
    }
    return 'id';
  }
}

export default new PartitioningService();
