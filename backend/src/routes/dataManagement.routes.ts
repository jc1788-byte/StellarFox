/**
 * Data Management Routes
 *
 * REST API endpoints for managing data retention, full-text search,
 * database replication, and connection pool monitoring.
 */

import express, { Router, Request, Response } from 'express';
import * as dataRetention from '../services/dataRetention.service';
import * as fullTextSearch from '../services/fullTextSearch.service';
import { getDynamicPoolManager } from '../services/connectionPool.service';
import { getHAManager } from '../services/databaseReplication.service';
import { AppError } from '../utils/AppError';
import { adminOnly } from '../middleware/auth.middleware';

const router = Router();

// =====================================================================
// Data Retention Management
// =====================================================================

/**
 * POST /api/data-management/retention/policies
 * Create or update a retention policy
 */
router.post('/retention/policies', adminOnly, async (req: Request, res: Response) => {
  try {
    const {
      entityType,
      retentionDays,
      archiveDays,
      enabled,
      description,
    } = req.body;

    if (!entityType || !retentionDays || !archiveDays) {
      throw AppError.badRequest('Missing required fields');
    }

    const policy = await dataRetention.setRetentionPolicy(
      entityType,
      retentionDays,
      archiveDays,
      enabled ?? true,
      description,
    );

    res.json({
      success: true,
      data: policy,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/retention/policies
 * Get all retention policies
 */
router.get('/retention/policies', adminOnly, async (req: Request, res: Response) => {
  try {
    const policies = await dataRetention.getRetentionPolicies();
    res.json({
      success: true,
      data: policies,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/data-management/retention/execute
 * Execute retention cleanup
 */
router.post('/retention/execute', adminOnly, async (req: Request, res: Response) => {
  try {
    const result = await dataRetention.executeRetentionCleanup();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/data-management/retention/:policyId/report
 * Generate compliance report for a policy
 */
router.post(
  '/retention/:policyId/report',
  adminOnly,
  async (req: Request, res: Response) => {
    try {
      const { policyId } = req.params;
      const report = await dataRetention.generateComplianceReport(parseInt(policyId));
      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      res.status(error instanceof AppError ? error.statusCode : 500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

/**
 * GET /api/data-management/retention/:policyId/reports
 * Get compliance reports for a policy
 */
router.get('/retention/:policyId/reports', adminOnly, async (req: Request, res: Response) => {
  try {
    const { policyId } = req.params;
    const reports = await dataRetention.getComplianceReports(parseInt(policyId));
    res.json({
      success: true,
      data: reports,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// =====================================================================
// Full-Text Search Management
// =====================================================================

/**
 * GET /api/data-management/search/markets
 * Search markets with full-text search
 */
router.get('/search/markets', async (req: Request, res: Response) => {
  try {
    const { q, type, limit, offset, status, category } = req.query;

    if (!q || typeof q !== 'string') {
      throw AppError.badRequest('Query parameter required');
    }

    const results = await fullTextSearch.searchMarkets({
      query: q,
      searchType: (type as 'simple' | 'phrase' | 'boolean') || 'simple',
      limit: limit ? parseInt(limit as string) : 20,
      offset: offset ? parseInt(offset as string) : 0,
      filters: {
        status: status || undefined,
        category: category || undefined,
      },
    });

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/search/markets/facets
 * Search with faceted results
 */
router.get('/search/markets/facets', async (req: Request, res: Response) => {
  try {
    const { q, limit } = req.query;

    if (!q || typeof q !== 'string') {
      throw AppError.badRequest('Query parameter required');
    }

    const results = await fullTextSearch.searchWithFacets(
      q,
      limit ? parseInt(limit as string) : 20,
    );

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/search/suggestions
 * Get search suggestions
 */
router.get('/search/suggestions', async (req: Request, res: Response) => {
  try {
    const { prefix, limit } = req.query;

    if (!prefix || typeof prefix !== 'string') {
      throw AppError.badRequest('Prefix parameter required');
    }

    const suggestions = await fullTextSearch.getSearchSuggestions(
      prefix,
      limit ? parseInt(limit as string) : 5,
    );

    res.json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/search/fuzzy
 * Fuzzy search for fighters
 */
router.get('/search/fuzzy', async (req: Request, res: Response) => {
  try {
    const { q, limit } = req.query;

    if (!q || typeof q !== 'string') {
      throw AppError.badRequest('Query parameter required');
    }

    const results = await fullTextSearch.fuzzySearchFighters(
      q,
      limit ? parseInt(limit as string) : 10,
    );

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/data-management/search/reindex
 * Reindex all full-text search indexes
 */
router.post('/search/reindex', adminOnly, async (req: Request, res: Response) => {
  try {
    await fullTextSearch.reindexSearchIndexes();
    res.json({
      success: true,
      message: 'Search indexes reindexed',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/search/stats
 * Get search index statistics
 */
router.get('/search/stats', adminOnly, async (req: Request, res: Response) => {
  try {
    const stats = await fullTextSearch.getIndexStatistics();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// =====================================================================
// Connection Pool Management
// =====================================================================

/**
 * GET /api/data-management/pool/metrics
 * Get connection pool metrics
 */
router.get('/pool/metrics', adminOnly, (req: Request, res: Response) => {
  try {
    const poolManager = getDynamicPoolManager();
    if (!poolManager) {
      throw AppError.notFound('Pool manager not initialized');
    }

    const metrics = poolManager.getMetrics();
    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/pool/config
 * Get current pool configuration
 */
router.get('/pool/config', adminOnly, (req: Request, res: Response) => {
  try {
    const poolManager = getDynamicPoolManager();
    if (!poolManager) {
      throw AppError.notFound('Pool manager not initialized');
    }

    const config = poolManager.getConfiguration();
    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/pool/health
 * Get pool health status
 */
router.get('/pool/health', adminOnly, (req: Request, res: Response) => {
  try {
    const poolManager = getDynamicPoolManager();
    if (!poolManager) {
      throw AppError.notFound('Pool manager not initialized');
    }

    const health = poolManager.getHealthStatus();
    res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/pool/report
 * Get performance report
 */
router.get('/pool/report', adminOnly, (req: Request, res: Response) => {
  try {
    const poolManager = getDynamicPoolManager();
    if (!poolManager) {
      throw AppError.notFound('Pool manager not initialized');
    }

    const report = poolManager.generatePerformanceReport();
    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// =====================================================================
// High Availability Management
// =====================================================================

/**
 * GET /api/data-management/ha/status
 * Get replication and failover status
 */
router.get('/ha/status', adminOnly, (req: Request, res: Response) => {
  try {
    const haManager = getHAManager();
    if (!haManager) {
      throw AppError.notFound('HA manager not initialized');
    }

    const status = haManager.getReplicationStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/ha/report
 * Get HA report
 */
router.get('/ha/report', adminOnly, (req: Request, res: Response) => {
  try {
    const haManager = getHAManager();
    if (!haManager) {
      throw AppError.notFound('HA manager not initialized');
    }

    const report = haManager.generateHAReport();
    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/data-management/ha/failover-history
 * Get failover history
 */
router.get('/ha/failover-history', adminOnly, (req: Request, res: Response) => {
  try {
    const haManager = getHAManager();
    if (!haManager) {
      throw AppError.notFound('HA manager not initialized');
    }

    const history = haManager.getFailoverHistory();
    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/data-management/ha/failover
 * Trigger manual failover
 */
router.post('/ha/failover', adminOnly, async (req: Request, res: Response) => {
  try {
    const { replicaId, reason } = req.body;

    if (!replicaId) {
      throw AppError.badRequest('replicaId required');
    }

    const haManager = getHAManager();
    if (!haManager) {
      throw AppError.notFound('HA manager not initialized');
    }

    await haManager.promoteReplica(replicaId, reason || 'Manual failover');

    res.json({
      success: true,
      message: `Replica ${replicaId} promoted to primary`,
    });
  } catch (error) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
