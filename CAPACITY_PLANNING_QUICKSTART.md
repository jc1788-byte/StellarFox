# Capacity Planning Quick Start Guide

## 5-Minute Setup

### 1. Run the Migration

Apply the database migration to create all capacity planning tables:

```bash
cd backend
npm run migrate
```

This creates these tables:
- `resource_metrics` - Raw metric readings
- `capacity_trends` - Aggregated trends
- `capacity_forecasts` - Predictions
- `capacity_thresholds` - Alert configuration
- `capacity_alerts` - Alert history
- `capacity_recommendations` - Recommendations

### 2. Update Your Main Server File

Add to your `backend/src/index.ts` or main app file:

```typescript
import capacityPlanningRoutes from './routes/capacityPlanning.routes';
import { startMetricsCollection } from './services/metricsCollector.service';
import { initializeCapacityPlanningJobs } from './cron/capacityPlanningJobs';

// Register the capacity planning API routes
app.use('/api/capacity', capacityPlanningRoutes);

// Start collecting system metrics every minute
// The callbacks are optional - use them to provide custom metrics
const collector = startMetricsCollection(1, {
  getDatabaseConnections: async () => {
    // Return your database connection pool size
    // Example: return pool.totalCount || 0;
    return 0;
  },
  getRedisInfo: async () => {
    // Return Redis info object
    // Example: return redis.info('stats') || {};
    return {};
  },
});

// Initialize all cron jobs for automated analysis
const capacityJobs = initializeCapacityPlanningJobs();

// On graceful shutdown
process.on('SIGTERM', () => {
  collector.stop();
  capacityJobs.stop();
  // ... other cleanup
});
```

### 3. Create Default Thresholds

Create a seed script or initialization function:

```typescript
import { db } from './db';
import { capacityThresholds } from './db/schema';

async function setupDefaultThresholds() {
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
      warningThreshold: '2',
      criticalThreshold: '4',
      forecastWarningDays: 7,
      enabled: true,
    },
  ]);
  
  console.log('Default thresholds created');
}

// Run during server initialization
await setupDefaultThresholds();
```

### 4. Start Collecting Data

The metrics collector starts automatically when you initialize it. It collects:

- **CPU**: load average (1m, 5m, 15m), count
- **Memory**: total, free, used, used percentage
- **Process**: heap usage, RSS memory, uptime
- **Database**: active connections (if callback provided)
- **Redis**: memory, clients, ops/sec (if callback provided)

## Common Tasks

### Record a Custom Metric

```bash
curl -X POST http://localhost:3000/api/capacity/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "api",
    "metricName": "request_count",
    "value": 1250,
    "unit": "count",
    "serviceName": "express-server"
  }'
```

### Check Memory Trend

```bash
# Analyze trends over last 24 hours
curl http://localhost:3000/api/capacity/trends/memory/used_percentage?hoursBack=24

# Response shows:
# - direction: "increasing" | "decreasing" | "stable"
# - rate: change per day
# - volatility: standard deviation
# - confidence: 0-1 score
```

### Forecast CPU Load

```bash
# Predict CPU load 7 days ahead using 1 week of history
curl http://localhost:3000/api/capacity/forecast/cpu/load_average_1m?daysAhead=7&hoursBack=168

# Response includes:
# - forecastValue: predicted value
# - confidenceIntervalLower/Upper: 95% CI
# - confidenceLevel: model reliability
# - rSquared: model fit quality (0-1)
```

### Set Alert Thresholds

```bash
# Create alert for database connections
curl -X POST http://localhost:3000/api/capacity/thresholds \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "database",
    "metricName": "active_connections",
    "warningThreshold": 80,
    "criticalThreshold": 95,
    "forecastWarningDays": 3
  }'
```

### Check for Active Alerts

```bash
# Get all unresolved alerts
curl http://localhost:3000/api/capacity/alerts?resolved=false

# Get critical alerts only
curl http://localhost:3000/api/capacity/alerts?resolved=false | jq '.alerts[] | select(.alertLevel=="critical")'
```

### Get Recommendations

```bash
# Get all pending recommendations
curl http://localhost:3000/api/capacity/recommendations?implemented=false

# Get only high-urgency recommendations
curl http://localhost:3000/api/capacity/recommendations?urgency=high&implemented=false
```

### Mark Recommendation as Done

```bash
curl -X PATCH http://localhost:3000/api/capacity/recommendations/42 \
  -H "Content-Type: application/json" \
  -d '{
    "implemented": true,
    "notes": "Added 100GB storage to production database"
  }'
```

### Get Full Capacity Report

```bash
# Get 7-day report
curl http://localhost:3000/api/capacity/report?days=7

# Get 30-day report
curl http://localhost:3000/api/capacity/report?days=30
```

## What Happens Automatically

The system runs these jobs:

| When | What |
|------|------|
| Every 5 minutes | Check if metrics exceed warning/critical thresholds |
| Every hour (at :05) | Aggregate raw metrics into hourly trends |
| 1 AM daily | Create daily trends and generate 7-day forecasts |
| 2 AM Mondays | Create weekly trends |
| 3 AM daily | Generate recommendations based on trends |
| 6 AM & 6 PM | Check if forecasts predict future threshold breaches |
| 4 AM daily | Clean up metrics older than 90 days |

## Understanding the Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    METRICS COLLECTION                       │
│  (every minute: system, process, database, redis metrics)   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │   resource_metrics table   │
    │  (raw 1-minute readings)   │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────────┐
    │  HOURLY AGGREGATION (every hr) │
    │  - avg, min, max, p95, p99    │
    └────────────┬───────────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │   capacity_trends table    │
    │  (hourly/daily/weekly/etc) │
    └────────────┬───────────────┘
                 │
    ┌────────────▼──────────────────┐
    │  FORECASTING (daily at 1 AM)  │
    │  - Linear regression          │
    │  - Exponential smoothing      │
    │  - Ensemble selection         │
    └────────────┬──────────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  capacity_forecasts table  │
    │  (7-day predictions)       │
    └────────────┬───────────────┘
                 │
    ┌────────────▼────────────────────┐
    │  ALERTS & RECOMMENDATIONS       │
    │  - Check thresholds (every 5m)  │
    │  - Generate recs (daily at 3am) │
    │  - Forecast-based alerts (2x/d) │
    └────────────┬────────────────────┘
                 │
                 ▼
    ┌──────────────────────────────────┐
    │  capacity_alerts table           │
    │  capacity_recommendations table  │
    └──────────────────────────────────┘
```

## Interpreting Results

### Trend Direction
- **Increasing**: Metric is going up (concerning if near threshold)
- **Decreasing**: Metric is going down (good sign)
- **Stable**: Metric is steady (predictable)

### Volatility
- **Low (<5%)**: Stable, predictable metric
- **Medium (5-15%)**: Normal variation
- **High (>15%)**: Unpredictable, may need investigation

### Forecast Confidence
- **0.9+**: Very reliable (high R² value)
- **0.7-0.9**: Reliable
- **0.5-0.7**: Acceptable
- **<0.5**: Use with caution

### Recommendation Urgency
- **High**: Address in next 1-2 days
- **Medium**: Address this week
- **Low**: Plan for future addressing

## Example: Memory Management Workflow

1. **Day 1**: System starts collecting memory metrics automatically

2. **Day 7**: You check the trend:
   ```bash
   curl http://localhost:3000/api/capacity/trends/memory/used_percentage
   ```
   Result: "increasing" at 0.5% per day with 8% volatility

3. **Day 8**: Forecast predicts memory will be 92% in 7 days
   ```bash
   curl http://localhost:3000/api/capacity/forecast/memory/used_percentage
   ```
   Forecast shows 92% ± 5% with 0.88 confidence

4. **Day 8 (1 AM)**: System generates recommendation: "Add 50GB RAM"

5. **Day 8 (6 AM)**: System alerts because forecast exceeds 85% critical threshold

6. **Day 8 (you)**: 
   - Check alerts: `curl http://localhost:3000/api/capacity/alerts`
   - Review recommendation: `curl http://localhost:3000/api/capacity/recommendations?urgency=high`
   - Order new RAM

7. **Day 9 (you)**: 
   - Install RAM
   - Mark recommendation done: `curl -X PATCH ... -d '{"implemented":true}'`

8. **Day 10**: Memory trend resets, forecast improves

## Troubleshooting

### No metrics appearing?
```bash
# Check if collector is running
curl http://localhost:3000/api/capacity/trends/memory/used_percentage

# If error "Insufficient data", wait 5 minutes and retry
# The collector runs every minute
```

### Forecasts not showing up?
- Need at least 7 days of data (checked at 1 AM)
- Check cron jobs: look for "Starting daily trend aggregation" in logs
- Manual trigger: `curl -X POST http://localhost:3000/api/capacity/trends/aggregate -H "Content-Type: application/json" -d '{"resourceType":"memory","metricName":"used_percentage"}'`

### Alerts not triggering?
```bash
# Verify threshold is configured
curl http://localhost:3000/api/capacity/thresholds

# Manually check thresholds
curl -X POST http://localhost:3000/api/capacity/check-thresholds
```

## Next Steps

1. **Monitor the report daily**: `curl http://localhost:3000/api/capacity/report`
2. **Review recommendations weekly**
3. **Adjust thresholds** based on your system's actual behavior
4. **Integrate with your monitoring** (Grafana, Datadog, etc.)
5. **Set up webhooks** for critical alerts

See `CAPACITY_PLANNING.md` for comprehensive documentation.
