# Database Features Deployment Guide

## Quick Start

### 1. Prerequisites

```bash
# PostgreSQL 12+
psql --version

# Node.js 16+
node --version

# npm packages already included in package.json
npm list | grep -E "drizzle|pg|node-cron"
```

### 2. Verify Database Extensions

```bash
# Connect to database
psql -h localhost -U postgres -d bankerchanger

# Check required extensions
SELECT * FROM pg_extension WHERE extname IN ('pg_stat_statements');

# Install missing extension
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### 3. Run Migrations

```bash
# Navigate to backend directory
cd backend

# Run migrations
npm run migrate

# Verify new tables
psql -h localhost -U postgres -d bankerchanger -c "\dt monitoring_*"
```

### 4. Configure Environment Variables

Create `.env.local` or update `.env`:

```bash
# Query Analysis
ENABLE_QUERY_ANALYSIS=true
SLOW_QUERY_THRESHOLD_MS=1000

# Partitioning
ENABLE_PARTITIONING=true
PARTITION_TABLES=bets,probability_snapshots
PARTITION_ROTATION_SCHEDULE=0 1 1 * *

# Backups
BACKUP_ENABLED=true
BACKUP_RETENTION_DAYS=90
BACKUP_LOCATIONS=/backups,/backups-secondary
BACKUP_FULL_SCHEDULE=0 2 * * 0
BACKUP_INCREMENTAL_SCHEDULE=0 3 * * *

# Monitoring
ENABLE_MONITORING=true
METRICS_COLLECTION_INTERVAL_SECONDS=60
ALERT_EMAIL=ops@example.com
```

### 5. Initialize Cron Jobs

The cron jobs are automatically initialized when the application starts:

```typescript
// In src/index.ts
import { initializeDatabaseMaintenance } from './cron/database-maintenance';

// After app initialization
initializeDatabaseMaintenance();
```

### 6. Test the Features

```bash
# Test Query Analysis
curl -X POST http://localhost:3000/api/admin/queries/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"query": "SELECT * FROM markets WHERE status = '\''open'\''"}'

# Test Backups
curl -X POST http://localhost:3000/api/admin/backups/create \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"backup_type": "full"}'

# Test Monitoring
curl -X GET http://localhost:3000/api/admin/monitoring/health \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Deployment Stages

### Stage 1: Development/Staging (Days 1-2)

```bash
# 1. Deploy code
git pull
npm install
npm run build

# 2. Run migrations
npm run migrate

# 3. Verify services
npm test -- tests/services/database-features.test.ts

# 4. Test backups
npm run test:integration -- backup

# 5. Monitor for 24 hours
```

### Stage 2: Production (Days 3-7)

```bash
# 1. Pre-deployment checks
- Verify database backups exist
- Confirm monitoring setup
- Test restore procedure
- Backup database before deployment

# 2. Deploy during maintenance window
docker pull <image>
docker-compose up -d

# 3. Verify deployment
curl http://localhost:3000/api/admin/monitoring/health

# 4. Monitor metrics dashboard
- Check connection pool usage
- Monitor backup completion
- Verify partition rotation
- Review slow queries

# 5. Gradual rollout
- Start with non-critical tables
- Monitor for 48 hours
- Expand to all tables
```

---

## File Structure

```
backend/
├── src/
│   ├── services/
│   │   ├── QueryAnalyzer.ts          ✅ Query analysis & recommendations
│   │   ├── IndexRecommendation.ts    ✅ Index management
│   │   ├── PartitioningService.ts    ✅ Table partitioning
│   │   ├── BackupService.ts          ✅ Backup/restore
│   │   └── MonitoringService.ts      ✅ Metrics & anomaly detection
│   │
│   ├── api/
│   │   ├── controllers/
│   │   │   ├── QueryAnalysisController.ts        ✅ Query analysis API
│   │   │   └── DatabaseAdminController.ts        ✅ Admin API endpoints
│   │   │
│   │   └── routes/
│   │       └── admin.routes.ts                   ✅ Admin route definitions
│   │
│   └── cron/
│       └── database-maintenance.ts               ✅ Scheduled jobs
│
├── migrations/
│   └── 001_create_monitoring_tables.sql          ✅ Database schema
│
└── tests/
    └── services/
        └── database-features.test.ts             ✅ Integration tests
```

---

## API Reference

### Query Analysis

```bash
# Analyze query performance
POST /api/admin/queries/analyze
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "SELECT * FROM bets WHERE placed_at > NOW() - INTERVAL '7 days'"
}

Response:
{
  "success": true,
  "data": {
    "analysis": {
      "query": "...",
      "execution_time_ms": 245,
      "total_cost": 3500.50,
      "rows_affected": 5200,
      "uses_seq_scan": false,
      "uses_index": true,
      "missing_indexes": [],
      "recommendations": ["Consider adding index on status column"],
      "execution_plan": {...}
    }
  }
}
```

### Backup Management

```bash
# Create full backup
POST /api/admin/backups/create
Authorization: Bearer <token>

{
  "backup_type": "full"
}

# List backups
GET /api/admin/backups/list
Authorization: Bearer <token>

# Restore from backup
POST /api/admin/backups/restore
Authorization: Bearer <token>

{
  "backup_id": "backup_1234567890"
}

# Test backup integrity
POST /api/admin/backups/test-restore
Authorization: Bearer <token>

{
  "backup_id": "backup_1234567890"
}
```

### Monitoring & Health

```bash
# Get system metrics
GET /api/admin/monitoring/metrics
Authorization: Bearer <token>

# Get health status
GET /api/admin/monitoring/health
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "status": "healthy",
    "metrics": {
      "connections_active": 8,
      "connections_max": 100,
      "cache_hit_ratio": 94.2,
      "avg_query_time_ms": 32,
      "slow_queries_count": 0,
      "lock_count": 0
    },
    "anomalies": [],
    "severity_summary": {}
  }
}
```

### Partitioning

```bash
# Get partition status
GET /api/admin/partitions/status?table_name=bets
Authorization: Bearer <token>

# Create monthly partitions
POST /api/admin/partitions/create-monthly
Authorization: Bearer <token>

{
  "table_name": "bets",
  "partition_column": "created_at"
}

# Rotate partitions
POST /api/admin/partitions/rotate
Authorization: Bearer <token>

{
  "table_name": "bets"
}
```

---

## Monitoring Dashboard

Access the monitoring dashboard:

```
http://localhost:3000/api/admin/monitoring/health
```

Key metrics to watch:

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Cache Hit Ratio | >90% | 80-90% | <80% |
| Avg Query Time | <50ms | 50-100ms | >100ms |
| Slow Queries | 0-2 | 3-5 | >5 |
| Connections | <50% | 50-80% | >80% |
| Lock Count | 0 | 1-5 | >5 |

---

## Kubernetes Deployment

### Health Probes

Update your pod spec:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: bankerchanger-backend
spec:
  containers:
    - name: backend
      image: bankerchanger:latest
      ports:
        - containerPort: 3000
      
      # Liveness probe (is the app alive?)
      livenessProbe:
        httpGet:
          path: /api/admin/monitoring/health
          port: 3000
        initialDelaySeconds: 30
        periodSeconds: 10
        timeoutSeconds: 5
        failureThreshold: 3
      
      # Readiness probe (is the app ready for traffic?)
      readinessProbe:
        httpGet:
          path: /api/admin/monitoring/health
          port: 3000
        initialDelaySeconds: 10
        periodSeconds: 5
        timeoutSeconds: 3
        failureThreshold: 2
      
      env:
        - name: ENABLE_MONITORING
          value: "true"
        - name: ENABLE_BACKUPS
          value: "true"
        - name: ENABLE_PARTITIONING
          value: "true"
```

### Resource Requests/Limits

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "2000m"
    memory: "2Gi"
```

### CronJobs

If running in Kubernetes, backup jobs can also be triggered via:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup-job
spec:
  schedule: "0 2 * * 0"  # Weekly Sunday 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: bankerchanger:latest
              command: ["npm", "run", "backup:full"]
          restartPolicy: OnFailure
```

---

## Troubleshooting

### Backups Not Running

```bash
# Check if cron jobs are initialized
ps aux | grep node

# Check logs for cron errors
tail -f logs/app.log | grep -i backup

# Manually trigger backup
curl -X POST http://localhost:3000/api/admin/backups/create \
  -H "Authorization: Bearer $TOKEN"

# Check backup directory
ls -lh /backups/
```

### Query Analysis Errors

```bash
# Check pg_stat_statements extension
psql -d bankerchanger -c "SELECT * FROM pg_stat_statements LIMIT 1;"

# If extension is missing, install it:
psql -d bankerchanger -c "CREATE EXTENSION pg_stat_statements;"

# Reset statistics if corrupted
curl -X POST http://localhost:3000/api/admin/queries/reset-stats \
  -H "Authorization: Bearer $TOKEN"
```

### Partition Issues

```bash
# Check partition status
psql -d bankerchanger -c "\d+ bets"

# Enable constraint exclusion
psql -d bankerchanger -c "SET constraint_exclusion = partition;"

# Verify partition pruning
EXPLAIN SELECT * FROM bets WHERE created_at > NOW() - INTERVAL '7 days';
```

### High Memory Usage

```bash
# Check if metrics table is growing too fast
psql -d bankerchanger -c "SELECT COUNT(*) FROM monitoring_metrics;"

# Run cleanup manually
psql -d bankerchanger -c "SELECT cleanup_old_metrics();"

# Adjust retention in environment
METRICS_RETENTION_DAYS=7  # Reduce from default 30
```

---

## Rollback Procedure

If issues occur:

```bash
# 1. Stop the application
docker-compose down

# 2. Restore from backup
curl -X POST http://localhost:3000/api/admin/backups/restore \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"backup_id": "backup_1234567890"}'

# 3. Disable problematic feature
ENABLE_MONITORING=false
ENABLE_PARTITIONING=false

# 4. Restart
docker-compose up -d
```

---

## Performance Verification

After deployment, verify improvements:

```bash
# Check cache hit ratio improvement
GET /api/admin/monitoring/metrics

# Compare query times (should improve 20-30%)
POST /api/admin/queries/analyze

# Verify partition effectiveness
GET /api/admin/partitions/status?table_name=bets

# Check backup status
GET /api/admin/backups/list
```

---

## Maintenance Tasks

### Weekly
- Review anomaly reports
- Check backup completion
- Monitor disk usage

### Monthly
- Run full table optimization (VACUUM ANALYZE)
- Review and apply index recommendations
- Archive old partitions
- Test restore procedures

### Quarterly
- Review partition strategy
- Analyze query patterns
- Optimize slow queries
- Update backup retention

---

## Support

For issues or questions:

1. Check the **Troubleshooting** section
2. Review application logs
3. Check PostgreSQL system tables:
   ```sql
   SELECT * FROM pg_stat_statements;
   SELECT * FROM pg_stat_user_tables;
   SELECT * FROM pg_stat_user_indexes;
   ```
4. Open issue with error logs attached

---

## Success Criteria

Deployment is successful when:

- ✅ All migrations complete without errors
- ✅ Query analysis API responds within 100ms
- ✅ First backup completes successfully
- ✅ Restore test passes
- ✅ Monitoring dashboard shows healthy status
- ✅ No increase in application response time
- ✅ Cron jobs execute on schedule
- ✅ Database size stable or decreasing (with archival)

