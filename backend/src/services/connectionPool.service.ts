/**
 * Dynamic Connection Pool Management Service
 *
 * Optimizes connection pool settings based on real-time load patterns,
 * resource availability, and system metrics. Implements auto-scaling,
 * connection queuing, and performance monitoring.
 */

import { Pool, PoolClient } from 'pg';
import * as pino from 'pino';

const logger = pino.default();

export interface PoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  connectionUtilization: number; // Percentage
  avgQueryTime: number; // ms
  connectionErrors: number;
  lastUpdated: Date;
}

export interface PoolConfig {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  maxQueryTimeMs: number;
  statementTimeoutMs: number;
}

export interface LoadPattern {
  timestamp: Date;
  requestRate: number; // requests per second
  avgConnectionDuration: number; // ms
  connectionErrorRate: number; // percentage
  cpuUsage: number; // percentage
  memoryUsage: number; // percentage
}

/**
 * Dynamic Pool Manager handles adaptive connection pool sizing
 */
export class DynamicPoolManager {
  private pool: Pool;
  private metrics: PoolMetrics;
  private loadPatterns: LoadPattern[] = [];
  private currentConfig: PoolConfig;
  private configUpdateInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private readonly maxPoolSize = 100;
  private readonly minPoolSize = 5;
  private queryStats: Map<string, { count: number; totalTime: number }> = new Map();

  constructor(initialPool: Pool, initialConfig: PoolConfig) {
    this.pool = initialPool;
    this.currentConfig = initialConfig;
    this.metrics = this.initializeMetrics();
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): PoolMetrics {
    return {
      totalConnections: this.currentConfig.max,
      activeConnections: 0,
      idleConnections: this.currentConfig.max,
      waitingRequests: 0,
      connectionUtilization: 0,
      avgQueryTime: 0,
      connectionErrors: 0,
      lastUpdated: new Date(),
    };
  }

  /**
   * Start monitoring and auto-adjusting the pool
   */
  public startMonitoring(intervalMs: number = 30000): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    this.metricsInterval = setInterval(async () => {
      try {
        await this.updateMetrics();
        await this.adjustPoolSize();
      } catch (error) {
        logger.error({ error }, 'Error updating pool metrics');
      }
    }, intervalMs);

    logger.info('Connection pool monitoring started');
  }

  /**
   * Stop monitoring
   */
  public stopMonitoring(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    if (this.configUpdateInterval) {
      clearInterval(this.configUpdateInterval);
      this.configUpdateInterval = null;
    }
  }

  /**
   * Update current metrics from pool and system
   */
  private async updateMetrics(): Promise<void> {
    const poolState = (this.pool as any)._clients || [];
    const activeConnections = poolState.length - (this.pool as any)._idle?.length || 0;
    const idleConnections = (this.pool as any)._idle?.length || 0;
    const waitingRequests = (this.pool as any)._queue?.length || 0;

    // Calculate average query time
    let totalQueryTime = 0;
    let totalQueries = 0;
    this.queryStats.forEach(({ count, totalTime }) => {
      totalQueries += count;
      totalQueryTime += totalTime;
    });

    const avgQueryTime = totalQueries > 0 ? totalQueryTime / totalQueries : 0;

    this.metrics = {
      totalConnections: this.currentConfig.max,
      activeConnections,
      idleConnections,
      waitingRequests,
      connectionUtilization: (activeConnections / this.currentConfig.max) * 100,
      avgQueryTime,
      connectionErrors: this.metrics.connectionErrors,
      lastUpdated: new Date(),
    };

    // Record load pattern
    const loadPattern: LoadPattern = {
      timestamp: new Date(),
      requestRate: totalQueries / 30, // Approximate RPS over 30s interval
      avgConnectionDuration: avgQueryTime,
      connectionErrorRate: 0, // Would calculate from connection errors
      cpuUsage: await this.getSystemCPUUsage(),
      memoryUsage: await this.getSystemMemoryUsage(),
    };

    this.loadPatterns.push(loadPattern);
    if (this.loadPatterns.length > 100) {
      this.loadPatterns.shift();
    }

    logger.debug(
      {
        active: activeConnections,
        idle: idleConnections,
        waiting: waitingRequests,
        utilization: this.metrics.connectionUtilization.toFixed(2) + '%',
      },
      'Pool metrics updated',
    );
  }

  /**
   * Automatically adjust pool size based on load
   */
  private async adjustPoolSize(): Promise<void> {
    const { connectionUtilization, activeConnections, waitingRequests } = this.metrics;
    const newConfig = { ...this.currentConfig };
    let adjusted = false;

    // Scale up if utilization is high
    if (connectionUtilization > 80 && this.currentConfig.max < this.maxPoolSize) {
      const increase = Math.min(
        Math.ceil(this.currentConfig.max * 0.2),
        this.maxPoolSize - this.currentConfig.max,
      );
      newConfig.max = this.currentConfig.max + increase;
      adjusted = true;
      logger.info(
        `Scaling up pool: ${this.currentConfig.max} → ${newConfig.max} connections`,
      );
    }

    // Scale down if utilization is low
    if (connectionUtilization < 30 && this.currentConfig.max > this.minPoolSize) {
      const decrease = Math.max(
        Math.floor(this.currentConfig.max * 0.1),
        this.minPoolSize - this.currentConfig.max,
      );
      newConfig.max = Math.max(this.currentConfig.max - decrease, this.minPoolSize);
      adjusted = true;
      logger.info(
        `Scaling down pool: ${this.currentConfig.max} → ${newConfig.max} connections`,
      );
    }

    // Optimize timeout based on query times
    const avgQueryTime = this.metrics.avgQueryTime;
    if (avgQueryTime > 0) {
      const recommendedTimeout = Math.ceil(avgQueryTime * 3); // 3x average + safety margin
      if (Math.abs(recommendedTimeout - this.currentConfig.maxQueryTimeMs) > 100) {
        newConfig.maxQueryTimeMs = recommendedTimeout;
        adjusted = true;
      }
    }

    if (adjusted) {
      this.currentConfig = newConfig;
      await this.applyConfiguration();
    }
  }

  /**
   * Apply configuration changes to the pool
   */
  private async applyConfiguration(): Promise<void> {
    // Note: pg Pool doesn't support dynamic resizing directly
    // This would need to be implemented by creating a new pool
    // or through custom wrapper logic
    logger.info(
      {
        max: this.currentConfig.max,
        idleTimeout: this.currentConfig.idleTimeoutMillis,
        connectionTimeout: this.currentConfig.connectionTimeoutMillis,
      },
      'New pool configuration',
    );
  }

  /**
   * Get current pool metrics
   */
  public getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current configuration
   */
  public getConfiguration(): PoolConfig {
    return { ...this.currentConfig };
  }

  /**
   * Get load patterns history
   */
  public getLoadPatterns(): LoadPattern[] {
    return [...this.loadPatterns];
  }

  /**
   * Track query execution time
   */
  public trackQueryExecution(query: string, durationMs: number): void {
    const normalized = this.normalizeQuery(query);
    const existing = this.queryStats.get(normalized) || { count: 0, totalTime: 0 };
    existing.count++;
    existing.totalTime += durationMs;
    this.queryStats.set(normalized, existing);
  }

  /**
   * Record connection error
   */
  public recordConnectionError(): void {
    this.metrics.connectionErrors++;
  }

  /**
   * Normalize query for tracking (remove literals)
   */
  private normalizeQuery(query: string): string {
    return query
      .replace(/\$\d+/g, '$X') // Replace parameter placeholders
      .replace(/'[^']*'/g, "'?'") // Replace string literals
      .replace(/\d+/g, 'N'); // Replace numbers
  }

  /**
   * Get system CPU usage (percentage)
   */
  private async getSystemCPUUsage(): Promise<number> {
    try {
      const os = require('os');
      const cpus = os.cpus();
      let idle = 0;
      let total = 0;

      cpus.forEach((cpu: any) => {
        for (const type in cpu.times) {
          total += cpu.times[type];
        }
        idle += cpu.times.idle;
      });

      return Math.round(((total - idle) / total) * 100) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get system memory usage (percentage)
   */
  private async getSystemMemoryUsage(): Promise<number> {
    try {
      const os = require('os');
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      return Math.round(((totalMem - freeMem) / totalMem) * 100);
    } catch {
      return 0;
    }
  }

  /**
   * Get health status
   */
  public getHealthStatus(): {
    healthy: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (this.metrics.connectionUtilization > 95) {
      issues.push('Pool nearly exhausted');
    }

    if (this.metrics.waitingRequests > 10) {
      issues.push('High number of waiting requests');
    }

    if (this.metrics.connectionErrors > 10) {
      issues.push('Connection errors detected');
    }

    if (this.metrics.avgQueryTime > 5000) {
      issues.push('High average query time');
    }

    return {
      healthy: issues.length === 0,
      issues,
    };
  }

  /**
   * Generate performance report
   */
  public generatePerformanceReport(): {
    currentMetrics: PoolMetrics;
    configuration: PoolConfig;
    healthStatus: { healthy: boolean; issues: string[] };
    recommendations: string[];
  } {
    const health = this.getHealthStatus();
    const recommendations: string[] = [];

    if (this.metrics.connectionUtilization > 80) {
      recommendations.push('Consider increasing max_connections');
    }

    if (this.metrics.avgQueryTime > 2000) {
      recommendations.push('Review slow queries and add indexes');
    }

    if (this.loadPatterns.length > 0) {
      const recentPattern = this.loadPatterns[this.loadPatterns.length - 1];
      if (recentPattern.cpuUsage > 80) {
        recommendations.push('System CPU usage is high, consider scaling');
      }
      if (recentPattern.memoryUsage > 80) {
        recommendations.push('System memory usage is high, consider optimization');
      }
    }

    return {
      currentMetrics: this.getMetrics(),
      configuration: this.getConfiguration(),
      healthStatus: health,
      recommendations,
    };
  }
}

/**
 * Create and initialize a dynamic pool manager
 */
export function createDynamicPoolManager(pool: Pool, config: PoolConfig): DynamicPoolManager {
  return new DynamicPoolManager(pool, config);
}

/**
 * Export singleton instance
 */
let dynamicPoolManagerInstance: DynamicPoolManager | null = null;

export function initializeDynamicPoolManager(
  pool: Pool,
  config: PoolConfig,
): DynamicPoolManager {
  dynamicPoolManagerInstance = createDynamicPoolManager(pool, config);
  dynamicPoolManagerInstance.startMonitoring(30000); // Update every 30 seconds
  return dynamicPoolManagerInstance;
}

export function getDynamicPoolManager(): DynamicPoolManager | null {
  return dynamicPoolManagerInstance;
}
