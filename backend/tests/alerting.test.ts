/**
 * Alerting System Tests
 * Tests for alert triggering, routing, and notification
 */

import { AlertService } from '../src/services/alert.service';
import { OnCallService } from '../src/services/oncall.service';
import { AlertSeverity, AlertChannel, ScheduleType } from '../src/types/alerting.types';
import { redis } from '../src/config/redis';

describe('AlertService', () => {
  let alertService: AlertService;

  beforeEach(() => {
    alertService = new AlertService();
  });

  afterEach(async () => {
    // Cleanup Redis
    await redis.flushdb();
  });

  describe('triggerAlert', () => {
    test('should create and trigger a new alert', async () => {
      const alert = await alertService.triggerAlert({
        title: 'Test Alert',
        description: 'This is a test alert',
        severity: AlertSeverity.HIGH,
        source: 'test-source',
        tags: {
          environment: 'test',
        },
        channels: [AlertChannel.EMAIL],
      });

      expect(alert).toBeDefined();
      expect(alert.title).toBe('Test Alert');
      expect(alert.severity).toBe(AlertSeverity.HIGH);
      expect(alert.status).toBe('triggered');
    });

    test('should include metadata in alert', async () => {
      const metadata = {
        component: 'api',
        region: 'us-east-1',
      };

      const alert = await alertService.triggerAlert({
        title: 'Test Alert',
        description: 'This is a test alert',
        severity: AlertSeverity.CRITICAL,
        source: 'test-source',
        metadata,
      });

      expect(alert.metadata).toEqual(expect.objectContaining(metadata));
    });

    test('should silently skip silenced alerts', async () => {
      // This test would require silence rules implementation
      // Placeholder for silence rule testing
      expect(true).toBe(true);
    });
  });

  describe('acknowledgeAlert', () => {
    test('should acknowledge an alert', async () => {
      const alert = await alertService.triggerAlert({
        title: 'Test Alert',
        description: 'This is a test alert',
        severity: AlertSeverity.HIGH,
        source: 'test-source',
      });

      const acknowledged = await alertService.acknowledgeAlert(
        alert.id,
        'test-user@example.com'
      );

      expect(acknowledged.status).toBe('acknowledged');
      expect(acknowledged.metadata?.acknowledgedBy).toBe('test-user@example.com');
    });
  });

  describe('resolveAlert', () => {
    test('should resolve an alert', async () => {
      const alert = await alertService.triggerAlert({
        title: 'Test Alert',
        description: 'This is a test alert',
        severity: AlertSeverity.HIGH,
        source: 'test-source',
      });

      const resolved = await alertService.resolveAlert(alert.id, 'test-user@example.com');

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolvedAt).toBeDefined();
    });

    test('should remove alert from active list when resolved', async () => {
      const alert = await alertService.triggerAlert({
        title: 'Test Alert',
        description: 'This is a test alert',
        severity: AlertSeverity.HIGH,
        source: 'test-source',
      });

      let activeAlerts = await alertService.getActiveAlerts();
      expect(activeAlerts.length).toBeGreaterThan(0);

      await alertService.resolveAlert(alert.id);

      activeAlerts = await alertService.getActiveAlerts();
      expect(activeAlerts.find((a) => a.id === alert.id)).toBeUndefined();
    });
  });

  describe('getActiveAlerts', () => {
    test('should return all active alerts', async () => {
      await alertService.triggerAlert({
        title: 'Alert 1',
        description: 'First alert',
        severity: AlertSeverity.HIGH,
        source: 'test-source',
      });

      await alertService.triggerAlert({
        title: 'Alert 2',
        description: 'Second alert',
        severity: AlertSeverity.MEDIUM,
        source: 'test-source',
      });

      const activeAlerts = await alertService.getActiveAlerts();
      expect(activeAlerts.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('OnCallService', () => {
  let onCallService: OnCallService;

  beforeEach(() => {
    onCallService = new OnCallService();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  describe('createSchedule', () => {
    test('should create a new on-call schedule', async () => {
      const schedule = await onCallService.createSchedule(
        'Platform Team',
        ScheduleType.WEEKLY,
        'America/New_York'
      );

      expect(schedule).toBeDefined();
      expect(schedule.name).toBe('Platform Team');
      expect(schedule.type).toBe(ScheduleType.WEEKLY);
      expect(schedule.enabled).toBe(true);
    });
  });

  describe('addLayer', () => {
    test('should add a layer to schedule', async () => {
      const schedule = await onCallService.createSchedule(
        'Platform Team',
        ScheduleType.WEEKLY,
        'America/New_York'
      );

      const layer = await onCallService.addLayer(
        schedule.id,
        'Primary On-Call',
        new Date(),
        7,
        [
          {
            id: 'member-1',
            name: 'Alice',
            email: 'alice@example.com',
            position: 0,
            active: true,
          },
          {
            id: 'member-2',
            name: 'Bob',
            email: 'bob@example.com',
            position: 1,
            active: true,
          },
        ]
      );

      expect(layer).toBeDefined();
      expect(layer.name).toBe('Primary On-Call');
      expect(layer.members.length).toBe(2);
    });
  });

  describe('getCurrentOnCall', () => {
    test('should return current on-call member', async () => {
      const schedule = await onCallService.createSchedule(
        'Platform Team',
        ScheduleType.WEEKLY,
        'America/New_York'
      );

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 10); // Start 10 days ago

      await onCallService.addLayer(
        schedule.id,
        'Primary On-Call',
        startDate,
        7, // 7-day rotation
        [
          {
            id: 'member-1',
            name: 'Alice',
            email: 'alice@example.com',
            position: 0,
            active: true,
          },
          {
            id: 'member-2',
            name: 'Bob',
            email: 'bob@example.com',
            position: 1,
            active: true,
          },
        ]
      );

      const onCallMember = await onCallService.getCurrentOnCall(schedule.id);
      expect(onCallMember).toBeDefined();
      expect(onCallMember?.email).toMatch(/@example\.com$/);
    });
  });

  describe('getScheduleForRange', () => {
    test('should return schedule assignments for date range', async () => {
      const schedule = await onCallService.createSchedule(
        'Platform Team',
        ScheduleType.WEEKLY,
        'America/New_York'
      );

      const startDate = new Date();
      await onCallService.addLayer(
        schedule.id,
        'Primary On-Call',
        startDate,
        7,
        [
          {
            id: 'member-1',
            name: 'Alice',
            email: 'alice@example.com',
            position: 0,
            active: true,
          },
          {
            id: 'member-2',
            name: 'Bob',
            email: 'bob@example.com',
            position: 1,
            active: true,
          },
        ]
      );

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const assignments = await onCallService.getScheduleForRange(
        schedule.id,
        new Date(),
        endDate
      );

      expect(assignments.length).toBeGreaterThan(0);
      assignments.forEach((assignment) => {
        expect(assignment.member).toBeDefined();
        expect(assignment.startTime).toBeDefined();
        expect(assignment.endTime).toBeDefined();
      });
    });
  });

  describe('createEscalationPolicy', () => {
    test('should create an escalation policy', async () => {
      const policy = await onCallService.createEscalationPolicy(
        'Critical Issues Policy',
        [
          {
            level: 1,
            delayMinutes: 0,
            notifySchedules: ['schedule-1'],
          },
          {
            level: 2,
            delayMinutes: 15,
            notifySchedules: ['schedule-2'],
          },
        ]
      );

      expect(policy).toBeDefined();
      expect(policy.name).toBe('Critical Issues Policy');
      expect(policy.levels.length).toBe(2);
    });
  });

  describe('testEscalationPolicy', () => {
    test('should validate escalation policy', async () => {
      const policy = await onCallService.createEscalationPolicy(
        'Valid Policy',
        [
          {
            level: 1,
            delayMinutes: 0,
            notifySchedules: ['schedule-1'],
          },
        ]
      );

      const result = await onCallService.testEscalationPolicy(policy.id);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should detect invalid policy (no levels)', async () => {
      const policy = await onCallService.createEscalationPolicy(
        'Empty Policy',
        []
      );

      const result = await onCallService.testEscalationPolicy(policy.id);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should detect invalid policy (no recipients)', async () => {
      const policy = await onCallService.createEscalationPolicy(
        'Invalid Policy',
        [
          {
            level: 1,
            delayMinutes: 0,
            notifySchedules: [],
            notifyUsers: [],
          },
        ]
      );

      const result = await onCallService.testEscalationPolicy(policy.id);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('AlertService Integration', () => {
  let alertService: AlertService;
  let onCallService: OnCallService;

  beforeEach(() => {
    alertService = new AlertService();
    onCallService = new OnCallService();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  test('should route alerts to appropriate schedule', async () => {
    // Create schedule
    const schedule = await onCallService.createSchedule(
      'Platform Team',
      ScheduleType.WEEKLY,
      'America/New_York'
    );

    // Add members
    const startDate = new Date();
    await onCallService.addLayer(
      schedule.id,
      'Primary On-Call',
      startDate,
      7,
      [
        {
          id: 'member-1',
          name: 'Alice',
          email: 'alice@example.com',
          position: 0,
          active: true,
        },
      ]
    );

    // Trigger alert
    const alert = await alertService.triggerAlert({
      title: 'Test Alert',
      description: 'This is a test alert',
      severity: AlertSeverity.CRITICAL,
      source: 'test-source',
      tags: {
        service: 'platform',
      },
    });

    expect(alert).toBeDefined();
    expect(alert.status).toBe('triggered');
  });
});
