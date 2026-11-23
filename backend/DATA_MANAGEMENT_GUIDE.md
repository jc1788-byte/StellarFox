# Data Management Guide

This guide covers the four major database features implemented for StellarFox:
1. Data Retention and Archival Policies
2. Dynamic Connection Pool Management
3. Full-Text Search Optimization
4. Database Replication and High Availability

## Table of Contents
- [Data Retention](#data-retention)
- [Connection Pool Management](#connection-pool-management)
- [Full-Text Search](#full-text-search)
- [Database Replication](#database-replication)

---

## Data Retention

### Overview
The data retention service provides automated cleanup and archival of old records with compliance reporting. It helps meet regulatory requirements while managing database size.

### Key Components

**Service Location:** `src/services/dataRetention.service.ts`

#### Features:
- Configurable retention policies per entity type
- Automatic archival to cold storage (archived_records table)
- Permanent deletion after retention period
- Compliance reporting with metrics
- Support for bets, disputes, user sessions, and notification jobs

### Setup

#### 1. Initialize Tables
```typescript
import * as dataRetention from '../services/dataRetention.service';

await dataRetention.initializeRetentionTables();
```

#### 2. Configure Retention Policies

```typescript
// Set a retention policy
await dataRetention.setRetentionPolicy(
  'bet',           // entity type
  730,             // retention days (2 years)
  365,             // archive days (1 year)
  true,            // enabled
  'Retain bets for 2 years per regulations'
);
```

#### 3. Get All Policies

```typescript
const policies = await dataRetention.getRetentionPolicies();
console.log(policies);
```

### API Endpoints

#### Create/Update Policy
```
POST /api/data-management/retention/policies
Content-Type: application/json

{
  "entityType": "bet",
  "retentionDays": 730,
  "archiveDays": 365,
  "enabled": true,
  "description": "Retain bets for regulatory compliance"
}
```

#### Get All Policies
```
GET /api/data-management/retention/policies
```

#### Execute Cleanup
```
POST /api/data-management/retention/execute

Response:
{
  "success": true,
  "data": {
    "policiesProcessed": 5,
    "totalRecordsArchived": 1250,
    "totalRecordsDeleted": 450
  }
}
```

#### Generate Compliance Report
```
POST /api/data-management/retention/{policyId}/report

Response:
{
  "success": true,
  "data": {
    "id": 1,
    "policy_id": 1,
    "records_processed": 5000,
    "records_archived": 4500,
    "records_deleted": 500,
    "storage_freed_bytes": 52428800,
    "status": "completed",
    "completed_at": "2024-11-21T14:30:00Z"
  }
}
```

#### Get Compliance Reports
```
GET /api/data-management/retention/{policyId}/reports

Response:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "policy_id": 1,
      "report_date": "2024-11-21",
      "status": "completed",
      ...
    }
  ]
}
```

### Scheduling Cleanup

Add to your cron service:

```typescript
// src/cron/retention.cron.ts
import * as dataRetention from '../services/dataRetention.service';
import cron from 'node-cron';

// Run cleanup daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  try {
    const result = await dataRetention.executeRetentionCleanup();
    logger.info('Retention cleanup completed', result);
  } catch (error) {
    logger.error('Retention cleanup failed', error);
  }
});
```

### Database Schema

**retention_policies table:**
```
id (SERIAL PRIMARY KEY)
entity_type (VARCHAR UNIQUE) - 'bet', 'dispute', 'user_session', etc.
retention_days (INTEGER) - How long to keep records
archive_days (INTEGER) - When to move to archive
enabled (BOOLEAN)
description (TEXT)
created_at, updated_at (TIMESTAMP)
```

**archived_records table:**
```
id (BIGSERIAL PRIMARY KEY)
entity_type (VARCHAR)
entity_id (TEXT) - Original record ID
original_table (VARCHAR)
archived_data (JSONB) - Full record copy
archived_at (TIMESTAMP)
archived_by (VARCHAR) - User who archived
retention_policy_id (INTEGER) - Reference to policy
```

---

## Connection Pool Management

### Overview
The dynamic pool manager automatically adjusts connection pool settings based on load patterns, system resources, and query performance.

### Key Components

**Service Location:** `src/services/connectionPool.service.ts`

#### Features:
- Real-time metrics collection
- Load-based auto-scaling
- Query time tracking
- Health monitoring
- Performance recommendations

### Setup

#### 1. Initialize Dynamic Pool Manager

```typescript
import { pool } from '../config/db';
import { initializeDynamicPoolManager } from '../services/connectionPool.service';

const poolConfig = {
  max: 20,
  min: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxQueryTimeMs: 30000,
  statementTimeoutMs: 60000,
};

const poolManager = initializeDynamicPoolManager(pool, poolConfig);
```

#### 2. Track Query Execution

```typescript
const startTime = Date.now();
try {
  await pool.query(sql);
} finally {
  const duration = Date.now() - startTime;
  poolManager.trackQueryExecution(sql, duration);
}
```

### API Endpoints

#### Get Pool Metrics
```
GET /api/data-management/pool/metrics

Response:
{
  "success": true,
  "data": {
    "totalConnections": 20,
    "activeConnections": 15,
    "idleConnections": 5,
    "waitingRequests": 0,
    "connectionUtilization": 75.0,
    "avgQueryTime": 245,
    "connectionErrors": 0,
    "lastUpdated": "2024-11-21T14:30:00Z"
  }
}
```

#### Get Pool Configuration
```
GET /api/data-management/pool/config

Response:
{
  "success": true,
  "data": {
    "max": 20,
    "min": 5,
    "idleTimeoutMillis": 30000,
    "connectionTimeoutMillis": 5000,
    "maxQueryTimeMs": 30000,
    "statementTimeoutMs": 60000
  }
}
```

#### Get Pool Health
```
GET /api/data-management/pool/health

Response:
{
  "success": true,
  "data": {
    "healthy": true,
    "issues": []
  }
}
```

#### Get Performance Report
```
GET /api/data-management/pool/report

Response:
{
  "success": true,
  "data": {
    "currentMetrics": { ... },
    "configuration": { ... },
    "healthStatus": { "healthy": true, "issues": [] },
    "recommendations": [
      "Consider increasing max_connections",
      "Review slow queries and add indexes"
    ]
  }
}
```

### Configuration Tuning

**Environment Variables:**
```
DB_POOL_MAX=20
DB_POOL_MIN=5
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_POOL_CONNECTION_TIMEOUT_MS=5000
```

**Auto-Scaling Rules:**
- Scale up when utilization > 80%
- Scale down when utilization < 30%
- Adjust query timeouts based on performance patterns
- Maximum pool size: 100 connections
- Minimum pool size: 5 connections

### Monitoring

The pool manager tracks:
- Active vs idle connections
- Query execution times
- Connection errors
- System CPU and memory usage
- Load patterns over time

---

## Full-Text Search

### Overview
Full-text search provides powerful text search capabilities with ranking, fuzzy matching, and faceted results.

### Key Components

**Service Location:** `src/services/fullTextSearch.service.ts`

#### Features:
- PostgreSQL full-text search with tsvector/tsquery
- Trigram-based fuzzy matching
- Search result ranking
- Faceted search with counts
- Query suggestions
- Multiple search types: simple, phrase, boolean

### Setup

#### 1. Initialize Indexes

```typescript
import * as fullTextSearch from '../services/fullTextSearch.service';

await fullTextSearch.initializeFullTextIndexes();
```

This creates:
- GIN indexes for efficient full-text search
- Trigram indexes for fuzzy matching
- Indexes on multiple tables (markets, disputes, events)

#### 2. Create Custom Index (Optional)

```typescript
await fullTextSearch.createSearchIndex(
  'markets',
  'idx_custom_search',
  ['fighter_a', 'fighter_b', 'weight_class', 'venue'],
  'english'
);
```

### API Endpoints

#### Basic Search
```
GET /api/data-management/search/markets?q=mayweather&type=simple&limit=20&offset=0

Response:
{
  "success": true,
  "data": [
    {
      "id": 123,
      "score": 0.8543,
      "item": {
        "market_id": "mkt_123",
        "fighter_a": "Floyd Mayweather",
        "fighter_b": "Logan Paul",
        "weight_class": "Heavyweight",
        "venue": "Las Vegas",
        "status": "open"
      },
      "highlights": {
        "headline": ["Floyd <strong>Mayweather</strong> vs Logan Paul"]
      }
    }
  ]
}
```

#### Search with Facets
```
GET /api/data-management/search/markets/facets?q=boxing

Response:
{
  "success": true,
  "data": {
    "results": [ ... ],
    "facets": {
      "categories": [
        { "value": "Heavyweight", "count": 45 },
        { "value": "Middleweight", "count": 32 }
      ],
      "statuses": [
        { "value": "open", "count": 60 },
        { "value": "resolved", "count": 17 }
      ],
      "venues": [
        { "value": "Las Vegas", "count": 28 },
        { "value": "London", "count": 15 }
      ]
    }
  }
}
```

#### Get Search Suggestions
```
GET /api/data-management/search/suggestions?prefix=may&limit=5

Response:
{
  "success": true,
  "data": [
    "Mayweather",
    "Maypol",
    "Mayer"
  ]
}
```

#### Fuzzy Search
```
GET /api/data-management/search/fuzzy?q=maywhether&limit=10

Response:
{
  "success": true,
  "data": [
    { "name": "Mayweather", "similarity": 0.95 },
    { "name": "May", "similarity": 0.60 }
  ]
}
```

### Search Types

1. **Simple** (default)
   - Basic keyword matching
   - Ignores Boolean operators
   - Best for general search

2. **Phrase**
   - Phrase matching within text
   - Maintains word order
   - Use for exact phrase search

3. **Boolean**
   - Supports & (AND), | (OR), ! (NOT) operators
   - Example: `mayweather & boxing`
   - Use for complex queries

### Admin Endpoints

#### Reindex Search Indexes
```
POST /api/data-management/search/reindex
```

#### Get Index Statistics
```
GET /api/data-management/search/stats

Response:
{
  "success": true,
  "data": [
    {
      "tablename": "markets",
      "indexname": "idx_markets_fts",
      "scans": 1523,
      "tuples_read": 45234,
      "tuples_fetched": 1523,
      "size": "2456 kB"
    }
  ]
}
```

### Database Schema

**Full-Text Indexes:**
```
idx_markets_fts (GIN)
- Searches: fighter_a, fighter_b, weight_class, venue

idx_markets_fighter_a_trgm (GIN trigram)
- Fuzzy search on fighter_a

idx_disputes_fts (GIN)
- Searches: reason, admin_notes

idx_blockchain_events_fts (GIN)
- Searches: event_type, payload
```

### Performance Tuning

**Tips for better search performance:**

1. Keep indexes analyzed
```sql
ANALYZE markets;
ANALYZE disputes;
```

2. Monitor index usage
```sql
SELECT * FROM pg_stat_user_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE '%fts%';
```

3. Reindex periodically
```sql
REINDEX INDEX CONCURRENTLY idx_markets_fts;
```

---

## Database Replication

### Overview
The database replication service provides high availability through master-replica replication with automatic failover and consistency verification.

### Key Components

**Service Location:** `src/services/databaseReplication.service.ts`

#### Features:
- Multi-replica support (standby, cascading, logical)
- Automatic health monitoring
- Manual and automatic failover
- Consistency verification
- Replica lag tracking
- Failover event history

### Setup

#### 1. Initialize HA Manager

```typescript
import { pool } from '../config/db';
import { initializeHAManager } from '../services/databaseReplication.service';

const haManager = initializeHAManager(pool, 'primary-db.example.com');
```

#### 2. Register Replicas

```typescript
haManager.registerReplica({
  id: 'replica-1',
  host: 'replica-1.example.com',
  port: 5432,
  database: 'bankerchanger',
  username: 'replicator',
  password: process.env.REPLICA_PASSWORD,
  type: 'standby',
  priority: 1,  // Higher priority = promoted first
  enabled: true,
  monitorInterval: 30000, // Check every 30 seconds
});

haManager.registerReplica({
  id: 'replica-2',
  host: 'replica-2.example.com',
  port: 5432,
  database: 'bankerchanger',
  username: 'replicator',
  password: process.env.REPLICA_PASSWORD,
  type: 'standby',
  priority: 2,
  enabled: true,
  monitorInterval: 30000,
});
```

#### 3. Start Monitoring

```typescript
haManager.startMonitoring();
```

### API Endpoints

#### Get Replication Status
```
GET /api/data-management/ha/status

Response:
{
  "success": true,
  "data": [
    {
      "replicaId": "replica-1",
      "isConnected": true,
      "replicaLagBytes": 2048,
      "replicaLagSeconds": 0,
      "isUpToDate": true,
      "syncPercentage": 99.8,
      "status": "healthy",
      "lastSync": "2024-11-21T14:30:15Z"
    },
    {
      "replicaId": "replica-2",
      "isConnected": true,
      "replicaLagBytes": 5120,
      "replicaLagSeconds": 1,
      "isUpToDate": true,
      "syncPercentage": 99.5,
      "status": "healthy",
      "lastSync": "2024-11-21T14:30:20Z"
    }
  ]
}
```

#### Get HA Report
```
GET /api/data-management/ha/report

Response:
{
  "success": true,
  "data": {
    "currentPrimary": "primary-db.example.com",
    "replicasHealthy": 2,
    "totalReplicas": 2,
    "replicationStatus": [ ... ],
    "failoverHistory": [ ... ],
    "recommendations": [
      "All replicas healthy",
      "Replication lag is minimal"
    ]
  }
}
```

#### Get Failover History
```
GET /api/data-management/ha/failover-history

Response:
{
  "success": true,
  "data": [
    {
      "id": "failover_1700592000000",
      "timestamp": "2024-11-21T12:00:00Z",
      "previousPrimary": "primary-db-1.example.com",
      "newPrimary": "replica-1.example.com",
      "reason": "Primary failure detected",
      "success": true,
      "errors": []
    }
  ]
}
```

#### Manual Failover
```
POST /api/data-management/ha/failover
Content-Type: application/json

{
  "replicaId": "replica-1",
  "reason": "Planned maintenance on primary"
}

Response:
{
  "success": true,
  "message": "Replica replica-1 promoted to primary"
}
```

### Replication Types

1. **Standby (Physical Replication)**
   - Block-level replication
   - Fastest replication
   - Exact copy of primary
   - Cannot serve queries in standby mode

2. **Cascading**
   - Replica replicates from another replica
   - Reduces load on primary
   - Increases replication lag

3. **Logical**
   - Row-level replication
   - Can replicate specific tables
   - Can transform data
   - Slower than physical

### Health Monitoring

The HA manager monitors:
- Connection status to each replica
- Replication lag (bytes and seconds)
- Data consistency via checksums
- Sync state
- WAL (Write-Ahead Log) distance

**Thresholds:**
```
Max replica lag bytes: 1 MB
Max replica lag seconds: 5 seconds
Sync timeout: 30 seconds
```

### Failover Process

**Manual Failover:**
1. Promote selected replica to primary
2. Update replica_conninfo on remaining replicas
3. Record failover event
4. Monitor new primary

**Automatic Failover:**
1. Detect primary unavailability
2. Select healthiest replica with highest priority
3. Promote to primary
4. Reconfigure other replicas
5. Log event with details

### PostgreSQL Configuration

**Primary server (postgresql.conf):**
```
wal_level = replica
max_wal_senders = 10
wal_keep_size = 1GB
hot_standby_feedback = on
```

**Replica server (postgresql.conf):**
```
hot_standby = on
hot_standby_feedback = on
recovery_min_apply_delay = 0
```

**pg_hba.conf:**
```
# Allow replication connections
host    replication     replicator      replica-1.example.com/32    md5
host    replication     replicator      replica-2.example.com/32    md5
```

### Disaster Recovery

**Create base backup for new replica:**
```bash
pg_basebackup -h primary-db.example.com -D /var/lib/postgresql/13/main \
  -U replicator -v -P -W --wal-method=stream
```

**Check replication status on primary:**
```sql
SELECT * FROM pg_stat_replication;
```

**Check replica status:**
```sql
SELECT pg_last_xlog_receive_location();
SELECT pg_last_xlog_replay_location();
```

---

## Monitoring and Maintenance

### Database Health Dashboard

Monitor all systems via endpoints:

```typescript
async function getFullHealthStatus() {
  const retention = await fetch('/api/data-management/retention/policies');
  const poolHealth = await fetch('/api/data-management/pool/health');
  const searchStats = await fetch('/api/data-management/search/stats');
  const haStatus = await fetch('/api/data-management/ha/report');
  
  return {
    retention: await retention.json(),
    pool: await poolHealth.json(),
    search: await searchStats.json(),
    ha: await haStatus.json(),
  };
}
```

### Scheduled Tasks

Add to cron service:

```typescript
// Daily 2 AM - Retention cleanup
cron.schedule('0 2 * * *', () => executeRetentionCleanup());

// Every 6 hours - Reindex search
cron.schedule('0 */6 * * *', () => reindexSearchIndexes());

// Every 1 minute - Monitor HA
cron.schedule('* * * * *', () => haManager?.generateHAReport());
```

### Alerts

Set up monitoring for:
- Pool utilization > 90%
- Replication lag > 5 seconds
- Query average time > 2 seconds
- Connection errors > 10
- Archived records not deleted within timeout

---

## Troubleshooting

### High Connection Pool Utilization
1. Check for long-running queries
2. Review application for connection leaks
3. Consider increasing pool size
4. Add database indexes

### Replication Lag
1. Check network connectivity
2. Monitor primary server resources
3. Review WAL generation rate
4. Optimize slow queries

### Search Performance
1. Analyze and reindex
2. Check disk space
3. Monitor table size
4. Review query patterns

### Data Retention Issues
1. Verify policies are enabled
2. Check retention_days and archive_days
3. Monitor archived_records table size
4. Review compliance_reports for errors

---

## Best Practices

1. **Retention**: Review and adjust policies quarterly based on regulations
2. **Connection Pool**: Monitor metrics weekly, adjust based on patterns
3. **Full-Text Search**: Reindex monthly, analyze index statistics
4. **Replication**: Test failover monthly, maintain 2+ replicas minimum
5. **Monitoring**: Set up alerts for all health indicators
6. **Backups**: Maintain regular backups independent of replication
7. **Documentation**: Keep replica configuration documented
8. **Testing**: Regular disaster recovery drills

---

## Support and Resources

- PostgreSQL Documentation: https://www.postgresql.org/docs/
- Full-Text Search: https://www.postgresql.org/docs/current/textsearch.html
- Replication: https://www.postgresql.org/docs/current/warm-standby.html
- Connection Pooling: https://www.postgresql.org/docs/current/sql-syntax.html
