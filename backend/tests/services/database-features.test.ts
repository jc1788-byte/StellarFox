import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import QueryAnalyzer from '../../src/services/QueryAnalyzer';
import IndexRecommendationService from '../../src/services/IndexRecommendation';
import BackupService from '../../src/services/BackupService';
import MonitoringService from '../../src/services/MonitoringService';
import PartitioningService from '../../src/services/PartitioningService';

describe('Query Analyzer', () => {
  it('should analyze query execution plan', async () => {
    const query = 'SELECT * FROM markets WHERE status = \'open\' LIMIT 10';
    const analysis = await QueryAnalyzer.analyzeQuery(query);

    expect(analysis).toBeDefined();
    expect(analysis.query).toBe(query);
    expect(analysis.execution_time_ms).toBeGreaterThanOrEqual(0);
    expect(analysis.total_cost).toBeGreaterThanOrEqual(0);
    expect(analysis.recommendations).toBeDefined();
  });

  it('should identify sequential scans', async () => {
    const query = 'SELECT * FROM bets WHERE bettor_address = \'test\'';
    const analysis = await QueryAnalyzer.analyzeQuery(query);

    expect(analysis.uses_seq_scan).toBeDefined();
    expect(typeof analysis.uses_seq_scan).toBe('boolean');
  });

  it('should generate optimization recommendations', async () => {
    const query = 'SELECT * FROM markets ORDER BY created_at DESC LIMIT 100';
    const analysis = await QueryAnalyzer.analyzeQuery(query);

    expect(analysis.recommendations).toBeDefined();
    expect(Array.isArray(analysis.recommendations)).toBe(true);
  });

  it('should fetch slow queries', async () => {
    const slowQueries = await QueryAnalyzer.getSlowQueries(5);

    expect(Array.isArray(slowQueries)).toBe(true);
    slowQueries.forEach((query) => {
      expect(query.query_hash).toBeDefined();
      expect(query.avg_execution_time_ms).toBeGreaterThanOrEqual(0);
      expect(['low', 'medium', 'high', 'critical']).toContain(query.severity);
    });
  });

  it('should reset query statistics', async () => {
    const result = await QueryAnalyzer.resetStatistics();
    expect(result).toBeUndefined(); // Returns void on success
  });
});

describe('Index Recommendation Service', () => {
  it('should get index recommendations', async () => {
    const recommendations = await IndexRecommendationService.getRecommendations();

    expect(Array.isArray(recommendations)).toBe(true);
    recommendations.forEach((rec) => {
      expect(rec.table_name).toBeDefined();
      expect(rec.reason).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(rec.estimated_benefit);
    });
  });

  it('should analyze index performance', async () => {
    const performance = await IndexRecommendationService.analyzeIndexPerformance();

    expect(Array.isArray(performance)).toBe(true);
    performance.forEach((idx) => {
      expect(idx.index_name).toBeDefined();
      expect(idx.table_name).toBeDefined();
      expect(idx.size_mb).toBeGreaterThanOrEqual(0);
    });
  });

  it('should detect index bloat', async () => {
    const bloat = await IndexRecommendationService.analyzeIndexBloat();

    expect(Array.isArray(bloat)).toBe(true);
    bloat.forEach((item) => {
      expect(item.index_name).toBeDefined();
      expect(item.bloat_percentage).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Backup Service', () => {
  let backupId: string;

  it('should create a full backup', async () => {
    const backup = await BackupService.createFullBackup();

    expect(backup).toBeDefined();
    expect(backup.backup_type).toBe('full');
    expect(backup.status).toBe('completed');
    expect(backup.size_bytes).toBeGreaterThan(0);
    expect(backup.checksum).toBeDefined();

    backupId = backup.id;
  });

  it('should create an incremental backup', async () => {
    const backup = await BackupService.createIncrementalBackup();

    expect(backup).toBeDefined();
    expect(backup.backup_type).toBe('incremental');
    expect(backup.status).toBe('completed');
  });

  it('should list backups', async () => {
    const backups = await BackupService.listBackups();

    expect(Array.isArray(backups)).toBe(true);
    expect(backups.length).toBeGreaterThan(0);
  });

  it('should verify backup checksum', async () => {
    const isValid = await BackupService.verifyBackup(backupId);
    expect(typeof isValid).toBe('boolean');
  });

  it('should test backup restoration', async () => {
    const isValid = await BackupService.testRestore(backupId);
    expect(typeof isValid).toBe('boolean');
  });

  it('should delete old backups', async () => {
    const deletedCount = await BackupService.deleteOldBackups();
    expect(typeof deletedCount).toBe('number');
    expect(deletedCount).toBeGreaterThanOrEqual(0);
  });
});

describe('Monitoring Service', () => {
  it('should collect database metrics', async () => {
    const metrics = await MonitoringService.collectMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.timestamp).toBeDefined();
    expect(metrics.connections_active).toBeGreaterThanOrEqual(0);
    expect(metrics.cache_hit_ratio).toBeGreaterThanOrEqual(0);
    expect(metrics.cache_hit_ratio).toBeLessThanOrEqual(100);
  });

  it('should get table metrics', async () => {
    const tableMetrics = await MonitoringService.getTableMetrics();

    expect(Array.isArray(tableMetrics)).toBe(true);
    tableMetrics.forEach((metric) => {
      expect(metric.table_name).toBeDefined();
      expect(metric.row_count).toBeGreaterThanOrEqual(0);
      expect(metric.size_mb).toBeGreaterThanOrEqual(0);
    });
  });

  it('should get query statistics', async () => {
    const stats = await MonitoringService.getQueryStatistics();

    expect(Array.isArray(stats)).toBe(true);
    stats.forEach((stat) => {
      expect(stat.query_hash).toBeDefined();
      expect(stat.execution_count).toBeGreaterThanOrEqual(0);
      expect(['low', 'medium', 'high', 'critical']).toContain(stat.severity);
    });
  });

  it('should detect anomalies', async () => {
    const anomalies = await MonitoringService.detectAnomalies();

    expect(Array.isArray(anomalies)).toBe(true);
    anomalies.forEach((anomaly) => {
      expect(anomaly.id).toBeDefined();
      expect(['performance', 'resource', 'query', 'lock']).toContain(anomaly.type);
      expect(['low', 'medium', 'high', 'critical']).toContain(anomaly.severity);
    });
  });

  it('should store metrics', async () => {
    const metrics = await MonitoringService.collectMetrics();
    const result = await MonitoringService.storeMetrics(metrics);

    expect(result).toBeUndefined(); // Returns void on success
  });
});

describe('Partitioning Service', () => {
  it('should get partition info', async () => {
    const info = await PartitioningService.getPartitionInfo('bets');

    expect(info).toBeDefined();
    expect(info?.table_name).toBe('bets');
  });

  it('should get partitions', async () => {
    const partitions = await PartitioningService.getPartitions('bets');

    expect(Array.isArray(partitions)).toBe(true);
    partitions.forEach((p) => {
      expect(p.partition_name).toBeDefined();
      expect(p.parent_table).toBeDefined();
      expect(p.size_mb).toBeGreaterThanOrEqual(0);
    });
  });

  it('should check constraint exclusion', async () => {
    const enabled = await PartitioningService.isConstraintExclusionEnabled();
    expect(typeof enabled).toBe('boolean');
  });

  it('should enable constraint exclusion', async () => {
    const success = await PartitioningService.enableConstraintExclusion();
    expect(typeof success).toBe('boolean');
  });

  it('should get partition statistics', async () => {
    const stats = await PartitioningService.getPartitionStats('bets');

    if (stats) {
      expect(stats.table_name).toBe('bets');
      expect(stats.total_size_mb).toBeGreaterThanOrEqual(0);
      expect(stats.partition_count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Integration Tests', () => {
  it('should perform end-to-end backup and restore test', async () => {
    // Create backup
    const backup = await BackupService.createFullBackup();
    expect(backup.status).toBe('completed');

    // Verify backup
    const isValid = await BackupService.verifyBackup(backup.id);
    expect(isValid).toBe(true);

    // Test restore
    const canRestore = await BackupService.testRestore(backup.id);
    expect(typeof canRestore).toBe('boolean');
  });

  it('should analyze query performance and recommend optimizations', async () => {
    const query = 'SELECT * FROM bets WHERE placed_at > NOW() - INTERVAL \'7 days\'';

    // Analyze query
    const analysis = await QueryAnalyzer.analyzeQuery(query);
    expect(analysis.recommendations.length).toBeGreaterThanOrEqual(0);

    // Get slow queries
    const slowQueries = await QueryAnalyzer.getSlowQueries(10);
    expect(Array.isArray(slowQueries)).toBe(true);

    // Get index recommendations
    const recommendations = await IndexRecommendationService.getRecommendations();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should detect and report system anomalies', async () => {
    // Collect metrics
    const metrics = await MonitoringService.collectMetrics();
    expect(metrics).toBeDefined();

    // Detect anomalies
    const anomalies = await MonitoringService.detectAnomalies();
    expect(Array.isArray(anomalies)).toBe(true);

    // Get table metrics
    const tableMetrics = await MonitoringService.getTableMetrics();
    expect(Array.isArray(tableMetrics)).toBe(true);
  });
});
