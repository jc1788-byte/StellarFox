# Performance Optimization - Quick Start Guide

## 🚀 Quick Implementation (5 minutes)

### Backend Setup

```typescript
// In src/index.ts, after creating app and pool:

import { installQueryMonitor } from './middleware/query-monitoring';
import { startMemoryMonitoring, setupMemoryPressureAlert } from './services/memory-leak-detection.service';
import performanceRouter from './routes/performance.routes';

// 1. Enable query monitoring
installQueryMonitor(pool, { slowThresholdMs: 100 });

// 2. Start memory monitoring
startMemoryMonitoring(30000);
setupMemoryPressureAlert(85, 10000);

// 3. Add performance routes
app.use('/admin/performance', performanceRouter); // Protect this with auth!

// 4. Add caching middleware to key routes
import { cacheMarket, cacheMarketList } from './middleware/cache.middleware';
app.get('/markets/:id', cacheMarket(30), getMarket);
app.get('/markets', cacheMarketList(10), listMarkets);
```

### Frontend Setup

```bash
cd frontend
npm install @next/bundle-analyzer
```

Then in your project, use dynamic imports:

```typescript
import dynamic from 'next/dynamic';

const Dashboard = dynamic(() => import('./pages/Dashboard'), {
  loading: () => <Spinner />,
});
```

## 📊 Monitor Performance

### View Metrics

```bash
# Memory status
curl http://localhost:4000/admin/performance/health

# Slow queries
curl http://localhost:4000/admin/performance/queries?limit=10

# Cache stats
curl http://localhost:4000/admin/performance/cache

# Full report
curl http://localhost:4000/admin/performance/report
```

### Analyze Bundle

```bash
cd frontend
ANALYZE=true npm run build
# Open analyze/client.html
```

## 🔍 Common Tasks

### Add Caching to a Route

```typescript
import { cacheAside } from './services/cache-strategy.service';

app.get('/my-endpoint', async (req, res) => {
  const data = await cacheAside(
    'my-key',
    () => expensiveQuery(),
    { ttl: 300 } // 5 minutes
  );
  res.json(data);
});
```

### Invalidate Cache on Update

```typescript
import { smartInvalidate } from './services/cache-strategy.service';

app.put('/markets/:id', async (req, res) => {
  const market = await updateMarket(req.params.id, req.body);
  await smartInvalidate('market', req.params.id); // ← Invalidate related caches
  res.json(market);
});
```

### Prevent N+1 Queries

```typescript
import { DataLoader } from './services/query-optimization.service';

const marketLoader = new DataLoader(async (ids) => {
  const result = await pool.query(
    'SELECT * FROM markets WHERE market_id = ANY($1)',
    [ids]
  );
  const map = new Map();
  result.rows.forEach(row => map.set(row.market_id, row));
  return map;
});

// Later, all these loads are batched into one query:
const market1 = await marketLoader.load('id1');
const market2 = await marketLoader.load('id2');
const market3 = await marketLoader.load('id3');
```

### Profile Memory Usage

```typescript
import { MemoryProfiler } from './services/memory-leak-detection.service';

const profiler = new MemoryProfiler();
profiler.start();

// ... your code ...

const result = profiler.end();
console.log(`Heap growth: ${result.heapGrowth / 1024 / 1024}MB`);
console.log(`Recommendation: ${result.recommendation}`);
```

### Check for Memory Leaks

```bash
# Capture heap snapshot
curl -X POST http://localhost:4000/admin/performance/memory/snapshot

# Get memory status
curl http://localhost:4000/admin/performance/memory
```

## 📈 Key Metrics to Watch

| Metric | Target | How to Check |
|--------|--------|------------|
| Cache Hit Rate | > 80% | `GET /performance/cache` |
| Slow Queries | < 5% | `GET /performance/queries` |
| Memory Growth | < 1MB/min | `GET /performance/memory` |
| Bundle Size | < 500KB | `ANALYZE=true npm run build` |
| Heap Pressure | < 85% | `GET /performance/health` |

## 🚨 Troubleshooting

### Q: Cache not working?
A: Check if invalidation is called on updates
```typescript
await smartInvalidate('your:key:*');
```

### Q: High memory usage?
A: Get memory status
```bash
curl http://localhost:4000/admin/performance/memory/snapshot
```

### Q: Slow database queries?
A: Check recommendations
```bash
curl http://localhost:4000/admin/performance/recommendations
```

### Q: Large bundle?
A: Run analysis
```bash
ANALYZE=true npm run build
# View analyze/client.html
```

## 📚 Full Documentation

- **Detailed Guide**: `PERFORMANCE_OPTIMIZATION_GUIDE.md`
- **Implementation Details**: `PERFORMANCE_IMPLEMENTATION_SUMMARY.md`
- **Tests**: `backend/tests/performance/optimization.test.ts`

## 🎯 Best Practices

1. **Cache everything read-heavy** - Lists, aggregations, derived data
2. **Keep user data TTL short** - 1-5 minutes maximum
3. **Monitor regularly** - Check metrics weekly
4. **Always invalidate** - Clear cache when data changes
5. **Profile before optimizing** - Let metrics guide decisions

## 📋 Integration Checklist

- [ ] Import services in `src/index.ts`
- [ ] Enable query monitoring
- [ ] Start memory monitoring
- [ ] Add performance routes (protected)
- [ ] Add caching middleware to key routes
- [ ] Implement invalidation on updates
- [ ] Add caching to expensive queries
- [ ] Configure memory pressure alerts
- [ ] Set up monitoring dashboard
- [ ] Test with load testing

## 🔗 Related Files

- Backend Services:
  - `src/services/query-optimization.service.ts`
  - `src/services/cache-strategy.service.ts`
  - `src/services/memory-leak-detection.service.ts`
  - `src/routes/performance.routes.ts`

- Frontend:
  - `src/utils/bundle-analysis.ts`
  - `next.config.js`

- Tests:
  - `tests/performance/optimization.test.ts`

## 💡 Pro Tips

1. **Use tiered caching** for frequently accessed data
   ```typescript
   const cache = new TieredCache(key, fetch, config);
   ```

2. **Warm cache at startup**
   ```typescript
   await warmCache([{ key: 'popular:data', fetchFn: () => {...}, ttl: 300 }]);
   ```

3. **Lock on expensive operations** (prevent thundering herd)
   ```typescript
   await withCacheLock(key, 30, computeFn);
   ```

4. **Monitor in real-time**
   ```bash
   curl http://localhost:4000/admin/performance/report | jq
   ```

5. **Route-split on frontend**
   ```typescript
   const Page = dynamic(() => import('./pages/Page'));
   ```

---

**Ready to optimize?** Start with the Backend Setup above, then monitor with the performance endpoints!
