# Alerting System Integration Guide

Complete guide for integrating the multi-channel alerting system into your StellarFox application.

## Step 1: Add Dependencies

Update your `package.json`:

```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "uuid": "^9.0.0",
    "node-cron": "^4.6.0"
  }
}
```

Run:
```bash
npm install
```

## Step 2: Update Environment Configuration

### Add PagerDuty configuration to `src/config/env.ts`:

```typescript
import { z } from 'zod';

const envSchema = z.object({
  // ... existing config
  
  // PagerDuty Configuration
  PAGERDUTY_API_KEY: z.string().optional(),
  PAGERDUTY_INTEGRATION_KEY: z.string().optional(),
  PAGERDUTY_ENABLED: z.coerce.boolean().default(false),
  
  // Alert Configuration
  DEFAULT_ALERT_SEVERITY: z.string().default('medium'),
  MAX_ACTIVE_ALERTS: z.coerce.number().int().positive().default(1000),
  ALERT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  ALERT_DEDUPLICATION_ENABLED: z.coerce.boolean().default(true),
  ALERT_DEDUP_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
  
  // On-Call Configuration
  DEFAULT_SCHEDULE_TIMEZONE: z.string().default('America/New_York'),
  SYNC_SCHEDULES_WITH_PAGERDUTY: z.coerce.boolean().default(false),
  
  // Auto-escalation
  AUTO_ESCALATION_ENABLED: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof envSchema>;
```

### Update `.env`:

```env
PAGERDUTY_API_KEY=your_key_here
PAGERDUTY_INTEGRATION_KEY=your_integration_key
PAGERDUTY_ENABLED=true
```

## Step 3: Initialize Services in `src/index.ts`

```typescript
import express from 'express';
import { getEnv, validateEnv } from './config/env';
import { logger } from './utils/logger';
import { initPagerDutyService } from './services/pagerduty.service';
import { getAlertService } from './services/alert.service';
import { getOnCallService } from './services/oncall.service';
import alertingRoutes from './routes/alerting.routes';

const app = express();

// Validate environment
const env = validateEnv();

// Initialize alerting system
if (env.PAGERDUTY_ENABLED && env.PAGERDUTY_API_KEY) {
  try {
    initPagerDutyService({
      apiKey: env.PAGERDUTY_API_KEY,
      integrationKey: env.PAGERDUTY_INTEGRATION_KEY || '',
      enabled: true,
    });
    logger.info('PagerDuty service initialized');
  } catch (error) {
    logger.warn('Failed to initialize PagerDuty service', { error });
  }
}

// Ensure services are initialized
const alertService = getAlertService();
const onCallService = getOnCallService();

logger.info('Alert service initialized');
logger.info('On-call service initialized');

// Register alerting API routes
app.use('/api/alerts', alertingRoutes);

// ... rest of your app setup
```

## Step 4: Run Database Migration

```bash
npm run migrate
```

Verify tables were created:
```bash
psql $DATABASE_URL -c "\dt alerts*"
```

## Step 5: Example Usage in Your Services

### Example 1: Health Check with Auto-Alerting

```typescript
// src/services/health-check.service.ts
import { getAlertService } from './alert.service';
import { AlertSeverity } from '../types/alerting.types';

export class HealthCheckService {
  private alertService = getAlertService();
  
  async checkSystemHealth(): Promise<void> {
    try {
      const metrics = await this.collectMetrics();
      
      // Check database connection
      if (!metrics.databaseHealthy) {
        await this.alertService.triggerAlert({
          title: 'Database Connection Failed',
          description: 'Unable to connect to primary database',
          severity: AlertSeverity.CRITICAL,
          source: 'health-check:database',
          tags: {
            service: 'database',
            environment: process.env.NODE_ENV,
          },
          channels: ['email', 'pagerduty', 'slack'],
          metadata: {
            attempt: metrics.dbConnectionAttempts,
            lastError: metrics.dbError,
          },
        });
      }
      
      // Check API responsiveness
      if (metrics.apiLatency > 5000) {
        await this.alertService.triggerAlert({
          title: 'High API Latency',
          description: `API response time exceeded threshold: ${metrics.apiLatency}ms`,
          severity: AlertSeverity.HIGH,
          source: 'health-check:performance',
          tags: {
            service: 'api',
            environment: process.env.NODE_ENV,
            region: process.env.REGION,
          },
          metadata: {
            latencyMs: metrics.apiLatency,
            p99Latency: metrics.p99Latency,
          },
        });
      }
      
    } catch (error) {
      logger.error('Health check failed', { error });
    }
  }
  
  private async collectMetrics() {
    // Implementation to collect system metrics
    return {
      databaseHealthy: true,
      dbConnectionAttempts: 0,
      apiLatency: 0,
      p99Latency: 0,
    };
  }
}
```

### Example 2: Cron-based Alert Processing

```typescript
// src/cron/alert-processor.cron.ts
import * as cron from 'node-cron';
import { getAlertService } from '../services/alert.service';
import { getOnCallService } from '../services/oncall.service';
import { logger } from '../utils/logger';

export function initAlertingCrons(): void {
  // Check escalation policies every minute
  cron.schedule('* * * * *', async () => {
    try {
      const alertService = getAlertService();
      const activeAlerts = await alertService.getActiveAlerts();
      
      for (const alert of activeAlerts) {
        const ageMinutes = (Date.now() - alert.timestamp.getTime()) / 60000;
        
        // Auto-escalate after 15 minutes
        if (ageMinutes > 15 && alert.status !== 'acknowledged') {
          // Your escalation logic
          logger.info('Auto-escalating alert', { alertId: alert.id, age: ageMinutes });
        }
      }
    } catch (error) {
      logger.error('Error in alert escalation cron', { error });
    }
  });
  
  // Sync on-call schedules with PagerDuty every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const onCallService = getOnCallService();
      const schedules = await onCallService.listSchedules();
      
      logger.info('Synced on-call schedules', { count: schedules.length });
    } catch (error) {
      logger.error('Error syncing schedules', { error });
    }
  });
}

// Call this in your main index.ts:
// initAlertingCrons();
```

### Example 3: Market Monitoring with Alerts

```typescript
// In your market service
import { getAlertService } from '../services/alert.service';
import { AlertSeverity } from '../types/alerting.types';

export class MarketMonitoringService {
  private alertService = getAlertService();
  
  async monitorMarketAnomalies(market: Market): Promise<void> {
    // Check for unusual price movements
    const priceChange = Math.abs(market.priceChange);
    if (priceChange > 50) { // 50% change
      await this.alertService.triggerAlert({
        title: 'Unusual Market Price Movement',
        description: `Market ${market.id} price changed by ${priceChange}%`,
        severity: AlertSeverity.HIGH,
        source: 'market-monitor',
        tags: {
          marketId: market.id,
          category: market.category,
          threshold: 'price_change_50',
        },
        channels: ['email', 'pagerduty'],
        metadata: {
          marketId: market.id,
          priceChange,
          previousPrice: market.previousPrice,
          currentPrice: market.currentPrice,
          timestamp: new Date().toISOString(),
        },
      });
    }
    
    // Check for low liquidity
    if (market.liquidity < 1000) {
      await this.alertService.triggerAlert({
        title: 'Low Market Liquidity',
        description: `Market ${market.id} liquidity below threshold`,
        severity: AlertSeverity.MEDIUM,
        source: 'market-monitor',
        tags: {
          marketId: market.id,
          threshold: 'low_liquidity',
        },
        channels: ['slack', 'webhook'],
        metadata: {
          marketId: market.id,
          liquidity: market.liquidity,
          threshold: 1000,
        },
      });
    }
  }
}
```

### Example 4: Error Tracking with Alerts

```typescript
// Add to your error handling middleware
import { getAlertService } from '../services/alert.service';
import { AlertSeverity } from '../types/alerting.types';

app.use((err: any, req: any, res: any, next: any) => {
  const alertService = getAlertService();
  
  // Alert on critical errors
  if (err.statusCode >= 500 || err.isCritical) {
    alertService.triggerAlert({
      title: `Error: ${err.message}`,
      description: `Stack: ${err.stack}`,
      severity: err.statusCode === 503 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
      source: 'api-error',
      tags: {
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
      },
      channels: ['pagerduty', 'email'],
      metadata: {
        url: req.originalUrl,
        error: err.message,
        statusCode: err.statusCode,
      },
    }).catch((error) => {
      logger.error('Failed to trigger alert for error', { error });
    });
  }
  
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message,
  });
});
```

## Step 6: Test the Integration

### Test Alert Triggering

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Trigger alert
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Alert",
    "description": "This is a test alert",
    "severity": "high",
    "source": "test-source",
    "channels": ["email", "pagerduty"]
  }'
```

### Verify Database

```bash
psql $DATABASE_URL -c "SELECT * FROM alerts ORDER BY created_at DESC LIMIT 5;"
```

### Check PagerDuty

Visit your PagerDuty dashboard to see if the incident was created.

## Step 7: Setup Monitoring Dashboard

Create a dashboard to monitor the alerting system:

```typescript
// src/routes/alerting-dashboard.routes.ts
import { Router, Request, Response } from 'express';
import { getAlertService } from '../services/alert.service';
import { getOnCallService } from '../services/oncall.service';

const router = Router();

router.get('/dashboard/stats', async (req: Request, res: Response) => {
  const alertService = getAlertService();
  const onCallService = getOnCallService();
  
  const alerts = await alertService.getActiveAlerts();
  const schedules = await onCallService.listSchedules();
  
  // Get current on-call person for each schedule
  const currentOnCall = await Promise.all(
    schedules.map(async (schedule) => ({
      schedule: schedule.name,
      member: await onCallService.getCurrentOnCall(schedule.id),
    }))
  );
  
  res.json({
    alerts: {
      total: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
    },
    onCall: currentOnCall,
    schedules: schedules.length,
  });
});

export default router;
```

## Step 8: Production Deployment

### Secrets Management

```bash
# Store in your secret manager (AWS Secrets Manager, HashiCorp Vault, etc.)
PAGERDUTY_API_KEY=<production-key>
PAGERDUTY_INTEGRATION_KEY=<production-integration-key>
```

### Database Backups

Ensure you have regular backups of the alerting tables:

```sql
-- Backup alerts
COPY alerts TO STDOUT | gzip > alerts_backup.sql.gz

-- Backup on-call schedules
COPY oncall_schedules TO STDOUT | gzip > schedules_backup.sql.gz
```

### Monitoring the Alerting System

Add metrics for the alerting system itself:

```typescript
// src/metrics/alerting-metrics.ts
import prom from 'prom-client';

export const alertsTriggered = new prom.Counter({
  name: 'alerts_triggered_total',
  help: 'Total number of alerts triggered',
  labelNames: ['severity', 'source'],
});

export const alertsResolved = new prom.Counter({
  name: 'alerts_resolved_total',
  help: 'Total number of alerts resolved',
  labelNames: ['source'],
});

export const alertsActive = new prom.Gauge({
  name: 'alerts_active',
  help: 'Current number of active alerts',
  labelNames: ['severity'],
});

export const notificationErrors = new prom.Counter({
  name: 'notifications_errors_total',
  help: 'Total notification errors',
  labelNames: ['channel'],
});
```

## Troubleshooting

### Alerts not appearing in PagerDuty

1. Check API key is valid
2. Verify integration key is correct
3. Check firewall/network access to api.pagerduty.com
4. Review application logs for errors

### On-call schedule not updating

1. Verify database connection
2. Check Redis is accessible
3. Ensure schedule sync is enabled
4. Review migration was applied successfully

### Notifications not being sent

1. Verify notification channels are configured
2. Check email/SMS credentials
3. Review rate limits
4. Check application logs for channel-specific errors

## Related Documentation

- [Alerting Setup Guide](./ALERTING_SETUP.md)
- [PagerDuty API Documentation](https://developer.pagerduty.com/)
- [Service Type Definitions](./src/types/alerting.types.ts)
