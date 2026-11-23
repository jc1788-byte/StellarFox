import { db } from '../db';
import {
  resourceMetrics,
  capacityTrends,
  capacityForecasts,
  capacityThresholds,
  capacityAlerts,
  capacityRecommendations,
} from '../db/schema';
import { and, eq, gte, lte, desc, asc, between, sql } from 'drizzle-orm';
import logger from 'pino';

const log = logger();

// ── Types ──────────────────────────────────────────────────────────────────

export interface ResourceMetricInput {
  resourceType: string;
  metricName: string;
  value: number;
  unit: string;
  hostId?: string;
  serviceName?: string;
  metadata?: Record<string, any>;
}

export interface TrendAnalysis {
  direction: 'increasing' | 'decreasing' | 'stable';
  rate: number; // change per day
  volatility: number; // std dev as % of mean
  confidence: number; // 0-1
}

export interface ForecastResult {
  method: string;
  value: number;
  confidenceLower: number;
  confidenceUpper: number;
  confidenceLevel: number;
  rSquared: number;
  mape: number;
}

export interface CapacityRecommendation {
  resourceType: string;
  metricName: string;
  recommendation: string;
  urgency: 'low' | 'medium' | 'high';
  recommendedAction: string;
  estimatedImpact: string;
  implementationEffort: 'easy' | 'moderate' | 'difficult';
  forecastDate: Date;
}

// ── Recording Metrics ──────────────────────────────────────────────────────

/**
 * Record a new resource metric
 */
export async function recordMetric(input: ResourceMetricInput): Promise<number> {
  try {
    const result = await db.insert(resourceMetrics).values({
      resourceType: input.resourceType,
      metricName: input.metricName,
      value: input.value.toString(),
      unit: input.unit,
      hostId: input.hostId,
      serviceName: input.serviceName,
      metadata: input.metadata,
    }).returning({ id: resourceMetrics.id });

    return Number(result[0]?.id) || 0;
  } catch (error) {
    log.error({ error }, 'Failed to record metric');
    throw error;
  }
}

/**
 * Batch record multiple metrics
 */
export async function recordMetrics(inputs: ResourceMetricInput[]): Promise<void> {
  if (inputs.length === 0) return;

  try {
    await db.insert(resourceMetrics).values(
      inputs.map(input => ({
        resourceType: input.resourceType,
        metricName: input.metricName,
        value: input.value.toString(),
        unit: input.unit,
        hostId: input.hostId,
        serviceName: input.serviceName,
        metadata: input.metadata,
      }))
    );
  } catch (error) {
    log.error({ error }, 'Failed to batch record metrics');
    throw error;
  }
}

// ── Trend Analysis ─────────────────────────────────────────────────────────

/**
 * Analyze trends for a metric over a time period
 */
export async function analyzeTrend(
  resourceType: string,
  metricName: string,
  hoursBack: number = 24,
  periodType: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'hourly'
): Promise<TrendAnalysis | null> {
  try {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const metrics = await db
      .select()
      .from(resourceMetrics)
      .where(
        and(
          eq(resourceMetrics.resourceType, resourceType),
          eq(resourceMetrics.metricName, metricName),
          gte(resourceMetrics.timestamp, since)
        )
      )
      .orderBy(asc(resourceMetrics.timestamp));

    if (metrics.length < 2) {
      return null;
    }

    // Convert values to numbers
    const values = metrics.map(m => Number(m.value));

    // Calculate statistics
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);
    const volatility = mean !== 0 ? (stdDev / mean) * 100 : 0;

    // Calculate trend using linear regression
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const xMean = (n - 1) / 2;
    const yMean = mean;

    const ssXY = x.reduce(
      (sum, xi, i) => sum + (xi - xMean) * (values[i] - yMean),
      0
    );
    const ssXX = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);

    const slope = ssXX === 0 ? 0 : ssXY / ssXX;
    const interceptRatio = slope !== 0 ? yMean / Math.abs(slope) : 0;

    // Determine trend direction and rate
    let direction: 'increasing' | 'decreasing' | 'stable' = 'stable';
    const threshold = volatility * 0.1; // 10% of volatility
    const dailyRate = slope * (24 / (hoursBack / n)); // extrapolate to per-day

    if (slope > threshold) {
      direction = 'increasing';
    } else if (slope < -threshold) {
      direction = 'decreasing';
    }

    // Calculate R² for confidence
    const ssRes = values.reduce(
      (sum, val, i) => sum + Math.pow(val - (slope * i + (yMean - slope * xMean)), 2),
      0
    );
    const ssTot = values.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0);
    const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    return {
      direction,
      rate: dailyRate,
      volatility: Math.min(volatility, 100), // cap at 100%
      confidence: Math.max(0, Math.min(1, Math.abs(rSquared))),
    };
  } catch (error) {
    log.error({ error, resourceType, metricName }, 'Failed to analyze trend');
    return null;
  }
}

/**
 * Aggregate metrics into trend records
 */
export async function aggregateTrends(
  resourceType: string,
  metricName: string,
  periodType: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'daily'
): Promise<void> {
  try {
    // Determine time window
    const now = new Date();
    let periodHours = 24; // default to daily
    let timeFormat = 'YYYY-MM-DD'; // PostgreSQL format

    if (periodType === 'hourly') {
      periodHours = 1;
      timeFormat = 'YYYY-MM-DD HH:00:00';
    } else if (periodType === 'weekly') {
      periodHours = 24 * 7;
      timeFormat = 'YYYY-WW';
    } else if (periodType === 'monthly') {
      periodHours = 24 * 30;
      timeFormat = 'YYYY-MM';
    }

    const since = new Date(Date.now() - periodHours * 60 * 60 * 1000);

    const metrics = await db
      .select()
      .from(resourceMetrics)
      .where(
        and(
          eq(resourceMetrics.resourceType, resourceType),
          eq(resourceMetrics.metricName, metricName),
          gte(resourceMetrics.timestamp, since)
        )
      )
      .orderBy(asc(resourceMetrics.timestamp));

    if (metrics.length === 0) return;

    // Convert values to numbers
    const values = metrics.map(m => Number(m.value));

    // Calculate statistics
    const avgValue = values.reduce((a, b) => a + b, 0) / values.length;
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    // Calculate percentiles
    const sorted = [...values].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);
    const p95Value = sorted[p95Index];
    const p99Value = sorted[p99Index];

    // Calculate volatility
    const mean = avgValue;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const volatility = mean !== 0 ? (stdDev / mean) * 100 : 0;

    // Analyze trend
    const trend = await analyzeTrend(resourceType, metricName, periodHours);

    // Insert trend record
    const periodStart = new Date(Math.floor(since.getTime() / (periodHours * 60 * 60 * 1000)) * (periodHours * 60 * 60 * 1000));
    const periodEnd = new Date(periodStart.getTime() + periodHours * 60 * 60 * 1000);

    await db.insert(capacityTrends).values({
      resourceType,
      metricName,
      periodStart,
      periodEnd,
      periodType,
      avgValue: avgValue.toString(),
      minValue: minValue.toString(),
      maxValue: maxValue.toString(),
      p95Value: p95Value.toString(),
      p99Value: p99Value.toString(),
      sampleCount: metrics.length,
      trendDirection: trend?.direction,
      trendRate: trend?.rate.toString(),
      volatility: volatility.toString(),
    });

    log.info(
      {
        resourceType,
        metricName,
        periodType,
        samples: metrics.length,
        avg: avgValue,
        min: minValue,
        max: maxValue,
        trend: trend?.direction,
      },
      'Aggregated trend'
    );
  } catch (error) {
    log.error({ error, resourceType, metricName }, 'Failed to aggregate trends');
    throw error;
  }
}

// ── Forecasting ────────────────────────────────────────────────────────────

/**
 * Linear regression forecast
 */
function linearRegression(values: number[], daysAhead: number = 1): ForecastResult {
  if (values.length < 2) {
    return {
      method: 'linear_regression',
      value: values[values.length - 1] || 0,
      confidenceLower: 0,
      confidenceUpper: 0,
      confidenceLevel: 0,
      rSquared: 0,
      mape: 0,
    };
  }

  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i + 1);
  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  const ssXY = x.reduce((sum, xi, i) => sum + (xi - xMean) * (values[i] - yMean), 0);
  const ssXX = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);

  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;

  // Predict future value
  const futurePeriod = n + daysAhead;
  const predictedValue = slope * futurePeriod + intercept;

  // Calculate R²
  const yPredicted = x.map(xi => slope * xi + intercept);
  const ssRes = values.reduce((sum, yi, i) => sum + Math.pow(yi - yPredicted[i], 2), 0);
  const ssTot = values.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // Calculate MAPE
  const mape =
    values.reduce((sum, yi, i) => {
      const predicted = yPredicted[i];
      return sum + Math.abs((yi - predicted) / Math.max(yi, 1));
    }, 0) / n;

  // Estimate confidence interval (simplified)
  const residuals = values.map((yi, i) => yi - yPredicted[i]);
  const residualStdDev = Math.sqrt(
    residuals.reduce((sum, r) => sum + Math.pow(r, 2), 0) / Math.max(n - 2, 1)
  );

  // 95% CI using t-distribution approximation
  const ciMargin = 1.96 * residualStdDev;

  return {
    method: 'linear_regression',
    value: Math.max(0, predictedValue),
    confidenceLower: Math.max(0, predictedValue - ciMargin),
    confidenceUpper: predictedValue + ciMargin,
    confidenceLevel: Math.max(0, Math.min(1, rSquared)),
    rSquared,
    mape: Math.min(1, mape), // cap at 100%
  };
}

/**
 * Exponential smoothing forecast
 */
function exponentialSmoothing(values: number[], alpha: number = 0.3, daysAhead: number = 1): ForecastResult {
  if (values.length < 1) {
    return {
      method: 'exponential_smoothing',
      value: 0,
      confidenceLower: 0,
      confidenceUpper: 0,
      confidenceLevel: 0,
      rSquared: 0,
      mape: 0,
    };
  }

  // Simple exponential smoothing
  let smoothed = values[0];
  const smoothedValues = [smoothed];

  for (let i = 1; i < values.length; i++) {
    smoothed = alpha * values[i] + (1 - alpha) * smoothed;
    smoothedValues.push(smoothed);
  }

  // Forecast ahead
  let predicted = smoothed;
  for (let i = 0; i < daysAhead - 1; i++) {
    // In simple ES, forecasts are constant
  }

  // Calculate MAPE
  const mape =
    values.reduce((sum, yi, i) => {
      const predicted = smoothedValues[i];
      return sum + Math.abs((yi - predicted) / Math.max(yi, 1));
    }, 0) / values.length;

  // Estimate confidence
  const residuals = values.map((yi, i) => yi - smoothedValues[i]);
  const residualStdDev = Math.sqrt(
    residuals.reduce((sum, r) => sum + Math.pow(r, 2), 0) / Math.max(values.length - 1, 1)
  );
  const ciMargin = 1.96 * residualStdDev;

  // Simple R² approximation
  const yMean = values.reduce((a, b) => a + b, 0) / values.length;
  const ssRes = residuals.reduce((sum, r) => sum + Math.pow(r, 2), 0);
  const ssTot = values.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return {
    method: 'exponential_smoothing',
    value: Math.max(0, predicted),
    confidenceLower: Math.max(0, predicted - ciMargin),
    confidenceUpper: predicted + ciMargin,
    confidenceLevel: Math.max(0, Math.min(1, rSquared)),
    rSquared,
    mape: Math.min(1, mape),
  };
}

/**
 * Generate forecast for a metric
 */
export async function forecast(
  resourceType: string,
  metricName: string,
  daysAhead: number = 7,
  hoursBack: number = 168 // 1 week default
): Promise<ForecastResult | null> {
  try {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const metrics = await db
      .select()
      .from(resourceMetrics)
      .where(
        and(
          eq(resourceMetrics.resourceType, resourceType),
          eq(resourceMetrics.metricName, metricName),
          gte(resourceMetrics.timestamp, since)
        )
      )
      .orderBy(asc(resourceMetrics.timestamp));

    if (metrics.length < 3) {
      return null;
    }

    const values = metrics.map(m => Number(m.value));

    // Use linear regression as primary method
    const lr = linearRegression(values, daysAhead);

    // Use exponential smoothing for comparison
    const es = exponentialSmoothing(values, 0.3, daysAhead);

    // Weighted ensemble: prefer linear regression for clear trends, ES for noise
    const useES = lr.rSquared < 0.3; // if poor fit, use ES
    const result = useES ? es : lr;

    // Store forecast
    const forecastDate = new Date();
    forecastDate.setDate(forecastDate.getDate() + daysAhead);

    await db.insert(capacityForecasts).values({
      resourceType,
      metricName,
      forecastDate: forecastDate.toISOString().split('T')[0],
      forecastMethod: result.method,
      forecastValue: result.value.toString(),
      confidenceIntervalLower: result.confidenceLower.toString(),
      confidenceIntervalUpper: result.confidenceUpper.toString(),
      confidenceLevel: result.confidenceLevel.toString(),
      modelRSquared: result.rSquared.toString(),
      mape: result.mape.toString(),
    });

    log.info(
      {
        resourceType,
        metricName,
        daysAhead,
        method: result.method,
        forecast: result.value,
        confidence: result.confidenceLevel,
      },
      'Generated forecast'
    );

    return result;
  } catch (error) {
    log.error({ error, resourceType, metricName }, 'Failed to generate forecast');
    return null;
  }
}

// ── Threshold Checking and Alerts ──────────────────────────────────────────

/**
 * Check if current metric exceeds thresholds
 */
export async function checkThresholds(
  resourceType: string,
  metricName: string
): Promise<void> {
  try {
    // Get the threshold configuration
    const threshold = await db
      .select()
      .from(capacityThresholds)
      .where(
        and(
          eq(capacityThresholds.resourceType, resourceType),
          eq(capacityThresholds.metricName, metricName),
          eq(capacityThresholds.enabled, true)
        )
      );

    if (threshold.length === 0) return;

    const config = threshold[0];

    // Get latest metric
    const latestMetric = await db
      .select()
      .from(resourceMetrics)
      .where(
        and(
          eq(resourceMetrics.resourceType, resourceType),
          eq(resourceMetrics.metricName, metricName)
        )
      )
      .orderBy(desc(resourceMetrics.timestamp))
      .limit(1);

    if (latestMetric.length === 0) return;

    const current = Number(latestMetric[0].value);
    const critical = Number(config.criticalThreshold);
    const warning = Number(config.warningThreshold);

    let alertLevel = null;
    let thresholdValue = null;

    if (current >= critical) {
      alertLevel = 'critical';
      thresholdValue = critical;
    } else if (current >= warning) {
      alertLevel = 'warning';
      thresholdValue = warning;
    }

    if (alertLevel) {
      await db.insert(capacityAlerts).values({
        thresholdId: config.id,
        resourceType,
        metricName,
        alertLevel,
        currentValue: current.toString(),
        thresholdValue: thresholdValue!.toString(),
        alertType: 'current_value',
      });

      log.warn(
        {
          resourceType,
          metricName,
          alertLevel,
          current,
          threshold: thresholdValue,
        },
        'Capacity threshold exceeded'
      );
    }
  } catch (error) {
    log.error({ error, resourceType, metricName }, 'Failed to check thresholds');
  }
}

/**
 * Check forecasts against thresholds and alert if necessary
 */
export async function checkForecastThresholds(): Promise<void> {
  try {
    // Get all active thresholds
    const thresholds = await db
      .select()
      .from(capacityThresholds)
      .where(eq(capacityThresholds.enabled, true));

    for (const threshold of thresholds) {
      // Get recent forecasts
      const since = new Date();
      since.setDate(since.getDate() - threshold.forecastWarningDays);

      const forecasts = await db
        .select()
        .from(capacityForecasts)
        .where(
          and(
            eq(capacityForecasts.resourceType, threshold.resourceType),
            eq(capacityForecasts.metricName, threshold.metricName),
            gte(capacityForecasts.forecastDate, since.toISOString().split('T')[0])
          )
        );

      for (const fcst of forecasts) {
        const forecastValue = Number(fcst.forecastValue);
        const critical = Number(threshold.criticalThreshold);

        if (forecastValue >= critical) {
          // Check if we already alerted
          const existing = await db
            .select()
            .from(capacityAlerts)
            .where(
              and(
                eq(capacityAlerts.thresholdId, threshold.id),
                eq(capacityAlerts.alertType, 'forecast_based'),
                eq(capacityAlerts.resourceType, threshold.resourceType)
              )
            );

          if (existing.length === 0) {
            await db.insert(capacityAlerts).values({
              thresholdId: threshold.id,
              resourceType: threshold.resourceType,
              metricName: threshold.metricName,
              alertLevel: 'critical',
              currentValue: '0',
              thresholdValue: critical.toString(),
              alertType: 'forecast_based',
            });

            log.warn(
              {
                resourceType: threshold.resourceType,
                metricName: threshold.metricName,
                forecastDate: fcst.forecastDate,
                forecastValue,
                critical,
              },
              'Forecast-based capacity alert'
            );
          }
        }
      }
    }
  } catch (error) {
    log.error({ error }, 'Failed to check forecast thresholds');
  }
}

// ── Recommendations ────────────────────────────────────────────────────────

/**
 * Generate capacity recommendations based on trends and forecasts
 */
export async function generateRecommendations(): Promise<CapacityRecommendation[]> {
  try {
    const recommendations: CapacityRecommendation[] = [];

    // Get all recent trends
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
    const trends = await db
      .select()
      .from(capacityTrends)
      .where(gte(capacityTrends.createdAt, since))
      .orderBy(desc(capacityTrends.createdAt));

    for (const trend of trends) {
      // Strong increasing trend
      if (
        trend.trendDirection === 'increasing' &&
        Number(trend.trendRate) > 0.05
      ) {
        const volatility = Number(trend.volatility);

        let urgency: 'low' | 'medium' | 'high' = 'medium';
        let effort: 'easy' | 'moderate' | 'difficult' = 'moderate';

        if (volatility > 30 || Number(trend.avgValue) > 70) {
          urgency = 'high';
          effort = 'difficult';
        }

        const forecastDate = new Date();
        forecastDate.setDate(forecastDate.getDate() + 7);

        recommendations.push({
          resourceType: trend.resourceType,
          metricName: trend.metricName,
          recommendation: `${trend.metricName} is increasing at ${(Number(trend.trendRate) * 100).toFixed(1)}% per day with ${volatility.toFixed(1)}% volatility`,
          urgency,
          recommendedAction: `Increase ${trend.resourceType} capacity or optimize usage patterns`,
          estimatedImpact: `${urgency === 'high' ? 'Critical' : 'Important'} - may impact service quality if not addressed`,
          implementationEffort: effort,
          forecastDate,
        });
      }
    }

    // Store recommendations
    for (const rec of recommendations) {
      await db.insert(capacityRecommendations).values({
        resourceType: rec.resourceType,
        metricName: rec.metricName,
        recommendation: rec.recommendation,
        urgency: rec.urgency,
        recommendedAction: rec.recommendedAction,
        estimatedImpact: rec.estimatedImpact,
        implementationEffort: rec.implementationEffort,
        forecastDate: rec.forecastDate,
      });
    }

    log.info({ count: recommendations.length }, 'Generated capacity recommendations');

    return recommendations;
  } catch (error) {
    log.error({ error }, 'Failed to generate recommendations');
    return [];
  }
}

// ── Reporting ──────────────────────────────────────────────────────────────

/**
 * Get capacity status report
 */
export async function getCapacityReport(days: number = 7) {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get resource types with recent trends
    const recentTrends = await db
      .select()
      .from(capacityTrends)
      .where(gte(capacityTrends.createdAt, since))
      .orderBy(desc(capacityTrends.createdAt));

    // Group by resource type and metric
    const grouped: Record<string, Record<string, any[]>> = {};
    for (const trend of recentTrends) {
      if (!grouped[trend.resourceType]) {
        grouped[trend.resourceType] = {};
      }
      if (!grouped[trend.resourceType][trend.metricName]) {
        grouped[trend.resourceType][trend.metricName] = [];
      }
      grouped[trend.resourceType][trend.metricName].push(trend);
    }

    // Get active alerts
    const activeAlerts = await db
      .select()
      .from(capacityAlerts)
      .where(eq(capacityAlerts.resolvedAt, null))
      .orderBy(desc(capacityAlerts.createdAt));

    // Get pending recommendations
    const pendingRecs = await db
      .select()
      .from(capacityRecommendations)
      .where(eq(capacityRecommendations.implemented, false))
      .orderBy(desc(capacityRecommendations.urgency));

    return {
      reportDate: new Date(),
      periodDays: days,
      resourceMetrics: grouped,
      activeAlerts,
      pendingRecommendations: pendingRecs,
      summary: {
        totalMetrics: Object.keys(grouped).length,
        activeAlertCount: activeAlerts.length,
        criticalAlertCount: activeAlerts.filter(a => a.alertLevel === 'critical').length,
        pendingRecommendationCount: pendingRecs.length,
        highUrgencyCount: pendingRecs.filter(r => r.urgency === 'high').length,
      },
    };
  } catch (error) {
    log.error({ error }, 'Failed to generate capacity report');
    throw error;
  }
}
