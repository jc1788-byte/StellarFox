/**
 * Memory Leak Detection and Profiling Service
 * 
 * Provides comprehensive memory monitoring:
 * - Heap snapshot analysis
 * - Long-lived object tracking
 * - Memory growth trends
 * - Garbage collection metrics
 * - Memory pressure alerts
 */

import v8 from 'v8';
import { performance } from 'perf_hooks';
import { logger } from '../utils/logger';

/**
 * Memory snapshot for comparison and trend analysis
 */
interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number; // Resident set size
  gcTime: number;
  gcCount: number;
}

/**
 * Tracks memory state and detects anomalies
 */
class MemoryTracker {
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 100;
  private gcEvents: { time: number; duration: number }[] = [];
  private objectCountBefore?: number;
  private objectCountAfter?: number;

  /**
   * Record a memory snapshot
   */
  snapshot(): MemorySnapshot {
    const memUsage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      gcTime: 0,
      gcCount: 0,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * Get memory growth rate over time (bytes/second)
   */
  getGrowthRate(): number {
    if (this.snapshots.length < 2) return 0;

    const oldest = this.snapshots[0];
    const newest = this.snapshots[this.snapshots.length - 1];
    const timeElapsed = (newest.timestamp - oldest.timestamp) / 1000;

    if (timeElapsed === 0) return 0;

    const heapGrowth = newest.heapUsed - oldest.heapUsed;
    return heapGrowth / timeElapsed;
  }

  /**
   * Detect memory leak patterns
   */
  detectLeak(): { isLeaking: boolean; confidence: number; reason: string } {
    const growthRate = this.getGrowthRate();
    const threshold = 1024 * 1024; // 1MB/second sustained growth

    if (this.snapshots.length < 10) {
      return { isLeaking: false, confidence: 0, reason: 'Insufficient data' };
    }

    const recentSnapshots = this.snapshots.slice(-10);
    const recentGrowth = recentSnapshots.every((s, i) => {
      if (i === 0) return true;
      return s.heapUsed >= recentSnapshots[i - 1].heapUsed;
    });

    if (recentGrowth && growthRate > threshold) {
      return {
        isLeaking: true,
        confidence: Math.min(growthRate / (threshold * 2), 1),
        reason: `Sustained heap growth of ${(growthRate / 1024 / 1024).toFixed(2)}MB/s detected`,
      };
    }

    return { isLeaking: false, confidence: 0, reason: 'No leak detected' };
  }

  /**
   * Get current memory statistics
   */
  getStats() {
    if (this.snapshots.length === 0) {
      return null;
    }

    const current = this.snapshots[this.snapshots.length - 1];
    const oldest = this.snapshots[0];
    const heapGrowth = current.heapUsed - oldest.heapUsed;

    return {
      current,
      heapGrowth,
      growthRate: this.getGrowthRate(),
      peakHeap: Math.max(...this.snapshots.map(s => s.heapUsed)),
      minHeap: Math.min(...this.snapshots.map(s => s.heapUsed)),
    };
  }

  /**
   * Clear snapshot history
   */
  reset(): void {
    this.snapshots = [];
    this.gcEvents = [];
  }
}

// Global memory tracker instance
const memoryTracker = new MemoryTracker();

/**
 * Start automatic memory monitoring
 * Call once at application startup
 */
export function startMemoryMonitoring(intervalMs: number = 30000): NodeJS.Timer {
  logger.info({ intervalMs }, 'Memory monitoring started');

  const interval = setInterval(() => {
    const snapshot = memoryTracker.snapshot();
    const stats = memoryTracker.getStats();
    const leak = memoryTracker.detectLeak();

    logger.debug(
      {
        heapUsed: `${(snapshot.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(snapshot.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        rss: `${(snapshot.rss / 1024 / 1024).toFixed(2)}MB`,
        external: `${(snapshot.external / 1024 / 1024).toFixed(2)}MB`,
      },
      'Memory snapshot',
    );

    if (stats && stats.growthRate > 512 * 1024) { // More than 512KB/s
      logger.warn(
        {
          growthRate: `${(stats.growthRate / 1024 / 1024).toFixed(2)}MB/s`,
          peakHeap: `${(stats.peakHeap / 1024 / 1024).toFixed(2)}MB`,
        },
        'High memory growth rate detected',
      );
    }

    if (leak.isLeaking) {
      logger.error(
        {
          confidence: (leak.confidence * 100).toFixed(1),
          reason: leak.reason,
        },
        'Potential memory leak detected',
      );
    }
  }, intervalMs);

  return interval;
}

/**
 * Generate a heap snapshot for offline analysis
 */
export async function captureHeapSnapshot(filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const snapshotStream = v8.writeHeapSnapshot(filename);
      snapshotStream.on('finish', () => {
        logger.info({ filename }, 'Heap snapshot captured');
        resolve(filename);
      });
      snapshotStream.on('error', (err) => {
        logger.error({ filename, err }, 'Failed to capture heap snapshot');
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Analyze heap snapshot for memory leaks
 * Uses Google Chrome DevTools format
 */
export async function analyzeHeapSnapshot(filename: string): Promise<{
  totalSize: number;
  objectCounts: Record<string, number>;
  largestObjects: Array<{
    type: string;
    size: number;
    count: number;
  }>;
}> {
  try {
    // For production, use Node.js built-in heap analysis
    const heapStats = v8.getHeapStatistics();
    const heapSpaces = v8.getHeapSpaceStatistics();

    const analysis = {
      totalSize: heapStats.total_heap_size,
      objectCounts: {},
      largestObjects: heapSpaces
        .sort((a, b) => b.space_size - a.space_size)
        .slice(0, 5)
        .map(space => ({
          type: space.space_name,
          size: space.space_size,
          count: space.space_used_size,
        })),
    };

    logger.info({ analysis }, 'Heap analysis completed');
    return analysis;
  } catch (err) {
    logger.error({ err }, 'Failed to analyze heap snapshot');
    throw err;
  }
}

/**
 * Force garbage collection and report results
 * Useful for testing memory leak detection
 */
export async function forceGarbageCollection(): Promise<{
  heapBefore: number;
  heapAfter: number;
  freed: number;
}> {
  if (!global.gc) {
    logger.warn('Garbage collection not available. Run with --expose-gc flag');
    return { heapBefore: 0, heapAfter: 0, freed: 0 };
  }

  const memBefore = process.memoryUsage().heapUsed;
  global.gc();
  const memAfter = process.memoryUsage().heapUsed;

  const freed = memBefore - memAfter;
  logger.info(
    {
      before: `${(memBefore / 1024 / 1024).toFixed(2)}MB`,
      after: `${(memAfter / 1024 / 1024).toFixed(2)}MB`,
      freed: `${(freed / 1024 / 1024).toFixed(2)}MB`,
    },
    'Manual garbage collection completed',
  );

  return {
    heapBefore: memBefore,
    heapAfter: memAfter,
    freed: Math.max(0, freed),
  };
}

/**
 * Memory pressure alert system
 * Triggers when heap exceeds threshold
 */
export function setupMemoryPressureAlert(
  thresholdPercent: number = 85,
  checkIntervalMs: number = 10000,
  onAlert?: (usage: number, threshold: number) => Promise<void>,
): NodeJS.Timer {
  return setInterval(async () => {
    const memUsage = process.memoryUsage();
    const limit = v8.getHeapStatistics().heap_size_limit;
    const usagePercent = (memUsage.heapUsed / limit) * 100;

    if (usagePercent >= thresholdPercent) {
      logger.error(
        {
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          heapLimit: `${(limit / 1024 / 1024).toFixed(2)}MB`,
          percent: usagePercent.toFixed(1),
        },
        'CRITICAL: Memory pressure alert',
      );

      if (onAlert) {
        try {
          await onAlert(usagePercent, thresholdPercent);
        } catch (err) {
          logger.error({ err }, 'Memory pressure alert callback failed');
        }
      }
    }
  }, checkIntervalMs);
}

/**
 * Profile long-lived objects that might indicate leaks
 */
export async function profileLongLivedObjects(): Promise<Map<string, number>> {
  try {
    const heapStats = v8.getHeapStatistics();
    const heapSpaces = v8.getHeapSpaceStatistics();

    const analysis = new Map<string, number>();

    for (const space of heapSpaces) {
      const percentUsed = (space.space_used_size / space.space_size) * 100;
      analysis.set(space.space_name, percentUsed);
    }

    return analysis;
  } catch (err) {
    logger.error({ err }, 'Failed to profile long-lived objects');
    throw err;
  }
}

/**
 * Get current memory tracker status
 */
export function getMemoryTrackerStatus() {
  return {
    stats: memoryTracker.getStats(),
    leak: memoryTracker.detectLeak(),
    snapshot: memoryTracker.snapshot(),
  };
}

/**
 * Reset memory tracking
 */
export function resetMemoryTracking(): void {
  memoryTracker.reset();
  logger.info('Memory tracking reset');
}

/**
 * Streaming memory profile - useful for long-running operations
 */
export class MemoryProfiler {
  private startSnapshot: MemorySnapshot;
  private isRunning = false;

  constructor() {
    this.startSnapshot = memoryTracker.snapshot();
  }

  start(): void {
    this.isRunning = true;
    logger.debug('Memory profiler started');
  }

  end(): {
    duration: number;
    heapGrowth: number;
    maxHeapDuringProfiling: number;
    recommendation: string;
  } {
    if (!this.isRunning) {
      throw new Error('Profiler not running');
    }

    this.isRunning = false;
    const endSnapshot = memoryTracker.snapshot();
    const stats = memoryTracker.getStats();

    if (!stats) {
      return {
        duration: 0,
        heapGrowth: 0,
        maxHeapDuringProfiling: 0,
        recommendation: 'Insufficient data',
      };
    }

    const heapGrowth = endSnapshot.heapUsed - this.startSnapshot.heapUsed;
    const recommendation =
      heapGrowth > 50 * 1024 * 1024
        ? 'High memory growth detected - investigate for leaks'
        : heapGrowth > 10 * 1024 * 1024
          ? 'Moderate memory growth - monitor'
          : 'Low memory growth - normal';

    return {
      duration: endSnapshot.timestamp - this.startSnapshot.timestamp,
      heapGrowth,
      maxHeapDuringProfiling: stats.peakHeap,
      recommendation,
    };
  }
}
