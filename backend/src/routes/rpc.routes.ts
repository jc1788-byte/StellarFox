/**
 * RPC Provider Management Routes
 * 
 * Endpoints for:
 * - Viewing provider health and status
 * - Adding/removing providers
 * - Manual health checks
 * - Provider metrics and diagnostics
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  getMetrics,
  performHealthCheck,
  getProviderHealth,
  addProvider,
  removeProvider,
  updateProvider,
} from '../services/rpcProvider.service';

const router = Router();

/**
 * GET /rpc/metrics
 * Get RPC provider metrics and health status
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await getMetrics();
    res.json(metrics);
  } catch (err) {
    logger.error({ err }, 'Failed to get RPC metrics');
    res.status(500).json({ error: 'Failed to get RPC metrics' });
  }
});

/**
 * GET /rpc/health
 * Get health status of all providers
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const metrics = await getMetrics();
    res.json({
      healthy: metrics.healthyProviders > 0,
      providers: metrics.providers.map((p) => ({
        url: p.provider_url,
        name: p.provider_name,
        isHealthy: p.is_healthy,
        consecutiveFailures: p.consecutive_failures,
        responseTimeMs: p.response_time_ms,
        successRate: p.total_requests > 0 
          ? Math.round(((p.total_requests - p.failed_requests) / p.total_requests) * 10000) / 100
          : 100,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get RPC health');
    res.status(500).json({ error: 'Failed to get RPC health' });
  }
});

/**
 * GET /rpc/providers/:url
 * Get health status of a specific provider
 */
router.get('/providers/:url', async (req: Request, res: Response) => {
  try {
    const { url } = req.params;
    const decodedUrl = decodeURIComponent(url);

    const health = await getProviderHealth(decodedUrl);
    if (!health) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    res.json({
      url: health.provider_url,
      name: health.provider_name,
      isHealthy: health.is_healthy,
      consecutiveFailures: health.consecutive_failures,
      lastCheckAt: health.last_check_at,
      lastErrorAt: health.last_error_at,
      lastErrorMessage: health.last_error_message,
      responseTimeMs: health.response_time_ms,
      totalRequests: health.total_requests,
      failedRequests: health.failed_requests,
      successRate: health.total_requests > 0
        ? Math.round(((health.total_requests - health.failed_requests) / health.total_requests) * 10000) / 100
        : 100,
      priority: health.priority,
      weight: health.weight,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get provider health');
    res.status(500).json({ error: 'Failed to get provider health' });
  }
});

/**
 * POST /rpc/health-check
 * Manually trigger health check for all providers
 */
router.post('/health-check', async (req: Request, res: Response) => {
  try {
    await performHealthCheck();
    const metrics = await getMetrics();

    res.json({
      success: true,
      message: 'Health check completed',
      healthyProviders: metrics.healthyProviders,
      totalProviders: metrics.totalProviders,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to perform health check');
    res.status(500).json({ error: 'Failed to perform health check' });
  }
});

/**
 * POST /rpc/providers
 * Add a new RPC provider
 * 
 * Body:
 * - url: provider URL (required)
 * - name: provider name (optional, defaults to provider)
 * - priority: provider priority (optional, default 0)
 * - weight: provider weight for load balancing (optional, default 1.0)
 */
router.post('/providers', async (req: Request, res: Response) => {
  try {
    const { url, name = 'provider', priority = 0, weight = 1.0 } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    await addProvider(url, name, priority, weight);

    res.json({
      success: true,
      message: 'RPC provider added',
      provider: { url, name, priority, weight },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to add RPC provider');
    if (err instanceof Error && err.message.includes('reachable')) {
      return res.status(400).json({ error: 'Provider is not reachable' });
    }
    res.status(500).json({ error: 'Failed to add RPC provider' });
  }
});

/**
 * DELETE /rpc/providers/:url
 * Remove an RPC provider
 */
router.delete('/providers/:url', async (req: Request, res: Response) => {
  try {
    const { url } = req.params;
    const decodedUrl = decodeURIComponent(url);

    const health = await getProviderHealth(decodedUrl);
    if (!health) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    await removeProvider(decodedUrl);

    res.json({
      success: true,
      message: 'RPC provider removed',
    });
  } catch (err) {
    logger.error({ err }, 'Failed to remove RPC provider');
    res.status(500).json({ error: 'Failed to remove RPC provider' });
  }
});

/**
 * PATCH /rpc/providers/:url
 * Update provider priority or weight
 * 
 * Body:
 * - priority: new priority (optional)
 * - weight: new weight (optional)
 */
router.patch('/providers/:url', async (req: Request, res: Response) => {
  try {
    const { url } = req.params;
    const decodedUrl = decodeURIComponent(url);
    const { priority, weight } = req.body;

    if (priority === undefined && weight === undefined) {
      return res.status(400).json({ error: 'At least one of priority or weight is required' });
    }

    const health = await getProviderHealth(decodedUrl);
    if (!health) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const updates: any = {};
    if (priority !== undefined) updates.priority = priority;
    if (weight !== undefined) updates.weight = weight;

    await updateProvider(decodedUrl, updates);

    res.json({
      success: true,
      message: 'RPC provider updated',
      provider: {
        url: decodedUrl,
        priority: priority !== undefined ? priority : health.priority,
        weight: weight !== undefined ? weight : health.weight,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to update RPC provider');
    res.status(500).json({ error: 'Failed to update RPC provider' });
  }
});

export default router;
