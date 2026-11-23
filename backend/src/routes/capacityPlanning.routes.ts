import { Router, Request, Response } from 'express';
import {
  recordMetric,
  recordMetrics,
  analyzeTrend,
  aggregateTrends,
  forecast,
  checkThresholds,
  checkForecastThresholds,
  generateRecommendations,
  getCapacityReport,
} from '../services/capacityPlanning.service';
import { db } from '../db';
import {
  capacityThresholds,
  capacityAlerts,
  capacityRecommendations,
  capacityForecasts,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

// ── Metrics Recording ──────────────────────────────────────────────────────

/**
 * POST /api/capacity/metrics
 * Record a single resource metric
 */
router.post('/metrics', async (req: Request, res: Response) => {
  try {
    const { resourceType, metricName, value, unit, hostId, serviceName, metadata } =
      req.body;

    if (!resourceType || !metricName || value === undefined || !unit) {
      return res.status(400).json({
        error: 'Missing required fields: resourceType, metricName, value, unit',
      });
    }

    const metricId = await recordMetric({
      resourceType,
      metricName,
      value: Number(value),
      unit,
      hostId,
      serviceName,
      metadata,
    });

    res.status(201).json({
      success: true,
      metricId,
      message: 'Metric recorded',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record metric' });
  }
});

/**
 * POST /api/capacity/metrics/batch
 * Record multiple metrics at once
 */
router.post('/metrics/batch', async (req: Request, res: Response) => {
  try {
    const { metrics } = req.body;

    if (!Array.isArray(metrics) || metrics.length === 0) {
      return res.status(400).json({
        error: 'Expected array of metrics',
      });
    }

    const validated = metrics.map(m => ({
      resourceType: m.resourceType,
      metricName: m.metricName,
      value: Number(m.value),
      unit: m.unit,
      hostId: m.hostId,
      serviceName: m.serviceName,
      metadata: m.metadata,
    }));

    await recordMetrics(validated);

    res.status(201).json({
      success: true,
      count: metrics.length,
      message: `Recorded ${metrics.length} metrics`,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record metrics' });
  }
});

// ── Trend Analysis ───────────────────────────��────────────────────────────

/**
 * GET /api/capacity/trends/:resourceType/:metricName
 * Analyze trend for a metric
 */
router.get('/trends/:resourceType/:metricName', async (req: Request, res: Response) => {
  try {
    const { resourceType, metricName } = req.params;
    const { hoursBack = 24, periodType = 'hourly' } = req.query;

    const trend = await analyzeTrend(
      resourceType,
      metricName,
      Number(hoursBack),
      periodType as any
    );

    if (!trend) {
      return res.status(404).json({
        error: 'Insufficient data for trend analysis',
      });
    }

    res.json({
      resourceType,
      metricName,
      trend,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to analyze trend' });
  }
});

/**
 * POST /api/capacity/trends/aggregate
 * Aggregate metrics into trend records
 */
router.post('/trends/aggregate', async (req: Request, res: Response) => {
  try {
    const { resourceType, metricName, periodType = 'daily' } = req.body;

    if (!resourceType || !metricName) {
      return res.status(400).json({
        error: 'Missing required fields: resourceType, metricName',
      });
    }

    await aggregateTrends(resourceType, metricName, periodType);

    res.json({
      success: true,
      message: `Aggregated trends for ${resourceType}/${metricName}`,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to aggregate trends' });
  }
});

// ── Forecasting ───────────────────────────────────────────────────────────

/**
 * GET /api/capacity/forecast/:resourceType/:metricName
 * Generate forecast for a metric
 */
router.get('/forecast/:resourceType/:metricName', async (req: Request, res: Response) => {
  try {
    const { resourceType, metricName } = req.params;
    const { daysAhead = 7, hoursBack = 168 } = req.query;

    const result = await forecast(
      resourceType,
      metricName,
      Number(daysAhead),
      Number(hoursBack)
    );

    if (!result) {
      return res.status(404).json({
        error: 'Insufficient data for forecasting',
      });
    }

    res.json({
      resourceType,
      metricName,
      daysAhead: Number(daysAhead),
      forecast: result,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate forecast' });
  }
});

/**
 * GET /api/capacity/forecasts
 * Get recent forecasts
 */
router.get('/forecasts', async (req: Request, res: Response) => {
  try {
    const { resourceType, metricName, limit = 100 } = req.query;

    let query = db.select().from(capacityForecasts);

    if (resourceType) {
      query = query.where(eq(capacityForecasts.resourceType, resourceType as string));
    }
    if (metricName) {
      query = query.where(eq(capacityForecasts.metricName, metricName as string));
    }

    const forecasts = await query.limit(Number(limit));

    res.json({
      count: forecasts.length,
      forecasts,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch forecasts' });
  }
});

// ── Thresholds ─────────────────────────────────────────────────────────────

/**
 * POST /api/capacity/thresholds
 * Create or update threshold configuration
 */
router.post('/thresholds', async (req: Request, res: Response) => {
  try {
    const {
      resourceType,
      metricName,
      warningThreshold,
      criticalThreshold,
      forecastWarningDays = 7,
    } = req.body;

    if (!resourceType || !metricName || warningThreshold === undefined || criticalThreshold === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
      });
    }

    // Check if exists
    const existing = await db
      .select()
      .from(capacityThresholds)
      .where(
        and(
          eq(capacityThresholds.resourceType, resourceType),
          eq(capacityThresholds.metricName, metricName)
        )
      );

    let result;
    if (existing.length > 0) {
      result = await db
        .update(capacityThresholds)
        .set({
          warningThreshold: warningThreshold.toString(),
          criticalThreshold: criticalThreshold.toString(),
          forecastWarningDays,
        })
        .where(eq(capacityThresholds.id, existing[0].id))
        .returning();
    } else {
      result = await db
        .insert(capacityThresholds)
        .values({
          resourceType,
          metricName,
          warningThreshold: warningThreshold.toString(),
          criticalThreshold: criticalThreshold.toString(),
          forecastWarningDays,
        })
        .returning();
    }

    res.status(201).json({
      success: true,
      threshold: result[0],
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save threshold' });
  }
});

/**
 * GET /api/capacity/thresholds
 * Get all threshold configurations
 */
router.get('/thresholds', async (req: Request, res: Response) => {
  try {
    const thresholds = await db.select().from(capacityThresholds);

    res.json({
      count: thresholds.length,
      thresholds,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch thresholds' });
  }
});

// ── Alerts ────────────────────────────────────────────────────────────────

/**
 * POST /api/capacity/check-thresholds
 * Check all metrics against thresholds
 */
router.post('/check-thresholds', async (req: Request, res: Response) => {
  try {
    const { resourceType, metricName } = req.body;

    if (resourceType && metricName) {
      await checkThresholds(resourceType, metricName);
    } else {
      // Check all configured thresholds
      const thresholds = await db.select().from(capacityThresholds);
      for (const t of thresholds) {
        await checkThresholds(t.resourceType, t.metricName);
      }
    }

    res.json({
      success: true,
      message: 'Threshold check completed',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check thresholds' });
  }
});

/**
 * POST /api/capacity/check-forecasts
 * Check forecasts against thresholds
 */
router.post('/check-forecasts', async (req: Request, res: Response) => {
  try {
    await checkForecastThresholds();

    res.json({
      success: true,
      message: 'Forecast threshold check completed',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check forecast thresholds' });
  }
});

/**
 * GET /api/capacity/alerts
 * Get alerts
 */
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const { resolved = false, limit = 100 } = req.query;

    let query = db.select().from(capacityAlerts);

    if (resolved === 'false') {
      query = query.where(eq(capacityAlerts.resolvedAt, null));
    }

    const alerts = await query.limit(Number(limit));

    res.json({
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// ── Recommendations ───────────────────────────────────────────────────────

/**
 * POST /api/capacity/recommendations/generate
 * Generate capacity recommendations
 */
router.post('/recommendations/generate', async (req: Request, res: Response) => {
  try {
    const recommendations = await generateRecommendations();

    res.json({
      success: true,
      count: recommendations.length,
      recommendations,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

/**
 * GET /api/capacity/recommendations
 * Get recommendations
 */
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const { urgency, implemented = false, limit = 100 } = req.query;

    let query = db.select().from(capacityRecommendations);

    if (urgency) {
      query = query.where(eq(capacityRecommendations.urgency, urgency as string));
    }

    if (implemented === 'false') {
      query = query.where(eq(capacityRecommendations.implemented, false));
    }

    const recommendations = await query.limit(Number(limit));

    res.json({
      count: recommendations.length,
      recommendations,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

/**
 * PATCH /api/capacity/recommendations/:id
 * Mark recommendation as implemented
 */
router.patch('/recommendations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { implemented, notes } = req.body;

    const updated = await db
      .update(capacityRecommendations)
      .set({
        implemented: Boolean(implemented),
        implementedAt: implemented ? new Date() : null,
        notes,
      })
      .where(eq(capacityRecommendations.id, BigInt(id)))
      .returning();

    res.json({
      success: true,
      recommendation: updated[0],
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update recommendation' });
  }
});

// ── Reporting ──────────────────────────────────────────────────────────────

/**
 * GET /api/capacity/report
 * Get capacity status report
 */
router.get('/report', async (req: Request, res: Response) => {
  try {
    const { days = 7 } = req.query;

    const report = await getCapacityReport(Number(days));

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

export default router;
