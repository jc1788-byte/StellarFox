/**
 * Database Replication and High Availability Service
 *
 * Implements database replication for high availability, automatic failover,
 * consistency verification, and replica lag monitoring.
 */

import { Pool } from 'pg';
import * as pino from 'pino';

const logger = pino.default();

export interface ReplicaConfig {
  id: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  type: 'standby' | 'cascading' | 'logical';
  priority: number; // Lower = higher priority for failover
  enabled: boolean;
  monitorInterval: number;
}

export interface ReplicationStatus {
  replicaId: string;
  isConnected: boolean;
  replicaLagBytes: number;
  replicaLagSeconds: number;
  lastSync: Date;
  isUpToDate: boolean;
  syncPercentage: number;
  status: 'healthy' | 'lagging' | 'disconnected' | 'unknown';
}

export interface FailoverEvent {
  id: string;
  timestamp: Date;
  previousPrimary: string;
  newPrimary: string;
  reason: string;
  success: boolean;
  errors: string[];
}

/**
 * High Availability Manager
 */
export class HAManager {
  private primaryPool: Pool;
  private replicas: Map<string, Pool> = new Map();
  private replicaConfigs: Map<string, ReplicaConfig> = new Map();
  private replicationStatuses: Map<string, ReplicationStatus> = new Map();
  private failoverHistory: FailoverEvent[] = [];
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private currentPrimary: string;
  private lastHealthCheckTime: Date = new Date();
  private readonly maxReplicaLagSeconds = 5;
  private readonly maxReplicaLagBytes = 1048576; // 1MB

  constructor(primaryPool: Pool, primaryHost: string) {
    this.primaryPool = primaryPool;
    this.currentPrimary = primaryHost;
  }

  /**
   * Register a replica
   */
  public registerReplica(config: ReplicaConfig): void {
    this.replicaConfigs.set(config.id, config);

    const replicaPool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.replicas.set(config.id, replicaPool);

    this.replicationStatuses.set(config.id, {
      replicaId: config.id,
      isConnected: false,
      replicaLagBytes: 0,
      replicaLagSeconds: 0,
      lastSync: new Date(),
      isUpToDate: false,
      syncPercentage: 0,
      status: 'unknown',
    });

    logger.info(`Replica ${config.id} registered`);
  }

  /**
   * Start monitoring all replicas
   */
  public startMonitoring(): void {
    const allConfigs = Array.from(this.replicaConfigs.values());

    for (const config of allConfigs) {
      if (!config.enabled) continue;

      const interval = setInterval(async () => {
        try {
          await this.checkReplicaHealth(config.id);
          await this.verifyReplicationConsistency(config.id);
        } catch (error) {
          logger.error({ error, replicaId: config.id }, 'Error monitoring replica');
        }
      }, config.monitorInterval);

      this.monitoringIntervals.set(config.id, interval);
    }

    logger.info('HA monitoring started');
  }

  /**
   * Stop monitoring
   */
  public stopMonitoring(): void {
    for (const [replicaId, interval] of this.monitoringIntervals) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
  }

  /**
   * Check replica health status
   */
  private async checkReplicaHealth(replicaId: string): Promise<void> {
    const replicaPool = this.replicas.get(replicaId);
    if (!replicaPool) return;

    try {
      // Test connection
      const client = await replicaPool.connect();

      // Check replication status
      const result = await client.query(`
        SELECT 
          client_addr,
          state,
          sync_state,
          write_lag,
          flush_lag,
          replay_lag,
          lsn_distance(pg_current_wal_lsn(), replay_lsn) as lag_bytes
        FROM pg_stat_replication
        LIMIT 1;
      `);

      client.release();

      if (result.rows.length === 0) {
        this.updateReplicationStatus(replicaId, {
          isConnected: false,
          status: 'disconnected',
          replicaLagBytes: 0,
          replicaLagSeconds: 0,
          isUpToDate: false,
        });
        return;
      }

      const replicationInfo = result.rows[0];
      const lagBytes = replicationInfo.lag_bytes || 0;
      const isHealthy =
        lagBytes < this.maxReplicaLagBytes &&
        replicationInfo.sync_state === 'async' &&
        replicationInfo.state === 'streaming';

      this.updateReplicationStatus(replicaId, {
        isConnected: true,
        replicaLagBytes: lagBytes,
        replicaLagSeconds: replicationInfo.replay_lag
          ? Math.ceil(replicationInfo.replay_lag / 1000)
          : 0,
        status: isHealthy ? 'healthy' : 'lagging',
        isUpToDate: lagBytes < this.maxReplicaLagBytes,
        syncPercentage: Math.min(100, 100 - (lagBytes / this.maxReplicaLagBytes) * 100),
      });

      logger.debug(
        { replicaId, lagBytes, isHealthy },
        'Replica health check completed',
      );
    } catch (error) {
      logger.warn({ error, replicaId }, 'Failed to connect to replica');
      this.updateReplicationStatus(replicaId, {
        isConnected: false,
        status: 'disconnected',
      });
    }
  }

  /**
   * Verify replication consistency with checksums
   */
  private async verifyReplicationConsistency(replicaId: string): Promise<void> {
    const replicaPool = this.replicas.get(replicaId);
    if (!replicaPool) return;

    try {
      const primaryClient = await this.primaryPool.connect();
      const replicaClient = await replicaPool.connect();

      // Verify data consistency on critical tables
      const tables = ['markets', 'bets', 'users'];

      for (const table of tables) {
        const primaryResult = await primaryClient.query(`
          SELECT 
            COUNT(*) as count,
            MD5(STRING_AGG(MD5(ROW(*)::text), '' ORDER BY id)) as checksum
          FROM ${table};
        `);

        const replicaResult = await replicaClient.query(`
          SELECT 
            COUNT(*) as count,
            MD5(STRING_AGG(MD5(ROW(*)::text), '' ORDER BY id)) as checksum
          FROM ${table};
        `);

        const primaryChecksum = primaryResult.rows[0].checksum;
        const replicaChecksum = replicaResult.rows[0].checksum;

        if (primaryChecksum !== replicaChecksum) {
          logger.warn(
            {
              replicaId,
              table,
              primaryChecksum,
              replicaChecksum,
            },
            'Consistency check failed',
          );
        }
      }

      primaryClient.release();
      replicaClient.release();
    } catch (error) {
      logger.error({ error, replicaId }, 'Consistency verification failed');
    }
  }

  /**
   * Update replication status
   */
  private updateReplicationStatus(replicaId: string, updates: Partial<ReplicationStatus>): void {
    const current = this.replicationStatuses.get(replicaId);
    if (!current) return;

    this.replicationStatuses.set(replicaId, {
      ...current,
      ...updates,
      lastSync: new Date(),
    });
  }

  /**
   * Get replication status for all replicas
   */
  public getReplicationStatus(): ReplicationStatus[] {
    return Array.from(this.replicationStatuses.values());
  }

  /**
   * Promote a replica to primary (failover)
   */
  public async promoteReplica(replicaId: string, reason: string): Promise<void> {
    const replicaPool = this.replicas.get(replicaId);
    const config = this.replicaConfigs.get(replicaId);

    if (!replicaPool || !config) {
      throw new Error(`Replica ${replicaId} not found`);
    }

    const startTime = new Date();
    const errors: string[] = [];

    try {
      const client = await replicaPool.connect();

      try {
        // Promote replica to primary
        await client.query('SELECT pg_wal_replay_resume();');
        await client.query('ALTER SYSTEM SET recovery_target_timeline = latest;');

        logger.info(`Replica ${replicaId} promoted to primary`);

        // Record failover event
        this.failoverHistory.push({
          id: `failover_${Date.now()}`,
          timestamp: startTime,
          previousPrimary: this.currentPrimary,
          newPrimary: config.host,
          reason,
          success: true,
          errors,
        });

        this.currentPrimary = config.host;

        // Restart promoted replica
        logger.info(`Restarting promoted primary ${replicaId}`);
      } finally {
        client.release();
      }

      // Reconfigure remaining replicas
      const allConfigs = Array.from(this.replicaConfigs.values());
      for (const otherConfig of allConfigs) {
        if (otherConfig.id === replicaId) continue;

        try {
          const otherPool = this.replicas.get(otherConfig.id);
          if (!otherPool) continue;

          const otherClient = await otherPool.connect();
          try {
            // Update primary_conninfo to point to new primary
            await otherClient.query(`
              ALTER SYSTEM SET primary_conninfo = 
              'host=${config.host} port=${config.port} user=replicator';
            `);
          } finally {
            otherClient.release();
          }
        } catch (error) {
          logger.error(
            { error, replicaId: otherConfig.id },
            'Failed to reconfigure replica',
          );
          errors.push(`Failed to reconfigure ${otherConfig.id}: ${error}`);
        }
      }
    } catch (error) {
      logger.error({ error, replicaId }, 'Failover failed');

      this.failoverHistory.push({
        id: `failover_${Date.now()}`,
        timestamp: startTime,
        previousPrimary: this.currentPrimary,
        newPrimary: config.host,
        reason,
        success: false,
        errors: [String(error), ...errors],
      });

      throw error;
    }
  }

  /**
   * Automatic failover if primary is down
   */
  public async attemptAutomaticFailover(): Promise<boolean> {
    const healthyReplicas = Array.from(this.replicationStatuses.values())
      .filter((status) => status.isConnected && status.isUpToDate)
      .sort((a, b) => {
        const configA = this.replicaConfigs.get(a.replicaId);
        const configB = this.replicaConfigs.get(b.replicaId);
        return (configA?.priority ?? 999) - (configB?.priority ?? 999);
      });

    if (healthyReplicas.length === 0) {
      logger.error('No healthy replicas available for failover');
      return false;
    }

    try {
      const primaryCandidate = healthyReplicas[0];
      await this.promoteReplica(primaryCandidate.replicaId, 'Automatic failover - primary down');
      return true;
    } catch (error) {
      logger.error({ error }, 'Automatic failover failed');
      return false;
    }
  }

  /**
   * Get failover history
   */
  public getFailoverHistory(): FailoverEvent[] {
    return [...this.failoverHistory];
  }

  /**
   * Get current primary
   */
  public getCurrentPrimary(): string {
    return this.currentPrimary;
  }

  /**
   * Generate HA report
   */
  public generateHAReport(): {
    currentPrimary: string;
    replicationStatus: ReplicationStatus[];
    replicasHealthy: number;
    totalReplicas: number;
    failoverHistory: FailoverEvent[];
    recommendations: string[];
  } {
    const statuses = this.getReplicationStatus();
    const healthyCount = statuses.filter((s) => s.status === 'healthy').length;
    const recommendations: string[] = [];

    if (healthyCount === 0) {
      recommendations.push('No healthy replicas - failover not possible');
    } else if (healthyCount === 1) {
      recommendations.push('Only one healthy replica - consider adding more for redundancy');
    }

    const laggingReplicas = statuses.filter((s) => s.status === 'lagging');
    if (laggingReplicas.length > 0) {
      recommendations.push(
        `${laggingReplicas.length} replicas are lagging - monitor and investigate`,
      );
    }

    return {
      currentPrimary: this.currentPrimary,
      replicationStatus: statuses,
      replicasHealthy: healthyCount,
      totalReplicas: statuses.length,
      failoverHistory: this.getFailoverHistory(),
      recommendations,
    };
  }

  /**
   * Cleanup - close all connections
   */
  public async cleanup(): Promise<void> {
    this.stopMonitoring();

    for (const pool of this.replicas.values()) {
      await pool.end();
    }

    this.replicas.clear();
    this.monitoringIntervals.clear();
  }
}

/**
 * Create and initialize HA manager
 */
export function createHAManager(primaryPool: Pool, primaryHost: string): HAManager {
  return new HAManager(primaryPool, primaryHost);
}

/**
 * Singleton instance
 */
let haManagerInstance: HAManager | null = null;

export function initializeHAManager(primaryPool: Pool, primaryHost: string): HAManager {
  haManagerInstance = createHAManager(primaryPool, primaryHost);
  haManagerInstance.startMonitoring();
  return haManagerInstance;
}

export function getHAManager(): HAManager | null {
  return haManagerInstance;
}
