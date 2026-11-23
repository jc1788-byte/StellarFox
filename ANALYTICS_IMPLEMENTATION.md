# User Analytics, Session Recording, and Heatmap Generation Implementation

## Overview

This implementation provides a comprehensive analytics system for UX optimization, including:

- **User Session Tracking**: Monitor user sessions with browser, OS, and device information
- **Event Tracking**: Track user interactions and custom events
- **Heatmap Generation**: Visualize where users click, scroll, hover, and move their mouse
- **Session Analytics Aggregation**: Daily summaries of user activity
- **Page Analytics**: Track page views, bounce rates, time on page, and conversion metrics
- **Custom Event Tracking**: Track business-specific events like conversions, form submissions, and errors
- **Session Recordings**: Record user interactions for playback and analysis

## Architecture

### Backend Components

#### Database Schema (Migration 1770000000000_add-user-analytics.js)

**Tables Created:**

1. **user_sessions**: Stores session metadata
   - session_id (UUID)
   - user_id, browser, OS, device info
   - start/end times, duration
   - page view and event counts

2. **user_events**: Individual user interactions
   - event_type, event_name, page_url
   - event_data (JSON), duration_ms
   - timestamp and session tracking

3. **heatmap_data**: Raw click/interaction data
   - Coordinates (x, y), viewport dimensions
   - Element information (id, class, text)
   - Interaction type (click, scroll, hover, move)

4. **session_recordings**: Metadata for recorded sessions
   - recording_url, storage_key
   - duration, event_count, file_size
   - status (processing, completed, failed)

5. **page_analytics**: Aggregated daily page metrics
   - unique_visitors, page_views
   - avg_time_on_page, bounce_rate
   - scroll_depth_avg, CTR, conversion_rate

6. **heatmap_aggregates**: Pre-computed heatmap grids
   - heatmap_json (grid-based data)
   - sample_count, grid_size
   - Indexed by page_url, date, interaction_type

7. **user_analytics_summary**: Daily user activity summary
   - sessions_count, page_views, events_count
   - total_time_seconds, unique_pages_visited
   - conversions, conversion_value, goals_completed

8. **analytics_custom_events**: Business-specific events
   - event_category, event_label, event_value
   - event_metadata (JSON)
   - Useful for form submissions, errors, conversions

#### Analytics Service (services/analytics.service.ts)

Provides methods for:

- **createSession(request)**: Initialize a new user session
- **endSession(sessionId)**: Close and calculate session duration
- **trackEvent(request)**: Record user interaction
- **trackHeatmapInteraction(request)**: Record click/scroll/hover/move
- **trackCustomEvent(request)**: Record business events
- **generateHeatmapAggregate(pageUrl, date, interactionType)**: Create grid-based heatmap
- **getPageAnalytics(pageUrl, startDate, endDate)**: Retrieve page metrics
- **getUserAnalyticsSummary(userId, date)**: Get daily summary
- **getHeatmapAggregate()**: Retrieve pre-computed heatmap
- **getTrendingPages(limit, daysBack)**: Get most visited pages

#### API Routes (routes/analytics.routes.ts)

**Endpoints:**

- `POST /api/analytics/session/start` - Initialize session
- `POST /api/analytics/session/end` - End session
- `POST /api/analytics/event` - Track event
- `POST /api/analytics/heatmap` - Track heatmap interaction
- `POST /api/analytics/custom-event` - Track custom event
- `GET /api/analytics/page/:pageUrl` - Get page analytics
- `GET /api/analytics/session/:sessionId/events` - Get session events
- `GET /api/analytics/heatmap/:pageUrl` - Get heatmap data
- `POST /api/analytics/heatmap/aggregate` - Generate heatmap
- `GET /api/analytics/heatmap/aggregate/:pageUrl` - Get heatmap aggregate
- `GET /api/analytics/trending` - Get trending pages
- `GET /api/analytics/custom-events` - Get custom events by category

### Frontend Components

#### Analytics Client (lib/analytics.ts)

Core client library for tracking:

```typescript
// Initialize analytics
const analytics = initializeAnalytics({
  enabled: true,
  apiBaseUrl: '/api',
  trackPageViews: true,
  trackClicks: true,
  trackScrolls: true,
  trackErrors: true,
  sampleRate: 0.5, // Track 50% of events
  batchSize: 10,
  batchInterval: 5000,
});

// Start session
await analytics.initSession(userId);

// Track events
analytics.trackEvent('interaction', 'button_click', { buttonId: 'submit' });

// Track conversions
analytics.trackConversion('bet_placed', 1000);

// Track errors
analytics.trackError('Form submission failed', errorStack, { formName: 'bet' });

// End session
await analytics.endSession();
```

**Features:**

- Automatic device detection (browser, OS, screen size)
- Event batching for efficient API usage
- Heatmap tracking (clicks, scrolls, hovers, mouse moves)
- Error tracking with stack traces
- Form submission tracking
- Custom event support
- Automatic session storage in sessionStorage

#### React Hooks (hooks/useAnalytics.ts)

- `useAnalytics()` - Main hook for accessing analytics
- `useTrackPageView()` - Track page views on mount
- `useTrackClick()` - Track element clicks
- `useTrackFormSubmission()` - Track form submissions
- `useTrackTimeSpent()` - Measure time spent on component
- `useTrackScrollDepth()` - Track scroll depth (25%, 50%, 75%, 100%)
- `useTrackSessionDuration()` - Measure total session time
- `useTrackElementVisibility()` - Track when elements enter viewport

#### Heatmap Visualization (components/HeatmapVisualization.tsx)

Components for displaying heatmap data:

- **HeatmapVisualization**: Renders intensity-based heatmap overlay
- **HeatmapGrid**: Renders grid-based heatmap visualization
- **HeatmapDashboard**: Complete dashboard for viewing heatmaps

Supported color schemes: `thermal`, `viridis`, `plasma`

#### Analytics Provider (providers/AnalyticsProvider.tsx)

Wrapper component to initialize analytics for the entire app:

```tsx
<AnalyticsProvider
  apiBaseUrl="/api"
  trackErrors={true}
  trackPageViews={true}
>
  <App />
</AnalyticsProvider>
```

## Integration Guide

### Backend Setup

1. **Run Migration**:
   ```bash
   npm run migrate
   ```

2. **Register Analytics Routes** in `src/index.ts`:
   ```typescript
   import analyticsRoutes from './routes/analytics.routes';
   app.use('/api/analytics', analyticsRoutes);
   ```

3. **Update main.ts/index.ts** to include analytics routes

### Frontend Setup

1. **Wrap App with AnalyticsProvider**:
   ```tsx
   // pages/_app.tsx or app.tsx
   import { AnalyticsProvider } from '@/providers/AnalyticsProvider';

   export default function MyApp({ Component, pageProps }) {
     return (
       <AnalyticsProvider>
         <Component {...pageProps} />
       </AnalyticsProvider>
     );
   }
   ```

2. **Use Analytics in Components**:
   ```tsx
   import { useAnalytics, useTrackPageView } from '@/hooks/useAnalytics';

   function MyComponent() {
     const { trackEvent, trackConversion } = useAnalytics();

     // Track page view
     useTrackPageView('my-page');

     // Track button click
     const handleClick = () => {
       trackEvent('interaction', 'button_click', { buttonName: 'Submit' });
     };

     // Track conversion
     const handleBet = () => {
       trackConversion('bet_placed', betAmount);
     };

     return <button onClick={handleClick}>Place Bet</button>;
   }
   ```

3. **Use Heatmap Visualization**:
   ```tsx
   import { HeatmapDashboard } from '@/components/HeatmapVisualization';

   function AnalyticsDashboard() {
     return (
       <HeatmapDashboard
         pageUrl="/markets"
         date={new Date()}
         interactionType="click"
       />
     );
   }
   ```

## Usage Examples

### Tracking User Interactions

```typescript
// Track form submission
const { trackFormSubmission } = useAnalytics();

const handleSubmit = (formData) => {
  trackFormSubmission('place_bet', {
    market: formData.marketId,
    amount: formData.amount,
  });
};
```

### Tracking Conversions

```typescript
// Track when user places a bet
const { trackConversion } = useAnalytics();

const handlePlaceBet = async (amount) => {
  // ... place bet logic
  trackConversion('bet_placed', amount);
};

// Track account creation
trackConversion('account_created', 0);

// Track referral sign-up
trackConversion('referral_signup', 0);
```

### Tracking Errors

```typescript
const { trackError } = useAnalytics();

try {
  // ... some operation
} catch (error) {
  trackError(
    error.message,
    error.stack,
    { context: 'bet_placement', marketId: 123 }
  );
}
```

### Measuring Engagement

```typescript
// Track scroll depth
useTrackScrollDepth();

// Track time spent
useTrackTimeSpent('market_detail_page');

// Track when element enters view
const ref = useRef<HTMLDivElement>(null);
useTrackElementVisibility(ref, 'premium_markets_section_viewed');

return <div ref={ref}>Premium Markets</div>;
```

## Database Queries for Analysis

### Get Page Performance Metrics
```sql
SELECT 
  page_url,
  date,
  page_views,
  unique_visitors,
  bounce_rate,
  avg_time_on_page_seconds,
  conversion_rate
FROM page_analytics
WHERE date >= NOW() - INTERVAL '7 days'
ORDER BY page_views DESC;
```

### Get Top Clicked Elements
```sql
SELECT 
  element_id,
  element_class,
  COUNT(*) as click_count,
  page_url
FROM heatmap_data
WHERE interaction_type = 'click'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY element_id, element_class, page_url
ORDER BY click_count DESC
LIMIT 20;
```

### Get User Engagement Summary
```sql
SELECT 
  user_id,
  date,
  sessions_count,
  page_views,
  total_time_seconds,
  conversions,
  conversion_value
FROM user_analytics_summary
WHERE date >= NOW() - INTERVAL '30 days'
ORDER BY conversion_value DESC;
```

### Get Bounce Rate by Page
```sql
SELECT 
  page_url,
  page_name,
  AVG(bounce_rate) as avg_bounce_rate,
  SUM(page_views) as total_views
FROM page_analytics
WHERE date >= NOW() - INTERVAL '7 days'
GROUP BY page_url, page_name
ORDER BY total_views DESC;
```

## Performance Considerations

### Data Volume

- **Raw Events**: ~100KB per user per session (depends on activity)
- **Heatmap Data**: ~50KB per page per interaction type per day
- **Aggregates**: ~1KB per page aggregate

### Optimization Strategies

1. **Event Batching**: Events are batched and sent every 5 seconds (configurable)
2. **Sampling**: Default sample rate is 0.5 (50%) in production
3. **Heatmap Binning**: Raw coordinates are aggregated into grid cells
4. **Data Retention**: Consider archiving old data periodically
5. **Indexing**: All tables include appropriate indexes on frequently queried columns

### Recommended Index Strategy

```sql
-- Already created by migration, but here for reference:
CREATE INDEX idx_heatmap_data_page_url ON heatmap_data(page_url);
CREATE INDEX idx_user_events_user_id ON user_events(user_id);
CREATE INDEX idx_user_events_timestamp ON user_events(timestamp);
CREATE INDEX idx_page_analytics_date ON page_analytics(date);
```

## Privacy and Compliance

### GDPR Considerations

1. **Consent**: Ensure users consent to analytics tracking
2. **Data Retention**: Implement data deletion policies
3. **PII Protection**: Avoid collecting personally identifiable information in event_data
4. **User Rights**: Provide ability to download or delete user analytics data

### Implementation Example

```typescript
// Check for consent
function hasAnalyticsConsent(): boolean {
  return localStorage.getItem('analyticsConsent') === 'true';
}

// Initialize only if consent given
if (hasAnalyticsConsent()) {
  const analytics = initializeAnalytics({...});
  await analytics.initSession(userId);
}
```

## Monitoring and Alerts

### Key Metrics to Monitor

1. **Page Performance**
   - Average page load time
   - Bounce rate by page
   - Conversion rate trends

2. **User Engagement**
   - Sessions per user
   - Pages per session
   - Average session duration

3. **System Health**
   - Event delivery success rate
   - API latency for analytics endpoints
   - Database query performance

### Example Alert Queries

```sql
-- Alert if bounce rate exceeds threshold
SELECT page_url FROM page_analytics
WHERE bounce_rate > 0.5 AND date = CURRENT_DATE;

-- Alert if conversion rate drops
SELECT page_url FROM page_analytics
WHERE conversion_rate < 0.01 AND date = CURRENT_DATE;
```

## Future Enhancements

1. **Machine Learning**: Predict user churn, recommend optimizations
2. **A/B Testing**: Built-in A/B testing framework
3. **Real-time Dashboards**: WebSocket-based real-time analytics
4. **Session Replay**: Store and replay user sessions
5. **Advanced Segmentation**: User cohorts and behavioral segments
6. **Attribution Modeling**: Multi-touch attribution for conversions
7. **Funnel Analysis**: Track conversion funnels
8. **Anomaly Detection**: Alert on unusual traffic patterns

## Troubleshooting

### Events Not Being Tracked

1. Check if AnalyticsProvider is wrapping the app
2. Verify `enabled: true` in analytics config
3. Check browser console for errors
4. Verify API endpoint is correct
5. Check network tab to see if requests are being sent

### Heatmap Data Missing

1. Ensure heatmap events are being tracked
2. Check if `generateHeatmapAggregate()` is being called
3. Verify page_url matches between tracking and queries
4. Check if data is within the date range queried

### High Database Query Times

1. Verify indexes are created
2. Consider partitioning analytics tables by date
3. Archive old data to separate tables
4. Adjust sample rate to reduce data volume

## API Documentation

See `/workspaces/StellarFox/backend/src/routes/analytics.routes.ts` for complete endpoint documentation.

## File Structure

```
backend/
├── migrations/
│   └── 1770000000000_add-user-analytics.js
├── src/
│   ├── db/
│   │   └── schema.ts (added analytics tables)
│   ├── services/
│   │   └── analytics.service.ts
│   └── routes/
│       └── analytics.routes.ts

frontend/
├── src/
│   ├── lib/
│   │   └── analytics.ts
│   ├── hooks/
│   │   └── useAnalytics.ts
│   ├── components/
│   │   └── HeatmapVisualization.tsx
│   └── providers/
│       └── AnalyticsProvider.tsx
```

## Support and Maintenance

For issues or questions:
1. Check this documentation
2. Review the example implementations
3. Check database for data presence
4. Verify migrations ran successfully
5. Check API logs for errors
