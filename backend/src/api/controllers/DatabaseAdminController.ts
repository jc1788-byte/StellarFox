import { Request, Response } from 'express';
import partitioningService from '../../services/PartitioningService';
import backupService from '../../services/BackupService';
import monitoringService from '../../services/MonitoringService';
import { Logger } from '../../utils/logger';
import { ApiResponse } from '../../types/api';

const logger = Logger.getLogger('DatabaseAdminController');

export class DatabaseAdminController {
  /**
   * Get partitioning status
   * GET /api/admin/partitions/status
   */
  static async getPartitioningStatus(req: Request, res: Response): Promise<void> {
    try {
      const { table_name } = req.query;

      if (!table_name || typeof table_name !== 'string') {
        res.status(400).json({
          success: false,
          error: 'table_name query parameter is required',
        });
        return;
      }

      const info = await partitioningService.getPartitionInfo(table_name);
      const stats = await partitioningService.getPartitionStats(table_name);

      const response: ApiResponse = {
        success: true,
        data: {
          partition_info: info,
          partition_stats: stats,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error getting partitioning status', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to get partitioning status',
      });
    }
  }

  /**
   * Create monthly partitions
   * POST /api/admin/partitions/create-monthly
   */
  static async createMonthlyPartitions(req: Request, res: Response): Promise<void> {
    try {
      const { table_name, partition_column } = req.body;

      if (!table_name) {
        res.status(400).json({
          success: false,
          error: 'table_name is required',
        });
        return;
      }

      const success = await partitioningService.createMonthlyPartitions(
        table_name,
        partition_column || 'created_at',
      );

      res.json({
        success,
        message: success
          ? `Monthly partitions created for ${table_name}`
          : `Failed to create monthly partitions for ${table_name}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error creating monthly partitions', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to create monthly partitions',
      });
    }
  }

  /**
   * Rotate partitions
   * POST /api/admin/partitions/rotate
   */
  static async rotatePartitions(req: Request, res: Response): Promise<void> {
    try {
      const { table_name } = req.body;

      if (!table_name) {
        res.status(400).json({
          success: false,
          error: 'table_name is required',
        });
        return;
      }

      const success = await partitioningService.rotatePartitions(table_name);

      res.json({
        success,
        message: success
          ? `Partitions rotated for ${table_name}`
          : `Failed to rotate partitions for ${table_name}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error rotating partitions', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to rotate partitions',
      });
    }
  }

  /**
   * Create backup
   * POST /api/admin/backups/create
   */
  static async createBackup(req: Request, res: Response): Promise<void> {
    try {
      const { backup_type } = req.body;

      let metadata;
      if (backup_type === 'incremental') {
        metadata = await backupService.createIncrementalBackup();
      } else {
        metadata = await backupService.createFullBackup();
      }

      const response: ApiResponse = {
        success: true,
        data: {
          backup: metadata,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error creating backup', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to create backup',
      });
    }
  }

  /**
   * List backups
   * GET /api/admin/backups/list
   */
  static async listBackups(req: Request, res: Response): Promise<void> {
    try {
      const backups = await backupService.listBackups();

      const response: ApiResponse = {
        success: true,
        data: {
          backups,
          count: backups.length,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error listing backups', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to list backups',
      });
    }
  }

  /**
   * Restore from backup
   * POST /api/admin/backups/restore
   */
  static async restoreBackup(req: Request, res: Response): Promise<void> {
    try {
      const { backup_id } = req.body;

      if (!backup_id) {
        res.status(400).json({
          success: false,
          error: 'backup_id is required',
        });
        return;
      }

      const success = await backupService.restoreFromBackup(backup_id);

      res.json({
        success,
        message: success ? `Database restored from backup ${backup_id}` : 'Restore failed',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error restoring backup', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to restore backup',
      });
    }
  }

  /**
   * Test backup integrity
   * POST /api/admin/backups/test-restore
   */
  static async testRestore(req: Request, res: Response): Promise<void> {
    try {
      const { backup_id } = req.body;

      if (!backup_id) {
        res.status(400).json({
          success: false,
          error: 'backup_id is required',
        });
        return;
      }

      const success = await backupService.testRestore(backup_id);

      res.json({
        success,
        message: success
          ? `Backup ${backup_id} integrity verified`
          : `Backup ${backup_id} integrity check failed`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error testing backup', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to test backup',
      });
    }
  }

  /**
   * Delete old backups
   * POST /api/admin/backups/cleanup
   */
  static async cleanupOldBackups(req: Request, res: Response): Promise<void> {
    try {
      const deletedCount = await backupService.deleteOldBackups();

      res.json({
        success: true,
        message: `${deletedCount} old backups deleted`,
        deleted_count: deletedCount,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error cleaning up backups', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to clean up backups',
      });
    }
  }

  /**
   * Get database metrics
   * GET /api/admin/monitoring/metrics
   */
  static async getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const [metrics, tableMetrics, queryStats, anomalies] = await Promise.all([
        monitoringService.collectMetrics(),
        monitoringService.getTableMetrics(),
        monitoringService.getQueryStatistics(),
        monitoringService.detectAnomalies(),
      ]);

      const response: ApiResponse = {
        success: true,
        data: {
          database_metrics: metrics,
          table_metrics: tableMetrics,
          query_statistics: queryStats,
          anomalies,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error getting metrics', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to get metrics',
      });
    }
  }

  /**
   * Get health status
   * GET /api/admin/monitoring/health
   */
  static async getHealthStatus(req: Request, res: Response): Promise<void> {
    try {
      const [metrics, anomalies] = await Promise.all([
        monitoringService.collectMetrics(),
        monitoringService.detectAnomalies(),
      ]);

      const health_status = anomalies.length === 0 ? 'healthy' : 'degraded';
      const severity_levels = anomalies.reduce(
        (acc, a) => {
          acc[a.severity] = (acc[a.severity] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const response: ApiResponse = {
        success: true,
        data: {
          status: health_status,
          metrics,
          anomalies,
          severity_summary: severity_levels,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error getting health status', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to get health status',
      });
    }
  }
}

export default DatabaseAdminController;
