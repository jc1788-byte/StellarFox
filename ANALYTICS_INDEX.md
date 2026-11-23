# Analytics System - Documentation Index

## 📚 Start Here

### For Quick Setup (15 minutes)
→ **[ANALYTICS_QUICK_START.md](./ANALYTICS_QUICK_START.md)**
- 5-minute backend setup
- 5-minute frontend setup
- Copy-paste ready code
- Common use cases

### For Understanding the System (30 minutes)
→ **[ANALYTICS_SUMMARY.md](./ANALYTICS_SUMMARY.md)**
- What was built
- Features overview
- Architecture summary
- File structure
- Key metrics

### For Complete Details (Reference)
→ **[ANALYTICS_IMPLEMENTATION.md](./ANALYTICS_IMPLEMENTATION.md)**
- Full architecture
- Database schema details
- API documentation
- Advanced usage
- Performance tuning
- GDPR compliance

### For Real-World Examples (Copy-Paste)
→ **[ANALYTICS_INTEGRATION_EXAMPLES.md](./ANALYTICS_INTEGRATION_EXAMPLES.md)**
- 12 real-world examples
- StellarFox-specific integrations
- Before/after code
- Testing commands

---

## 🎯 Common Tasks

### I want to...

#### Get Started Immediately
1. Read: [Quick Start Guide](./ANALYTICS_QUICK_START.md) (5 mins)
2. Follow: Step 1, Step 2, Step 3
3. Test: Run backend and frontend
4. Done! ✅

#### Track a Specific User Action
1. Find example in: [Integration Examples](./ANALYTICS_INTEGRATION_EXAMPLES.md)
2. Copy relevant code snippet
3. Paste into your component
4. Done! ✅

#### Understand How It Works
1. Read: [Architecture](./ANALYTICS_IMPLEMENTATION.md#architecture)
2. Review: [Database Schema](./ANALYTICS_IMPLEMENTATION.md#database-schema)
3. Study: [Usage Examples](./ANALYTICS_IMPLEMENTATION.md#usage-examples)
4. Done! ✅

#### Optimize Performance
1. Review: [Performance Considerations](./ANALYTICS_IMPLEMENTATION.md#performance-considerations)
2. Adjust: Configuration in AnalyticsProvider
3. Monitor: Database query times
4. Done! ✅

#### Handle GDPR Compliance
1. Review: [Privacy and Compliance](./ANALYTICS_IMPLEMENTATION.md#privacy-and-compliance)
2. Implement: Consent checking
3. Set up: Data deletion workflows
4. Done! ✅

#### Troubleshoot Issues
1. Check: [Quick Start Troubleshooting](./ANALYTICS_QUICK_START.md#troubleshooting)
2. Review: [Full Troubleshooting](./ANALYTICS_IMPLEMENTATION.md#troubleshooting)
3. Test: API endpoints
4. Done! ✅

---

## 📋 Quick Reference

### Files Created

**Backend**
- `backend/migrations/1770000000000_add-user-analytics.js` - Database schema
- `backend/src/services/analytics.service.ts` - Core logic
- `backend/src/routes/analytics.routes.ts` - API endpoints
- `backend/src/db/schema.ts` - Updated with analytics tables

**Frontend**
- `frontend/src/lib/analytics.ts` - Tracking client
- `frontend/src/hooks/useAnalytics.ts` - React hooks
- `frontend/src/components/HeatmapVisualization.tsx` - Heatmap UI
- `frontend/src/providers/AnalyticsProvider.tsx` - Provider component

**Documentation**
- `ANALYTICS_IMPLEMENTATION.md` - Complete reference (2,500+ lines)
- `ANALYTICS_QUICK_START.md` - Quick setup (1,200+ lines)
- `ANALYTICS_INTEGRATION_EXAMPLES.md` - Code examples (700+ lines)
- `ANALYTICS_SUMMARY.md` - Overview (500+ lines)
- `ANALYTICS_INDEX.md` - This file

### Key Statistics

- **Total Code**: 3,500+ lines
- **Documentation**: 4,400+ lines
- **Database Tables**: 8
- **API Endpoints**: 11
- **React Hooks**: 8
- **React Components**: 3
- **Setup Time**: 15 minutes

### What Gets Tracked

✅ Sessions (browser, OS, device)
✅ Page views and navigation
✅ Clicks and interactions
✅ Scroll depth
✅ Form submissions
✅ Errors with stack traces
✅ Custom business events
✅ Heatmaps (click, scroll, hover)
✅ Time on page
✅ User engagement

---

## 🚀 Getting Started Path

```
Day 1: Setup (20 minutes)
├─ Run migration
├─ Register routes
├─ Add AnalyticsProvider
└─ Test basic tracking

Day 2: Integration (1 hour)
├─ Track page views
├─ Track conversions
├─ Track form submissions
└─ Test in production

Day 3: Optimization (30 minutes)
├─ View analytics dashboard
├─ Analyze heatmaps
├─ Identify improvements
└─ Implement optimizations
```

---

## 📊 Database Tables

| Table | Purpose | Rows/Day |
|-------|---------|----------|
| `user_sessions` | Track sessions | 5K |
| `user_events` | Individual events | 50K |
| `heatmap_data` | Click coordinates | 100K |
| `page_analytics` | Page metrics | 50 |
| `session_recordings` | Recording data | 1K |
| `heatmap_aggregates` | Processed heatmaps | 200 |
| `user_analytics_summary` | Daily summaries | 1K |
| `analytics_custom_events` | Business events | 10K |

---

## 🔌 API Endpoints

### Session Management
```
POST   /api/analytics/session/start
POST   /api/analytics/session/end
```

### Event Tracking
```
POST   /api/analytics/event
POST   /api/analytics/heatmap
POST   /api/analytics/custom-event
```

### Analytics Retrieval
```
GET    /api/analytics/page/:pageUrl
GET    /api/analytics/session/:sessionId/events
GET    /api/analytics/heatmap/:pageUrl
GET    /api/analytics/heatmap/aggregate/:pageUrl
POST   /api/analytics/heatmap/aggregate
GET    /api/analytics/trending
GET    /api/analytics/custom-events
```

---

## 🎨 React Hooks

```typescript
// Main hook
useAnalytics()

// Page tracking
useTrackPageView(pageName?)

// Interaction tracking
useTrackClick(elementName, onTrack?)

// Form tracking
useTrackFormSubmission(formName)

// Engagement tracking
useTrackTimeSpent(eventName?)
useTrackScrollDepth()
useTrackSessionDuration()
useTrackElementVisibility(ref, eventLabel)
```

---

## 💡 Common Code Patterns

### Track a Button Click
```tsx
const { trackEvent } = useAnalytics();
<button onClick={() => trackEvent('button', 'submit_clicked')}>
  Submit
</button>
```

### Track Page View
```tsx
useTrackPageView('my-page');
```

### Track Conversion
```tsx
const { trackConversion } = useAnalytics();
trackConversion('bet_placed', 1000);
```

### Track Form Submission
```tsx
const { trackFormSubmission } = useAnalytics();
const handleSubmit = () => {
  trackFormSubmission('contact_form', { email });
};
```

### Track Error
```tsx
const { trackError } = useAnalytics();
try {
  // ...
} catch (error) {
  trackError(error.message, error.stack);
}
```

---

## 🔍 Debugging

### Check Events Are Being Sent
```javascript
// In browser console
sessionStorage.getItem('analyticsSessionId')

// Check Network tab for /api/analytics/* requests
```

### Query Database Directly
```sql
-- Count events
SELECT COUNT(*) FROM user_events;

-- See page analytics
SELECT * FROM page_analytics LIMIT 10;

-- Check heatmap data
SELECT * FROM heatmap_data LIMIT 10;
```

### Test API Endpoints
```bash
# Start tracking custom event
curl -X POST http://localhost:3001/api/analytics/custom-event \
  -H "Content-Type: application/json" \
  -d '{"eventCategory": "test", "eventLabel": "test_event"}'
```

---

## 📖 Documentation Structure

```
ANALYTICS_IMPLEMENTATION.md
├─ Overview
├─ Architecture
│  ├─ Backend Components
│  ├─ Frontend Components
│  └─ Integration Guide
├─ Usage Examples
├─ Database Queries
├─ Performance Considerations
├─ Privacy & Compliance
├─ Monitoring & Alerts
├─ Future Enhancements
└─ Troubleshooting

ANALYTICS_QUICK_START.md
├─ What Was Added
├─ Step 1: Backend Setup
├─ Step 2: Frontend Setup
├─ Step 3: Use Analytics
├─ Step 4: View Analytics
├─ Configuration Options
├─ Performance Tips
├─ Example: Complete Implementation
└─ Troubleshooting

ANALYTICS_INTEGRATION_EXAMPLES.md
├─ 12 Real-World Examples
│  ├─ Bet Placement Tracking
│  ├─ Form Submission Tracking
│  ├─ Account Creation
│  ├─ Page Engagement
│  ├─ Claim Winnings
│  ├─ Error Tracking
│  ├─ Referral Tracking
│  ├─ Leaderboard View
│  ├─ Market Search
│  ├─ Portfolio View
│  ├─ Backend Event Logging
│  └─ Wallet Transactions
├─ Integration Checklist
└─ Testing Analytics

ANALYTICS_SUMMARY.md
├─ What Was Built
├─ Files Created
├─ Key Metrics
├─ Features Implemented
├─ Database Schema
├─ API Endpoints
├─ Use Cases Enabled
├─ Integration Steps
├─ Technology Stack
├─ Quality Assurance
├─ Production Readiness
└─ Conclusion
```

---

## ⚡ Performance Tips

1. **Use sampling**: `sampleRate: 0.5` in production
2. **Batch events**: Default 5-second batching
3. **Throttle listeners**: Scroll/mousemove already throttled
4. **Archive old data**: Consider partitioning by date
5. **Use indexes**: Already created by migration
6. **Monitor queries**: Check slow query logs

---

## 🎓 Learning Path

### Beginner (30 mins)
1. Read: Quick Start Guide
2. Do: Follow setup steps
3. Test: Basic page tracking

### Intermediate (2 hours)
1. Read: Summary & Integration Examples
2. Do: Integrate tracking in components
3. Test: Verify events in database

### Advanced (4 hours)
1. Read: Full Implementation Guide
2. Do: Customize for your needs
3. Optimize: Performance tuning

---

## 🆘 Getting Help

### First Steps
1. Check relevant section in ANALYTICS_QUICK_START.md
2. Search ANALYTICS_IMPLEMENTATION.md for your topic
3. Look for similar example in ANALYTICS_INTEGRATION_EXAMPLES.md

### Common Issues
- **Events not tracked?** → Check AnalyticsProvider is wrapping app
- **API errors?** → Verify backend routes registered
- **Database issues?** → Run migration again
- **Heatmap empty?** → Generate aggregates via API

### Need More Help?
1. Review the specific documentation file
2. Check troubleshooting section
3. Verify all setup steps completed
4. Test API endpoints directly

---

## 📅 Timeline

- **15 mins**: Initial setup (backend + frontend)
- **1 hour**: Basic integration (page views, conversions)
- **3 hours**: Full integration (all tracking)
- **2 hours**: Dashboard & optimization

---

## ✅ Verification Checklist

- [ ] Migration ran successfully
- [ ] Backend routes registered
- [ ] AnalyticsProvider wrapping app
- [ ] Page views being tracked
- [ ] Events appearing in database
- [ ] Conversions tracked
- [ ] Heatmaps generating
- [ ] No console errors

---

## 🚢 Production Checklist

- [ ] Set up data retention policies
- [ ] Enable sampling (0.5)
- [ ] Set up monitoring & alerts
- [ ] Implement GDPR workflows
- [ ] Configure backups
- [ ] Monitor disk usage
- [ ] Review logs regularly
- [ ] Archive old data

---

## 📞 Support Resources

- Full Docs: `ANALYTICS_IMPLEMENTATION.md`
- Quick Start: `ANALYTICS_QUICK_START.md`
- Examples: `ANALYTICS_INTEGRATION_EXAMPLES.md`
- Overview: `ANALYTICS_SUMMARY.md`
- This Index: `ANALYTICS_INDEX.md`

---

**Last Updated**: November 2024
**Version**: 1.0.0 - Production Ready
**Status**: ✅ Complete

---

Start with **[ANALYTICS_QUICK_START.md](./ANALYTICS_QUICK_START.md)** →
