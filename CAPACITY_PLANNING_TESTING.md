# Capacity Planning Testing & Validation Guide

## Pre-Deployment Testing

### 1. Database Migration Testing

Verify the migration creates all required tables:

```bash
# Run migration
cd backend
npm run migrate

# Verify tables exist
psql -U your_user -d your_db -c "\dt capacity_*"
psql -U your_user -d your_db -c "\dt resource_*"

# Expected output: 6 tables
# - capacity_alerts
# - capacity_forecasts
# - capacity_recommendations
# - capacity_thresholds
# - capacity_trends
# - resource_metrics
```

### 2. Schema Validation

Verify schema structure:

```bash
# Check resource_metrics columns
psql -U your_user -d your_db -c "\d resource_metrics"

# Check indexes
psql -U your_user -d your_db -c "\di capacity_*"
psql -U your_user -d your_db -c "\di resource_*"

# Expected: 6 indexes created for performance
```

### 3. Service Import Testing

Test that services can be imported without errors:

```typescript
// In a test file or node REPL
import { 
  recordMetric, 
  analyzeTrend, 
  forecast,
  checkThresholds,
  generateRecommendations 
} from './services/capacityPlanning.service';

import { 
  startMetricsCollection 
} from './services/metricsCollector.service';

import { 
  initializeCapacityPlanningJobs 
} from './cron/capacityPlanningJobs';

// Should import without errors
console.log('✓ All services imported successfully');
```

## Functional Testing

### 1. Metrics Recording

Test recording individual and batch metrics:

```bash
# Record single metric
curl -X POST http://localhost:3000/api/capacity/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "memory",
    "metricName": "used_percentage",
    "value": 65.5,
    "unit": "percentage",
    "serviceName": "test"
  }'

# Expected: 201 Created with metricId

# Batch record metrics
curl -X POST http://localhost:3000/api/capacity/metrics/batch \
  -H "Content-Type: application/json" \
  -d '{
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
        "value": 70,
        "unit": "percentage"
      }
    ]
  }'

# Expected: 201 Created with count: 2
```

Verify in database:

```sql
SELECT COUNT(*) FROM resource_metrics WHERE service_name = 'test';
-- Expected: > 0
```

### 2. Trend Analysis

Test trend analysis with recorded data:

```bash
# Wait a few minutes for collection, then analyze
curl http://localhost:3000/api/capacity/trends/memory/used_percentage?hoursBack=1

# Expected response format:
# {
#   "resourceType": "memory",
#   "metricName": "used_percentage",
#   "trend": {
#     "direction": "stable|increasing|decreasing",
#     "rate": <number>,
#     "volatility": <number>,
#     "confidence": <0-1>
#   }
# }
```

If insufficient data:

```bash
# Should return 404 with message about insufficient data
# Status: 404
# Response: {"error":"Insufficient data for trend analysis"}
```

### 3. Threshold Configuration

Test creating and retrieving thresholds:

```bash
# Create threshold
curl -X POST http://localhost:3000/api/capacity/thresholds \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "memory",
    "metricName": "used_percentage",
    "warningThreshold": 70,
    "criticalThreshold": 85,
    "forecastWarningDays": 7
  }'

# Expected: 201 Created with threshold object

# Retrieve thresholds
curl http://localhost:3000/api/capacity/thresholds

# Expected: array of thresholds
```

### 4. Alert Checking

Test threshold checking:

```bash
# Create a test metric that exceeds threshold
curl -X POST http://localhost:3000/api/capacity/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "memory",
    "metricName": "used_percentage",
    "value": 90,
    "unit": "percentage"
  }'

# Trigger threshold check
curl -X POST http://localhost:3000/api/capacity/check-thresholds \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "memory",
    "metricName": "used_percentage"
  }'

# Get alerts
curl http://localhost:3000/api/capacity/alerts?resolved=false

# Expected: alert with level "critical"
```

Verify in database:

```sql
SELECT * FROM capacity_alerts WHERE alert_level = 'critical' ORDER BY created_at DESC LIMIT 1;
```

### 5. Forecasting

Test forecast generation (requires 7+ days of data):

```bash
# Generate forecast
curl http://localhost:3000/api/capacity/forecast/memory/used_percentage?daysAhead=7

# Response should include:
# {
#   "resourceType": "memory",
#   "metricName": "used_percentage",
#   "daysAhead": 7,
#   "forecast": {
#     "method": "linear_regression|exponential_smoothing",
#     "value": <number>,
#     "confidenceLower": <number>,
#     "confidenceUpper": <number>,
#     "confidenceLevel": <0-1>,
#     "rSquared": <0-1>,
#     "mape": <0-1>
#   }
# }
```

### 6. Recommendations

Test recommendation generation:

```bash
# Generate recommendations
curl -X POST http://localhost:3000/api/capacity/recommendations/generate

# Expected: 200 OK with generated recommendations

# Retrieve recommendations
curl http://localhost:3000/api/capacity/recommendations

# Should return array of recommendations

# Mark as implemented
curl -X PATCH http://localhost:3000/api/capacity/recommendations/1 \
  -H "Content-Type: application/json" \
  -d '{
    "implemented": true,
    "notes": "Completed upgrade"
  }'

# Expected: 200 OK with updated recommendation
```

### 7. Reporting

Test the comprehensive report:

```bash
# Get 7-day report
curl http://localhost:3000/api/capacity/report?days=7

# Expected response includes:
# {
#   "reportDate": <ISO timestamp>,
#   "periodDays": 7,
#   "resourceMetrics": {...},
#   "activeAlerts": [...],
#   "pendingRecommendations": [...],
#   "summary": {
#     "totalMetrics": <number>,
#     "activeAlertCount": <number>,
#     "criticalAlertCount": <number>,
#     "pendingRecommendationCount": <number>,
#     "highUrgencyCount": <number>
#   }
# }
```

## Integration Testing

### 1. Metrics Collection Integration

Test that metrics collector works:

```typescript
// In your server startup
const collector = startMetricsCollection(1);

// Wait 1-2 minutes
setTimeout(async () => {
  const report = await getCapacityReport(1);
  console.log('Metrics collected:', report.summary.totalMetrics);
  // Should be > 0 if collection is working
}, 120000);
```

### 2. Cron Jobs Integration

Test that cron jobs initialize without errors:

```typescript
// In your server startup
const jobs = initializeCapacityPlanningJobs();

// Check that jobs are running (should see log messages)
// Each job should log when initialized:
// - "Scheduled: Hourly trend aggregation"
// - "Scheduled: Daily trend aggregation and forecasting"
// - etc.
```

Monitor logs to verify jobs execute:

```bash
# Should see these messages at scheduled times:
# "Starting hourly trend aggregation"
# "Checking capacity thresholds"
# etc.
```

### 3. API Route Integration

Test routes are registered:

```bash
# All these should return 200 or appropriate responses
curl http://localhost:3000/api/capacity/thresholds
curl http://localhost:3000/api/capacity/alerts?resolved=false
curl http://localhost:3000/api/capacity/forecasts
curl http://localhost:3000/api/capacity/recommendations
curl http://localhost:3000/api/capacity/report

# All should work without 404 errors
```

## Load Testing

### 1. Batch Metric Recording

Test with high volume:

```bash
# Record 1000 metrics
for i in {1..100}; do
  curl -X POST http://localhost:3000/api/capacity/metrics/batch \
    -H "Content-Type: application/json" \
    -d '{
      "metrics": [
        {"resourceType":"cpu","metricName":"load","value":'$((RANDOM % 100))',"unit":"count"},
        {"resourceType":"memory","metricName":"used","value":'$((RANDOM % 100))',"unit":"percentage"},
        {"resourceType":"disk","metricName":"used","value":'$((RANDOM % 100))',"unit":"percentage"},
        {"resourceType":"database","metricName":"connections","value":'$((RANDOM % 100))',"unit":"count"},
        {"resourceType":"redis","metricName":"memory","value":'$((RANDOM % 100))',"unit":"percentage"},
        {"resourceType":"process","metricName":"heap","value":'$((RANDOM % 100))',"unit":"percentage"},
        {"resourceType":"cache","metricName":"hit_rate","value":'$((RANDOM % 100))',"unit":"percentage"},
        {"resourceType":"api","metricName":"request_time","value":'$((RANDOM % 1000))',"unit":"milliseconds"},
        {"resourceType":"queue","metricName":"length","value":'$((RANDOM % 10000))',"unit":"count"},
        {"resourceType":"storage","metricName":"used","value":'$((RANDOM % 100))',"unit":"percentage"}
      ]
    }' &
done
wait

# Check performance
time curl http://localhost:3000/api/capacity/report
```

### 2. Trend Aggregation Performance

```bash
# Aggregate trends for all metrics
time curl -X POST http://localhost:3000/api/capacity/trends/aggregate \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "memory",
    "metricName": "used_percentage",
    "periodType": "daily"
  }'

# Should complete in < 1 second
```

## Error Handling Testing

### 1. Invalid Input

```bash
# Missing required fields
curl -X POST http://localhost:3000/api/capacity/metrics \
  -H "Content-Type: application/json" \
  -d '{"resourceType":"memory"}'
# Expected: 400 Bad Request

# Invalid JSON
curl -X POST http://localhost:3000/api/capacity/metrics \
  -H "Content-Type: application/json" \
  -d '{invalid json}'
# Expected: 400 Bad Request
```

### 2. Database Errors

Test error handling when database is down:

```bash
# Stop PostgreSQL service
sudo service postgresql stop

# Try to record metric
curl -X POST http://localhost:3000/api/capacity/metrics \
  -H "Content-Type: application/json" \
  -d '{"resourceType":"test","metricName":"test","value":1,"unit":"count"}'
# Expected: 500 Internal Server Error

# Check logs for proper error logging

# Restart PostgreSQL
sudo service postgresql start
```

## Data Validation

### 1. Verify Data Integrity

```sql
-- Check that all metrics have required fields
SELECT COUNT(*) FROM resource_metrics WHERE resource_type IS NULL;
-- Expected: 0

-- Check that values are numeric
SELECT COUNT(*) FROM resource_metrics WHERE value ~ '[^0-9.-]';
-- Expected: 0 (or minimal)

-- Check timestamp consistency
SELECT COUNT(*) FROM resource_metrics 
WHERE timestamp > NOW();
-- Expected: 0 (no future timestamps)

-- Check trends calculations
SELECT * FROM capacity_trends 
WHERE avg_value > max_value;
-- Expected: 0 (integrity check)

SELECT * FROM capacity_trends 
WHERE p95_value IS NOT NULL AND p95_value < p99_value;
-- Expected: 1 (p95 should be less than p99)
```

### 2. Verify Forecast Accuracy

Track forecast accuracy over time:

```sql
-- Calculate prediction accuracy
SELECT 
  resource_type,
  metric_name,
  AVG(ABS((actual_value - forecast_value) / actual_value)) as mape,
  COUNT(*) as predictions
FROM capacity_forecasts
WHERE actual_value IS NOT NULL
GROUP BY resource_type, metric_name;

-- MAPE under 0.15 (15%) is acceptable
-- MAPE under 0.05 (5%) is excellent
```

## Performance Baselines

### Establish Performance Baselines

Run these tests and record baseline performance:

```bash
# Record metrics performance
time for i in {1..1000}; do
  curl -s -X POST http://localhost:3000/api/capacity/metrics \
    -H "Content-Type: application/json" \
    -d "{\"resourceType\":\"test\",\"metricName\":\"perf\",\"value\":$i,\"unit\":\"count\"}" > /dev/null
done

# Trend analysis performance
time curl -s http://localhost:3000/api/capacity/trends/test/perf > /dev/null

# Forecast performance
time curl -s http://localhost:3000/api/capacity/forecast/test/perf > /dev/null

# Report generation
time curl -s http://localhost:3000/api/capacity/report > /dev/null
```

Document baseline times for regression testing.

## Automated Testing (Jest)

Create test file at `backend/src/__tests__/capacityPlanning.test.ts`:

```typescript
import { recordMetric, analyzeTrend, forecast } from '../services/capacityPlanning.service';
import { db } from '../db';
import { resourceMetrics } from '../db/schema';

describe('Capacity Planning System', () => {
  test('should record a metric', async () => {
    const id = await recordMetric({
      resourceType: 'test',
      metricName: 'test_metric',
      value: 42,
      unit: 'count',
    });
    
    expect(id).toBeGreaterThan(0);
  });

  test('should analyze trends', async () => {
    // Record some test data
    for (let i = 0; i < 10; i++) {
      await recordMetric({
        resourceType: 'cpu',
        metricName: 'load',
        value: 60 + i * 0.5,
        unit: 'percentage',
      });
    }

    const trend = await analyzeTrend('cpu', 'load', 1);
    expect(trend).not.toBeNull();
    expect(trend?.direction).toMatch(/increasing|decreasing|stable/);
  });

  test('should generate forecasts', async () => {
    // Need 7+ days of data
    // Setup test data with dates
    const result = await forecast('cpu', 'load', 7, 168);
    
    if (result) {
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.confidenceLevel).toBeGreaterThanOrEqual(0);
      expect(result.confidenceLevel).toBeLessThanOrEqual(1);
    }
  });
});
```

Run tests:

```bash
npm run test -- capacityPlanning.test.ts
```

## Monitoring Test

Monitor the system over 7 days:

```markdown
### Week 1 Monitoring Checklist

- [ ] Day 1: Verify metrics are collecting
- [ ] Day 1-3: Check for any error messages
- [ ] Day 2: Verify hourly trends are created
- [ ] Day 3: Check daily aggregations
- [ ] Day 3-7: Monitor forecast generation
- [ ] Day 7: Review forecast accuracy
- [ ] Day 7: Check recommendations generated
- [ ] Day 7: Verify alerts triggering correctly
```

## Sign-Off Checklist

Before deploying to production:

- [ ] Migration runs without errors
- [ ] All 6 tables created with correct schema
- [ ] Metrics recording works (single and batch)
- [ ] Trend analysis calculates correctly
- [ ] Thresholds can be created and retrieved
- [ ] Alerts trigger on threshold breach
- [ ] Forecasting generates valid predictions
- [ ] Recommendations are generated
- [ ] Report includes all expected data
- [ ] Cron jobs initialize without errors
- [ ] API routes are accessible
- [ ] Error handling works properly
- [ ] Database integrity maintained
- [ ] Performance is acceptable
- [ ] Logs show expected messages
- [ ] Documentation is accurate

## Production Readiness

After sign-off, verify:

1. **Monitoring**: Set up alerts for capacity planning system health
2. **Backups**: Database backup strategy includes new tables
3. **Scaling**: Capacity planning accounts for growth in metrics
4. **Updates**: Plan for forecast model improvements
5. **Maintenance**: Schedule regular reviews of recommendations

See CAPACITY_PLANNING.md for complete documentation.
