/**
 * Performance Monitoring Endpoints
 * 
 * Routes for accessing performance metrics and optimization data
 * Protected routes - should be restricted to admins only
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import * as queryOptimization from '../services/query-optimization.service';
import * as memoryDetection from '../services/memory-leak-detection.service';
import * as cacheStrategy from '../services/cache-strategy.service';

const router = Router();

/**
 * GET /performance/health
 * Quick health check on all monitoring systems
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const memoryStatus = memoryDetection.getMemoryTrackerStatus();
    const cacheStats = await cacheStrategy.getCacheStats();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      memory: {
        heapUsedMB: memoryStatus.snapshot.heapUsed / 1024 / 1024,
        heapTotalMB: memoryStatus.snapshot.heapTotal / 1024 / 1024,
        rssMB: memoryStatus.snapshot.rss / 1024 / 1024,
        leaking: memoryStatus.leak.isLeaking,
      },
      cache: {
        keyCount: cacheStats.keyCount,
        hitRate: (cacheStats.hitRate * 100).toFixed(1),
        memoryUsage: cacheStats.memoryUsage,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Performance health check failed');
    res.status(500).json({ error: 'Health check failed' });
  }
});

/**
 * GET /performance/memory
 * Detailed memory profiling information
 */
router.get('/memory', async (req: Request, res: Response) => {
  try {
    const status = memoryDetection.getMemoryTrackerStatus();

    res.json({
      timestamp: new Date().toISOString(),
      current: {
        heapUsed: status.snapshot.heapUsed,
        heapTotal: status.snapshot.heapTotal,
        external: status.snapshot.external,
        rss: status.snapshot.rss,
      },
      analysis: {
        growthRateMBPerSec: (status.stats?.growthRate || 0) / 1024 / 1024,
        peakHeapMB: (status.stats?.peakHeap || 0) / 1024 / 1024,
        minHeapMB: (status.stats?.minHeap || 0) / 1024 / 1024,
        leakDetection: status.leak,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Memory profiling failed');
    res.status(500).json({ error: 'Memory profiling failed' });
  }
});

/**
 * POST /performance/memory/snapshot
 * Capture and analyze a heap snapshot
 */
router.post('/memory/snapshot', async (req: Request, res: Response) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `heap-snapshot-${timestamp}.heapsnapshot`;

    await memoryDetection.captureHeapSnapshot(filename);
    const analysis = await memoryDetection.analyzeHeapSnapshot(filename);

    res.json({
      status: 'captured',
      filename,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Heap snapshot capture failed');
    res.status(500).json({ error: 'Heap snapshot capture failed' });
  }
});

/**
 * POST /performance/gc
 * Force garbage collection and report freed memory
 */
router.post('/gc', async (req: Request, res: Response) => {
  try {
    const result = await memoryDetection.forceGarbageCollection();

    res.json({
      status: 'completed',
      heapBeforeMB: result.heapBefore / 1024 / 1024,
      heapAfterMB: result.heapAfter / 1024 / 1024,
      freedMB: result.freed / 1024 / 1024,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'GC invocation failed');
    res.status(500).json({ error: 'GC invocation failed' });
  }
});

/**
 * GET /performance/queries
 * Top slow queries with statistics
 */
router.get('/queries', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const queries = await queryOptimization.getTopSlowQueries(limit);

    res.json({
      timestamp: new Date().toISOString(),
      limit,
      queries,
    });
  } catch (err) {
    logger.error({ err }, 'Query stats retrieval failed');
    res.status(500).json({ error: 'Query stats retrieval failed' });
  }
});

/**
 * GET /performance/recommendations
 * Get optimization recommendations based on analysis
 */
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const queryRecs = await queryOptimization.getOptimizationRecommendations();

    res.json({
      timestamp: new Date().toISOString(),
      recommendations: {
        queries: queryRecs,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Recommendations generation failed');
    res.status(500).json({ error: 'Recommendations generation failed' });
  }
});

/**
 * GET /performance/indexes/:tableName
 * Get index suggestions for a specific table
 */
router.get('/indexes/:tableName', async (req: Request, res: Response) => {
  try {
    const suggestions = await queryOptimization.suggestIndexes(req.params.tableName);

    res.json({
      timestamp: new Date().toISOString(),
      tableName: req.params.tableName,
      suggestions,
    });
  } catch (err) {
    logger.error({ err }, 'Index suggestion failed');
    res.status(500).json({ error: 'Index suggestion failed' });
  }
});

/**
 * GET /performance/cache
 * Cache statistics and performance metrics
 */
router.get('/cache', async (req: Request, res: Response) => {
  try {
    const stats = await cacheStrategy.getCacheStats();

    res.json({
      timestamp: new Date().toISOString(),
      statistics: stats,
      hitRatePercent: (stats.hitRate * 100).toFixed(1),
      recommendation: stats.hitRate < 0.7
        ? 'Low cache hit rate - review TTL settings or add more caching'
        : 'Cache performance is good',
    });
  } catch (err) {
    logger.error({ err }, 'Cache stats retrieval failed');
    res.status(500).json({ error: 'Cache stats retrieval failed' });
  }
});

/**
 * POST /performance/cache/warm
 * Manually trigger cache warming for hot data
 */
router.post('/cache/warm', async (req: Request, res: Response) => {
  try {
    const patterns = req.body.patterns || [];

    if (!Array.isArray(patterns) || patterns.length === 0) {
      return res.status(400).json({
        error: 'Invalid request - provide patterns array',
        example: {
          patterns: [
            { key: 'markets:featured', fetchFn: '...', ttl: 600 },
          ],
        },
      });
    }

    // Note: In production, you'd have predefined warming patterns
    // This is just for demonstration
    logger.info({ patternCount: patterns.length }, 'Cache warming initiated');

    res.json({
      status: 'warming',
      patternCount: patterns.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Cache warming failed');
    res.status(500).json({ error: 'Cache warming failed' });
  }
});

/**
 * POST /performance/cache/clear
 * Clear specific cache entries by pattern
 */
router.post('/cache/clear', async (req: Request, res: Response) => {
  try {
    const pattern = req.body.pattern as string;

    if (!pattern) {
      return res.status(400).json({ error: 'Pattern required' });
    }

    const count = await cacheStrategy.invalidateWithPattern(pattern);

    res.json({
      status: 'cleared',
      pattern,
      keysInvalidated: count,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Cache clearing failed');
    res.status(500).json({ error: 'Cache clearing failed' });
  }
});

/**
 * GET /performance/report
 * Comprehensive performance report
 */
router.get('/report', async (req: Request, res: Response) => {
  try {
    const memoryStatus = memoryDetection.getMemoryTrackerStatus();
    const queries = await queryOptimization.getTopSlowQueries(5);
    const cacheStats = await cacheStrategy.getCacheStats();
    const recommendations = await queryOptimization.getOptimizationRecommendations();

    res.json({
      timestamp: new Date().toISOString(),
      summary: {
        status: memoryStatus.leak.isLeaking ? 'warning' : 'ok',
        cacheHitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
      },
      memory: {
        current: {
          heapUsedMB: (memoryStatus.snapshot.heapUsed / 1024 / 1024).toFixed(2),
          heapTotalMB: (memoryStatus.snapshot.heapTotal / 1024 / 1024).toFixed(2),
          rssMB: (memoryStatus.snapshot.rss / 1024 / 1024).toFixed(2),
        },
        leak: memoryStatus.leak,
      },
      database: {
        topSlowQueries: queries.slice(0, 5),
        recommendations,
      },
      cache: {
        keyCount: cacheStats.keyCount,
        memoryUsage: cacheStats.memoryUsage,
        hitRate: cacheStats.hitRate,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Report generation failed');
    res.status(500).json({ error: 'Report generation failed' });
  }
});

export default router;
