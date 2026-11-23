import cron from 'node-cron';
import backupService from '../services/BackupService';
import partitioningService from '../services/PartitioningService';
import monitoringService from '../services/MonitoringService';
import { Logger } from '../utils/logger';

const logger = Logger.getLogger('DatabaseMaintenance');

/**
 * Schedule weekly full backups
 * Default: Sunday 2 AM
 */
export function scheduleFullBackup(schedule: string = '0 2 * * 0') {
  const task = cron.schedule(schedule, async () => {
    try {
      logger.info('Starting scheduled full backup');
      const backup = await backupService.createFullBackup();
      logger.info('Full backup completed', {
        backup_id: backup.id,
        size_mb: backup.size_bytes / (1024 * 1024),
      });
    } catch (error) {
      logger.error('Full backup failed', { error: String(error) });
    }
  });

  logger.info('Full backup scheduled', { schedule });
  return task;
}

/**
 * Schedule daily incremental backups
 * Default: Daily 3 AM
 */
export function scheduleIncrementalBackup(schedule: string = '0 3 * * *') {
  const task = cron.schedule(schedule, async () => {
    try {
      logger.info('Starting scheduled incremental backup');
      const backup = await backupService.createIncrementalBackup();
      logger.info('Incremental backup completed', {
        backup_id: backup.id,
        size_mb: backup.size_bytes / (1024 * 1024),
      });
    } catch (error) {
      logger.error('Incremental backup failed', { error: String(error) });
    }
  });

  logger.info('Incremental backup scheduled', { schedule });
  return task;
}

/**
 * Schedule backup cleanup (retention policy)
 * Default: Daily 4 AM
 */
export function scheduleBackupCleanup(schedule: string = '0 4 * * *') {
  const task = cron.schedule(schedule, async () => {
    try {
      logger.info('Starting backup cleanup');
      const deletedCount = await backupService.deleteOldBackups();
      logger.info('Backup cleanup completed', { deleted_count: deletedCount });
    } catch (error) {
      logger.error('Backup cleanup failed', { error: String(error) });
    }
  });

  logger.info('Backup cleanup scheduled', { schedule });
  return task;
}

/**
 * Schedule monthly partition rotation
 * Default: 1st of month at 1 AM
 */
export function schedulePartitionRotation(
  tables: string[],
  schedule: string = '0 1 1 * *',
) {
  const task = cron.schedule(schedule, async () => {
    try {
      logger.info('Starting partition rotation');
      for (const table of tables) {
        try {
          const success = await partitioningService.rotatePartitions(table);
          logger.info('Partition rotated', { table, success });
        } catch (error) {
          logger.error('Partition rotation failed for table', { table, error: String(error) });
        }
      }
    } catch (error) {
      logger.error('Partition rotation batch failed', { error: String(error) });
    }
  });

  logger.info('Partition rotation scheduled', { schedule, tables });
  return task;
}

/**
 * Schedule metrics collection
 * Default: Every minute
 */
export function scheduleMetricsCollection(schedule: string = '* * * * *') {
  const task = cron.schedule(schedule, async () => {
    try {
      const metrics = await monitoringService.collectMetrics();
      await monitoringService.storeMetrics(metrics);
    } catch (error) {
      logger.error('Metrics collection failed', { error: String(error) });
    }
  });

  logger.info('Metrics collection scheduled', { schedule });
  return task;
}

/**
 * Schedule anomaly detection
 * Default: Every 5 minutes
 */
export function scheduleAnomalyDetection(schedule: string = '*/5 * * * *') {
  const task = cron.schedule(schedule, async () => {
    try {
      const anomalies = await monitoringService.detectAnomalies();
      if (anomalies.length > 0) {
        logger.warn('Anomalies detected', {
          count: anomalies.length,
          anomalies: anomalies.map((a) => ({
            type: a.type,
            severity: a.severity,
            message: a.message,
          })),
        });
      }
    } catch (error) {
      logger.error('Anomaly detection failed', { error: String(error) });
    }
  });

  logger.info('Anomaly detection scheduled', { schedule });
  return task;
}

/**
 * Schedule table statistics update
 * Default: Daily at 5 AM
 */
export function scheduleTableAnalysis(schedule: string = '0 5 * * *') {
  const task = cron.schedule(schedule, async () => {
    try {
      logger.info('Starting table statistics analysis');

      // List of critical tables to analyze
      const tables = ['bets', 'markets', 'users', 'transactions', 'probability_snapshots'];

      for (const table of tables) {
        try {
          await monitoringService.getTableMetrics();
          logger.info('Table analyzed', { table });
        } catch (error) {
          logger.error('Table analysis failed', { table, error: String(error) });
        }
      }
    } catch (error) {
      logger.error('Table analysis batch failed', { error: String(error) });
    }
  });

  logger.info('Table statistics analysis scheduled', { schedule });
  return task;
}

/**
 * Schedule backup integrity testing
 * Default: Weekly on Saturday at 1 AM
 */
export function scheduleBackupValidation(schedule: string = '0 1 * * 6') {
  const task = cron.schedule(schedule, async () => {
    try {
      logger.info('Starting backup validation');

      const backups = await backupService.listBackups();
      if (backups.length === 0) {
        logger.warn('No backups found for validation');
        return;
      }

      // Test the most recent backup
      const latestBackup = backups[0];
      const isValid = await backupService.testRestore(latestBackup.id);

      if (isValid) {
        logger.info('Backup validation passed', { backup_id: latestBackup.id });
      } else {
        logger.error('Backup validation failed', { backup_id: latestBackup.id });
      }
    } catch (error) {
      logger.error('Backup validation failed', { error: String(error) });
    }
  });

  logger.info('Backup validation scheduled', { schedule });
  return task;
}

/**
 * Initialize all database maintenance jobs
 */
export function initializeDatabaseMaintenance() {
  logger.info('Initializing database maintenance jobs');

  const jobs = [];

  // Backup jobs
  if (process.env.ENABLE_BACKUPS !== 'false') {
    jobs.push(scheduleFullBackup(process.env.BACKUP_FULL_SCHEDULE || '0 2 * * 0'));
    jobs.push(scheduleIncrementalBackup(process.env.BACKUP_INCREMENTAL_SCHEDULE || '0 3 * * *'));
    jobs.push(scheduleBackupCleanup(process.env.BACKUP_CLEANUP_SCHEDULE || '0 4 * * *'));
    jobs.push(scheduleBackupValidation(process.env.BACKUP_VALIDATION_SCHEDULE || '0 1 * * 6'));
  }

  // Partitioning jobs
  if (process.env.ENABLE_PARTITIONING !== 'false') {
    const partitionTables = (process.env.PARTITION_TABLES || 'bets,probability_snapshots').split(
      ',',
    );
    jobs.push(
      schedulePartitionRotation(partitionTables, process.env.PARTITION_ROTATION_SCHEDULE || '0 1 1 * *'),
    );
  }

  // Monitoring jobs
  if (process.env.ENABLE_MONITORING !== 'false') {
    jobs.push(scheduleMetricsCollection(process.env.METRICS_COLLECTION_SCHEDULE || '* * * * *'));
    jobs.push(scheduleAnomalyDetection(process.env.ANOMALY_DETECTION_SCHEDULE || '*/5 * * * *'));
    jobs.push(scheduleTableAnalysis(process.env.TABLE_ANALYSIS_SCHEDULE || '0 5 * * *'));
  }

  logger.info(`${jobs.length} database maintenance jobs initialized`);

  return jobs;
}

export default {
  scheduleFullBackup,
  scheduleIncrementalBackup,
  scheduleBackupCleanup,
  schedulePartitionRotation,
  scheduleMetricsCollection,
  scheduleAnomalyDetection,
  scheduleTableAnalysis,
  scheduleBackupValidation,
  initializeDatabaseMaintenance,
};
