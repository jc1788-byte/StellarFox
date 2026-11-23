# Multi-Channel Alerting with PagerDuty Integration

Comprehensive guide for setting up and using the multi-channel alerting system with PagerDuty integration, escalation policies, and on-call management.

## Overview

The alerting system provides:

- **Multi-channel notifications**: Email, SMS, Slack, PagerDuty, and webhooks
- **PagerDuty integration**: Direct incident creation, acknowledgment, and resolution
- **On-call scheduling**: Flexible rotation management with layered schedules
- **Escalation policies**: Multi-level escalation with configurable delays
- **Alert routing**: Rules-based routing to appropriate teams/schedules
- **Alert silencing**: Suppress specific alerts during maintenance windows
- **Real-time monitoring**: Track alerts through their lifecycle

## Installation

### 1. Environment Configuration

Add these variables to your `.env` file:

```env
# PagerDuty Integration
PAGERDUTY_API_KEY=your_pagerduty_api_key_here
PAGERDUTY_INTEGRATION_KEY=your_integration_key_here
PAGERDUTY_ENABLED=true

# Alert Configuration
ALERT_WEBHOOK_URL=https://your-domain.com/webhooks/alerts
DASHBOARD_URL=https://app.stellarfox.dev
```

### 2. Run Database Migration

```bash
npm run migrate
```

This creates the following tables:
- `alerts` - Alert records
- `alert_notifications` - Notification history
- `oncall_schedules` - On-call schedule definitions
- `schedule_layers` - Schedule layers for rotations
- `schedule_members` - Members in schedules
- `escalation_policies` - Escalation policy definitions
- `escalation_levels` - Individual escalation levels
- `alert_routing_rules` - Alert routing rules
- `alert_silence_rules` - Alert suppression rules

### 3. Initialize Services

In your main application file (e.g., `src/index.ts`):

```typescript
import { initPagerDutyService } from './services/pagerduty.service';
import { getAlertService } from './services/alert.service';
import { getOnCallService } from './services/oncall.service';
import { getEnv } from './config/env';
import alertingRoutes from './routes/alerting.routes';

const env = getEnv();

// Initialize PagerDuty service
if (env.PAGERDUTY_ENABLED) {
  initPagerDutyService({
    apiKey: env.PAGERDUTY_API_KEY,
    integrationKey: env.PAGERDUTY_INTEGRATION_KEY,
    enabled: true,
  });
}

// Register alerting routes
app.use('/api/alerts', alertingRoutes);
```

## Quick Start

### Create an On-Call Schedule

```bash
curl -X POST http://localhost:3000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Platform Team",
    "type": "weekly",
    "timezone": "America/New_York"
  }'
```

Response:
```json
{
  "success": true,
  "schedule": {
    "id": "uuid",
    "name": "Platform Team",
    "type": "weekly",
    "timezone": "America/New_York",
    "enabled": true,
    "layers": [],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Add Members to Schedule

```bash
curl -X POST http://localhost:3000/api/schedules/{schedule-id}/layers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Primary On-Call",
    "rotationTurnLength": 7,
    "members": [
      {
        "name": "Alice Engineer",
        "email": "alice@example.com",
        "phone": "+1234567890",
        "slackId": "U123456"
      },
      {
        "name": "Bob Engineer",
        "email": "bob@example.com",
        "phone": "+0987654321",
        "slackId": "U654321"
      }
    ]
  }'
```

### Create Escalation Policy

```bash
curl -X POST http://localhost:3000/api/escalation-policies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Critical Issues Policy",
    "levels": [
      {
        "level": 1,
        "delayMinutes": 0,
        "notifySchedules": ["schedule-id-1"]
      },
      {
        "level": 2,
        "delayMinutes": 15,
        "notifySchedules": ["schedule-id-2"]
      },
      {
        "level": 3,
        "delayMinutes": 30,
        "notifyUsers": ["manager-id"]
      }
    ],
    "repeatEnabled": true
  }'
```

### Trigger an Alert

```bash
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Database Connection Failure",
    "description": "Failed to connect to primary database. Retrying...",
    "severity": "critical",
    "source": "database-monitor",
    "tags": {
      "service": "api",
      "environment": "production",
      "region": "us-east-1"
    },
    "channels": ["email", "pagerduty", "slack"],
    "metadata": {
      "error": "connection timeout",
      "lastConnectTime": "2024-01-01T12:00:00Z",
      "affectedServices": ["user-service", "order-service"]
    }
  }'
```

Response:
```json
{
  "success": true,
  "alert": {
    "id": "uuid",
    "title": "Database Connection Failure",
    "description": "Failed to connect to primary database. Retrying...",
    "severity": "critical",
    "source": "database-monitor",
    "status": "triggered",
    "timestamp": "2024-01-01T12:30:00Z",
    "externalIds": {
      "pagerduty": "dedup-key-123"
    }
  }
}
```

### Acknowledge Alert

```bash
curl -X PUT http://localhost:3000/api/alerts/{alert-id}/acknowledge \
  -H "Content-Type: application/json" \
  -d '{
    "acknowledgedBy": "alice@example.com"
  }'
```

### Resolve Alert

```bash
curl -X PUT http://localhost:3000/api/alerts/{alert-id}/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "resolvedBy": "alice@example.com"
  }'
```

## Alert Routing Rules

Define custom routing rules to automatically route alerts to appropriate teams:

```typescript
import { getAlertService } from './services/alert.service';

const alertService = getAlertService();

const routingRule = {
  id: 'rule-1',
  name: 'Critical Database Alerts to Platform Team',
  enabled: true,
  priority: 1,
  conditions: [
    {
      field: 'severity',
      operator: 'equals',
      value: 'critical'
    },
    {
      field: 'tags.service',
      operator: 'equals',
      value: 'database'
    }
  ],
  actions: [
    {
      type: 'route',
      schedule: 'platform-team-schedule-id'
    },
    {
      type: 'escalate',
      schedule: 'critical-escalation-policy-id',
      delay: 300 // 5 minutes
    }
  ]
};

// Store in Redis
await redis.setex('alert:routing-rules', 24 * 60 * 60, JSON.stringify([routingRule]));
```

## Alert Silencing

Silence alerts during maintenance windows:

```bash
curl -X POST http://localhost:3000/api/alerts/silence \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Database Maintenance",
    "enabled": true,
    "conditions": [
      {
        "field": "source",
        "operator": "equals",
        "value": "database-monitor"
      }
    ],
    "duration": 120,
    "reason": "Scheduled database maintenance"
  }'
```

## API Reference

### Alerts Endpoints

#### POST /api/alerts/trigger
Trigger a new alert.

**Request:**
```json
{
  "title": "string",
  "description": "string",
  "severity": "critical|high|medium|low|info",
  "source": "string",
  "tags": { "key": "value" },
  "channels": ["email", "pagerduty", "slack"],
  "metadata": { "key": "value" }
}
```

#### GET /api/alerts
List active alerts.

#### GET /api/alerts/:id
Get alert details.

#### PUT /api/alerts/:id/acknowledge
Acknowledge an alert.

#### PUT /api/alerts/:id/resolve
Resolve an alert.

### Schedule Endpoints

#### POST /api/schedules
Create a new on-call schedule.

#### GET /api/schedules
List all schedules.

#### GET /api/schedules/:id
Get schedule details.

#### GET /api/schedules/:id/oncall
Get current on-call person.

#### GET /api/schedules/:id/range
Get schedule for date range.
- Query params: `startDate`, `endDate` (ISO 8601)

#### POST /api/schedules/:id/layers
Add a layer (rotation) to schedule.

### Escalation Policy Endpoints

#### POST /api/escalation-policies
Create escalation policy.

#### GET /api/escalation-policies/:id
Get escalation policy.

#### POST /api/escalation-policies/:id/test
Test escalation policy configuration.

### PagerDuty Integration Endpoints

#### GET /api/integrations/pagerduty/health
Check PagerDuty integration health.

#### GET /api/integrations/pagerduty/incidents
List PagerDuty incidents.
- Query params: `statuses`, `limit`, `offset`

#### GET /api/integrations/pagerduty/incidents/:id
Get PagerDuty incident details.

## Advanced Usage

### Custom Alert Channel Implementation

To add a custom notification channel:

```typescript
// In alert.service.ts, extend sendNotification method
async sendNotification(alert: Alert, channel: AlertChannel, recipient: string) {
  switch (channel) {
    case 'custom-channel':
      await this.sendCustomNotification(alert, recipient);
      break;
    // ... other channels
  }
}

private async sendCustomNotification(alert: Alert, recipient: string): Promise<void> {
  // Your custom implementation
  logger.debug('Custom notification sent', { 
    alertId: alert.id, 
    recipient 
  });
}
```

### Programmatic Alert Triggering

```typescript
import { getAlertService } from './services/alert.service';
import { AlertSeverity } from './types/alerting.types';

const alertService = getAlertService();

// In your monitoring/health check code
try {
  await checkSystemHealth();
} catch (error) {
  await alertService.triggerAlert({
    title: 'System Health Check Failed',
    description: error.message,
    severity: AlertSeverity.HIGH,
    source: 'health-check',
    tags: {
      component: 'api-server',
      environment: process.env.NODE_ENV
    }
  });
}
```

### Webhook Integration

Receive alert updates via webhook:

```typescript
app.post('/webhooks/pagerduty/incidents', (req, res) => {
  const events = req.body.events || [];
  
  for (const event of events) {
    const { type, data } = event;
    
    switch (type) {
      case 'incident.triggered':
        // Handle triggered incident
        break;
      case 'incident.acknowledged':
        // Handle acknowledged incident
        break;
      case 'incident.resolved':
        // Handle resolved incident
        break;
    }
  }
  
  res.json({ success: true });
});
```

## Monitoring and Metrics

Track alerting system performance:

```typescript
// Get active alert count
const activeAlerts = await alertService.getActiveAlerts();
const criticalCount = activeAlerts.filter(a => a.severity === 'critical').length;

// Monitor on-call rotations
const schedules = await onCallService.listSchedules();
for (const schedule of schedules) {
  const onCallMember = await onCallService.getCurrentOnCall(schedule.id);
  console.log(`${schedule.name}: ${onCallMember?.name || 'None'}`);
}
```

## Best Practices

1. **Set Appropriate Severity Levels**
   - CRITICAL: Immediate action required, production outage
   - HIGH: Significant issue affecting functionality
   - MEDIUM: Notable issue, should be addressed soon
   - LOW: Minor issues, non-urgent
   - INFO: Informational messages

2. **Use Meaningful Alert Sources**
   - Use consistent naming: `service-monitor`, `health-check`, `synthetic-test`
   - Include environment context in tags

3. **Configure Escalation Policies**
   - Level 1: Primary on-call engineer
   - Level 2 (15-30 min): Backup engineer or team lead
   - Level 3 (30-60 min): Manager or director

4. **Implement Runbooks**
   - Include runbook links in alert metadata
   - Document troubleshooting steps for common issues

5. **Monitor False Positives**
   - Review alert history regularly
   - Adjust thresholds to reduce noise
   - Use silence rules for known issues during testing

6. **Maintain Schedule Hygiene**
   - Update schedules regularly
   - Ensure contact information is current
   - Test escalation policies regularly

## Troubleshooting

### PagerDuty Integration Not Working

1. Verify API key is valid:
```bash
curl -H "Authorization: Token token=YOUR_API_KEY" \
  https://api.pagerduty.com/users?limit=1
```

2. Check integration key format
3. Verify webhook URL is accessible and publicly available

### Alerts Not Being Routed Correctly

1. Review routing rules configuration
2. Check alert tags and conditions match
3. Verify on-call schedules are properly configured
4. Check Redis cache for routing rule data

### Escalation Policy Not Working

1. Test the policy:
```bash
curl -X POST http://localhost:3000/api/escalation-policies/{policy-id}/test
```

2. Verify all referenced schedules exist
3. Check schedule member contact information
4. Ensure notification channels are configured

## Related Files

- Service implementation: `src/services/alert.service.ts`
- PagerDuty integration: `src/services/pagerduty.service.ts`
- On-call management: `src/services/oncall.service.ts`
- API routes: `src/routes/alerting.routes.ts`
- Types: `src/types/alerting.types.ts`
- Database migrations: `migrations/1767000000000_add-alerting-tables.js`
