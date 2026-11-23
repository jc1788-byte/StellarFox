/**
 * Example: Integrating Capacity Planning into Your Backend
 * 
 * This file shows how to integrate the capacity planning system
 * into a typical Express.js backend application.
 */

import express, { Express } from 'express';
import { db } from '../db';
import { capacityThresholds } from '../db/schema';

// Import capacity planning components
import capacityPlanningRoutes from '../routes/capacityPlanning.routes';
import { startMetricsCollection } from '../services/metricsCollector.service';
import { initializeCapacityPlanningJobs } from '../cron/capacityPlanningJobs';
import { recordMetric } from '../services/capacityPlanning.service';

/**
 * Example 1: Basic Integration in Your Express App
 */
export function integrateCapacityPlanning(app: Express) {
  // Register the capacity planning API routes
  app.use('/api/capacity', capacityPlanningRoutes);

  console.log('✓ Capacity planning routes registered at /api/capacity');
}

/**
 * Example 2: Start Automated Metrics Collection
 */
export function startAutomaticMetricsCollection() {
  // Start collecting system metrics every 1 minute
  // You can customize the interval and provide custom metric callbacks
  const collector = startMetricsCollection(1, {
    // Optional: Provide database connection metrics
    getDatabaseConnections: async () => {
      // Example: return pool.totalCount || 0;
      // This would be your actual connection pool
      return 0;
    },

    // Optional: Provide Redis metrics
    getRedisInfo: async () => {
      // Example: return redis.client.info('stats') || {};
      // This would be your actual Redis client
      return {};
    },
  });

  console.log('✓ Metrics collection started');

  return collector;
}

/**
 * Example 3: Initialize Automated Cron Jobs
 */
export function startAutomatedTrendAnalysis() {
  // Initialize all cron jobs for:
  // - Hourly trend aggregation
  // - Daily forecasting
  // - Weekly trends
  // - Continuous threshold checking
  // - Recommendation generation
  // - Automatic cleanup
  const jobs = initializeCapacityPlanningJobs();

  console.log('✓ Capacity planning cron jobs initialized');

  return jobs;
}

/**
 * Example 4: Set Up Default Alert Thresholds
 */
export async function setupDefaultThresholds() {
  try {
    // Clear existing thresholds (optional)
    // await db.delete(capacityThresholds);

    // Create thresholds for critical metrics
    await db.insert(capacityThresholds).values([
      {
        resourceType: 'memory',
        metricName: 'used_percentage',
        warningThreshold: '70',
        criticalThreshold: '85',
        forecastWarningDays: 7,
        enabled: true,
      },
      {
        resourceType: 'cpu',
        metricName: 'load_average_1m',
        warningThreshold: '2.0',
        criticalThreshold: '4.0',
        forecastWarningDays: 7,
        enabled: true,
      },
      {
        resourceType: 'process_memory',
        metricName: 'heap_percentage',
        warningThreshold: '75',
        criticalThreshold: '90',
        forecastWarningDays: 7,
        enabled: true,
      },
    ]);

    console.log('✓ Default alert thresholds created');
  } catch (error) {
    console.error('Error setting up thresholds:', error);
  }
}

/**
 * Example 5: Record Custom Application Metrics
 * 
 * Call this from your request handlers to track application-specific metrics
 */
export async function recordApplicationMetrics(
  requestDuration: number,
  queueLength: number,
  cacheHitRate: number
) {
  try {
    // Record request processing time
    if (requestDuration > 0) {
      await recordMetric({
        resourceType: 'application',
        metricName: 'request_duration_ms',
        value: requestDuration,
        unit: 'milliseconds',
        serviceName: 'express-server',
      });
    }

    // Record job queue length
    if (queueLength >= 0) {
      await recordMetric({
        resourceType: 'application',
        metricName: 'queue_length',
        value: queueLength,
        unit: 'count',
        serviceName: 'job-processor',
      });
    }

    // Record cache hit rate
    if (cacheHitRate >= 0 && cacheHitRate <= 100) {
      await recordMetric({
        resourceType: 'cache',
        metricName: 'hit_rate',
        value: cacheHitRate,
        unit: 'percentage',
        serviceName: 'redis',
      });
    }
  } catch (error) {
    console.error('Error recording metrics:', error);
  }
}

/**
 * Example 6: Request Tracking Middleware
 * 
 * Use this middleware to automatically track request metrics
 */
export function capacityMetricsMiddleware() {
  return (req: any, res: any, next: any) => {
    const startTime = Date.now();

    // Capture original send
    const originalSend = res.send;

    res.send = function (data: any) {
      const duration = Date.now() - startTime;

      // Record metric asynchronously (don't block response)
      recordMetric({
        resourceType: 'http',
        metricName: 'request_duration_ms',
        value: duration,
        unit: 'milliseconds',
        metadata: {
          method: req.method,
          route: req.route?.path || req.path,
          status: res.statusCode,
        },
      }).catch(err => console.error('Metric recording error:', err));

      // Call original send
      return originalSend.call(this, data);
    };

    next();
  };
}

/**
 * Example 7: Complete Server Integration
 */
export async function initializeCapacityPlanningFullStack(app: Express) {
  try {
    console.log('\n📊 Initializing Capacity Planning System...\n');

    // 1. Register API routes
    integrateCapacityPlanning(app);

    // 2. Set up alert thresholds
    await setupDefaultThresholds();

    // 3. Start metrics collection
    const collector = startAutomaticMetricsCollection();

    // 4. Initialize cron jobs
    const jobs = startAutomatedTrendAnalysis();

    // 5. Add middleware to track requests
    app.use(capacityMetricsMiddleware());

    console.log('\n✅ Capacity planning system initialized!\n');

    // Return cleanup function for graceful shutdown
    return {
      shutdown: async () => {
        console.log('\n🛑 Shutting down capacity planning...');
        collector.stop();
        jobs.stop();
        console.log('✓ Capacity planning stopped\n');
      },
    };
  } catch (error) {
    console.error('❌ Failed to initialize capacity planning:', error);
    throw error;
  }
}

/**
 * Example 8: Usage in Your Main Server File
 * 
 * Place this in your backend/src/index.ts or main app file:
 */

/*
import express from 'express';
import { initializeCapacityPlanningFullStack } from './examples/capacityPlanningExample';

const app = express();

// ... your other middleware and routes ...

// Initialize capacity planning
const capacityPlanning = await initializeCapacityPlanningFullStack(app);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  
  server.close(async () => {
    await capacityPlanning.shutdown();
    // ... other cleanup ...
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  
  server.close(async () => {
    await capacityPlanning.shutdown();
    // ... other cleanup ...
    process.exit(0);
  });
});
*/

/**
 * Example 9: Usage Patterns
 */

// Pattern 1: Record metrics in a request handler
/*
app.get('/api/users', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const users = await getUsers();
    const duration = Date.now() - startTime;
    
    // Track this operation
    await recordMetric({
      resourceType: 'database',
      metricName: 'query_duration_ms',
      value: duration,
      unit: 'milliseconds',
      metadata: { query: 'getUsers' }
    });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
*/

// Pattern 2: Track business metrics
/*
app.post('/api/bets', async (req, res) => {
  // ... create bet ...
  
  await recordApplicationMetrics(
    requestDuration,
    jobQueueLength,
    cacheHitRate
  );
  
  res.json(newBet);
});
*/

// Pattern 3: Monitor critical services
/*
async function monitorDatabasePool() {
  setInterval(async () => {
    const activeConnections = db.pool?.totalCount || 0;
    const idleConnections = db.pool?.idleCount || 0;
    
    await recordMetric({
      resourceType: 'database',
      metricName: 'active_connections',
      value: activeConnections,
      unit: 'count'
    });
    
    await recordMetric({
      resourceType: 'database',
      metricName: 'idle_connections',
      value: idleConnections,
      unit: 'count'
    });
  }, 30000); // Check every 30 seconds
}
*/
