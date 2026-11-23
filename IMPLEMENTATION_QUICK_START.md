# Quick Start: Four Critical Features

## Feature 1: Advanced Search ⭐

### Use in Frontend Component
```typescript
import { useAdvancedSearch } from '@/hooks/useAdvancedSearch';

export function MarketSearchPage() {
  const { results, facets, search, setSearch, filters, setFilters, isLoading } = useAdvancedSearch();

  return (
    <div>
      {/* Search input */}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search markets..." />

      {/* Faceted filters */}
      {facets?.categories.map((cat) => (
        <label key={cat.value}>
          <input
            type="checkbox"
            onChange={(e) => {
              if (e.target.checked) {
                setFilters({ ...filters, categories: [...(filters.categories || []), cat.value as string] });
              }
            }}
          />
          {cat.name} ({cat.count})
        </label>
      ))}

      {/* Results with highlighting */}
      {results.map((r) => (
        <div key={r.market.id}>
          <h3>{r.market.fighter_a_name} vs {r.market.fighter_b_name}</h3>
          <p>Relevance: {r.score}</p>
          {r.highlights?.map((h, i) => (
            <p key={i}>{h.field}: {h.snippet}</p>
          ))}
        </div>
      ))}
    </div>
  );
}
```

### API Response
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "market": { /* full market object */ },
        "highlights": [
          { "field": "fighter_a_name", "snippet": "...found <mark>Floyd</mark> Mayweather..." }
        ],
        "score": 2.45
      }
    ],
    "facets": {
      "categories": [
        { "name": "BOXING", "value": "BOXING", "count": 42 }
      ],
      "statuses": [
        { "name": "OPEN", "value": "open", "count": 23 }
      ],
      "dateRanges": [
        { "name": "Next 7 days", "value": "7d", "count": 15 }
      ]
    },
    "total": 156,
    "page": 1,
    "limit": 20
  }
}
```

---

## Feature 2: URL State Synchronization 🔗

### Use in Any Component
```typescript
import { useUrlState, useSearchState } from '@/hooks/useUrlState';

export function MyComponent() {
  // Single parameter
  const [search, setSearch] = useUrlState('q', {
    encode: (v) => v,
    decode: (v) => v,
  });

  // Multiple parameters
  const [filters, setFilters] = useUrlState('filters', {
    encode: (obj) => JSON.stringify(obj),
    decode: (str) => JSON.parse(str),
  });

  // Pre-configured for search
  const { search, setSearch, filters, setFilters, page, setPage } = useSearchState();

  // URL automatically updates: ?q=floyd&filters=%7B%7D&page=1
  // Back/forward buttons work automatically!
}
```

### Example URLs
```
# Search with filters
/markets?q=mayweather&categories=BOXING&page=1&limit=20

# Filter by status
/markets?filters={"status":"open"}&page=2

# Full example
/markets?q=boxing&filters={"minPool":5000}&page=1&limit=50
```

### Features
- ✅ Bookmarkable: Shares all state in URL
- ✅ History: Back/forward buttons work
- ✅ Shareable: Send URL to friends - they see same view
- ✅ Refreshable: F5 restores exact state

---

## Feature 3: Adaptive Event Polling 📊

### Monitoring Polling Health
```bash
# Get polling health endpoint
curl http://localhost:3000/healthz/ready

# Response includes polling metrics:
# - currentPollingIntervalMs: 5000
# - eventsProcessed: 1523
# - consecutiveFailures: 0
# - averageEventsPerPoll: 12.4
```

### Configuration
Set in `.env`:
```bash
# Polling intervals (milliseconds)
POLLING_MIN_INTERVAL_MS=1000      # Don't poll faster than 1s
POLLING_MAX_INTERVAL_MS=60000     # Don't poll slower than 60s
POLLING_INITIAL_INTERVAL_MS=5000  # Start at 5s

# Adaptation rates
POLLING_ERROR_MULTIPLIER=1.5      # Increase interval 50% on error
POLLING_SUCCESS_DIVISOR=1.2       # Decrease interval 20% on events

# Circuit breaker
POLLING_MAX_ERRORS=10             # Stop after 10 consecutive errors
POLLING_RECOVERY_MULTIPLIER=0.9   # Gradually reduce on success
```

### Behavior Examples

**High Activity**: Many events found
```
5000ms → 4166ms → 3472ms → 2893ms
(Adaptive: faster polling to catch events)
```

**Low Activity**: Few/no events
```
5000ms → 5000ms → 5000ms → 6000ms
(Adaptive: slower polling to save resources)
```

**Error Recovery**: Connection failures
```
5000ms → 7500ms → 11250ms → 16875ms
(Exponential: back off aggressively)
After recovery:
16875ms → 15187ms → 13668ms (gradual reset)
```

---

## Feature 4: Exactly-Once Event Processing ✔️

### Automatic Deduplication
Events are automatically deduplicated by:
1. Unique event ID: `ledger:txIndex:eventIndex`
2. In-memory cache for fast lookup
3. Database storage for persistence
4. Ordering validation

### Database Schema
```sql
-- Automatically created by migration
CREATE TABLE processed_events (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(255) UNIQUE NOT NULL,  -- "100:0:0"
  ledger_sequence BIGINT NOT NULL,
  tx_index INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  event_data JSONB NOT NULL,
  processed_at TIMESTAMP NOT NULL
);

-- Ensures ordering is preserved
CREATE UNIQUE INDEX idx_processed_events_ledger_tx_event
  ON processed_events(ledger_sequence, tx_index, event_index);
```

### Run Migration
```bash
cd backend
psql -U postgres -d bankerchanger -f pgmigrations/add_processed_events_table.sql
```

### Monitoring
```bash
# Check event processing stats
curl http://localhost:3001/api/indexer/events/stats

# Response:
{
  "totalProcessed": 15234,
  "duplicatesDetected": 42,
  "orderingViolations": 0,
  "failedProcessing": 3
}
```

---

## Testing All Features

### Frontend Tests
```bash
cd frontend
npm test -- search.test.ts           # Search functionality
npm test -- useUrlState.test.ts      # URL state synchronization
npm test -- useAdvancedSearch.test.ts # Integration test
```

### Backend Tests
```bash
cd backend
npm test -- search.test.ts           # Search controller

cd ../indexer
npm test -- adaptivePolling.test.ts   # Polling behavior
npm test -- eventProcessing.test.ts   # Event deduplication
```

---

## Deployment Checklist

- [ ] Pull latest changes
- [ ] Install dependencies: `npm install` (all packages)
- [ ] Run database migration: `psql ... add_processed_events_table.sql`
- [ ] Set environment variables (see Feature 3)
- [ ] Build: `npm run build` (frontend + backend)
- [ ] Run tests: `npm test`
- [ ] Deploy frontend to CDN/server
- [ ] Deploy backend to production
- [ ] Deploy indexer
- [ ] Verify health endpoints:
  - [ ] `/healthz/ready` returns 200
  - [ ] `/api/markets/search/advanced?q=test` returns results
  - [ ] `/api/markets/search/facets` returns facets

---

## Troubleshooting

### Search not returning results
1. Check database has fts column: `SELECT fts FROM markets LIMIT 1;`
2. Run migration if missing
3. Verify query: `curl 'http://localhost:3001/api/markets/search/advanced?q=boxing'`

### URL state not updating
1. Check component is using `useUrlState` hook
2. Verify URL shows query parameters
3. Check browser console for errors
4. Ensure `next/navigation` is imported

### Polling too fast/slow
1. Check environment variables are set
2. Verify `POLLING_*` variables in `.env`
3. Restart indexer for changes to take effect
4. Check `/healthz/ready` endpoint for current interval

### Events being processed multiple times
1. Check `processed_events` table exists
2. Verify database migration ran
3. Check for errors in indexer logs
4. Monitor stats: `totalProcessed` should match unique events

---

## Performance Targets

### Search
- Query execution: <100ms
- Facet generation: <50ms
- Full API response: <200ms
- Caching: 60s for results, 300s for facets

### Polling
- Initial interval: 5 seconds
- Adaptive range: 1-60 seconds
- Error recovery: Exponential up to 60s
- Memory: <50MB for 24-hour cache

### Event Processing
- Deduplication: <1ms per event
- Ordering validation: <0.1ms
- Database write: <5ms
- Batch processing: 100 events/second

---

## Support

For issues or questions:
1. Check this guide first
2. Review `IMPLEMENTATION_SUMMARY.md` for details
3. Check test files for usage examples
4. Look at implementation files for documentation
