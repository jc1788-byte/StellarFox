/**
 * Alerting System Types
 * Defines types for multi-channel alerting with PagerDuty integration
 */

// Alert severity levels
export enum AlertSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}

// Alert channels
export enum AlertChannel {
  EMAIL = 'email',
  SMS = 'sms',
  SLACK = 'slack',
  PAGERDUTY = 'pagerduty',
  WEBHOOK = 'webhook',
}

// Alert status
export enum AlertStatus {
  TRIGGERED = 'triggered',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  ESCALATED = 'escalated',
}

// PagerDuty event action types
export enum PagerDutyEventAction {
  TRIGGER = 'trigger',
  ACKNOWLEDGE = 'acknowledge',
  RESOLVE = 'resolve',
}

// On-call rotation schedule types
export enum ScheduleType {
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  CUSTOM = 'custom',
}

// Alert interface
export interface Alert {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  source: string;
  tags?: Record<string, string>;
  timestamp: Date;
  resolvedAt?: Date;
  status: AlertStatus;
  channels: AlertChannel[];
  externalIds?: Record<string, string>; // Map of channel -> external ID (e.g., PagerDuty incident ID)
  metadata?: Record<string, any>;
}

// Alert trigger request
export interface AlertTriggerRequest {
  title: string;
  description: string;
  severity: AlertSeverity;
  source: string;
  tags?: Record<string, string>;
  channels?: AlertChannel[];
  metadata?: Record<string, any>;
}

// PagerDuty integration config
export interface PagerDutyConfig {
  apiKey: string;
  integrationKey?: string;
  serverId?: string;
  enabled: boolean;
}

// PagerDuty event
export interface PagerDutyEvent {
  routing_key?: string;
  event_action: PagerDutyEventAction;
  dedup_key?: string;
  payload?: {
    summary: string;
    severity: string;
    source: string;
    timestamp?: string;
    custom_details?: Record<string, any>;
  };
  links?: Array<{
    href: string;
    text?: string;
  }>;
  client?: string;
  client_url?: string;
}

// PagerDuty incident
export interface PagerDutyIncident {
  id: string;
  incident_number: number;
  title: string;
  description: string;
  status: string;
  urgency: string;
  service?: {
    id: string;
    type: string;
    summary: string;
  };
  assignees?: Array<{
    id: string;
    type: string;
    summary: string;
  }>;
  escalation_policy?: {
    id: string;
    type: string;
    summary: string;
  };
  created_at: string;
  last_status_update_at: string;
}

// On-call schedule
export interface OnCallSchedule {
  id: string;
  name: string;
  type: ScheduleType;
  timezone: string;
  pagerDutyScheduleId?: string;
  enabled: boolean;
  layers: ScheduleLayer[];
  createdAt: Date;
  updatedAt: Date;
}

// Schedule layer for on-call rotation
export interface ScheduleLayer {
  id: string;
  scheduleId: string;
  name: string;
  startDate: Date;
  endDate?: Date;
  rotationTurnLength: number; // in days
  members: ScheduleMember[];
  escalationPolicy?: EscalationPolicy;
  createdAt: Date;
  updatedAt: Date;
}

// Member in on-call schedule
export interface ScheduleMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  slackId?: string;
  position: number; // Position in rotation
  active: boolean;
}

// Escalation policy
export interface EscalationPolicy {
  id: string;
  name: string;
  pagerDutyPolicyId?: string;
  levels: EscalationLevel[];
  repeatEnabled: boolean;
  repeatCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Escalation level
export interface EscalationLevel {
  level: number;
  delayMinutes: number;
  notifySchedules: string[]; // Schedule IDs to notify at this level
  notifyUsers?: string[]; // User IDs to notify at this level
}

// Alert notification
export interface AlertNotification {
  id: string;
  alertId: string;
  channel: AlertChannel;
  recipient: string;
  scheduledFor: Date;
  sentAt?: Date;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  retryCount: number;
  error?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

// Alert routing rule
export interface AlertRoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: AlertCondition[];
  actions: AlertRoutingAction[];
  createdAt: Date;
  updatedAt: Date;
}

// Alert condition for routing
export interface AlertCondition {
  field: string; // e.g., 'severity', 'source', 'tags.environment'
  operator: 'equals' | 'contains' | 'regex' | 'in' | 'gt' | 'lt';
  value: string | string[] | number;
}

// Alert routing action
export interface AlertRoutingAction {
  type: 'route' | 'silence' | 'enrich' | 'escalate';
  target?: string; // Schedule ID, team ID, etc.
  schedule?: string;
  delay?: number; // in seconds
  metadata?: Record<string, any>;
}

// Alert statistics
export interface AlertStatistics {
  total: number;
  triggered: number;
  acknowledged: number;
  resolved: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  averageResponseTime?: number; // in minutes
  averageResolutionTime?: number; // in minutes
}

// Silence/Suppression rule
export interface SilenceRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: AlertCondition[];
  duration: number; // in minutes
  createdAt: Date;
  expiresAt: Date;
  reason?: string;
}

// Alert context for template rendering
export interface AlertContext {
  alert: Alert;
  onCallSchedule?: OnCallSchedule;
  escalationPolicy?: EscalationPolicy;
  runbookUrl?: string;
  dashboardUrl?: string;
}
