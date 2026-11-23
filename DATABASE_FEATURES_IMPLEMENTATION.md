# Database Features Implementation Plan

## Overview
Implementing 4 critical database features for StellarFox backend to improve performance, reliability, and operational management.

---

## Feature 1: Query Analysis Tools & Execution Plan Visualization

### Purpose
Analyze SQL queries, generate execution plans, and provide optimization recommendations.

### Components

#### 1.1 Query Analyzer Service
- File: `src/services/QueryAnalyzer.ts`
- Analyze query execution plans from PostgreSQL
- Extract metrics (rows scanned, execution time, cost)
- Identify missing indexes and inefficient operations
- Generate optimization recommendations

#### 1.2 Index Recommendation Engine
- File: `src/services/IndexRecommendation.ts`
- Analyze query patterns
- Detect slow queries
- Recommend indexes based on access patterns
- Track index recommendations history

#### 1.3 Query Analysis API Endpoints
- File: `src/api/controllers/QueryAnalysisController.ts`
- `POST /api/admin/queries/analyze` - Analyze a query
- `GET /api/admin/queries/slow-queries` - Get slow queries
- `GET /api/admin/recommendations/indexes` - Get index recommendations
- `POST /api/admin/queries/explain` - Get execution plan

#### 1.4 Visualization Components
- File: `src/utils/QueryPlanVisualizer.ts`
- Convert execution plans to structured format
- Generate metrics summary

---

## Feature 2: Time-Based & Hash-Based Partitioning

### Purpose
Improve query performance and maintenance for large tables through intelligent partitioning.

### Components

#### 2.1 Partitioning Strategy Service
- File: `src/services/PartitioningStrategy.ts`
- Implement time-based partitioning for time-series data (bets, transactions, snapshots)
- Implement hash-based partitioning for lookup tables
- Manage partition lifecycle

#### 2.2 Partition Management Service
- File: `src/services/PartitionManagement.ts`
- Create/drop partitions
- Monitor partition sizes
- Handle partition rotation
- Archive old partitions

#### 2.3 Migration Scripts
- File: `migrations/partition-tables.sql`
- Partition `bets` table by month
- Partition `probability_snapshots` by month + hash
- Partition `transactions` by date
- Maintain partition pruning for query optimization

#### 2.4 Admin API for Partition Management
- File: `src/api/controllers/PartitionController.ts`
- `GET /api/admin/partitions/status` - View partition status
- `POST /api/admin/partitions/rotate` - Trigger partition rotation
- `GET /api/admin/partitions/analyze` - Analyze partition effectiveness

---

## Feature 3: Automated Backup System

### Purpose
Ensure data durability and recovery capability with multiple backup strategies.

### Components

#### 3.1 Backup Service
- File: `src/services/BackupService.ts`
- Full backups (weekly)
- Incremental backups (daily)
- Continuous WAL archiving
- Multiple backup locations (local, S3, secondary server)

#### 3.2 Backup Configuration
- File: `src/config/backup.config.ts`
- Configure backup retention policies
- Define backup schedule
- Set backup locations
- Configure encryption

#### 3.3 Backup Execution
- File: `src/cron/backup-scheduler.ts`
- Cron job to execute backups
- Monitor backup status
- Send notifications on failure
- Log backup metadata

#### 3.4 Restore Testing
- File: `tests/services/restore-test.spec.ts`
- Automated restore validation
- Test restore from different backup points
- Verify data integrity

#### 3.5 Backup Admin API
- File: `src/api/controllers/BackupController.ts`
- `GET /api/admin/backups/list` - List backups
- `POST /api/admin/backups/create` - Trigger backup
- `POST /api/admin/backups/restore` - Restore from backup
- `GET /api/admin/backups/status` - View backup status

---

## Feature 4: Comprehensive Monitoring & Alerting

### Purpose
Detect and alert on performance issues, anomalies, and resource exhaustion.

### Components

#### 4.1 Metrics Collector
- File: `src/services/MetricsCollector.ts`
- Collect database metrics (CPU, memory, connections)
- Track query performance (slow queries, locks)
- Monitor table sizes and growth
- Monitor index performance

#### 4.2 Anomaly Detection
- File: `src/services/AnomalyDetector.ts`
- Detect unusual query patterns
- Identify performance degradation
- Detect resource exhaustion
- Trend analysis

#### 4.3 Alert System
- File: `src/services/AlertingService.ts`
- Define alert thresholds
- Route alerts (email, Slack, PagerDuty)
- Manage alert escalation
- Track alert history

#### 4.4 Monitoring Dashboard
- File: `src/api/controllers/MonitoringController.ts`
- `GET /api/admin/monitoring/metrics` - Current metrics
- `GET /api/admin/monitoring/alerts` - Active/historical alerts
- `GET /api/admin/monitoring/health` - System health status
- `GET /api/admin/monitoring/slow-queries` - Slow query log

#### 4.5 Health Check Integration
- File: `src/api/controllers/HealthController.ts`
- Enhanced `/health/live` endpoint
- Enhanced `/health/ready` endpoint
- Include detailed metrics in response

---

## Implementation Order

1. **Phase 1: Query Analysis** (1-2 days)
   - Query Analyzer Service
   - Index Recommendation Engine
   - Query Analysis API endpoints

2. **Phase 2: Partitioning** (2-3 days)
   - Partitioning Strategy Service
   - Partition Management Service
   - Migration scripts
   - Partition Management API

3. **Phase 3: Backup System** (2-3 days)
   - Backup Service
   - Backup Configuration
   - Restore Testing
   - Backup Admin API

4. **Phase 4: Monitoring** (2-3 days)
   - Metrics Collector
   - Anomaly Detection
   - Alert System
   - Monitoring Dashboard
   - Health Check Integration

---

## Database Schema Enhancements

### New Tables

#### monitoring_metrics
```sql
CREATE TABLE monitoring_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  labels JSONB,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_monitoring_metrics_name_time ON monitoring_metrics(metric_name, collected_at DESC);
```

#### alert_definitions
```sql
CREATE TABLE alert_definitions (
  id SERIAL PRIMARY KEY,
  alert_name TEXT NOT NULL UNIQUE,
  condition TEXT NOT NULL,
  threshold NUMERIC NOT NULL,
  severity TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### alerts
```sql
CREATE TABLE alerts (
  id BIGSERIAL PRIMARY KEY,
  alert_definition_id INTEGER NOT NULL REFERENCES alert_definitions(id),
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  value NUMERIC,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active'
);
CREATE INDEX idx_alerts_status_time ON alerts(status, triggered_at DESC);
```

#### backup_metadata
```sql
CREATE TABLE backup_metadata (
  id SERIAL PRIMARY KEY,
  backup_type TEXT NOT NULL,
  location TEXT NOT NULL,
  size_bytes BIGINT,
  checksum TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'in_progress',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_backup_metadata_status_time ON backup_metadata(status, created_at DESC);
```

#### query_analysis_cache
```sql
CREATE TABLE query_analysis_cache (
  id SERIAL PRIMARY KEY,
  query_hash TEXT NOT NULL UNIQUE,
  query_text TEXT NOT NULL,
  execution_plan JSONB NOT NULL,
  avg_execution_time_ms NUMERIC,
  recommendations JSONB,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Configuration Files

### Environment Variables
```
# Query Analysis
ENABLE_QUERY_ANALYSIS=true
SLOW_QUERY_THRESHOLD_MS=1000

# Partitioning
ENABLE_PARTITIONING=true
PARTITION_ROTATION_DAY=1

# Backup
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 2 * * 0"  # Weekly Sunday 2 AM
BACKUP_RETENTION_DAYS=90
BACKUP_LOCATIONS="s3://bucket/backups,/local/backups"

# Monitoring
MONITORING_ENABLED=true
METRICS_COLLECTION_INTERVAL_SECONDS=60
ALERT_EMAIL=alerts@example.com
ALERT_SLACK_WEBHOOK=https://hooks.slack.com/...
```

---

## Testing Strategy

1. **Unit Tests**: Each service independently
2. **Integration Tests**: Services with database
3. **Performance Tests**: Query performance improvements
4. **Recovery Tests**: Backup and restore validation
5. **Alert Tests**: Alert triggering and routing

---

## Deployment Checklist

- [ ] Create new tables
- [ ] Deploy services in order (Phase 1-4)
- [ ] Enable monitoring gradually
- [ ] Test partition rotation
- [ ] Test backup and restore
- [ ] Set up alerting channels
- [ ] Configure Kubernetes/container resources
- [ ] Monitor for 48 hours post-deployment

---

## Success Metrics

- Query analysis identifies optimization opportunities
- Partitioned tables reduce query time by 30-50%
- Backup completes successfully and restores correctly
- Alerts trigger within 1 minute of anomaly
- Mean time to detect (MTTD) < 2 minutes
- Mean time to recover (MTTR) < 5 minutes
