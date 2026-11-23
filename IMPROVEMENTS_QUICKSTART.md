# Quick Start Guide: Four Improvements to StellarFox Indexer

## 1. Minute-by-Minute Overview

### Problem 1: Inefficient Batch Processing
**Solution**: `DynamicBatchProcessor` - Automatically adjusts batch size based on load
- Scales up to 500 events when running smooth
- Scales down when errors occur
- Prevents queue overflow with backpressure

### Problem 2: Lost Events on Errors
**Solution**: `DeadLetterQueue` - Captures failed events, replays them automatically
- Events stored with full error context
- Exponential backoff retry (1m, 2m, 4m, 8m...)
- Admin can manually review and replay

### Problem 3: Single RPC Provider Failure
**Solution**: `MultiRPCProvider` - Automatic failover and load balancing
- Check provider health every 5 seconds
- Automatic failover in <5 seconds
- Load balance across providers

### Problem 4: No Schema Validation
**Solution**: `EventSchemaRegistry` - Validates and migrates event schemas
- Validates all events before processing
- Supports multiple schema versions
- Zero-downtime contract upgrades

---

## 2. Using the Enhanced Poller

### Option A: Use Enhanced Poller (Recommended)

```typescript
// indexer/src/index.ts
import app from './server';
import { pollEventsEnhanced } from './pollerEnhanced';  // NEW
import { initWebSocketServer } from './ws';

const PORT = process.env.PORT || 3001;

const httpServer = app.listen(PORT, () => {
  console.log(`Indexer running on port ${PORT}`);
  pollEventsEnhanced();  // Use enhanced version
});

initWebSocketServer(httpServer);
```

### Option B: Use Individual Components

```typescript
import DynamicBatchProcessor from './batchProcessor';
import DeadLetterQueue from './dlq';
import { MultiRPCProvider } from './rpcProvider';
import EventSchemaRegistry from './eventSchema';

const processor = new DynamicBatchProcessor({ /* config */ });
const dlq = new DeadLetterQueue();
const rpc = new MultiRPCProvider(providers);
const schemas = new EventSchemaRegistry();
```

---

## 3. Environment Configuration

### Set in `.env` file:

```bash
# RPC Providers (required for multi-RPC)
# Use comma-separated URLs
SOROBAN_RPC_URLS="https://soroban-testnet.stellar.org,https://soroban-testnet-backup.stellar.org"

# Batch Processing (optional, these are defaults)
BATCH_MIN_SIZE=10
BATCH_MAX_SIZE=500
BATCH_INIT_SIZE=100
BATCH_MAX_WORKERS=4
BACKPRESSURE_LIMIT=1000

# Logging
LOG_LEVEL=debug  # or info, warn, error
NODE_ENV=production  # or development

# Other existing variables
FACTORY_CONTRACT_ADDRESS=your-contract-id
PORT=3001
```

---

## 4. Monitoring Health

### Add Health Endpoint (Optional)

```typescript
// indexer/src/server.ts
import express from 'express';
import { getPollerHealth } from './pollerEnhanced';

const app = express();

app.get('/health/enhanced', (req, res) => {
  const health = getPollerHealth();
  const status = health.isRunning ? 200 : 503;
  res.status(status).json(health);
});

export default app;
```

### Example Response:
```json
{
  "isRunning": true,
  "consecutiveFailures": 0,
  "eventsProcessed": 50000,
  "reorgsDetected": 2,
  "ledgerGapsDetected": 1,
  "dlqSize": 15,
  "batchMetrics": {
    "currentBatchSize": 125,
    "throughput": 5000,
    "errorRate": 0.03,
    "activeWorkers": 4,
    "queuedEvents": 50
  }
}
```

---

## 5. Database Migrations

The DLQ and RPC provider health tables are already defined in migrations:

```bash
# Already exists:
# backend/migrations/1751000000002_add-dlq-table.js
# backend/migrations/1751000000003_add-rpc-provider-health.js

# Run migrations:
cd backend
npm run migrate:up
```

---

## 6. Testing the Implementation

```bash
cd indexer

# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suites
npm test -- batchProcessor.test.ts
npm test -- dlq.test.ts
npm test -- rpcProvider.test.ts
npm test -- eventSchema.test.ts

# Build TypeScript
npm run build

# Start enhanced indexer
npm run dev
```

---

## 7. Monitoring Key Metrics

### What to Watch

```typescript
import { getPollerHealth } from './pollerEnhanced';

setInterval(() => {
  const health = getPollerHealth();

  // Alert if DLQ growing
  if (health.dlqSize > 100) {
    console.warn('DLQ growing:', health.dlqSize);
  }

  // Alert if error rate high
  if (health.batchMetrics.errorRate > 0.1) {
    console.warn('High error rate:', health.batchMetrics.errorRate);
  }

  // Alert if no events processed recently
  const lastPoll = new Date(health.lastSuccessfulPollAt);
  const minutesAgo = (Date.now() - lastPoll.getTime()) / 60000;
  if (minutesAgo > 5) {
    console.warn('No events processed for', minutesAgo, 'minutes');
  }
}, 60000); // Check every minute
```

---

## 8. Common Tasks

### Query DLQ Events
```typescript
import DeadLetterQueue from './dlq';

const dlq = new DeadLetterQueue();
await dlq.loadFromPersistence(); // Load from DB

const stats = dlq.getStats();
console.log('DLQ Stats:', stats);

const pending = await dlq.getPendingRetries();
console.log('Pending retries:', pending.length);
```

### Check RPC Provider Health
```typescript
import { MultiRPCProvider } from './rpcProvider';

const rpc = new MultiRPCProvider(providers);
rpc.startHealthChecks();

const health = rpc.getAllHealth();
health.forEach(h => {
  console.log(`${h.name}: ${h.isHealthy ? 'healthy' : 'unhealthy'}`);
});

const stats = rpc.getStats();
console.log('Stats:', stats);
```

### Validate Event Schema
```typescript
import EventSchemaRegistry from './eventSchema';

const registry = new EventSchemaRegistry();
const result = registry.validate('invoice.submitted', eventData);

if (!result.valid) {
  console.error('Validation errors:', result.errors);
}

if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
}
```

---

## 9. Performance Expectations

After deployment, you should see:

| Metric | Expected |
|--------|----------|
| Event throughput | 500+ events/sec (was 100) |
| DLQ size | <10 normally, recovers within hours |
| RPC failover time | <5 seconds |
| Batch size | Dynamic 10-500 (was fixed 100) |
| Error recovery rate | >99% |
| Downtime due to RPC failure | 0 minutes |

---

## 10. Troubleshooting

### DLQ Growing Too Large
1. Check logs for systematic errors
2. Verify RPC provider health
3. Check event schema compatibility
4. Run: `dlq.cleanup()` to remove old resolved events

### Batch Size Not Scaling
1. Monitor error rate (needs <5% to scale up)
2. Check worker utilization
3. Check for backpressure conditions
4. Increase `BATCH_MAX_SIZE` if needed

### High Failover Rate
1. Monitor RPC provider response times
2. Check network connectivity
3. Verify RPC URL configuration
4. Consider reducing timeout threshold

### Schema Validation Failing
1. Check event structure matches schema
2. Verify schema version registered
3. Create migration for breaking changes
4. Review validation errors for details

---

## 11. File Reference

| File | Purpose |
|------|---------|
| `batchProcessor.ts` | Dynamic batch processing with parallelism |
| `dlq.ts` | Dead Letter Queue for failed events |
| `rpcProvider.ts` | Multi-RPC with failover and health checks |
| `eventSchema.ts` | Event validation and migration |
| `logger.ts` | Structured logging with Pino |
| `pollerEnhanced.ts` | Integrated enhanced poller |

---

## 12. Documentation

For detailed information, see:

- **Architecture & Design**: `IMPROVEMENTS_IMPLEMENTATION.md`
- **Implementation Summary**: `FOUR_IMPROVEMENTS_SUMMARY.md`
- **Code Examples**: Inline documentation in source files
- **Test Examples**: Test files for usage patterns

---

## 13. Support

- Check logs: `LOG_LEVEL=debug` for detailed output
- Review test files for usage examples
- Check health endpoint: `/health/enhanced`
- Monitor metrics: Use `getPollerHealth()` function

---

## Getting Started (5 Minutes)

```bash
# 1. Update imports in index.ts
sed -i "s/import { pollEvents }/import { pollEventsEnhanced as pollEvents }/" src/index.ts

# 2. Set environment variables
export SOROBAN_RPC_URLS="https://soroban-testnet.stellar.org"
export BATCH_MAX_WORKERS=4

# 3. Run migrations (if needed)
cd ../backend && npm run migrate:up && cd ../indexer

# 4. Start the enhanced indexer
npm run dev

# 5. Check health
curl http://localhost:3001/health/enhanced
```

That's it! The enhanced indexer is now running with all four improvements.
