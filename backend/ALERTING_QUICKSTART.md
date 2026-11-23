# Alerting System Quick Start Guide

Get the multi-channel alerting system running in 5 minutes.

## Step 1: Install Dependencies (Already in project)

The required dependencies are already installed:
- `ioredis` for caching
- `express` for routing
- `node-cron` for scheduled tasks
- `pg` for database
- `jsonwebtoken` for auth

Check package.json includes `axios`:
```bash
npm list axios
# If missing:
npm install axios@1.6.0
```

## Step 2: Set Up Environment Variables

Copy the example configuration:
```bash
cp backend/.env.alerting.example backend/.env.alerting
```

Add to your `.env`:
```env
PAGERDUTY_API_KEY=u+dL_YourActualKeyHere
PAGERDUTY_INTEGRATION_KEY=R1234567890abcdef
PAGERDUTY_ENABLED=true
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## Step 3: Run Database Migration

```bash
cd backend
npm run migrate
```

Verify tables:
```bash
psql $DATABASE_URL -c "\dt alerts"
psql $DATABASE_URL -c "\dt oncall*"
psql $DATABASE_URL -c "\dt escalation*"
```

## Step 4: Initialize in Your App

Add to `src/index.ts`:

```typescript
import { initPagerDutyService } from './services/pagerduty.service';
import alertingRoutes from './routes/alerting.routes';

// Initialize alerting
if (process.env.PAGERDUTY_ENABLED === 'true') {
  initPagerDutyService({
    apiKey: process.env.PAGERDUTY_API_KEY || '',
    integrationKey: process.env.PAGERDUTY_INTEGRATION_KEY || '',
    enabled: true,
  });
}

// Register routes
app.use('/api/alerts', alertingRoutes);
```

## Step 5: Test It

### Start the server:
```bash
npm run dev
```

### Create a test schedule:
```bash
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Team",
    "type": "weekly",
    "timezone": "America/New_York"
  }'
```

### Add on-call members:
```bash
curl -X POST http://localhost:3000/api/schedules/{schedule-id}/layers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Primary",
    "rotationTurnLength": 7,
    "members": [
      {
        "name": "Your Name",
        "email": "your@email.com"
      }
    ]
  }'
```

### Trigger your first alert:
```bash
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Alert",
    "description": "This is my first alert",
    "severity": "high",
    "source": "test-system",
    "channels": ["email", "pagerduty"]
  }'
```

### Check active alerts:
```bash
curl http://localhost:3000/api/alerts
```

## Key API Endpoints

### Alerts
- `POST /api/alerts/trigger` - Create alert
- `GET /api/alerts` - List active
- `PUT /api/alerts/:id/acknowledge` - Acknowledge
- `PUT /api/alerts/:id/resolve` - Resolve

### On-Call
- `POST /api/schedules` - Create schedule
- `GET /api/schedules` - List schedules
- `POST /api/schedules/:id/layers` - Add shift
- `GET /api/schedules/:id/oncall` - Get current

### Escalation
- `POST /api/escalation-policies` - Create policy
- `POST /api/escalation-policies/:id/test` - Test

### Health
- `GET /api/integrations/pagerduty/health` - Check status

## Common Tasks

### Create an escalation policy:
```bash
curl -X POST http://localhost:3000/api/escalation-policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Standard Escalation",
    "levels": [
      {
        "level": 1,
        "delayMinutes": 0,
        "notifySchedules": ["your-schedule-id"]
      },
      {
        "level": 2,
        "delayMinutes": 15,
        "notifySchedules": ["backup-schedule-id"]
      }
    ]
  }'
```

### Acknowledge an alert:
```bash
curl -X PUT http://localhost:3000/api/alerts/{alert-id}/acknowledge \
  -H "Content-Type: application/json" \
  -d '{"acknowledgedBy": "user@example.com"}'
```

### Resolve an alert:
```bash
curl -X PUT http://localhost:3000/api/alerts/{alert-id}/resolve \
  -H "Content-Type: application/json" \
  -d '{"resolvedBy": "user@example.com"}'
```

## Programmatic Usage

### In your services:
```typescript
import { getAlertService } from './services/alert.service';
import { AlertSeverity } from './types/alerting.types';

const alertService = getAlertService();

// Trigger alert programmatically
await alertService.triggerAlert({
  title: 'Database Error',
  description: 'Connection failed',
  severity: AlertSeverity.CRITICAL,
  source: 'database-monitor',
  tags: { service: 'api' },
  channels: ['pagerduty', 'email'],
});
```

### Get on-call person:
```typescript
import { getOnCallService } from './services/oncall.service';

const onCallService = getOnCallService();
const currentEngineer = await onCallService.getCurrentOnCall('schedule-id');
console.log(`Current on-call: ${currentEngineer?.name}`);
```

## Troubleshooting

### PagerDuty not working?
```bash
# Check credentials
curl -H "Authorization: Token token=YOUR_KEY" \
  https://api.pagerduty.com/users?limit=1

# Check health endpoint
curl http://localhost:3000/api/integrations/pagerduty/health
```

### No active alerts showing?
```bash
# Check Redis connection
redis-cli ping

# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM alerts;"
```

### Schedule calculation wrong?
```bash
# Test escalation policy
curl -X POST http://localhost:3000/api/escalation-policies/{policy-id}/test
```

## Next Steps

1. **Read Full Guides**
   - [Setup Guide](./ALERTING_SETUP.md) - Complete features
   - [Integration Guide](./ALERTING_INTEGRATION.md) - Production setup

2. **Add Alert Rules**
   - Set up routing rules in Redis
   - Configure silence rules
   - Create escalation policies

3. **Integrate with Services**
   - Add alerts to health checks
   - Monitor market events
   - Track system errors

4. **Deploy to Production**
   - Use production PagerDuty account
   - Set up monitoring
   - Configure backup schedules

## Support

For detailed information, see:
- `ALERTING_SETUP.md` - Feature documentation
- `ALERTING_INTEGRATION.md` - Production deployment
- `ALERTING_SUMMARY.md` - Architecture overview
- Tests: `tests/alerting.test.ts`

## Common Patterns

### Health Check Alerting
```typescript
async checkHealth() {
  if (dbDown) {
    await alertService.triggerAlert({
      title: 'Database Down',
      description: 'Cannot connect to database',
      severity: AlertSeverity.CRITICAL,
      source: 'health-check',
      channels: ['pagerduty', 'slack']
    });
  }
}
```

### Error Tracking
```typescript
app.use((err, req, res, next) => {
  if (err.statusCode >= 500) {
    alertService.triggerAlert({
      title: `Error: ${err.message}`,
      severity: AlertSeverity.HIGH,
      source: 'api-error',
      channels: ['pagerduty']
    });
  }
});
```

### Market Monitoring
```typescript
async monitorMarket(market) {
  if (market.priceChange > 50) {
    await alertService.triggerAlert({
      title: 'Unusual Price Movement',
      description: `${market.id} changed ${market.priceChange}%`,
      severity: AlertSeverity.HIGH,
      source: 'market-monitor'
    });
  }
}
```

Ready to go! 🚀
