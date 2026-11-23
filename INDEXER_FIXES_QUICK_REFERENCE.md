# Indexer Fixes - Quick Reference Guide

## What Was Fixed

### 1. ✅ Health Monitoring - COMPLETE
**Problem**: No detailed health monitoring for liveness/readiness probes

**Solution**:
- Separate liveness (`/healthz/live`) and readiness (`/healthz/ready`) probes
- Database and RPC dependency health checks
- Stale cursor detection (5-minute threshold)
- Detailed readiness reasons for debugging

**Key Files**: `src/health.ts`

**Endpoints**:
```
GET /healthz/live       - Returns 200 if process alive
GET /healthz/ready      - Returns 200/503 + dependency status
GET /health             - Legacy unified endpoint
```

---

### 2. ✅ Event Processing Metrics - COMPLETE
**Problem**: No detailed metrics for event processing performance

**Solution**:
- Track latency (min/max/avg) for events and batches
- Measure throughput (events/sec, batches/min)
- Calculate error rates (% failed events/batches)
- Monitor queue depth
- Prometheus-compatible output format

**Key Files**: `src/metrics.ts`

**Endpoints**:
```
GET /metrics/events     - JSON metrics snapshot
GET /metrics            - Prometheus text format
```

**Quick Stats**:
```json
{
  "events": {
    "totalEvents": 45230,
    "failedEvents": 234,
    "errorRate": 0.52,
    "latency": {"min": 5, "max": 2500, "avg": 272}
  },
  "batches": {...},
  "throughput": {
    "eventsPerSecond": 125.45,
    "batchesPerMinute": 4.2
  },
  "queue": {"pendingEvents": 0}
}
```

---

### 3. ✅ Checkpoint Recovery - COMPLETE
**Problem**: Service restarts lose progress and must re-process from start

**Solution**:
- Create checkpoints every N events (default: 1000)
- Store ledger sequence, paging token, batch info
- Automatic recovery to latest checkpoint on startup
- Keep N most recent checkpoints (default: 10)
- Manual recovery to specific checkpoint available

**Key Files**: `src/checkpointRecovery.ts`

**Endpoints**:
```
GET /checkpoints/status - View checkpoint stats and recovery info
```

**Configuration**:
```bash
CHECKPOINT_INTERVAL_EVENTS=1000    # Create checkpoint every 1k events
MAX_CHECKPOINTS_TO_KEEP=10         # Keep last 10 checkpoints
```

**Recovery Workflow**:
1. Service starts → loads latest checkpoint
2. Resume polling from saved cursor/ledger
3. Process events normally
4. Create new checkpoint at interval
5. On restart → repeat from step 1

---

### 4. ✅ Event Filtering & Sampling - COMPLETE
**Problem**: Processing/storing unnecessary events, no cost reduction

**Solution**:
- Filter by event type, contract, ledger range
- Multiple sampling strategies:
  - **Random**: Keep random % (e.g., 10%)
  - **Systematic**: Keep every Nth event
  - **Adaptive**: Auto-sample when queue depth exceeds threshold
- Pre-configured presets (invoices, markets, trades)
- Estimated reduction percentage

**Key Files**: `src/eventFiltering.ts`

**Endpoints**:
```
GET /filtering/status   - View current filter and sampling config
```

**Usage Examples**:

```typescript
// Filter by event type
setEventFilter({ eventTypes: ['submitted', 'paid'] });

// Enable adaptive sampling
enableAdaptiveSampling(1000, 0.5); // Sample at 50% when queue > 1000

// Apply to events
const filtered = filterAndSampleEvents(events, queueDepth);

// Get efficiency stats
const stats = getFilteringStats();
// -> { estimatedReductionPercent: 65 }
```

---

## Health Check Flow

```
Client Request
    ↓
/healthz/live
    ├─ isLive() → Always true
    └─ Return 200

/healthz/ready
    ├─ Check database connectivity ✓
    ├─ Check RPC health ✓
    ├─ Check cursor age (< 5 min) ✓
    ├─ Check if ledger processed ✓
    └─ Return 200 (ready) or 503 (not ready)
```

---

## Key Metrics Explained

| Metric | What It Means | Alert If |
|--------|--------------|----------|
| `errorRate` (events) | % of events that failed | > 10% |
| `latency` (avg) | Average time to process event | > 1000ms |
| `throughput` (events/sec) | How many events/second | < 10 events/sec |
| `queue.pendingEvents` | Backlog of unprocessed events | > 10000 |
| `dependencies.database.healthy` | DB is responding | false |
| `dependencies.rpc.healthy` | RPC is responding | false |

---

## Filtering Strategy Comparison

| Strategy | Use Case | Reduction | Real-time Adjustment |
|----------|----------|-----------|----------------------|
| **Event Type** | Only track invoices | 50-90% | Manual |
| **Contract** | Multi-contract setup | 40-80% | Manual |
| **Random (10%)** | Statistical sample | 90% | Fixed |
| **Systematic (1 in 10)** | Regular sampling | 90% | Fixed |
| **Adaptive** | Handle spikes | Dynamic | Automatic |

---

## Quick Start

### 1. Deploy and Monitor Health
```bash
# Check if ready
curl http://localhost:8080/healthz/ready

# View dependencies
curl http://localhost:8080/health
```

### 2. Monitor Metrics
```bash
# Get JSON metrics
curl http://localhost:8080/metrics/events

# Get Prometheus format (for scraper)
curl http://localhost:8080/metrics
```

### 3. View Recovery Status
```bash
# Check checkpoints
curl http://localhost:8080/checkpoints/status
```

### 4. Configure Filtering (if needed)
```bash
# Enable sampling when queue backs up
curl -X POST http://localhost:8080/config/filtering \
  -H "Content-Type: application/json" \
  -d '{
    "strategy": "adaptive",
    "threshold": 1000,
    "sampleRate": 0.5
  }'
```

---

## Kubernetes Integration

### Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /healthz/live
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

### Readiness Probe
```yaml
readinessProbe:
  httpGet:
    path: /healthz/ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 2
```

---

## Testing

Run test suites:
```bash
npm test
```

Test files:
- `src/__tests__/metrics.test.ts` - 15+ metric tests
- `src/__tests__/checkpointRecovery.test.ts` - 12+ recovery tests
- `src/__tests__/eventFiltering.test.ts` - 18+ filtering tests

---

## Environment Variables

```bash
# Health monitoring
MAX_CURSOR_AGE_MS=300000                # 5 minutes
MAX_DEPENDENCY_CHECK_AGE_MS=30000       # 30 seconds

# Checkpoint recovery
CHECKPOINT_INTERVAL_EVENTS=1000         # Events between checkpoints
MAX_CHECKPOINTS_TO_KEEP=10              # Retain last N checkpoints

# Backoff (existing)
POLLER_MIN_BACKOFF_MS=1000
POLLER_MAX_BACKOFF_MS=300000
POLLER_BACKOFF_MULTIPLIER=2

# RPC (existing)
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
FACTORY_CONTRACT_ADDRESS=<contract-id>
```

---

## Typical Metrics Baseline

When running normally:

| Metric | Typical Value |
|--------|---------------|
| Event error rate | < 1% |
| Batch error rate | < 5% |
| Avg event latency | 50-200ms |
| Avg batch latency | 500-2000ms |
| Events/sec throughput | 50-200 |
| Queue depth | < 100 |
| Database health | true |
| RPC health | true |

---

## Troubleshooting

### Service not ready?
```bash
curl http://localhost:8080/healthz/ready

# Response will show:
# - Database health status
# - RPC health status
# - Why it's not ready (in "reasons" array)
```

### High error rate?
```bash
curl http://localhost:8080/metrics/events

# Check:
# - events.errorRate
# - events.failedEvents
# - batches.errorRate
```

### Queue backing up?
```bash
curl http://localhost:8080/metrics/events | grep pendingEvents

# If high, consider:
# - Enabling adaptive sampling
# - Filtering event types
# - Increasing processing capacity
```

### Can't recover from checkpoint?
```bash
curl http://localhost:8080/checkpoints/status

# Check:
# - totalCheckpoints > 0
# - recoveryEnabled = true
# - Latest checkpoint timestamp
```

---

## Files Changed

**New**:
- `src/metrics.ts` - All metrics logic
- `src/checkpointRecovery.ts` - Checkpoint management
- `src/eventFiltering.ts` - Filtering/sampling strategies
- `src/__tests__/metrics.test.ts` - Metrics tests
- `src/__tests__/checkpointRecovery.test.ts` - Recovery tests
- `src/__tests__/eventFiltering.test.ts` - Filtering tests

**Modified**:
- `src/health.ts` - Enhanced with dependency checks
- `src/db.ts` - Added database health check
- `src/poller.ts` - Integrated new modules
- `src/server.ts` - Added new endpoints

---

## Support Resources

- **Full Documentation**: See `IMPLEMENTATION_SUMMARY.md`
- **Source Code**: All modules have detailed comments
- **Tests**: Over 40 test cases cover all functionality
- **Prometheus Metrics**: Standard Prometheus exposition format

---

## Benefits Summary

| Issue | Before | After |
|-------|--------|-------|
| Health visibility | Basic checks only | Full dependency tracking |
| Performance metrics | None | Complete latency/throughput/error tracking |
| Failure recovery | Full re-index | Resume from last checkpoint |
| Data volume | All events stored | 50-90% reduction possible |
| Kubernetes integration | Limited | Full health probe support |
| Cost | Highest | Lowest (with filtering) |
