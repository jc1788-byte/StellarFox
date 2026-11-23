import cron from 'node-cron';
import logger from 'pino';
import {
  aggregateTrends,
  forecast,
  checkThresholds,
  checkForecastThresholds,
  generateRecommendations,
} from '../services/capacityPlanning.service';
import { db } from '../db';
import { resourceMetrics } from '../db/schema';
import { sql } from 'drizzle-orm';

const log = logger();

/**
 * Get unique combinations of resourceType and metricName from recent metrics
 */
async function getActiveMetrics() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24 hours

    const result = await db
      .selectDistinct({
        resourceType: resourceMetrics.resourceType,
        metricName: resourceMetrics.metricName,
      })
      .from(resourceMetrics)
      .where(sql`${resourceMetrics.timestamp} >= ${since}`);

    return result;
  } catch (error) {
    log.error({ error }, 'Failed to get active metrics');
    return [];
  }
}

/**
 * Hourly trend aggregation job
 * Aggregates metrics into hourly trends
 */
export function scheduleHourlyTrendAggregation() {
  // Run every hour at minute 5
  const job = cron.schedule('5 * * * *', async () => {
    try {
      log.info('Starting hourly trend aggregation');

      const activeMetrics = await getActiveMetrics();

      for (const metric of activeMetrics) {
        try {
          await aggregateTrends(metric.resourceType, metric.metricName, 'hourly');
        } catch (error) {
          log.error(
            { error, resourceType: metric.resourceType, metricName: metric.metricName },
            'Failed to aggregate hourly trend'
          );
        }
      }

      log.info({ count: activeMetrics.length }, 'Completed hourly trend aggregation');
    } catch (error) {
      log.error({ error }, 'Hourly trend aggregation job failed');
    }
  });

  return job;
}

/**
 * Daily trend aggregation and forecasting job
 * Aggregates metrics into daily trends and generates forecasts
 */
export function scheduleDailyTrendAggregation() {
  // Run every day at 1:00 AM
  const job = cron.schedule('0 1 * * *', async () => {
    try {
      log.info('Starting daily trend aggregation and forecasting');

      const activeMetrics = await getActiveMetrics();
      let aggregatedCount = 0;
      let forecastCount = 0;

      for (const metric of activeMetrics) {
        try {
          // Aggregate to daily
          await aggregateTrends(metric.resourceType, metric.metricName, 'daily');
          aggregatedCount++;

          // Generate forecast
          const forecast_result = await forecast(metric.resourceType, metric.metricName, 7, 168);
          if (forecast_result) {
            forecastCount++;
          }
        } catch (error) {
          log.error(
            { error, resourceType: metric.resourceType, metricName: metric.metricName },
            'Failed to process daily metric'
          );
        }
      }

      log.info(
        { aggregated: aggregatedCount, forecasted: forecastCount },
        'Completed daily trend aggregation and forecasting'
      );
    } catch (error) {
      log.error({ error }, 'Daily trend job failed');
    }
  });

  return job;
}

/**
 * Weekly trend aggregation job
 */
export function scheduleWeeklyTrendAggregation() {
  // Run every Monday at 2:00 AM
  const job = cron.schedule('0 2 * * 1', async () => {
    try {
      log.info('Starting weekly trend aggregation');

      const activeMetrics = await getActiveMetrics();

      for (const metric of activeMetrics) {
        try {
          await aggregateTrends(metric.resourceType, metric.metricName, 'weekly');
        } catch (error) {
          log.error(
            { error, resourceType: metric.resourceType, metricName: metric.metricName },
            'Failed to aggregate weekly trend'
          );
        }
      }

      log.info({ count: activeMetrics.length }, 'Completed weekly trend aggregation');
    } catch (error) {
      log.error({ error }, 'Weekly trend job failed');
    }
  });

  return job;
}

/**
 * Threshold checking job
 * Checks current metrics against thresholds
 */
export function scheduleThresholdChecking() {
  // Run every 5 minutes
  const job = cron.schedule('*/5 * * * *', async () => {
    try {
      log.debug('Checking capacity thresholds');

      const activeMetrics = await getActiveMetrics();

      for (const metric of activeMetrics) {
        try {
          await checkThresholds(metric.resourceType, metric.metricName);
        } catch (error) {
          log.error(
            { error, resourceType: metric.resourceType, metricName: metric.metricName },
            'Failed to check threshold'
          );
        }
      }
    } catch (error) {
      log.error({ error }, 'Threshold checking job failed');
    }
  });

  return job;
}

/**
 * Forecast threshold checking job
 * Checks forecasts against thresholds
 */
export function scheduleForecastThresholdChecking() {
  // Run twice daily: 6 AM and 6 PM
  const job = cron.schedule('0 6,18 * * *', async () => {
    try {
      log.info('Checking forecast-based capacity thresholds');

      await checkForecastThresholds();

      log.info('Completed forecast-based threshold checking');
    } catch (error) {
      log.error({ error }, 'Forecast threshold checking job failed');
    }
  });

  return job;
}

/**
 * Capacity recommendations generation job
 */
export function scheduleRecommendationGeneration() {
  // Run daily at 3:00 AM
  const job = cron.schedule('0 3 * * *', async () => {
    try {
      log.info('Generating capacity recommendations');

      const recommendations = await generateRecommendations();

      log.info(
        { count: recommendations.length },
        'Generated capacity recommendations'
      );
    } catch (error) {
      log.error({ error }, 'Recommendation generation job failed');
    }
  });

  return job;
}

/**
 * Cleanup old metrics job
 * Removes old raw metrics to manage storage
 */
export function scheduleMetricsCleanup() {
  // Run daily at 4:00 AM - keep only 90 days of raw metrics
  const job = cron.schedule('0 4 * * *', async () => {
    try {
      log.info('Starting metrics cleanup');

      const daysToKeep = 90;
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

      // Delete old metrics (PostgreSQL specific)
      // This would need to be adjusted based on your actual DB setup
      await db.execute(
        sql`DELETE FROM ${resourceMetrics} WHERE timestamp < ${cutoffDate}`
      );

      log.info({ daysToKeep }, 'Completed metrics cleanup');
    } catch (error) {
      log.error({ error }, 'Metrics cleanup job failed');
    }
  });

  return job;
}

/**
 * Initialize all capacity planning cron jobs
 */
export function initializeCapacityPlanningJobs() {
  const jobs = [];

  try {
    jobs.push(scheduleHourlyTrendAggregation());
    log.info('Scheduled: Hourly trend aggregation');

    jobs.push(scheduleDailyTrendAggregation());
    log.info('Scheduled: Daily trend aggregation and forecasting');

    jobs.push(scheduleWeeklyTrendAggregation());
    log.info('Scheduled: Weekly trend aggregation');

    jobs.push(scheduleThresholdChecking());
    log.info('Scheduled: Threshold checking (every 5 minutes)');

    jobs.push(scheduleForecastThresholdChecking());
    log.info('Scheduled: Forecast threshold checking');

    jobs.push(scheduleRecommendationGeneration());
    log.info('Scheduled: Daily recommendation generation');

    jobs.push(scheduleMetricsCleanup());
    log.info('Scheduled: Daily metrics cleanup');

    log.info({ jobCount: jobs.length }, 'Capacity planning cron jobs initialized');

    return {
      jobs,
      stop: () => {
        jobs.forEach(job => job.stop());
        log.info('All capacity planning cron jobs stopped');
      },
    };
  } catch (error) {
    log.error({ error }, 'Failed to initialize capacity planning jobs');
    throw error;
  }
}
