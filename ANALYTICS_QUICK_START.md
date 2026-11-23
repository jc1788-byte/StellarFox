# Analytics Implementation - Quick Start Guide

## What Was Added

A comprehensive analytics system for tracking user interactions, sessions, and creating heatmaps for UX optimization.

### Files Created

#### Backend
1. **Migration**: `backend/migrations/1770000000000_add-user-analytics.js`
   - Creates 8 analytics tables
   - Sets up indexes for performance

2. **Service**: `backend/src/services/analytics.service.ts`
   - Core analytics logic
   - Session management
   - Heatmap aggregation
   - Reporting functions

3. **Routes**: `backend/src/routes/analytics.routes.ts`
   - API endpoints for tracking and reporting
   - 11 endpoints for analytics data

4. **Schema**: Updated `backend/src/db/schema.ts`
   - Added 8 new Drizzle ORM table definitions
   - Added TypeScript types

#### Frontend
1. **Client Library**: `frontend/src/lib/analytics.ts`
   - Browser-based event tracking
   - Session management
   - Heatmap tracking
   - Event batching and optimization

2. **React Hooks**: `frontend/src/hooks/useAnalytics.ts`
   - 8 custom hooks for tracking
   - Easy integration in components

3. **Visualization**: `frontend/src/components/HeatmapVisualization.tsx`
   - Interactive heatmap display
   - Grid-based visualization
   - Analytics dashboard component

4. **Provider**: `frontend/src/providers/AnalyticsProvider.tsx`
   - App-level initialization
   - Session lifecycle management

#### Documentation
1. **Full Documentation**: `ANALYTICS_IMPLEMENTATION.md` (comprehensive guide)
2. **This Guide**: `ANALYTICS_QUICK_START.md`

## Step 1: Backend Setup (5 minutes)

### 1.1 Run Database Migration

```bash
cd /workspaces/StellarFox
npm run migrate
```

This creates 8 new tables:
- `user_sessions` - Session metadata
- `user_events` - Individual user interactions
- `heatmap_data` - Click/scroll/hover data
- `page_analytics` - Page metrics
- `session_recordings` - Recording metadata
- `heatmap_aggregates` - Pre-computed heatmaps
- `user_analytics_summary` - Daily user summaries
- `analytics_custom_events` - Business-specific events

### 1.2 Register Routes in Backend

Edit `backend/src/index.ts`:

```typescript
import analyticsRoutes from './routes/analytics.routes';

// Add this after other route imports
app.use('/api/analytics', analyticsRoutes);
```

### 1.3 Verify Backend Setup

```bash
cd backend
npm run dev
```

You should see no errors. Backend is ready!

## Step 2: Frontend Setup (5 minutes)

### 2.1 Wrap App with AnalyticsProvider

In your app's root component (`pages/_app.tsx` or `app.tsx`):

```tsx
import { AnalyticsProvider } from '@/providers/AnalyticsProvider';

export default function MyApp({ Component, pageProps }) {
  return (
    <AnalyticsProvider
      apiBaseUrl="/api"
      trackErrors={true}
      trackPageViews={true}
    >
      <Component {...pageProps} />
    </AnalyticsProvider>
  );
}
```

### 2.2 Start Frontend

```bash
cd frontend
npm run dev
```

Analytics will now automatically initialize when users load the app!

## Step 3: Use Analytics in Your Components

### Track Page Views
```tsx
import { useTrackPageView } from '@/hooks/useAnalytics';

function MyPage() {
  useTrackPageView('my-page');
  return <div>Welcome</div>;
}
```

### Track Events
```tsx
import { useAnalytics } from '@/hooks/useAnalytics';

function BetForm() {
  const { trackEvent, trackConversion } = useAnalytics();

  const handleSubmit = (data) => {
    trackEvent('form', 'bet_submitted', { amount: data.amount });
    
    // Place bet...
    
    trackConversion('bet_placed', data.amount);
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      handleSubmit(new FormData(e.currentTarget));
    }}>
      {/* form fields */}
    </form>
  );
}
```

### Track Form Submissions
```tsx
const { trackFormSubmission } = useAnalytics();

const handleFormSubmit = (formData) => {
  trackFormSubmission('signup_form', {
    email: formData.email,
  });
};
```

### Track Conversions
```tsx
const { trackConversion } = useAnalytics();

// When user creates account
trackConversion('account_created', 0);

// When user makes first bet
trackConversion('first_bet', betAmount);

// When user reaches milestone
trackConversion('referral_bonus', bonusAmount);
```

### Track Scroll Depth
```tsx
import { useTrackScrollDepth } from '@/hooks/useAnalytics';

function LongPage() {
  useTrackScrollDepth(); // Automatically tracks 25%, 50%, 75%, 100%
  
  return (
    <div>
      {/* Long content */}
    </div>
  );
}
```

### Track Time Spent
```tsx
import { useTrackTimeSpent } from '@/hooks/useAnalytics';

function DetailPage() {
  useTrackTimeSpent('detail_view');
  
  return <div>Details</div>;
}
```

## Step 4: View Analytics Data

### API Endpoints Available

All endpoints require authentication (pass JWT token):

#### Session Management
```bash
# Start session
POST /api/analytics/session/start
Body: { browser?, os?, ipAddress?, deviceInfo? }
Response: { sessionId }

# End session
POST /api/analytics/session/end
Body: { sessionId }
Response: { durationSeconds }
```

#### Event Tracking
```bash
# Track event
POST /api/analytics/event
Body: {
  sessionId,
  eventType,
  eventName,
  pageUrl?,
  eventData?
}

# Track heatmap interaction
POST /api/analytics/heatmap
Body: {
  sessionId,
  pageUrl,
  interactionType,
  x, y,
  elementId?,
  viewportWidth?,
  viewportHeight?
}

# Track custom event
POST /api/analytics/custom-event
Body: {
  eventCategory,
  eventLabel,
  eventValue?,
  eventMetadata?
}
```

#### Analytics Queries
```bash
# Get page analytics
GET /api/analytics/page/:pageUrl?startDate=2024-01-01&endDate=2024-01-31

# Get session events
GET /api/analytics/session/:sessionId/events

# Get heatmap data
GET /api/analytics/heatmap/:pageUrl?interactionType=click&startDate=2024-01-01&endDate=2024-01-31

# Get trending pages
GET /api/analytics/trending?limit=10&daysBack=7

# Get custom events
GET /api/analytics/custom-events?eventCategory=conversion&startDate=2024-01-01&endDate=2024-01-31
```

### View Heatmaps in Your App

```tsx
import { HeatmapDashboard } from '@/components/HeatmapVisualization';

function AnalyticsDashboard() {
  return (
    <div className="p-8">
      <h1>Analytics Dashboard</h1>
      <HeatmapDashboard
        pageUrl="/markets"
        date={new Date()}
        interactionType="click"
      />
    </div>
  );
}
```

### Query Database Directly

```sql
-- See which pages get the most traffic
SELECT page_url, page_views, bounce_rate 
FROM page_analytics 
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY page_views DESC;

-- See most clicked elements
SELECT element_id, COUNT(*) as clicks
FROM heatmap_data
WHERE interaction_type = 'click'
AND created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY element_id
ORDER BY clicks DESC
LIMIT 10;

-- See user engagement summary
SELECT user_id, sessions_count, page_views, total_time_seconds
FROM user_analytics_summary
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY page_views DESC;
```

## What Gets Tracked Automatically

### Session Data
- ✅ Session ID (UUID)
- ✅ User ID
- ✅ Browser type
- ✅ Operating system
- ✅ Device info (screen size, language, timezone)
- ✅ Start/end times
- ✅ Session duration
- ✅ Number of page views
- ✅ Number of events

### Events
- ✅ Page views
- ✅ All clicks (if enabled)
- ✅ Scroll events (if enabled)
- ✅ Form submissions
- ✅ Errors (if enabled)
- ✅ Custom business events

### Heatmaps
- ✅ Click locations and elements
- ✅ Scroll positions
- ✅ Mouse movements
- ✅ Hover interactions
- ✅ Element information (ID, class, text)
- ✅ Viewport dimensions

## Configuration Options

Customize analytics in `AnalyticsProvider`:

```tsx
<AnalyticsProvider
  apiBaseUrl="/api"
  trackErrors={true}           // Track JavaScript errors
  trackPageViews={true}        // Track page loads
  // In analytics client:
  // enabled: true              // Enable/disable entirely
  // sampleRate: 0.5            // Track 50% of events (for load testing)
  // trackClicks: true          // Track click events
  // trackScrolls: true         // Track scroll events
  // batchSize: 10              // Send events in batches of 10
  // batchInterval: 5000        // Send batches every 5 seconds
>
  <App />
</AnalyticsProvider>
```

## Performance Tips

1. **Event Sampling**: In production, set `sampleRate: 0.5` to track 50% of events
2. **Batch Sending**: Events are batched every 5 seconds to reduce API calls
3. **Heatmap Sampling**: Heatmap events are sampled more aggressively
4. **Database Indexing**: All tables have appropriate indexes
5. **Data Retention**: Consider archiving data older than 90 days

## Example: Complete Implementation

Here's a real-world example tracking a bet placement:

```tsx
import { useAnalytics, useTrackPageView } from '@/hooks/useAnalytics';

function BetMarket() {
  // Track page view
  useTrackPageView('market-detail');
  
  const { trackEvent, trackConversion, trackError, trackFormSubmission } = useAnalytics();
  
  const [formData, setFormData] = useState({
    marketId: '',
    amount: 0,
    outcome: '',
  });

  const handleInputChange = (field) => {
    // Track user engagement
    trackEvent('interaction', 'form_field_focused', { field });
  };

  const handleSubmit = async () => {
    try {
      // Track form submission
      trackFormSubmission('place_bet', {
        marketId: formData.marketId,
        amount: formData.amount,
      });

      // Place the bet
      const response = await fetch('/api/bets', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error('Bet failed');

      // Track successful conversion
      trackConversion('bet_placed', formData.amount);
      
      // Track milestones
      trackEvent('business', 'bet_milestone', {
        amount: formData.amount,
        market: formData.marketId,
      });
    } catch (error) {
      trackError(error.message, error.stack, {
        form: 'place_bet',
        marketId: formData.marketId,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input 
        onFocus={() => handleInputChange('marketId')}
        onChange={(e) => setFormData({...formData, marketId: e.target.value})}
        placeholder="Market ID"
      />
      <input 
        onFocus={() => handleInputChange('amount')}
        onChange={(e) => setFormData({...formData, amount: Number(e.target.value)})}
        placeholder="Amount"
        type="number"
      />
      <button type="submit">Place Bet</button>
    </form>
  );
}
```

## Troubleshooting

### Events not being tracked?
1. Check browser console for errors
2. Verify AnalyticsProvider wraps your app
3. Check Network tab - should see `/api/analytics/*` requests
4. Verify backend is running and analytics routes registered

### Heatmap not showing?
1. Check if heatmap events are being sent (Network tab)
2. Try calling `/api/analytics/heatmap/aggregate` manually
3. Verify page_url matches between tracking and query
4. Check database: `SELECT COUNT(*) FROM heatmap_data;`

### Database migration failed?
1. Check migration file exists: `backend/migrations/1770000000000_add-user-analytics.js`
2. Verify database connection works: `npm run migrate:check`
3. Check PostgreSQL logs for errors
4. Try: `npm run migrate:down` then `npm run migrate` again

## Next Steps

1. ✅ Set up backend and frontend
2. ✅ Add AnalyticsProvider to your app
3. ✅ Start tracking key user interactions
4. ✅ Monitor analytics data using the API
5. Create admin dashboard to visualize analytics
6. Set up alerts for key metrics
7. Use data to inform UX improvements

## Support

Refer to `ANALYTICS_IMPLEMENTATION.md` for:
- Detailed API documentation
- Database schema information
- Advanced usage patterns
- Performance optimization
- Privacy/GDPR compliance
- Troubleshooting guide

## Summary

You now have:
- ✅ Complete analytics tracking system
- ✅ Session management
- ✅ Heatmap generation
- ✅ Custom event tracking
- ✅ Error tracking
- ✅ Form submission tracking
- ✅ Conversion tracking
- ✅ React hooks for easy integration
- ✅ Heatmap visualization components

Start using it immediately to understand your users better!
