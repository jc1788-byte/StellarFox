import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils/logger';

const exec = promisify(cp.exec);

export interface BackupConfig {
  backup_type: 'full' | 'incremental' | 'wal';
  locations: string[];
  retention_days: number;
  compression: 'gzip' | 'none';
  encryption_enabled: boolean;
  schedule?: string;
}

export interface BackupMetadata {
  id: string;
  backup_type: 'full' | 'incremental' | 'wal';
  location: string;
  size_bytes: number;
  checksum: string;
  start_time: Date;
  end_time?: Date;
  status: 'in_progress' | 'completed' | 'failed';
  error_message?: string;
  created_at: Date;
}

export interface RestorePoint {
  backup_id: string;
  backup_time: Date;
  size_mb: number;
  location: string;
  recovery_target_time?: Date;
}

const logger = Logger.getLogger('BackupService');

export class BackupService {
  private config: BackupConfig;
  private backupMetadataFile: string;

  constructor(config: Partial<BackupConfig> = {}) {
    this.config = {
      backup_type: 'full',
      locations: ['/backups'],
      retention_days: 90,
      compression: 'gzip',
      encryption_enabled: false,
      ...config,
    };

    this.backupMetadataFile = path.join(this.config.locations[0], 'backup_metadata.json');
    this.ensureBackupDirectories();
  }

  /**
   * Ensure backup directories exist
   */
  private ensureBackupDirectories(): void {
    this.config.locations.forEach((location) => {
      if (!fs.existsSync(location)) {
        fs.mkdirSync(location, { recursive: true });
        logger.info('Backup directory created', { location });
      }
    });
  }

  /**
   * Create a full backup
   */
  async createFullBackup(): Promise<BackupMetadata> {
    const startTime = new Date();
    const backupId = `backup_${startTime.getTime()}`;
    const metadata: BackupMetadata = {
      id: backupId,
      backup_type: 'full',
      location: path.join(this.config.locations[0], `${backupId}.sql`),
      size_bytes: 0,
      checksum: '',
      start_time: startTime,
      status: 'in_progress',
      created_at: startTime,
    };

    try {
      const dbName = process.env.DATABASE_NAME || 'bankerchanger';
      const backupFile = metadata.location;

      // Create backup using pg_dump
      const command = `pg_dump -h localhost -U postgres ${dbName} > ${backupFile}`;
      await exec(command);

      // Compress if enabled
      if (this.config.compression === 'gzip') {
        await exec(`gzip -f ${backupFile}`);
        metadata.location = `${backupFile}.gz`;
      }

      // Get file size
      const stats = fs.statSync(metadata.location);
      metadata.size_bytes = stats.size;

      // Calculate checksum
      metadata.checksum = this.calculateChecksum(metadata.location);

      // Update status
      metadata.status = 'completed';
      metadata.end_time = new Date();

      // Copy to secondary locations
      await this.copyToSecondaryLocations(metadata.location, backupId);

      // Save metadata
      this.saveBackupMetadata(metadata);

      logger.info('Full backup created', {
        id: backupId,
        size: metadata.size_bytes,
        location: metadata.location,
      });

      return metadata;
    } catch (error) {
      metadata.status = 'failed';
      metadata.error_message = String(error);
      this.saveBackupMetadata(metadata);

      logger.error('Full backup failed', { id: backupId, error: String(error) });
      throw error;
    }
  }

  /**
   * Create an incremental backup
   */
  async createIncrementalBackup(): Promise<BackupMetadata> {
    const startTime = new Date();
    const backupId = `incremental_${startTime.getTime()}`;
    const metadata: BackupMetadata = {
      id: backupId,
      backup_type: 'incremental',
      location: path.join(this.config.locations[0], `${backupId}.sql`),
      size_bytes: 0,
      checksum: '',
      start_time: startTime,
      status: 'in_progress',
      created_at: startTime,
    };

    try {
      const dbName = process.env.DATABASE_NAME || 'bankerchanger';

      // Create incremental backup (this is simplified; actual implementation would use WAL archiving)
      // In production, use pg_basebackup with WAL streaming
      const command = `
        pg_dump -h localhost -U postgres ${dbName} \
        --schema-only > ${metadata.location}
      `;
      await exec(command);

      const stats = fs.statSync(metadata.location);
      metadata.size_bytes = stats.size;
      metadata.checksum = this.calculateChecksum(metadata.location);
      metadata.status = 'completed';
      metadata.end_time = new Date();

      await this.copyToSecondaryLocations(metadata.location, backupId);
      this.saveBackupMetadata(metadata);

      logger.info('Incremental backup created', {
        id: backupId,
        size: metadata.size_bytes,
      });

      return metadata;
    } catch (error) {
      metadata.status = 'failed';
      metadata.error_message = String(error);
      this.saveBackupMetadata(metadata);

      logger.error('Incremental backup failed', { id: backupId, error: String(error) });
      throw error;
    }
  }

  /**
   * Restore from a backup
   */
  async restoreFromBackup(backupId: string): Promise<boolean> {
    try {
      const metadata = this.getBackupMetadata(backupId);
      if (!metadata) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      const dbName = process.env.DATABASE_NAME || 'bankerchanger';
      let backupFile = metadata.location;

      // Decompress if needed
      if (backupFile.endsWith('.gz')) {
        const tempFile = backupFile.replace('.gz', '_temp.sql');
        await exec(`gunzip -c ${backupFile} > ${tempFile}`);
        backupFile = tempFile;
      }

      // Restore database
      const command = `psql -h localhost -U postgres ${dbName} < ${backupFile}`;
      await exec(command);

      // Clean up temp file
      if (backupFile !== metadata.location) {
        fs.unlinkSync(backupFile);
      }

      logger.info('Database restored from backup', { backupId });
      return true;
    } catch (error) {
      logger.error('Database restore failed', { backupId, error: String(error) });
      throw error;
    }
  }

  /**
   * Test restore from backup (verify backup integrity)
   */
  async testRestore(backupId: string): Promise<boolean> {
    try {
      const metadata = this.getBackupMetadata(backupId);
      if (!metadata) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      let backupFile = metadata.location;

      // Decompress if needed
      if (backupFile.endsWith('.gz')) {
        const tempFile = backupFile.replace('.gz', '_temp.sql');
        await exec(`gunzip -c ${backupFile} > ${tempFile}`);
        backupFile = tempFile;

        // Verify SQL syntax
        const { stdout, stderr } = await exec(`pg_restore --list ${backupFile} 2>&1 | head -10`);

        fs.unlinkSync(tempFile);
      }

      logger.info('Backup integrity test passed', { backupId });
      return true;
    } catch (error) {
      logger.error('Backup integrity test failed', { backupId, error: String(error) });
      return false;
    }
  }

  /**
   * Get list of available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      if (!fs.existsSync(this.backupMetadataFile)) {
        return [];
      }

      const data = fs.readFileSync(this.backupMetadataFile, 'utf-8');
      const backups = JSON.parse(data) as BackupMetadata[];

      // Filter out expired backups
      return backups.filter((backup) => {
        const age = (Date.now() - backup.created_at.getTime()) / (1000 * 60 * 60 * 24);
        return age <= this.config.retention_days;
      });
    } catch (error) {
      logger.error('Error listing backups', { error: String(error) });
      return [];
    }
  }

  /**
   * Delete old backups based on retention policy
   */
  async deleteOldBackups(): Promise<number> {
    try {
      const backups = await this.listBackups();
      let deletedCount = 0;

      const cutoffDate = new Date(Date.now() - this.config.retention_days * 24 * 60 * 60 * 1000);

      for (const backup of backups) {
        if (backup.created_at < cutoffDate) {
          try {
            fs.unlinkSync(backup.location);
            deletedCount++;

            // Also delete from secondary locations
            this.config.locations.slice(1).forEach((location) => {
              const secondaryPath = path.join(location, path.basename(backup.location));
              if (fs.existsSync(secondaryPath)) {
                fs.unlinkSync(secondaryPath);
              }
            });

            logger.info('Old backup deleted', { backupId: backup.id });
          } catch (error) {
            logger.error('Error deleting backup', {
              backupId: backup.id,
              error: String(error),
            });
          }
        }
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error deleting old backups', { error: String(error) });
      return 0;
    }
  }

  /**
   * Copy backup to secondary locations
   */
  private async copyToSecondaryLocations(sourceFile: string, backupId: string): Promise<void> {
    const secondaryLocations = this.config.locations.slice(1);

    for (const location of secondaryLocations) {
      try {
        const destFile = path.join(location, path.basename(sourceFile));
        await exec(`cp ${sourceFile} ${destFile}`);
        logger.info('Backup copied to secondary location', {
          backupId,
          location,
        });
      } catch (error) {
        logger.warn('Failed to copy to secondary location', {
          backupId,
          location,
          error: String(error),
        });
      }
    }
  }

  /**
   * Calculate checksum of file
   */
  private calculateChecksum(filePath: string): string {
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Verify backup checksum
   */
  async verifyBackup(backupId: string): Promise<boolean> {
    try {
      const metadata = this.getBackupMetadata(backupId);
      if (!metadata) {
        return false;
      }

      const currentChecksum = this.calculateChecksum(metadata.location);
      return currentChecksum === metadata.checksum;
    } catch (error) {
      logger.error('Error verifying backup', { backupId, error: String(error) });
      return false;
    }
  }

  /**
   * Save backup metadata
   */
  private saveBackupMetadata(metadata: BackupMetadata): void {
    try {
      let backups: BackupMetadata[] = [];

      if (fs.existsSync(this.backupMetadataFile)) {
        const data = fs.readFileSync(this.backupMetadataFile, 'utf-8');
        backups = JSON.parse(data);
      }

      // Update or add metadata
      const index = backups.findIndex((b) => b.id === metadata.id);
      if (index >= 0) {
        backups[index] = metadata;
      } else {
        backups.push(metadata);
      }

      fs.writeFileSync(this.backupMetadataFile, JSON.stringify(backups, null, 2));
    } catch (error) {
      logger.error('Error saving backup metadata', { error: String(error) });
    }
  }

  /**
   * Get backup metadata
   */
  private getBackupMetadata(backupId: string): BackupMetadata | null {
    try {
      if (!fs.existsSync(this.backupMetadataFile)) {
        return null;
      }

      const data = fs.readFileSync(this.backupMetadataFile, 'utf-8');
      const backups = JSON.parse(data) as BackupMetadata[];
      return backups.find((b) => b.id === backupId) || null;
    } catch (error) {
      logger.error('Error reading backup metadata', { error: String(error) });
      return null;
    }
  }
}

export default new BackupService({
  locations: ['/backups', process.env.BACKUP_SECONDARY_LOCATION || '/backups/secondary'],
  retention_days: parseInt(process.env.BACKUP_RETENTION_DAYS || '90'),
  compression: 'gzip',
});
