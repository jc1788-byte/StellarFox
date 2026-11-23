# Indexer Improvements - Quick Start Guide

## 1. Database Migrations

First, run the three new migrations to set up tables:

```bash
cd /workspaces/StellarFox/backend

# Run migrations
npm run migrate
# or manually
node-pg-migrate up 3
```

**Tables created**:
- `dead_letter_queue` - Failed events with retry tracking
- `rpc_provider_health` - Multi-provider health metrics
- `event_schema_versions` - Event schema versions
- `event_validation_results` - Validation audit trail

## 2. Environment Configuration

Add these variables to your `.env` file:

```bash
# Batch Processing (optional, defaults are good for most cases)
BATCH_PROCESSOR_ENABLED=true
BATCH_PROCESSOR_SIZE=10
BATCH_PROCESSOR_MAX_SIZE=100
BATCH_PROCESSOR_CONCURRENCY=3

# DLQ (optional)
DLQ_ENABLED=true
DLQ_MAX_RETRIES=5

# RPC Providers (optional - keeps single provider as default)
RPC_PROVIDERS=https://soroban-mainnet.stellar.org:mainnet:0:2,https://soroban-testnet.stellar.org:testnet:1:1
RPC_HEALTH_CHECK_INTERVAL_MS=30000

# Schema Validation (optional)
SCHEMA_VALIDATION_ENABLED=true
```

## 3. Register API Routes

In your main `src/index.ts` or Express app setup:

```typescript
import dlqRoutes from './routes/dlq.routes';
import rpcRoutes from './routes/rpc.routes';
import schemaValidationRoutes from './routes/schema-validation.routes';

// Add these after other route registrations
app.use('/api/dlq', dlqRoutes);
app.use('/api/rpc', rpcRoutes);
app.use('/api/schema-validation', schemaValidationRoutes);
```

## 4. Initialize on Startup

In your main `src/index.ts` before starting the indexer:

```typescript
import { initializeIndexerSubsystems, startDLQProcessor } from './indexer/indexerManager';

async function main() {
  // ... existing setup code ...

  try {
    // Initialize all subsystems (schema versions, RPC providers, etc)
    await initializeIndexerSubsystems();
    
    // Start background DLQ processor for auto-retry
    await startDLQProcessor();
    
    // Start the indexer
    await startIndexer();
  } catch (err) {
    logger.error({ err }, 'Failed to start indexer');
    process.exit(1);
  }
}

main();
```

## 5. Verify Everything Works

### Check DLQ is working
```bash
curl http://localhost:3000/api/dlq/stats
```
Expected response:
```json
{
  "totalEntries": 0,
  "pendingEntries": 0,
  "failedEntries": 0,
  "resolvedEntries": 0,
  "oldestPendingAge": null,
  "averageRetries": 0
}
```

### Check RPC provider health
```bash
curl http://localhost:3000/api/rpc/health
```
Expected response:
```json
{
  "healthy": true,
  "providers": [
    {
      "url": "https://soroban-testnet.stellar.org",
      "name": "default",
      "isHealthy": true,
      "consecutiveFailures": 0,
      "responseTimeMs": 150,
      "successRate": 100
    }
  ]
}
```

### Check schema validation
```bash
curl http://localhost:3000/api/schema-validation/stats
```
Expected response:
```json
{
  "totalValidations": 0,
  "validEvents": 0,
  "invalidEvents": 0,
  "validationRate": 0,
  "eventTypeStats": []
}
```

## 6. Monitoring

Watch the key metrics during operation:

```bash
# Monitor DLQ (should stay empty)
watch -n 5 'curl -s http://localhost:3000/api/dlq/stats | jq .pendingEntries'

# Monitor RPC health
watch -n 10 'curl -s http://localhost:3000/api/rpc/metrics | jq .successRate'

# Monitor validation
watch -n 10 'curl -s http://localhost:3000/api/schema-validation/stats | jq .validationRate'
```

## 7. Handling Failed Events

If events appear in the DLQ:

### 1. Check what failed
```bash
curl http://localhost:3000/api/dlq/entries?status=pending | jq '.'
```

### 2. Review specific failure
```bash
curl http://localhost:3000/api/dlq/entries/1 | jq '.error_message, .error_stack'
```

### 3. Retry the event
```bash
curl -X POST http://localhost:3000/api/dlq/entries/1/retry
```

### 4. Export for analysis
```bash
curl http://localhost:3000/api/dlq/export > dlq-export.csv
```

## 8. RPC Provider Failover

The system automatically uses failover. To manually trigger health check:

```bash
curl -X POST http://localhost:3000/api/rpc/health-check
```

To add another provider:

```bash
curl -X POST http://localhost:3000/api/rpc/providers \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://soroban-mainnet.stellar.org",
    "name": "mainnet-primary",
    "priority": 0,
    "weight": 2.0
  }'
```

## 9. Schema Validation

View invalid events:

```bash
curl http://localhost:3000/api/schema-validation/invalid-events?limit=10 | jq '.'
```

## 10. Common Issues

### DLQ not working
- Check `DLQ_ENABLED=true` in env
- Verify `dead_letter_queue` table exists: `SELECT COUNT(*) FROM dead_letter_queue;`
- Check application logs for DLQ errors

### RPC failover not working
- Check `RPC_PROVIDERS` env var is set correctly
- Verify `rpc_provider_health` table exists
- Run `/rpc/health-check` to test

### Schema validation not working
- Check `SCHEMA_VALIDATION_ENABLED=true` in env
- Verify `event_schema_versions` table exists
- Check `/schema-validation/stats` for validation count

## 11. Performance Tuning

### High throughput (>1000 events/sec)
```bash
BATCH_PROCESSOR_MAX_SIZE=200
BATCH_PROCESSOR_CONCURRENCY=5
```

### Memory constrained
```bash
BATCH_PROCESSOR_SIZE=5
BATCH_PROCESSOR_MAX_SIZE=50
BATCH_PROCESSOR_CONCURRENCY=1
```

### Strict validation
```bash
SCHEMA_VALIDATION_ENABLED=true
DLQ_MAX_RETRIES=10
```

### Quick failover
```bash
RPC_HEALTH_CHECK_INTERVAL_MS=10000
```

## 12. Logs to Watch

Enable debug logging to see all activity:

```bash
LOG_LEVEL=debug npm start
```

Key log messages to look for:

```
BatchProcessor: Increasing batch size
BatchProcessor: Decreasing batch size
Event sent to DLQ
RPC provider marked as unhealthy
Event validation failed
Schema version activated
DLQ retry processing complete
```

## 13. Data Retention

By default, old DLQ entries are kept 30 days. To clean up:

```bash
curl -X POST http://localhost:3000/api/dlq/cleanup \
  -H "Content-Type: application/json" \
  -d '{"daysToKeep": 30}'
```

## 14. Troubleshooting Template

If issues occur, collect this info:

```bash
# Get system status
echo "=== DLQ Status ===" && curl -s http://localhost:3000/api/dlq/stats
echo "=== RPC Status ===" && curl -s http://localhost:3000/api/rpc/health
echo "=== Validation Status ===" && curl -s http://localhost:3000/api/schema-validation/stats

# Get first failed event
echo "=== First Failed Event ===" && curl -s 'http://localhost:3000/api/dlq/entries?status=pending&limit=1'

# Get last 100 validation errors
echo "=== Invalid Events ===" && curl -s 'http://localhost:3000/api/schema-validation/invalid-events?limit=100'
```

Then check application logs:

```bash
# Show last 100 error lines
tail -100 /path/to/logs | grep ERROR

# Search for DLQ errors
grep "DLQ\|dlq" /path/to/logs | tail -50

# Search for RPC errors
grep "RPC\|rpc" /path/to/logs | tail -50
```

## Summary

✅ **You now have**:
- Automatic batch processing with adaptive sizing
- Failed event tracking with retry capabilities
- Multi-RPC provider support with failover
- Event schema validation with versioning
- Full monitoring and management APIs

🚀 **Ready to launch**: All features are production-ready and backward compatible!
