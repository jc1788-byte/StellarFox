# Capacity Planning System Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    CAPACITY PLANNING SYSTEM                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              METRICS COLLECTION LAYER                   │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                         │    │
│  │  System Metrics    Process Metrics    Custom Metrics   │    │
│  │  - CPU load        - Heap usage       - API calls      │    │
│  │  - Memory          - RSS memory       - Queue depth    │    │
│  │  - Disk I/O        - Uptime           - Business KPIs  │    │
│  │  - Network         - GC events        - etc.           │    │
│  │                                                         │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│                    Every 1 minute (configurable)                │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              METRICS STORAGE                            │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                         │    │
│  │         resource_metrics (PostgreSQL)                  │    │
│  │  - Timestamp, resource_type, metric_name, value        │    │
│  │  - Unit, host_id, service_name, metadata               │    │
│  │  - Indexes: timestamp, (resource_type, metric_name)   │    │
│  │                                                         │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         │                 │                 │                   │
│    HOURLY AGGS    TREND ANALYSIS    FORECASTING                │
│    (every hour)   (on demand)       (daily 1 AM)               │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              TREND & FORECAST STORAGE                   │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                         │    │
│  │    capacity_trends (hourly, daily, weekly, monthly)    │    │
│  │    - avg, min, max, p95, p99                           │    │
│  │    - trend_direction, trend_rate, volatility           │    │
│  │                                                         │    │
│  │    capacity_forecasts (7-day predictions)              │    │
│  │    - forecast_value, confidence_interval               │    │
│  │    - method (linear_regression, exponential_smoothing) │    │
│  │    - model_r_squared, mape                             │    │
│  │                                                         │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         │                 │                 │                   │
│    THRESHOLD          ALERTS            RECOMMENDATIONS         │
│    CHECKING         GENERATION           GENERATION             │
│    (every 5m)       (every 5m)           (daily 3 AM)           │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              ALERTS & RECOMMENDATIONS                   │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                         │    │
│  │    capacity_thresholds (configuration)                 │    │
│  │    - warning_threshold, critical_threshold             │    │
│  │    - forecast_warning_days                             │    │
│  │                                                         │    │
│  │    capacity_alerts (history)                           │    │
│  │    - alert_level, current_value, threshold_value       │    │
│  │    - alert_type (current_value or forecast_based)      │    │
│  │    - resolved_at                                       │    │
│  │                                                         │    │
│  │    capacity_recommendations                            │    │
│  │    - recommendation, urgency (low/medium/high)         │    │
│  │    - implementation_effort, estimated_impact           │    │
│  │    - implemented status                                │    │
│  │                                                         │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              API LAYER (Express Routes)                 │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                         │    │
│  │  POST /api/capacity/metrics (record single)            │    │
│  │  POST /api/capacity/metrics/batch (batch record)       │    │
│  │  GET  /api/capacity/trends/:type/:metric (analyze)     │    │
│  │  POST /api/capacity/trends/aggregate (aggregate)       │    │
│  │  GET  /api/capacity/forecast/:type/:metric (predict)   │    │
│  │  GET  /api/capacity/forecasts (retrieve)               │    │
│  │  POST /api/capacity/thresholds (create/update)         │    │
│  │  GET  /api/capacity/thresholds (list)                  │    │
│  │  POST /api/capacity/check-thresholds (trigger check)   │    │
│  │  POST /api/capacity/check-forecasts (forecast check)   │    │
│  │  GET  /api/capacity/alerts (retrieve)                  │    │
│  │  POST /api/capacity/recommendations/generate (gen)     │    │
│  │  GET  /api/capacity/recommendations (list)             │    │
│  │  PATCH /api/capacity/recommendations/:id (update)      │    │
│  │  GET  /api/capacity/report (comprehensive report)      │    │
│  │                                                         │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌─────────────────────┐
│  System Metrics     │
│  - CPU, Memory      │
│  - Disk, Network    │
│  - Database         │
│  - Redis            │
└──────────┬──────────┘
           │
           ▼
    ┌─────────────┐
    │ Collector   │   Every 1 minute
    │ Service     │
    └──────┬──────┘
           │
           ▼
    ┌──────────────────────┐
    │ resource_metrics     │
    │ (raw data store)     │
    │ 1-2GB/90 days        │
    └──────┬───────────────┘
           │
      ┌────┴────────────────┬──────────────┬─────────┐
      │                     │              │         │
      ▼ (hourly)     ▼ (on demand)  ▼ (daily 1 AM)  │
    ┌──────┐        ┌────────┐     ┌──────────┐      │
    │Trend │        │Analyze │     │Forecast  │      │
    │Agg   │        │Trend   │     │Generate  │      │
    └──┬───┘        └──┬─────┘     └────┬─────┘      │
       │               │                │            │
       ▼ ─────┐       ▼                ▼            │
    ┌─────────────────────────────┐               │
    │ capacity_trends             │◄──────────────┘
    │ - hourly/daily/weekly/etc   │
    │ - avg, min, max, p95, p99  │
    │ - trend_direction, rate     │
    │ - volatility, confidence    │
    └─────────────────────────────┘

       capacity_forecasts
       - Linear Regression
       - Exponential Smoothing
       - Ensemble Selection
       - 95% Confidence Intervals

              ▼
    ┌─────────────────────────┐
    │ Threshold Checking      │  Every 5 minutes
    │ - Current value         │  & 6 AM, 6 PM
    │ - Forecast-based        │
    └──────┬──────────────────┘
           │
           ▼
    ┌─────────────────┐      ┌────────────────┐
    │capacity_alerts  │      │capacity_        │ Every 3 AM
    │- warning        │      │recommendations │
    │- critical       │      │- urgency       │
    └─────────────────┘      │- action items  │
                             └────────────────┘
                                    ▼
                             ┌──────────────┐
                             │/api/capacity/│
                             │report        │
                             └──────────────┘
```

## Component Architecture

### 1. Metrics Collection (`metricsCollector.service.ts`)

```typescript
startMetricsCollection(intervalMinutes, callbacks)
  ├─ System Metrics
  │  ├─ collectSystemMetrics()
  │  │  ├─ CPU: load_average (1m, 5m, 15m), count
  │  │  └─ Memory: total, free, used, used_percentage
  │  │
  ├─ Process Metrics
  │  ├─ collectNodeMetrics()
  │  │  ├─ Heap: used, total, percentage
  │  │  ├─ Process: external memory, rss, uptime
  │  │  └─ GC: tracking prepared
  │  │
  ├─ Database Metrics (if callback provided)
  │  ├─ collectDatabaseMetrics()
  │  │  └─ active_connections
  │  │
  └─ Redis Metrics (if callback provided)
     ├─ collectRedisMetrics()
     │  ├─ used_memory, percentage
     │  ├─ connected_clients
     │  └─ ops_per_sec
```

### 2. Capacity Planning Service (`capacityPlanning.service.ts`)

```
Main Functions:
├─ recordMetric(input) → metricId
├─ recordMetrics(inputs[]) → void
│
├─ analyzeTrend(...) → TrendAnalysis
│  ├─ Statistical calculations (mean, median, stddev)
│  ├─ Linear regression for trend detection
│  └─ Confidence scoring (R²)
│
├─ aggregateTrends(...) → void
│  ├─ Group metrics by time period
│  ├─ Calculate percentiles (p95, p99)
│  ├─ Detect trend direction and rate
│  └─ Store in capacity_trends
│
├─ forecast(...) → ForecastResult
│  ├─ linearRegression()
│  ├─ exponentialSmoothing()
│  ├─ Ensemble selection
│  ├─ Calculate confidence intervals
│  └─ Store in capacity_forecasts
│
├─ checkThresholds(...) → void
│  ├─ Get latest metric value
│  ├─ Compare against thresholds
│  └─ Create alerts if exceeded
│
├─ checkForecastThresholds() → void
│  ├─ Get all active thresholds
│  ├─ Check forecasts against thresholds
│  └─ Create forecast-based alerts
│
├─ generateRecommendations() → CapacityRecommendation[]
│  ├─ Analyze trends
│  ├─ Assess urgency
│  ├─ Estimate effort
│  └─ Store in capacity_recommendations
│
└─ getCapacityReport(days) → Report
   ├─ Aggregate all metrics/trends/alerts
   ├─ Count issues and recommendations
   └─ Return comprehensive summary
```

### 3. API Routes (`capacityPlanning.routes.ts`)

```
Layer: Express Router
Mounted at: /api/capacity

Routes:
├─ Metrics
│  ├─ POST /metrics (single)
│  └─ POST /metrics/batch (multiple)
│
├─ Trends
│  ├─ GET /trends/:type/:metric
│  └─ POST /trends/aggregate
│
├─ Forecasts
│  ├─ GET /forecast/:type/:metric
│  └─ GET /forecasts
│
├─ Thresholds
│  ├─ POST /thresholds (create/update)
│  └─ GET /thresholds (list)
│
├─ Alerts
│  ├─ POST /check-thresholds
│  ├─ POST /check-forecasts
│  └─ GET /alerts
│
├─ Recommendations
│  ├─ POST /recommendations/generate
│  ├─ GET /recommendations
│  └─ PATCH /recommendations/:id
│
└─ Reporting
   └─ GET /report

All routes:
- Accept JSON input
- Return JSON output
- Include error handling
- Log operations
```

### 4. Cron Jobs (`capacityPlanningJobs.ts`)

```
Scheduler: node-cron

├─ scheduleHourlyTrendAggregation()
│  └─ Runs: 5 min past every hour
│     Task: Aggregate metrics to hourly trends
│
├─ scheduleDailyTrendAggregation()
│  └─ Runs: 1 AM daily
│     Task: Aggregate to daily trends + forecast
│
├─ scheduleWeeklyTrendAggregation()
│  └─ Runs: Monday 2 AM
│     Task: Aggregate to weekly trends
│
├─ scheduleThresholdChecking()
│  └─ Runs: Every 5 minutes
│     Task: Check current metrics vs thresholds
│
├─ scheduleForecastThresholdChecking()
│  └─ Runs: 6 AM & 6 PM
│     Task: Check if forecasts exceed thresholds
│
├─ scheduleRecommendationGeneration()
│  └─ Runs: 3 AM daily
│     Task: Generate recommendations
│
└─ scheduleMetricsCleanup()
   └─ Runs: 4 AM daily
      Task: Delete metrics older than 90 days
```

## Database Schema Diagram

```
resource_metrics (raw data)
├─ id (PK)
├─ timestamp (indexed)
├─ resource_type (indexed)
├─ metric_name (indexed)
├─ value
├─ unit
├─ host_id
├─ service_name
└─ metadata

capacity_trends (aggregated)
├─ id (PK)
├─ resource_type
├─ metric_name
├─ period_start
├─ period_end
├─ period_type (hourly|daily|weekly|monthly)
├─ avg_value, min_value, max_value
├─ p95_value, p99_value
├─ sample_count
├─ trend_direction
├─ trend_rate
├─ volatility
├─ created_at
└─ updated_at

capacity_forecasts (predictions)
├─ id (PK)
├─ resource_type
├─ metric_name
├─ forecast_date
├─ forecast_timestamp
├─ forecast_method
├─ forecast_value
├─ confidence_interval_lower
├─ confidence_interval_upper
├─ confidence_level
├─ model_r_squared
├─ mape
├─ actual_value (null until observed)
├─ prediction_error (null until actual)
└─ created_at

capacity_thresholds (config)
├─ id (PK)
├─ resource_type
├─ metric_name
├─ warning_threshold
├─ critical_threshold
├─ forecast_warning_days
├─ enabled
├─ created_at
└─ updated_at

capacity_alerts (history)
├─ id (PK)
├─ threshold_id (FK)
├─ resource_type
├─ metric_name
├─ alert_level (warning|critical)
├─ current_value
├─ threshold_value
├─ alert_type (current_value|forecast_based)
├─ resolved_at
└─ created_at

capacity_recommendations (actions)
├─ id (PK)
├─ resource_type
├─ metric_name
├─ recommendation
├─ urgency (low|medium|high)
├─ recommended_action
├─ estimated_impact
├─ implementation_effort
├─ forecast_date
├─ implemented
├─ implemented_at
├─ notes
├─ created_at
└─ updated_at
```

## Forecasting Algorithm Flow

```
Historical Data Collection
(7 days minimum)
        │
        ▼
Linear Regression Analysis
├─ Calculate slope and intercept
├─ Project forward N days
├─ Calculate R² (fit quality)
├─ Estimate confidence interval
└─ Output: ForecastResult A

Exponential Smoothing Analysis
├─ Apply alpha smoothing (0.3)
├─ Weight recent data more heavily
├─ Project forward N days
├─ Estimate confidence interval
└─ Output: ForecastResult B

Ensemble Selection
├─ If R² (LR) > 0.3: Use Linear Regression
├─ Else: Use Exponential Smoothing
└─ Output: Selected ForecastResult

Validation
├─ Check value is >= 0
├─ Verify CI bounds are reasonable
├─ Calculate MAPE for accuracy
└─ Store in capacity_forecasts

↓
Available for threshold checking
and reporting
```

## Performance & Scalability

### Indexing Strategy

```
Resource Metrics
├─ Index on timestamp (query by date range)
└─ Composite index (resource_type, metric_name)
   → Fast lookups for specific metrics

Capacity Trends
└─ Composite index (resource_type, metric_name, period_type, period_start)
   → Enables efficient trend queries

Capacity Forecasts
└─ Composite index (resource_type, metric_name, forecast_date)
   → Quick lookups for forecast results

Capacity Alerts
└─ Index on resolved_at (find unresolved alerts)

Capacity Recommendations
└─ Index on urgency (quick priority sorting)
```

### Storage Calculation

```
Typical System (12 metrics/minute):
├─ Raw metrics: 12 metrics × 1KB = 12KB/minute
├─ Per day: 12 × 60 × 24 = 17.3 MB
├─ Per month: ~520 MB
├─ 90-day retention: ~1.5 GB

Trends:
├─ Hourly trends: 12 × 24 = 288/day
├─ Daily trends: 12/day
├─ Weekly trends: ~12 data points
├─ Total trends storage: Much smaller than raw data

Total for 90 days:
├─ Raw metrics: ~1.5 GB
├─ Trends: ~50 MB
├─ Forecasts/Alerts/Recommendations: <50 MB
└─ Total: ~1.6 GB
```

### Query Performance

```
Recording metric: O(1) - ~1ms
Batch record 1000: O(n) - ~100ms
Analyze trend: O(n) - ~50ms (n=1440 points/day)
Generate forecast: O(n) - ~100-500ms
Check threshold: O(1) - ~5ms
Aggregate trends: O(n) - ~100-200ms
Generate report: O(m) - ~500ms (m=trending metrics)

All operations sub-second
Suitable for high-frequency queries
```

## Integration Points

```
Your Express App
├─ POST /api/capacity/* routes
├─ GET /api/capacity/* routes
└─ PATCH /api/capacity/* routes

Your Database (PostgreSQL)
├─ 6 new tables
├─ 6 new indexes
└─ Auto-migration on startup

Your Metrics Collection
├─ System metrics (automatic)
├─ Process metrics (automatic)
├─ Database metrics (callback)
├─ Redis metrics (callback)
└─ Custom metrics (your API calls)

Your Monitoring System
├─ Alert webhooks (future enhancement)
├─ Grafana datasource (future enhancement)
└─ Custom integrations (API available)

Your Logging System
├─ Capacity planning logs via pino
├─ Error logs with full context
└─ Performance metrics
```

## Deployment Architecture

```
Production Environment:
├─ Express App
│  ├─ Capacity Planning Routes
│  ├─ Metrics Collector (runs every 1 min)
│  └─ Cron Jobs (multiple scheduled tasks)
│
├─ PostgreSQL Database
│  ├─ resource_metrics table
│  ├─ capacity_trends table
│  ├─ capacity_forecasts table
│  ├─ capacity_thresholds table
│  ├─ capacity_alerts table
│  └─ capacity_recommendations table
│
├─ Redis (optional)
│  └─ Can collect metrics via callback
│
└─ External Services (optional)
   ├─ Prometheus (metrics scraping)
   ├─ Grafana (visualization)
   └─ Alert Services (webhooks)
```

## Security Model

```
Data Flow:
├─ Metrics collected internally (trusted)
├─ Stored in PostgreSQL (internal DB)
├─ Accessed only via API (your app)
├─ No external calls by default
└─ No sensitive data in metrics

API Security:
├─ Routes inherit Express middleware
├─ Your authentication applies
├─ Input validation on all endpoints
├─ Error messages don't leak sensitive data
└─ Logging includes user context

Database Security:
├─ Parameterized queries (ORM)
├─ No SQL injection possible
├─ Timestamps are UTC (timezone safe)
└─ Data retention policy (90 days)
```

## Troubleshooting Architecture

```
Issue: No metrics appearing
├─ Check: Collector running?
├─ Check: Database connected?
└─ Check: recordMetrics() logging

Issue: Trends not calculating
├─ Check: Sufficient data (>10 points)?
├─ Check: Cron jobs running?
└─ Check: aggregateTrends() logging

Issue: Forecasts inaccurate
├─ Check: R² value (model fit)
├─ Check: MAPE score (error rate)
├─ Check: Data has 7+ days history
└─ Check: System changes affecting pattern

Issue: Alerts not firing
├─ Check: Threshold configured?
├─ Check: Threshold enabled?
├─ Check: Value exceeds threshold?
└─ Check: Cron job ran?
```

See CAPACITY_PLANNING.md for complete documentation.
