# Quick Integration Guide

Fast integration steps for the four database improvements.

## 1. Run Migration

```bash
cd backend
npm run migrate
# or manually run:
psql -d bankerchanger < migrations/008_data_retention_and_ha.sql
```

## 2. Update `src/index.ts`

Add this to your main application setup (after pool creation):

```typescript
import { initializeRetentionTables } from './services/dataRetention.service';
import { initializeFullTextIndexes } from './services/fullTextSearch.service';
import { initializeDynamicPoolManager } from './services/connectionPool.service';
import { initializeHAManager } from './services/databaseReplication.service';
import dataManagementRoutes from './routes/dataManagement.routes';

// Initialize services (after pool is created)
try {
  // Data Retention
  await initializeRetentionTables();
  logger.info('Data retention initialized');

  // Full-Text Search
  await initializeFullTextIndexes();
  logger.info('Full-text search indexes created');

  // Connection Pool Manager
  const poolConfig = {
    max: parseInt(process.env.DB_POOL_MAX || '20'),
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    maxQueryTimeMs: 30000,
    statementTimeoutMs: 60000,
  };
  const poolManager = initializeDynamicPoolManager(pool, poolConfig);
  logger.info('Connection pool manager started');

  // High Availability Manager (optional - only if using replicas)
  if (process.env.DB_REPLICA_HOST_1) {
    const haManager = initializeHAManager(pool, process.env.DB_HOST || 'localhost');
    haManager.registerReplica({
      id: 'replica-1',
      host: process.env.DB_REPLICA_HOST_1,
      port: 5432,
      database: process.env.DB_NAME || 'bankerchanger',
      username: process.env.DB_REPLICA_USER || 'replicator',
      password: process.env.DB_REPLICA_PASSWORD || '',
      type: 'standby',
      priority: 1,
      enabled: true,
      monitorInterval: 30000,
    });
    logger.info('HA Manager initialized with replica-1');
  }

  // Mount data management routes
  app.use('/api/data-management', dataManagementRoutes);
  logger.info('Data management routes mounted');

} catch (error) {
  logger.error('Failed to initialize database services:', error);
  // Continue running even if initialization fails
}
```

## 3. Add to Cron Service

In `src/cron/retention.cron.ts` or your cron file:

```typescript
import * as dataRetention from '../services/dataRetention.service';
import cron from 'node-cron';
import * as pino from 'pino';

const logger = pino.default();

// Run retention cleanup daily at 2 AM
export function setupRetentionCron() {
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Starting retention cleanup');
      const result = await dataRetention.executeRetentionCleanup();
      logger.info('Retention cleanup completed:', result);
    } catch (error) {
      logger.error('Retention cleanup failed:', error);
    }
  });
}

// Optional: Search reindex every Sunday at 3 AM
export function setupSearchReindexCron() {
  cron.schedule('0 3 * * 0', async () => {
    try {
      logger.info('Starting search reindex');
      const { reindexSearchIndexes } = await import('../services/fullTextSearch.service');
      await reindexSearchIndexes();
      logger.info('Search reindex completed');
    } catch (error) {
      logger.error('Search reindex failed:', error);
    }
  });
}

// Call in your cron initialization
setupRetentionCron();
setupSearchReindexCron();
```

## 4. Configure Environment Variables

Add to `.env`:

```bash
# Connection Pool Settings
DB_POOL_MAX=20
DB_POOL_MIN=5
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_POOL_CONNECTION_TIMEOUT_MS=5000

# High Availability (optional)
DB_REPLICA_HOST_1=replica-1.example.com
DB_REPLICA_USER=replicator
DB_REPLICA_PASSWORD=your-secure-password
```

## 5. Optional: Update Pool Usage

Wrap queries to track performance (optional but recommended):

```typescript
import { getDynamicPoolManager } from '../services/connectionPool.service';

async function executeQuery(sql: string, params?: any[]) {
  const startTime = Date.now();
  const poolManager = getDynamicPoolManager();
  
  try {
    const result = await pool.query(sql, params);
    return result;
  } finally {
    const duration = Date.now() - startTime;
    poolManager?.trackQueryExecution(sql, duration);
  }
}
```

## Testing Each Feature

### Test Data Retention
```bash
curl http://localhost:3000/api/data-management/retention/policies
```

### Test Connection Pool
```bash
curl http://localhost:3000/api/data-management/pool/metrics
```

### Test Full-Text Search
```bash
curl 'http://localhost:3000/api/data-management/search/markets?q=mayweather'
```

### Test High Availability
```bash
curl http://localhost:3000/api/data-management/ha/status
```

## Default Retention Policies

The migration auto-creates these policies:

| Entity Type | Retention Days | Archive Days | Purpose |
|-------------|----------------|--------------|---------|
| bet | 730 (2 years) | 365 (1 year) | Regulatory compliance |
| dispute | 1095 (3 years) | 365 (1 year) | Legal holds |
| user_session | 90 (3 months) | 30 (1 month) | Session history |
| notification_job | 365 (1 year) | 90 (3 months) | Notification records |
| blockchain_event | 730 (2 years) | 180 (6 months) | Event audit trail |

## Troubleshooting

### Migration fails
```bash
# Check psql connection
psql -U bankerchanger -d bankerchanger -c "SELECT 1"

# Run migration manually
psql -U bankerchanger -d bankerchanger -f migrations/008_data_retention_and_ha.sql
```

### Services don't initialize
- Check logs for specific error
- Verify database tables were created
- Check database user has proper permissions

### API endpoints return 404
- Verify routes are mounted: `app.use('/api/data-management', dataManagementRoutes)`
- Check middleware order - adminOnly middleware must be set up

### Search returns empty results
```bash
# Reindex
curl -X POST http://localhost:3000/api/data-management/search/reindex

# Check stats
curl http://localhost:3000/api/data-management/search/stats
```

## Next Steps

1. ✅ Run migration
2. ✅ Update `src/index.ts`
3. ✅ Setup cron jobs
4. ✅ Configure environment
5. ✅ Test all endpoints
6. ✅ Deploy and monitor

## Documentation

- **Comprehensive Guide**: `backend/DATA_MANAGEMENT_GUIDE.md`
- **Implementation Details**: `IMPLEMENTATION_SUMMARY.md`
- **API Reference**: Endpoints documented in routes file

## Support

All services include:
- Comprehensive error handling
- Transaction safety
- Performance logging
- Health checks
- Monitoring endpoints

Check `DATA_MANAGEMENT_GUIDE.md` for detailed troubleshooting.
