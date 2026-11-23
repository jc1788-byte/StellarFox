import os from 'os';
import { recordMetrics } from './capacityPlanning.service';
import logger from 'pino';

const log = logger();

/**
 * Collect system-level metrics
 */
export function collectSystemMetrics() {
  const metrics: any[] = [];

  // CPU metrics
  const cpus = os.cpus();
  const totalLoad = os.loadavg();

  metrics.push({
    resourceType: 'cpu',
    metricName: 'load_average_1m',
    value: totalLoad[0],
    unit: 'count',
    serviceName: 'system',
  });

  metrics.push({
    resourceType: 'cpu',
    metricName: 'load_average_5m',
    value: totalLoad[1],
    unit: 'count',
    serviceName: 'system',
  });

  metrics.push({
    resourceType: 'cpu',
    metricName: 'load_average_15m',
    value: totalLoad[2],
    unit: 'count',
    serviceName: 'system',
  });

  metrics.push({
    resourceType: 'cpu',
    metricName: 'count',
    value: cpus.length,
    unit: 'count',
    serviceName: 'system',
  });

  // Memory metrics
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryPercentage = (usedMemory / totalMemory) * 100;

  metrics.push({
    resourceType: 'memory',
    metricName: 'total',
    value: totalMemory,
    unit: 'bytes',
    serviceName: 'system',
  });

  metrics.push({
    resourceType: 'memory',
    metricName: 'free',
    value: freeMemory,
    unit: 'bytes',
    serviceName: 'system',
  });

  metrics.push({
    resourceType: 'memory',
    metricName: 'used',
    value: usedMemory,
    unit: 'bytes',
    serviceName: 'system',
  });

  metrics.push({
    resourceType: 'memory',
    metricName: 'used_percentage',
    value: memoryPercentage,
    unit: 'percentage',
    serviceName: 'system',
  });

  return metrics;
}

/**
 * Collect Node.js process metrics
 */
export function collectNodeMetrics() {
  const metrics: any[] = [];
  const memUsage = process.memoryUsage();

  // Heap metrics
  metrics.push({
    resourceType: 'process_memory',
    metricName: 'heap_used',
    value: memUsage.heapUsed,
    unit: 'bytes',
    serviceName: 'nodejs',
  });

  metrics.push({
    resourceType: 'process_memory',
    metricName: 'heap_total',
    value: memUsage.heapTotal,
    unit: 'bytes',
    serviceName: 'nodejs',
  });

  metrics.push({
    resourceType: 'process_memory',
    metricName: 'heap_percentage',
    value: (memUsage.heapUsed / memUsage.heapTotal) * 100,
    unit: 'percentage',
    serviceName: 'nodejs',
  });

  metrics.push({
    resourceType: 'process_memory',
    metricName: 'external',
    value: memUsage.external,
    unit: 'bytes',
    serviceName: 'nodejs',
  });

  metrics.push({
    resourceType: 'process_memory',
    metricName: 'rss',
    value: memUsage.rss,
    unit: 'bytes',
    serviceName: 'nodejs',
  });

  // Uptime
  metrics.push({
    resourceType: 'process',
    metricName: 'uptime',
    value: process.uptime(),
    unit: 'seconds',
    serviceName: 'nodejs',
  });

  return metrics;
}

/**
 * Collect database connection metrics
 */
export async function collectDatabaseMetrics(activeConnections: number) {
  const metrics: any[] = [];

  metrics.push({
    resourceType: 'database',
    metricName: 'active_connections',
    value: activeConnections,
    unit: 'count',
    serviceName: 'postgresql',
  });

  return metrics;
}

/**
 * Collect Redis metrics
 */
export async function collectRedisMetrics(info: Record<string, any>) {
  const metrics: any[] = [];

  if (info.used_memory) {
    metrics.push({
      resourceType: 'redis',
      metricName: 'used_memory',
      value: info.used_memory,
      unit: 'bytes',
      serviceName: 'redis',
    });
  }

  if (info.used_memory_percentage) {
    metrics.push({
      resourceType: 'redis',
      metricName: 'used_memory_percentage',
      value: info.used_memory_percentage,
      unit: 'percentage',
      serviceName: 'redis',
    });
  }

  if (info.connected_clients) {
    metrics.push({
      resourceType: 'redis',
      metricName: 'connected_clients',
      value: info.connected_clients,
      unit: 'count',
      serviceName: 'redis',
    });
  }

  if (info.ops_per_sec) {
    metrics.push({
      resourceType: 'redis',
      metricName: 'ops_per_sec',
      value: info.ops_per_sec,
      unit: 'count',
      serviceName: 'redis',
    });
  }

  return metrics;
}

/**
 * Start automatic metrics collection
 */
export function startMetricsCollection(
  intervalMinutes: number = 1,
  callbacks?: {
    getDatabaseConnections?: () => Promise<number>;
    getRedisInfo?: () => Promise<Record<string, any>>;
  }
) {
  const intervalMs = intervalMinutes * 60 * 1000;

  const collectAll = async () => {
    try {
      const allMetrics: any[] = [];

      // System metrics
      allMetrics.push(...collectSystemMetrics());

      // Node metrics
      allMetrics.push(...collectNodeMetrics());

      // Database metrics if callback provided
      if (callbacks?.getDatabaseConnections) {
        try {
          const dbConnections = await callbacks.getDatabaseConnections();
          allMetrics.push(...(await collectDatabaseMetrics(dbConnections)));
        } catch (e) {
          log.warn('Failed to collect database metrics');
        }
      }

      // Redis metrics if callback provided
      if (callbacks?.getRedisInfo) {
        try {
          const redisInfo = await callbacks.getRedisInfo();
          allMetrics.push(...(await collectRedisMetrics(redisInfo)));
        } catch (e) {
          log.warn('Failed to collect Redis metrics');
        }
      }

      // Record all metrics
      if (allMetrics.length > 0) {
        await recordMetrics(allMetrics);
        log.debug({ count: allMetrics.length }, 'Recorded system metrics');
      }
    } catch (error) {
      log.error({ error }, 'Failed to collect metrics');
    }
  };

  // Run immediately
  collectAll();

  // Set up interval
  const intervalId = setInterval(collectAll, intervalMs);

  log.info({ intervalMinutes }, 'Started metrics collection');

  return {
    stop: () => {
      clearInterval(intervalId);
      log.info('Stopped metrics collection');
    },
  };
}
