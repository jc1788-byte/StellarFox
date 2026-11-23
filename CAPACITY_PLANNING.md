# Capacity Planning with Trend Analysis and Resource Forecasting

## Overview

This comprehensive capacity planning system provides real-time monitoring, trend analysis, and predictive forecasting for system resources. It helps identify bottlenecks, predict future capacity needs, and generate actionable recommendations.

## Features

### 1. Metrics Collection
- **System Metrics**: CPU, memory, disk, load average
- **Process Metrics**: Node.js heap usage, RSS memory, uptime
- **Database Metrics**: Connection counts, query performance
- **Redis Metrics**: Memory usage, connected clients, operations/second
- **Custom Metrics**: Application-specific metrics via API

### 2. Trend Analysis
- Statistical analysis of metric changes over time
- Trend direction detection: increasing, decreasing, stable
- Volatility calculation (standard deviation)
- Confidence scoring based on R² values
- Multiple aggregation periods: hourly, daily, weekly, monthly

### 3. Forecasting
- **Linear Regression**: Best for consistent trends
- **Exponential Smoothing**: Best for noisy data
- 95% confidence intervals with upper/lower bounds
- Model quality metrics (R², MAPE)
- Ensemble predictions

### 4. Alert Management
- Configurable warning and critical thresholds
- Current value alerts (immediate)
- Forecast-based alerts (proactive)
- Alert history and resolution tracking
- Automatic alert categorization

### 5. Recommendations
- Urgency levels: low, medium, high
- Implementation difficulty assessment
- Estimated impact analysis
- Specific recommended actions
- Tracking of implementation status

### 6. Reporting
- Daily capacity status reports
- Resource utilization summaries
- Active alert lists with severity
- Pending recommendations with urgency
- Historical trend analysis

## Database Schema

### Tables

#### `resource_metrics`
Raw metric readings with high granularity (typically 1-5 minute intervals).

```sql
- id: bigserial (primary key)
- timestamp: timestamp with timezone
- resource_type: text (e.g., 'cpu', 'memory', 'database')
- metric_name: text (e.g., 'used_percentage', 'active_connections')
- value: numeric
- unit: text (e.g., 'percentage', 'bytes', 'count')
- host_id: text (optional)
- service_name: text (optional)
- metadata: jsonb (optional)
```

#### `capacity_trends`
Aggregated metrics over time periods (hourly, daily, weekly, monthly).

```sql
- id: bigserial
- resource_type: text
- metric_name: text
- period_start, period_end: timestamp
- period_type: text ('hourly', 'daily', 'weekly', 'monthly')
- avg_value, min_value, max_value: numeric
- p95_value, p99_value: numeric (percentiles)
- sample_count: integer
- trend_direction: text ('increasing', 'decreasing', 'stable')
- trend_rate: numeric (change per day)
- volatility: numeric (percentage)
```

#### `capacity_forecasts`
Predicted future values generated from trend analysis.

```sql
- id: bigserial
- resource_type, metric_name: text
- forecast_date: date (the date being predicted)
- forecast_timestamp: timestamp (when prediction was made)
- forecast_method: text ('linear_regression', 'exponential_smoothing')
- forecast_value: numeric (predicted value)
- confidence_interval_lower, upper: numeric
- confidence_level: numeric (0-1)
- model_r_squared: numeric (model fit quality)
- mape: numeric (mean absolute percentage error)
- actual_value: numeric (actual value when known)
- prediction_error: numeric (when actual is known)
```

#### `capacity_thresholds`
Configuration for alert thresholds.

```sql
- id: serial
- resource_type, metric_name: text
- warning_threshold: numeric
- critical_threshold: numeric
- forecast_warning_days: integer (alert if forecast exceeds critical in N days)
- enabled: boolean
```

#### `capacity_alerts`
Historical alert records.

```sql
- id: bigserial
- threshold_id: integer (references capacity_thresholds)
- resource_type, metric_name: text
- alert_level: text ('warning', 'critical')
- current_value: numeric
- threshold_value: numeric
- alert_type: text ('current_value', 'forecast_based')
- resolved_at: timestamp (null if unresolved)
- created_at: timestamp
```

#### `capacity_recommendations`
Actionable capacity planning recommendations.

```sql
- id: bigserial
- resource_type, metric_name: text
- recommendation: text (description)
- urgency: text ('low', 'medium', 'high')
- recommended_action: text
- estimated_impact: text
- implementation_effort: text ('easy', 'moderate', 'difficult')
- forecast_date: date (when issue is predicted)
- implemented: boolean
- implemented_at: timestamp
```

## API Endpoints

### Recording Metrics

#### POST `/api/capacity/metrics`
Record a single metric.

```json
{
  "resourceType": "memory",
  "metricName": "used_percentage",
  "value": 65.2,
  "unit": "percentage",
  "hostId": "server-1",
  "serviceName": "nodejs",
  "metadata": {
    "region": "us-east-1"
  }
}
```

#### POST `/api/capacity/metrics/batch`
Record multiple metrics in one request.

```json
{
  "metrics": [
    {
      "resourceType": "cpu",
      "metricName": "load_average_1m",
      "value": 2.5,
      "unit": "count"
    },
    {
      "resourceType": "memory",
      "metricName": "used_percentage",
      "value": 65.2,
      "unit": "percentage"
    }
  ]
}
```

### Trend Analysis

#### GET `/api/capacity/trends/:resourceType/:metricName`
Analyze trends for a metric.

Query parameters:
- `hoursBack`: Number of hours to analyze (default: 24)
- `periodType`: 'hourly', 'daily', 'weekly', 'monthly' (default: 'hourly')

Response:
```json
{
  "resourceType": "memory",
  "metricName": "used_percentage",
  "trend": {
    "direction": "increasing",
    "rate": 0.5,
    "volatility": 8.3,
    "confidence": 0.87
  }
}
```

#### POST `/api/capacity/trends/aggregate`
Aggregate metrics into trend records.

```json
{
  "resourceType": "cpu",
  "metricName": "load_average_1m",
  "periodType": "daily"
}
```

### Forecasting

#### GET `/api/capacity/forecast/:resourceType/:metricName`
Generate forecast for a metric.

Query parameters:
- `daysAhead`: Days to forecast (default: 7)
- `hoursBack`: Historical data to use (default: 168)

Response:
```json
{
  "resourceType": "memory",
  "metricName": "used_percentage",
  "daysAhead": 7,
  "forecast": {
    "method": "linear_regression",
    "value": 72.5,
    "confidenceLower": 68.2,
    "confidenceUpper": 76.8,
    "confidenceLevel": 0.92,
    "rSquared": 0.89,
    "mape": 0.045
  }
}
```

#### GET `/api/capacity/forecasts`
Get recent forecasts.

Query parameters:
- `resourceType`: Filter by resource type
- `metricName`: Filter by metric name
- `limit`: Max results (default: 100)

### Thresholds

#### POST `/api/capacity/thresholds`
Create or update threshold configuration.

```json
{
  "resourceType": "memory",
  "metricName": "used_percentage",
  "warningThreshold": 70,
  "criticalThreshold": 85,
  "forecastWarningDays": 7
}
```

#### GET `/api/capacity/thresholds`
Get all threshold configurations.

### Alerts

#### POST `/api/capacity/check-thresholds`
Manually trigger threshold checking.

```json
{
  "resourceType": "memory",
  "metricName": "used_percentage"
}
```

#### POST `/api/capacity/check-forecasts`
Manually trigger forecast threshold checking.

#### GET `/api/capacity/alerts`
Get alerts.

Query parameters:
- `resolved`: 'true' or 'false' (default: 'false' to show unresolved)
- `limit`: Max results (default: 100)

### Recommendations

#### POST `/api/capacity/recommendations/generate`
Generate recommendations based on current trends.

#### GET `/api/capacity/recommendations`
Get recommendations.

Query parameters:
- `urgency`: 'low', 'medium', 'high'
- `implemented`: 'true' or 'false'
- `limit`: Max results (default: 100)

#### PATCH `/api/capacity/recommendations/:id`
Mark recommendation as implemented.

```json
{
  "implemented": true,
  "notes": "Added 50GB of memory to production server"
}
```

### Reporting

#### GET `/api/capacity/report`
Get comprehensive capacity status report.

Query parameters:
- `days`: Number of days to include (default: 7)

Response:
```json
{
  "reportDate": "2024-01-15T10:30:00Z",
  "periodDays": 7,
  "resourceMetrics": {
    "memory": {
      "used_percentage": [...]
    },
    "cpu": {
      "load_average_1m": [...]
    }
  },
  "activeAlerts": [...],
  "pendingRecommendations": [...],
  "summary": {
    "totalMetrics": 8,
    "activeAlertCount": 2,
    "criticalAlertCount": 1,
    "pendingRecommendationCount": 3,
    "highUrgencyCount": 1
  }
}
```

## Integration

### In Your Backend Server

#### 1. Register Routes

In your main `index.ts` or `app.ts`:

```typescript
import capacityPlanningRoutes from './routes/capacityPlanning.routes';

app.use('/api/capacity', capacityPlanningRoutes);
```

#### 2. Initialize Metrics Collection

```typescript
import { startMetricsCollection } from './services/metricsCollector.service';
import { initializeCapacityPlanningJobs } from './cron/capacityPlanningJobs';

// Start collecting system metrics every minute
const collector = startMetricsCollection(1, {
  getDatabaseConnections: async () => {
    // Return current active database connections
    return pool.totalCount;
  },
  getRedisInfo: async () => {
    // Return Redis info stats
    return redis.info();
  },
});

// Initialize cron jobs for trend aggregation and forecasting
const capacityJobs = initializeCapacityPlanningJobs();

// On shutdown
process.on('SIGTERM', () => {
  collector.stop();
  capacityJobs.stop();
});
```

#### 3. Set Up Thresholds

Create thresholds for critical metrics:

```typescript
import { recordMetric } from './services/capacityPlanning.service';
import { db } from './db';
import { capacityThresholds } from './db/schema';

// Set up default thresholds
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
    resourceType: 'database',
    metricName: 'active_connections',
    warningThreshold: '80',
    criticalThreshold: '95',
    forecastWarningDays: 7,
    enabled: true,
  },
]);
```

## Forecasting Algorithms

### Linear Regression
- Best for metrics with consistent trends
- Fast computation
- Extrapolates trends into the future
- Confidence based on R² (fit quality)

**When to use**: CPU load, steadily growing memory, connection counts

### Exponential Smoothing
- Best for noisy or volatile metrics
- Weights recent data more heavily
- Adapts quickly to changes
- Better for short-term predictions

**When to use**: Request latency, cache hit rates, volatile business metrics

### Ensemble Approach
The system uses an ensemble:
1. Calculates both methods
2. Compares R² values
3. Uses exponential smoothing if R² < 0.3 (poor linear fit)
4. Otherwise uses linear regression

## Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Hourly Trend Aggregation | 5 minutes past every hour | Aggregate metrics to hourly trends |
| Daily Trend & Forecast | 1 AM daily | Aggregate to daily trends and generate 7-day forecasts |
| Weekly Trend | Monday 2 AM | Aggregate to weekly trends |
| Threshold Checking | Every 5 minutes | Check current metrics against thresholds |
| Forecast Threshold | 6 AM & 6 PM | Check if forecasts exceed thresholds |
| Recommendations | 3 AM daily | Generate actionable recommendations |
| Metrics Cleanup | 4 AM daily | Delete raw metrics older than 90 days |

## Monitoring and Alerting

### Alert Levels

**Warning**: Metric exceeds warning threshold or forecast will exceed critical in configured days

**Critical**: Metric exceeds critical threshold or immediate intervention needed

### Forecast-Based Alerts

The system analyzes forecasts and alerts if:
- Forecast value exceeds critical threshold
- Trend suggests critical threshold will be reached within `forecastWarningDays`

This provides early warning for proactive capacity planning.

## Best Practices

### 1. Set Appropriate Thresholds
- Use historical data to determine realistic thresholds
- Consider business requirements and SLAs
- Set warning threshold 10-15% below critical

### 2. Monitor Trends Over Time
- Allow at least 7 days of data for reliable forecasts
- Check for seasonality in your metrics
- Adjust thresholds based on actual behavior

### 3. Act on Recommendations
- Review high-urgency recommendations immediately
- Track implemented recommendations
- Monitor impact of changes

### 4. Regular Reviews
- Review capacity report weekly
- Analyze forecast accuracy (compare predictions vs actual)
- Update thresholds as system scales

### 5. Data Retention
- Raw metrics are kept for 90 days
- Trends are kept for historical analysis
- Adjust retention based on your needs

## Performance Considerations

### Storage
- Raw metrics: ~1KB per record
- Typical collection: 8-12 metrics per minute
- 90 days of data: ~1-2 GB

### Query Performance
- Indexed on timestamp, resource_type, metric_name
- Forecasting queries use indexed lookups
- Aggregation can be resource-intensive; schedule during low-traffic periods

### Forecast Accuracy
- Improves with more historical data (minimum 7 days recommended)
- Less accurate during major system changes
- Seasonality patterns are not explicitly handled

## Troubleshooting

### Forecasts are Inaccurate
1. Check data quality (gaps, outliers)
2. Ensure sufficient historical data (7+ days)
3. Review trend direction and volatility
4. Consider system changes that affect metrics

### Missing Metrics
1. Verify metrics are being recorded
2. Check collector is running: `GET /api/capacity/metrics`
3. Review cron job logs
4. Check database connectivity

### Alerts Not Triggering
1. Verify threshold is configured
2. Check threshold is enabled
3. Review alert history to see if already alerted
4. Manually trigger: `POST /api/capacity/check-thresholds`

## Example Usage Scenarios

### Scenario 1: Monitor Memory Growth
```bash
# Record memory metrics
curl -X POST http://localhost:3000/api/capacity/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "memory",
    "metricName": "used_percentage",
    "value": 65.2,
    "unit": "percentage"
  }'

# Analyze trend
curl http://localhost:3000/api/capacity/trends/memory/used_percentage?hoursBack=168

# Generate forecast
curl http://localhost:3000/api/capacity/forecast/memory/used_percentage?daysAhead=14

# Get recommendations
curl http://localhost:3000/api/capacity/recommendations?urgency=high
```

### Scenario 2: Set Up Database Connection Monitoring
```bash
# Create threshold
curl -X POST http://localhost:3000/api/capacity/thresholds \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "database",
    "metricName": "active_connections",
    "warningThreshold": 80,
    "criticalThreshold": 95,
    "forecastWarningDays": 3
  }'

# Get alerts
curl http://localhost:3000/api/capacity/alerts?resolved=false
```

### Scenario 3: Weekly Capacity Report
```bash
# Get comprehensive report
curl http://localhost:3000/api/capacity/report?days=7

# Export to monitoring system
curl http://localhost:3000/api/capacity/report | \
  jq '.summary' | \
  send-to-monitoring-system
```

## Future Enhancements

- Anomaly detection (ML-based)
- Seasonal decomposition
- Multi-dimensional forecasting
- Cost analysis and optimization
- Integration with cloud provider APIs
- Custom alert actions (webhooks, auto-scaling)
- Advanced visualization dashboards
