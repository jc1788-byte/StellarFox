/**
 * Alert Management Service
 * Handles alert lifecycle, routing, and multi-channel notifications
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';
import { db } from '../db';
import {
  Alert,
  AlertStatus,
  AlertTriggerRequest,
  AlertChannel,
  AlertSeverity,
  AlertNotification,
  AlertRoutingRule,
  AlertCondition,
  EscalationPolicy,
  OnCallSchedule,
} from '../types/alerting.types';
import { getPagerDutyService } from './pagerduty.service';
import { EmailService } from './email.service';

const ALERT_KEY = (id: string) => `alert:${id}`;
const ACTIVE_ALERTS_KEY = 'alerts:active';
const ALERT_HISTORY_KEY = 'alerts:history';
const ROUTING_RULES_KEY = 'alert:routing-rules';
const SILENCED_ALERTS_KEY = 'alerts:silenced';

export class AlertService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * Trigger a new alert
   */
  async triggerAlert(request: AlertTriggerRequest): Promise<Alert> {
    try {
      const alert: Alert = {
        id: uuidv4(),
        title: request.title,
        description: request.description,
        severity: request.severity,
        source: request.source,
        tags: request.tags || {},
        timestamp: new Date(),
        status: AlertStatus.TRIGGERED,
        channels: request.channels || [AlertChannel.EMAIL, AlertChannel.PAGERDUTY],
        externalIds: {},
        metadata: request.metadata || {},
      };

      // Check silence rules
      if (await this.isSilenced(alert)) {
        logger.info('Alert silenced by rule', { alertId: alert.id });
        alert.status = AlertStatus.RESOLVED;
        return alert;
      }

      // Store alert
      await this.storeAlert(alert);

      // Add to active alerts
      await redis.zadd(ACTIVE_ALERTS_KEY, Date.now(), alert.id);

      // Process routing
      const routingResult = await this.processRouting(alert);

      // Send notifications
      await this.sendNotifications(alert, routingResult);

      logger.info('Alert triggered', {
        alertId: alert.id,
        severity: alert.severity,
        channels: alert.channels,
      });

      return alert;
    } catch (error) {
      logger.error('Failed to trigger alert', { error, request });
      throw error;
    }
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<Alert> {
    try {
      const alert = await this.getAlert(alertId);
      if (!alert) {
        throw new Error(`Alert not found: ${alertId}`);
      }

      alert.status = AlertStatus.ACKNOWLEDGED;
      alert.metadata = {
        ...alert.metadata,
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy,
      };

      await this.storeAlert(alert);

      // Acknowledge in PagerDuty
      if (alert.externalIds?.pagerduty) {
        try {
          await getPagerDutyService().acknowledgeIncident(
            alert.externalIds.pagerduty,
            acknowledgedBy,
          );
        } catch (error) {
          logger.warn('Failed to acknowledge in PagerDuty', { error, alertId });
        }
      }

      logger.info('Alert acknowledged', { alertId, acknowledgedBy });
      return alert;
    } catch (error) {
      logger.error('Failed to acknowledge alert', { error, alertId });
      throw error;
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolvedBy?: string): Promise<Alert> {
    try {
      const alert = await this.getAlert(alertId);
      if (!alert) {
        throw new Error(`Alert not found: ${alertId}`);
      }

      alert.status = AlertStatus.RESOLVED;
      alert.resolvedAt = new Date();
      alert.metadata = {
        ...alert.metadata,
        resolvedAt: new Date().toISOString(),
        resolvedBy: resolvedBy || 'system',
      };

      await this.storeAlert(alert);

      // Remove from active alerts
      await redis.zrem(ACTIVE_ALERTS_KEY, alertId);

      // Resolve in PagerDuty
      if (alert.externalIds?.pagerduty) {
        try {
          await getPagerDutyService().resolveIncident(
            alert.externalIds.pagerduty,
            resolvedBy || 'system',
          );
        } catch (error) {
          logger.warn('Failed to resolve in PagerDuty', { error, alertId });
        }
      }

      logger.info('Alert resolved', { alertId, resolvedBy });
      return alert;
    } catch (error) {
      logger.error('Failed to resolve alert', { error, alertId });
      throw error;
    }
  }

  /**
   * Get alert by ID
   */
  async getAlert(alertId: string): Promise<Alert | null> {
    try {
      const cached = await redis.get(ALERT_KEY(alertId));
      if (cached) {
        return JSON.parse(cached);
      }

      // Try to fetch from DB
      // This assumes you have a database table for alerts
      return null;
    } catch (error) {
      logger.error('Failed to get alert', { error, alertId });
      return null;
    }
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(): Promise<Alert[]> {
    try {
      const alertIds = await redis.zrange(ACTIVE_ALERTS_KEY, 0, -1);
      const alerts = await Promise.all(
        alertIds.map((id) => this.getAlert(id)),
      );
      return alerts.filter((alert): alert is Alert => alert !== null);
    } catch (error) {
      logger.error('Failed to get active alerts', { error });
      return [];
    }
  }

  /**
   * Process alert through routing rules
   */
  async processRouting(alert: Alert): Promise<{
    schedules: OnCallSchedule[];
    escalationPolicy?: EscalationPolicy;
    enrichedMetadata?: Record<string, any>;
  }> {
    try {
      const rules = await this.getRoutingRules();
      const matchedRules = rules.filter((rule) => this.matchesConditions(alert, rule.conditions));

      const schedules: OnCallSchedule[] = [];
      let escalationPolicy: EscalationPolicy | undefined;

      for (const rule of matchedRules) {
        for (const action of rule.actions) {
          if (action.type === 'route' && action.schedule) {
            const schedule = await this.getSchedule(action.schedule);
            if (schedule) {
              schedules.push(schedule);
            }
          } else if (action.type === 'escalate' && action.schedule) {
            escalationPolicy = await this.getEscalationPolicy(action.schedule);
          }
        }
      }

      return {
        schedules,
        escalationPolicy,
      };
    } catch (error) {
      logger.error('Failed to process routing', { error, alertId: alert.id });
      return { schedules: [] };
    }
  }

  /**
   * Send notifications to appropriate channels
   */
  async sendNotifications(
    alert: Alert,
    routing: {
      schedules: OnCallSchedule[];
      escalationPolicy?: EscalationPolicy;
    },
  ): Promise<void> {
    try {
      const recipients = this.getNotificationRecipients(routing);

      for (const channel of alert.channels) {
        for (const recipient of recipients) {
          await this.sendNotification(alert, channel, recipient);
        }
      }
    } catch (error) {
      logger.error('Failed to send notifications', { error, alertId: alert.id });
    }
  }

  /**
   * Send notification via specific channel
   */
  async sendNotification(alert: Alert, channel: AlertChannel, recipient: string): Promise<void> {
    try {
      const notification: AlertNotification = {
        id: uuidv4(),
        alertId: alert.id,
        channel,
        recipient,
        scheduledFor: new Date(),
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
      };

      switch (channel) {
        case AlertChannel.EMAIL:
          await this.emailService.sendAlertEmail(recipient, alert);
          break;

        case AlertChannel.PAGERDUTY:
          try {
            const result = await getPagerDutyService().triggerIncident(
              alert.title,
              alert.description,
              this.mapSeverity(alert.severity),
              `${alert.source}:${alert.id}`,
              alert.metadata,
            );
            alert.externalIds = alert.externalIds || {};
            alert.externalIds.pagerduty = result.dedup_key;
            await this.storeAlert(alert);
          } catch (error) {
            logger.warn('Failed to send PagerDuty notification', { error, alertId: alert.id });
          }
          break;

        case AlertChannel.SLACK:
          await this.sendSlackNotification(alert, recipient);
          break;

        case AlertChannel.SMS:
          await this.sendSmsNotification(alert, recipient);
          break;

        case AlertChannel.WEBHOOK:
          await this.sendWebhookNotification(alert, recipient);
          break;
      }

      notification.status = 'sent';
      notification.sentAt = new Date();
    } catch (error) {
      logger.error('Failed to send notification', {
        error,
        alertId: alert.id,
        channel,
        recipient,
      });
    }
  }

  /**
   * Check if alert matches silencing rules
   */
  async isSilenced(alert: Alert): Promise<boolean> {
    try {
      const silenceRules = await redis.lrange(SILENCED_ALERTS_KEY, 0, -1);

      for (const ruleJson of silenceRules) {
        const rule = JSON.parse(ruleJson);
        if (this.matchesConditions(alert, rule.conditions)) {
          const now = new Date();
          if (new Date(rule.expiresAt) > now) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      logger.warn('Failed to check silence rules', { error });
      return false;
    }
  }

  /**
   * Get matching routing rules
   */
  private async getRoutingRules(): Promise<AlertRoutingRule[]> {
    try {
      const rulesJson = await redis.get(ROUTING_RULES_KEY);
      return rulesJson ? JSON.parse(rulesJson) : [];
    } catch (error) {
      logger.warn('Failed to get routing rules', { error });
      return [];
    }
  }

  /**
   * Store alert in cache and database
   */
  private async storeAlert(alert: Alert): Promise<void> {
    try {
      const ttl = 24 * 60 * 60; // 24 hours
      await redis.setex(ALERT_KEY(alert.id), ttl, JSON.stringify(alert));

      // Also add to history
      await redis.zadd(ALERT_HISTORY_KEY, Date.now(), alert.id);
    } catch (error) {
      logger.error('Failed to store alert', { error, alertId: alert.id });
    }
  }

  /**
   * Check if alert conditions match
   */
  private matchesConditions(alert: Alert, conditions: AlertCondition[]): boolean {
    return conditions.every((condition) => this.matchesCondition(alert, condition));
  }

  /**
   * Check if alert matches a single condition
   */
  private matchesCondition(alert: Alert, condition: AlertCondition): boolean {
    const value = this.getFieldValue(alert, condition.field);

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'contains':
        return String(value).includes(String(condition.value));
      case 'regex':
        return new RegExp(String(condition.value)).test(String(value));
      case 'in':
        return (condition.value as any[]).includes(value);
      case 'gt':
        return Number(value) > Number(condition.value);
      case 'lt':
        return Number(value) < Number(condition.value);
      default:
        return false;
    }
  }

  /**
   * Get field value from alert using dot notation
   */
  private getFieldValue(alert: Alert, field: string): any {
    const parts = field.split('.')
    let value: any = alert;

    for (const part of parts) {
      value = value?.[part];
    }

    return value;
  }

  /**
   * Get notification recipients from routing result
   */
  private getNotificationRecipients(routing: {
    schedules: OnCallSchedule[];
    escalationPolicy?: EscalationPolicy;
  }): string[] {
    const recipients: Set<string> = new Set();

    // Add on-call members from schedules
    for (const schedule of routing.schedules) {
      for (const layer of schedule.layers) {
        for (const member of layer.members) {
          if (member.active) {
            recipients.add(member.email);
          }
        }
      }
    }

    return Array.from(recipients);
  }

  /**
   * Get on-call schedule
   */
  private async getSchedule(scheduleId: string): Promise<OnCallSchedule | null> {
    try {
      const cached = await redis.get(`schedule:${scheduleId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn('Failed to get schedule', { error, scheduleId });
      return null;
    }
  }

  /**
   * Get escalation policy
   */
  private async getEscalationPolicy(policyId: string): Promise<EscalationPolicy | null> {
    try {
      const cached = await redis.get(`escalation:${policyId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn('Failed to get escalation policy', { error, policyId });
      return null;
    }
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(alert: Alert, channel: string): Promise<void> {
    try {
      // Implementation would use Slack SDK
      logger.debug('Slack notification sent', { alertId: alert.id, channel });
    } catch (error) {
      logger.error('Failed to send Slack notification', { error, alertId: alert.id });
    }
  }

  /**
   * Send SMS notification
   */
  private async sendSmsNotification(alert: Alert, phoneNumber: string): Promise<void> {
    try {
      // Implementation would use SMS provider (Twilio, etc.)
      logger.debug('SMS notification sent', { alertId: alert.id, phoneNumber });
    } catch (error) {
      logger.error('Failed to send SMS notification', { error, alertId: alert.id });
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(alert: Alert, webhookUrl: string): Promise<void> {
    try {
      const axios = require('axios');
      await axios.post(webhookUrl, {
        alert,
        timestamp: new Date().toISOString(),
      });
      logger.debug('Webhook notification sent', { alertId: alert.id, webhookUrl });
    } catch (error) {
      logger.error('Failed to send webhook notification', { error, alertId: alert.id });
    }
  }

  /**
   * Map internal severity to PagerDuty severity
   */
  private mapSeverity(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return 'critical';
      case AlertSeverity.HIGH:
        return 'error';
      case AlertSeverity.MEDIUM:
        return 'warning';
      default:
        return 'info';
    }
  }
}

// Singleton instance
let alertService: AlertService | null = null;

/**
 * Get or initialize alert service
 */
export function getAlertService(): AlertService {
  if (!alertService) {
    alertService = new AlertService();
  }
  return alertService;
}
