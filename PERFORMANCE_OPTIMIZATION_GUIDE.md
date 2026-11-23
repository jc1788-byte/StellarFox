# Performance Optimization Guide

This document describes the comprehensive performance optimization implementations for StellarFox covering bundle analysis, database queries, memory leak detection, and caching strategies.

## Table of Contents

1. [Bundle Analysis & Optimization](#437-bundle-analysis--optimization)
2. [Database Query Optimization](#438-database-query-optimization)
3. [Memory Leak Detection](#439-memory-leak-detection)
4. [Request Caching Strategy](#440-request-caching-strategy)

---

## #437: Bundle Analysis & Optimization

### Overview

Automated bundle analysis and code splitting optimization for the Next.js frontend to reduce initial load time and improve performance metrics.

### Files

- `frontend/next.config.js` - Next.js configuration with bundle analyzer integration
- `frontend/src/utils/bundle-analysis.ts` - Bundle analysis utilities and tools

### Features

#### 1. Automated Bundle Analysis

Enable bundle analysis:

```bash
cd frontend
ANALYZE=true npm run build
```

This generates `analyze/client.html` and `analyze/server.html` with visual bundle breakdowns.

#### 2. Code Splitting Strategies

**Route-based splitting (Recommended):**

```typescript
import dynamic from 'next/dynamic';

const Dashboard = dynamic(() => import('./pages/Dashboard'), {
  loading: () => <Spinner />,
});

const Analytics = dynamic(() => import('./pages/Analytics'), {
  loading: () => <Spinner />,
});
```

**Component-based splitting for heavy components:**

```typescript
const HeavyChart = dynamic(() => import('./components/HeavyChart'), {
  ssr: false, // Don't render on server
  loading: () => <ChartSkeleton />,
});
```

#### 3. Performance Budgeting

Track bundle size against performance targets:

```typescript
import { budgetTracker, BudgetTracker, DEFAULT_BUDGET } from '@/utils/bundle-analysis';

// Default budget (can be customized)
const customBudget: PerformanceBudget = {
  maxBundleSize: 400 * 1024,      // 400KB
  maxChunkSize: 150 * 1024,       // 150KB
  maxChunkLoadTime: 1500,         // 1.5 seconds
  maxInitialLoadTime: 3000,       // 3 seconds
};

const tracker = new BudgetTracker(customBudget);
tracker.checkChunkSize('analytics', fileSizeBytes);
```

#### 4. Chunk Load Monitoring

Track real-world chunk loading performance:

```typescript
import { createDynamicImport } from '@/utils/bundle-analysis';

const SafeChartImport = createDynamicImport(
  () => import('./components/Chart'),
  'Chart'
);

// Reports load time automatically
const ChartComponent = await SafeChartImport();
```

#### 5. Code Splitting Recommendations

Get actionable recommendations:

```typescript
import { bundleAnalyzer } from '@/utils/bundle-analysis';

const recommendations = bundleAnalyzer.getCodeSplittingRecommendations();
// Returns: ['Large modules found: Chart.js (250KB)', 'Break circular imports...']
```

### Next.js Optimizations Configured

- **Image optimization**: AVIF/WebP formats, responsive sizing
- **Font optimization**: Google Fonts with subsetting
- **Script optimization**: Lazy-load third-party scripts
- **Caching headers**: 1-year cache for immutable assets
- **Tree-shaking**: Automatic dead code elimination
- **Module concatenation**: Webpack scope hoisting

### Best Practices

1. **Use dynamic imports for routes**: Each route gets its own chunk
2. **Lazy-load libraries**: Delay loading charts, maps, editors
3. **Monitor bundle size**: Add bundle checks to CI/CD
4. **Split vendor code**: Keep vendor bundles separate
5. **Preload critical chunks**: Use `Link` for route prefetching

### Monitoring

Monitor bundle metrics in production:

```typescript
import { reportBundleAnalytics } from '@/utils/bundle-analysis';

const analytics = reportBundleAnalytics();
// Send to your monitoring service
sendToMonitoring(analytics);
```

---

## #438: Database Query Optimization

### Overview

Comprehensive database optimization with query caching, N+1 prevention, indexing strategies, and performance monitoring.

### Files

- `backend/src/services/query-optimization.service.ts` - Query optimization strategies
- `backend/src/middleware/query-monitoring.ts` - Query performance tracking

### Features

#### 1. Query Performance Monitoring

Monitor slow queries automatically:

```typescript
import { installQueryMonitor } from './middleware/query-monitoring';
import { pool } from './config/db';

// Call once at app startup
installQueryMonitor(pool, {
  slowThresholdMs: 100, // Log queries slower than 100ms
  ignorePatterns: [/^SELECT 1\b/i], // Ignore health checks
});
```

Slow queries are logged with:
- Query fingerprint (normalized to group similar queries)
- Execution time
- Operation type (SELECT/INSERT/UPDATE/DELETE)
- Prometheus metrics for monitoring

#### 2. Cached Query Execution

Cache query results with automatic TTL:

```typescript
import { executeCachedQuery } from './services/query-optimization.service';

const markets = await executeCachedQuery<Market>(
  'markets:list:popular',
  'SELECT * FROM markets WHERE status = $1 LIMIT 20',
  ['open'],
  300 // 5-minute TTL
);
```

#### 3. Prevent N+1 Queries with Batch Loading

Load related records in a single query instead of one-per-row:

```typescript
import { DataLoader } from './services/query-optimization.service';

// Load all markets for a list of market_ids efficiently
const marketLoader = new DataLoader(async (marketIds) => {
  const result = await pool.query(
    `SELECT * FROM markets WHERE market_id = ANY($1)`,
    [marketIds]
  );
  const map = new Map();
  result.rows.forEach(row => map.set(row.market_id, row));
  return map;
});

// Use it
const markets = await Promise.all([
  marketLoader.load('market1'),
  marketLoader.load('market2'),
  marketLoader.load('market3'),
]); // All loaded in one query!
```

#### 4. Query Statistics and Analysis

Enable query statistics tracking:

```typescript
import { 
  enableQueryStats, 
  getTopSlowQueries,
  getOptimizationRecommendations 
} from './services/query-optimization.service';

// At startup
await enableQueryStats();

// Later, get insights
const slowQueries = await getTopSlowQueries(10);
const recommendations = await getOptimizationRecommendations();
```

#### 5. Index Recommendations

Get actionable index suggestions:

```typescript
import { suggestIndexes } from './services/query-optimization.service';

const suggestions = await suggestIndexes('markets');
// Returns: ['CREATE INDEX idx_markets_status ON markets(status);', ...]
```

### Indexing Strategy

The schema already has many indexes. Here's the indexing strategy:

**Existing Indexes (Good Coverage):**
- Unique indexes on primary keys and unique constraints
- Indexes on foreign keys (for joins)
- Indexes on frequently filtered columns (status, category)
- Indexes on timestamp columns (for range queries)
- Full-text search index on market text fields

**Additional Recommendations:**
```sql
-- For better performance on common queries:

-- Markets status + scheduled_at for sorting
CREATE INDEX idx_markets_status_scheduled ON markets(status, scheduled_at DESC);

-- Bets for claimed queries with filtering
CREATE INDEX idx_bets_market_claimed ON bets(market_id, claimed);

-- Probability snapshots for time-series queries
CREATE INDEX idx_probability_snapshots_time_range ON probability_snapshots(sampled_at DESC);

-- User sessions for efficient lookups
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
```

### Example: Optimization in Route Handler

```typescript
import { Router } from 'express';
import { executeCachedQuery } from './services/query-optimization.service';
import { pool } from './config/db';

const router = Router();

// GET /markets - with caching and query optimization
router.get('/markets', async (req, res) => {
  const category = req.query.category as string;
  const status = req.query.status as string || 'open';
  
  const cacheKey = `markets:list:${category}:${status}`;
  
  const markets = await executeCachedQuery(
    cacheKey,
    `SELECT * FROM markets 
     WHERE status = $1 
     ${category ? 'AND category = $2' : ''} 
     ORDER BY scheduled_at DESC
     LIMIT 100`,
    category ? [status, category] : [status],
    30 // 30-second TTL for list
  );
  
  res.json(markets);
});

export default router;
```

---

## #439: Memory Leak Detection

### Overview

Comprehensive memory profiling and leak detection with automatic monitoring and alerts.

### Files

- `backend/src/services/memory-leak-detection.service.ts` - Memory profiling and leak detection

### Features

#### 1. Automatic Memory Monitoring

Start memory monitoring at app startup:

```typescript
import { startMemoryMonitoring } from './services/memory-leak-detection.service';

// Monitor memory every 30 seconds
const monitoringInterval = startMemoryMonitoring(30000);

// Stop monitoring if needed
clearInterval(monitoringInterval);
```

Memory monitoring logs:
- Heap usage (used/total)
- Resident set size (RSS)
- External memory
- Memory growth rate
- Potential leak detection

#### 2. Heap Snapshot Analysis

Capture heap snapshots for offline analysis:

```typescript
import { captureHeapSnapshot, analyzeHeapSnapshot } from './services/memory-leak-detection.service';

// Capture snapshot
const filename = await captureHeapSnapshot('./heap-snapshot-2024.heapsnapshot');

// Analyze it
const analysis = await analyzeHeapSnapshot(filename);
console.log(analysis);
// {
//   totalSize: 52428800,
//   objectCounts: { ... },
//   largestObjects: [ ... ]
// }
```

#### 3. Memory Pressure Alerts

Setup critical memory alerts:

```typescript
import { setupMemoryPressureAlert } from './services/memory-leak-detection.service';

setupMemoryPressureAlert(
  85, // Alert when heap usage > 85%
  10000, // Check every 10 seconds
  async (usage, threshold) => {
    // Custom alert handler
    console.error(`Memory pressure: ${usage.toFixed(1)}% > ${threshold}%`);
    // Trigger cleanup, scale up, or alert ops
  }
);
```

#### 4. Force Garbage Collection

For testing and debugging:

```typescript
import { forceGarbageCollection } from './services/memory-leak-detection.service';

// Run with: node --expose-gc app.js
const result = await forceGarbageCollection();
// {
//   heapBefore: 52428800,
//   heapAfter: 41943040,
//   freed: 10485760
// }
```

#### 5. Memory Profiling for Operations

Profile specific code sections:

```typescript
import { MemoryProfiler } from './services/memory-leak-detection.service';

async function expensiveOperation() {
  const profiler = new MemoryProfiler();
  profiler.start();
  
  try {
    // Your expensive code here
    await processLargeDataset();
  } finally {
    const result = profiler.end();
    console.log(`
      Operation duration: ${result.duration}ms
      Heap growth: ${(result.heapGrowth / 1024 / 1024).toFixed(2)}MB
      Recommendation: ${result.recommendation}
    `);
  }
}
```

#### 6. Leak Detection and Tracking

Automatic leak detection:

```typescript
import { getMemoryTrackerStatus } from './services/memory-leak-detection.service';

// Check current status
const status = getMemoryTrackerStatus();
// {
//   stats: { current, heapGrowth, growthRate, peakHeap, minHeap },
//   leak: { isLeaking, confidence, reason },
//   snapshot: { timestamp, heapUsed, heapTotal, ... }
// }

if (status.leak.isLeaking) {
  console.error(`LEAK DETECTED: ${status.leak.reason} (confidence: ${status.leak.confidence * 100}%)`);
}
```

### Common Memory Leak Patterns

#### 1. Unbounded Caches

```typescript
// ❌ BAD - Grows infinitely
const cache = new Map();
app.get('/data/:id', (req, res) => {
  if (!cache.has(req.params.id)) {
    cache.set(req.params.id, expensiveCompute());
  }
  res.json(cache.get(req.params.id));
});

// ✅ GOOD - Use Redis with TTL
import * as cacheService from './services/cache.service';
app.get('/data/:id', (req, res) => {
  const value = await cacheService.getOrSet(
    `data:${req.params.id}`,
    300, // 5-minute TTL
    () => expensiveCompute()
  );
  res.json(value);
});
```

#### 2. Event Listener Leaks

```typescript
// ❌ BAD - Listener never removed
emitter.on('event', handler);

// ✅ GOOD - Clean up listeners
const handler = () => { /* ... */ };
emitter.on('event', handler);
// Later:
emitter.off('event', handler);

// ✅ BETTER - Use once for one-time events
emitter.once('event', handler);
```

#### 3. Dangling Timers

```typescript
// ❌ BAD - Timer never cleared
setInterval(() => expensiveOperation(), 1000);

// ✅ GOOD - Store and clear reference
const interval = setInterval(() => expensiveOperation(), 1000);
// Later:
clearInterval(interval);
```

### Production Setup

```typescript
import express from 'express';
import { startMemoryMonitoring, setupMemoryPressureAlert } from './services/memory-leak-detection.service';

const app = express();

// Start monitoring
startMemoryMonitoring(60000); // Check every minute

// Alert on critical memory pressure
setupMemoryPressureAlert(
  90, // 90% threshold
  30000, // Check every 30 seconds
  async (usage) => {
    // Log to monitoring service
    logger.error('Critical memory pressure', { usage });
    
    // Optional: trigger cleanup
    if (global.gc) global.gc();
  }
);

export default app;
```

---

## #440: Request Caching Strategy

### Overview

Comprehensive multi-pattern caching strategy with cache invalidation, warming, and intelligent TTL management.

### Files

- `backend/src/services/cache-strategy.service.ts` - Advanced caching patterns
- `backend/src/middleware/cache.middleware.ts` - Express caching middleware
- `backend/src/services/cache.service.ts` - Cache operations (get, set, del)

### Features

#### 1. Cache-Aside Pattern (Lazy Loading)

Most common pattern - try cache first, fetch if miss:

```typescript
import { cacheAside } from './services/cache-strategy.service';

app.get('/markets/:id', async (req, res) => {
  const market = await cacheAside(
    `market:${req.params.id}`,
    async () => {
      return await pool.query('SELECT * FROM markets WHERE market_id = $1', [req.params.id]);
    },
    {
      ttl: 300, // 5 minutes
      refreshThreshold: 10, // Proactive refresh after 10 accesses
    }
  );
  
  res.json(market);
});
```

#### 2. Write-Through Pattern (Consistency)

Update source first, then cache - ensures no stale data:

```typescript
import { writeThrough } from './services/cache-strategy.service';

app.put('/markets/:id', async (req, res) => {
  const updated = await writeThrough(
    `market:${req.params.id}`,
    async () => {
      // Update database first
      const result = await pool.query(
        'UPDATE markets SET ... WHERE market_id = $1 RETURNING *',
        [req.params.id, ...]
      );
      return result.rows[0];
    },
    { ttl: 300 }
  );
  
  res.json(updated);
});
```

#### 3. Write-Behind Pattern (Speed)

Fast writes with async durability - risky but high-performance:

```typescript
import { writeBehind } from './services/cache-strategy.service';

app.post('/fast-update', async (req, res) => {
  const data = { ...req.body, id: generateId() };
  
  // Returns immediately after caching
  await writeBehind(
    `queue:${data.id}`,
    data,
    async (data) => {
      // This happens asynchronously
      await pool.query('INSERT INTO logs VALUES ...', [data]);
    },
    { ttl: 3600 }
  );
  
  res.json({ id: data.id, queued: true });
});
```

#### 4. Cache Warming

Proactively load hot data at startup:

```typescript
import { warmCache } from './services/cache-strategy.service';

// In app startup
await warmCache([
  {
    key: 'markets:featured',
    fetchFn: () => pool.query('SELECT * FROM markets WHERE featured = true'),
    ttl: 600,
  },
  {
    key: 'stats:platform',
    fetchFn: () => getAggregatedStats(),
    ttl: 300,
  },
  {
    key: 'config:app',
    fetchFn: () => loadAppConfiguration(),
    ttl: 3600,
  },
]);
```

#### 5. Intelligent Cache Invalidation

Invalidate related cache entries when data changes:

```typescript
import { smartInvalidate } from './services/cache-strategy.service';

app.post('/markets', async (req, res) => {
  const market = await createMarket(req.body);
  
  // Invalidate all related caches
  await smartInvalidate('market', market.id, [
    'markets:list:*',
    'stats:*',
  ]);
  
  res.json(market);
});

app.put('/markets/:id', async (req, res) => {
  const market = await updateMarket(req.params.id, req.body);
  
  // Cascade invalidation
  await smartInvalidate('market', req.params.id);
  
  res.json(market);
});
```

#### 6. Thundering Herd Prevention

Distributed lock to prevent multiple processes computing same expensive result:

```typescript
import { withCacheLock } from './services/cache-strategy.service';

app.get('/expensive-report', async (req, res) => {
  const report = await withCacheLock(
    'report:monthly',
    30, // 30-second lock
    async () => {
      return await computeExpensiveReport();
    }
  );
  
  res.json(report);
});
```

#### 7. Tiered Caching (Memory + Redis + Source)

Three-level cache: memory (fast) → Redis (distributed) → Source (slow):

```typescript
import { TieredCache } from './services/cache-strategy.service';

const leaderboardCache = new TieredCache(
  'leaderboard:global',
  async () => {
    return await pool.query('SELECT ... FROM leaderboard ORDER BY score DESC');
  },
  { ttl: 600 }, // Redis TTL
  120, // Memory cache for 2 minutes
);

app.get('/leaderboard', async (req, res) => {
  const leaderboard = await leaderboardCache.get();
  res.json(leaderboard);
});

// Invalidate all tiers
app.post('/leaderboard-reset', async (req, res) => {
  leaderboardCache.invalidate();
  res.json({ message: 'Leaderboard cache cleared' });
});
```

#### 8. Express Middleware for Route Caching

Simple middleware to cache entire route responses:

```typescript
import { cacheMarket, cacheMarketList } from './middleware/cache.middleware';

app.get('/markets/:market_id', cacheMarket(30), getMarket);
app.get('/markets', cacheMarketList(10), listMarkets);
app.get('/markets/:market_id/stats', cacheMarketStats(60), getMarketStats);
app.get('/platform/stats', cachePlatformStats(60), getPlatformStats);
```

#### 9. Cache Statistics and Monitoring

Monitor cache performance:

```typescript
import { getCacheStats } from './services/cache-strategy.service';

app.get('/admin/cache-stats', async (req, res) => {
  const stats = await getCacheStats();
  // {
  //   memoryUsage: "127MB",
  //   keyCount: 1542,
  //   hitRate: 0.87
  // }
  res.json(stats);
});
```

### Caching Strategy by Use Case

#### Markets List (Frequently Accessed, Low-Priority Freshness)

```typescript
// Cache for 30 seconds, use cache-aside
const markets = await cacheAside(
  `markets:list:${status}:${category}`,
  () => fetchMarkets(status, category),
  { ttl: 30, refreshThreshold: 5 }
);
```

#### Leaderboard (Moderately Fresh, Hot Data)

```typescript
// Warm on startup, update via events
const leaderboard = await cacheAside(
  'leaderboard:global',
  () => fetchLeaderboard(),
  { ttl: 300 }
);

// When score changes, invalidate
await smartInvalidate('leaderboard');
```

#### User Portfolio (Personal Data, High-Freshness)

```typescript
// Write-through for consistency
const portfolio = await writeThrough(
  `portfolio:${userId}`,
  () => computePortfolio(userId),
  { ttl: 60 } // Short TTL for freshness
);
```

#### Platform Statistics (Expensive, Rarely Changes)

```typescript
// Cache warming + long TTL
await warmCache([{
  key: 'stats:platform',
  fetchFn: computeStats,
  ttl: 3600, // 1 hour
}]);
```

### Best Practices

1. **Cache everything read-heavy, invalidate selectively**
   - Lists, aggregations, derived data
   - Invalidate on writes affecting the data

2. **Keep TTL short for user-specific data** (1-5 minutes)
   - Ensures freshness while reducing load
   - Prevents stale user state

3. **Use cache-aside for most cases**
   - Simplest to implement
   - Handles cache failures gracefully

4. **Use write-through for consistency-critical operations**
   - Never return stale data to users
   - E.g., user settings, confirmed transactions

5. **Monitor cache hit rate**
   - Target > 80% hit rate for hot data
   - < 50% means cache TTL or strategy needs adjustment

6. **Set memory limits on Redis**
   - Configure eviction policy (LRU recommended)
   - Monitor Redis memory usage

7. **Plan cache invalidation strategies early**
   - Document which caches to clear on each update
   - Prevent cascading cache staleness

### Monitoring and Debugging

```typescript
import { redis } from './config/redis';

// Check cache size
const dbSize = await redis.dbsize();

// Monitor top keys
const topKeys = await redis.info('keyspace');

// Check memory usage
const memInfo = await redis.info('memory');

// Flush cache (development only!)
await redis.flushdb();
```

---

## Integration Checklist

- [ ] Enable query monitoring in backend startup
- [ ] Deploy bundle analysis configuration to frontend
- [ ] Start memory monitoring in app initialization
- [ ] Add caching middleware to key routes
- [ ] Set up cache invalidation in update routes
- [ ] Configure Redis connection pool
- [ ] Add performance monitoring dashboards
- [ ] Document caching strategy for team
- [ ] Set up alerts for memory pressure and slow queries
- [ ] Create runbook for cache invalidation issues

## Monitoring and Alerting

### Key Metrics to Monitor

**Backend:**
- Query duration (p50, p95, p99)
- Slow query count
- Cache hit rate
- Memory usage and growth rate
- GC pause duration

**Frontend:**
- Bundle size (initial, total, by chunk)
- First Contentful Paint (FCP)
- Largest Contentful Paint (LCP)
- Time to Interactive (TTI)
- Chunk load times

### Recommended Dashboards

1. Database Performance: Slow queries, query types, top tables
2. Memory: Heap usage, growth rate, leak detection
3. Cache: Hit rate, key count, memory usage
4. Bundle: Size trends, chunk sizes, code coverage
5. User Experience: Web Vitals, page load times

## Testing Performance Optimizations

```bash
# Frontend bundle size
cd frontend
ANALYZE=true npm run build

# Backend query performance
cd backend
npm run benchmark:markets

# Memory leak detection (requires --expose-gc)
node --expose-gc dist/index.js

# Load testing
npm run test:autoscaling:cluster
```

---

## Troubleshooting

### High Memory Usage

1. Check for memory leaks using heap snapshot
2. Review DataLoader batch sizes
3. Check cache TTL settings
4. Monitor unbounded arrays/maps in code

### Slow Queries

1. Check query-monitoring logs for fingerprints
2. Run `EXPLAIN ANALYZE` on slow queries
3. Create suggested indexes
4. Consider caching or query rewrite

### Cache Inconsistency

1. Verify invalidation patterns are called
2. Check cache TTL configuration
3. Ensure write-through for critical paths
4. Check Redis connection status

### Large Bundle

1. Run bundle analyzer: `ANALYZE=true npm run build`
2. Identify large dependencies
3. Implement route-based code splitting
4. Consider library alternatives with smaller footprint

---

## References

- [Next.js Performance Optimization](https://nextjs.org/learn/seo/introduction-to-seo)
- [PostgreSQL Query Optimization](https://www.postgresql.org/docs/current/sql-explain.html)
- [Node.js Memory Management](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Redis Best Practices](https://redis.io/docs/management/optimization/)
