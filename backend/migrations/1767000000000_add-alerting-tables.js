/**
 * Migration: Add alerting tables
 * Creates tables for alerts, on-call schedules, and escalation policies
 */

const { pgm } = require('node-pg-migrate');

exports.up = (pgm) => {
  // Alerts table
  pgm.createTable('alerts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    description: {
      type: 'text',
      notNull: true,
    },
    severity: {
      type: 'varchar(50)',
      notNull: true,
      check: "severity IN ('critical', 'high', 'medium', 'low', 'info')",
    },
    source: {
      type: 'varchar(255)',
      notNull: true,
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'triggered',
      check: "status IN ('triggered', 'acknowledged', 'resolved', 'escalated')",
    },
    tags: {
      type: 'jsonb',
      default: '{}',
    },
    metadata: {
      type: 'jsonb',
      default: '{}',
    },
    external_ids: {
      type: 'jsonb',
      default: '{}',
    },
    triggered_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    acknowledged_at: {
      type: 'timestamp',
    },
    resolved_at: {
      type: 'timestamp',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Create indexes for alerts
  pgm.createIndex('alerts', 'severity');
  pgm.createIndex('alerts', 'source');
  pgm.createIndex('alerts', 'status');
  pgm.createIndex('alerts', 'triggered_at');
  pgm.createIndex('alerts', ['severity', 'status']);
  pgm.createIndex('alerts', 'tags', { using: 'gin' });

  // Alert notifications table
  pgm.createTable('alert_notifications', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    alert_id: {
      type: 'uuid',
      notNull: true,
      references: 'alerts(id)',
      onDelete: 'cascade',
    },
    channel: {
      type: 'varchar(50)',
      notNull: true,
      check: "channel IN ('email', 'sms', 'slack', 'pagerduty', 'webhook')",
    },
    recipient: {
      type: 'varchar(255)',
      notNull: true,
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending', 'sent', 'failed', 'skipped')",
    },
    scheduled_for: {
      type: 'timestamp',
      notNull: true,
    },
    sent_at: {
      type: 'timestamp',
    },
    retry_count: {
      type: 'int',
      notNull: true,
      default: 0,
    },
    error: {
      type: 'text',
    },
    metadata: {
      type: 'jsonb',
      default: '{}',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('alert_notifications', 'alert_id');
  pgm.createIndex('alert_notifications', 'status');
  pgm.createIndex('alert_notifications', 'channel');

  // On-call schedules table
  pgm.createTable('oncall_schedules', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    type: {
      type: 'varchar(50)',
      notNull: true,
      check: "type IN ('weekly', 'biweekly', 'custom')",
    },
    timezone: {
      type: 'varchar(50)',
      notNull: true,
    },
    pagerduty_schedule_id: {
      type: 'varchar(255)',
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('oncall_schedules', 'enabled');

  // Schedule layers table
  pgm.createTable('schedule_layers', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    schedule_id: {
      type: 'uuid',
      notNull: true,
      references: 'oncall_schedules(id)',
      onDelete: 'cascade',
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    start_date: {
      type: 'timestamp',
      notNull: true,
    },
    end_date: {
      type: 'timestamp',
    },
    rotation_turn_length: {
      type: 'int',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('schedule_layers', 'schedule_id');

  // Schedule members table
  pgm.createTable('schedule_members', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    layer_id: {
      type: 'uuid',
      notNull: true,
      references: 'schedule_layers(id)',
      onDelete: 'cascade',
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
    },
    phone: {
      type: 'varchar(20)',
    },
    slack_id: {
      type: 'varchar(255)',
    },
    position: {
      type: 'int',
      notNull: true,
    },
    active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('schedule_members', 'layer_id');
  pgm.createIndex('schedule_members', 'email');

  // Escalation policies table
  pgm.createTable('escalation_policies', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    pagerduty_policy_id: {
      type: 'varchar(255)',
    },
    repeat_enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    repeat_count: {
      type: 'int',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Escalation levels table
  pgm.createTable('escalation_levels', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    policy_id: {
      type: 'uuid',
      notNull: true,
      references: 'escalation_policies(id)',
      onDelete: 'cascade',
    },
    level: {
      type: 'int',
      notNull: true,
    },
    delay_minutes: {
      type: 'int',
      notNull: true,
    },
    notify_schedules: {
      type: 'uuid[]',
      default: '{}',
    },
    notify_users: {
      type: 'uuid[]',
      default: '{}',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('escalation_levels', 'policy_id');

  // Alert routing rules table
  pgm.createTable('alert_routing_rules', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    priority: {
      type: 'int',
      notNull: true,
    },
    conditions: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    actions: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('alert_routing_rules', 'enabled');
  pgm.createIndex('alert_routing_rules', 'priority');

  // Alert silence rules table
  pgm.createTable('alert_silence_rules', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    conditions: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    duration: {
      type: 'int',
      notNull: true,
    },
    reason: {
      type: 'text',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    expires_at: {
      type: 'timestamp',
      notNull: true,
    },
  });

  pgm.createIndex('alert_silence_rules', 'enabled');
  pgm.createIndex('alert_silence_rules', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('alert_silence_rules', { ifExists: true });
  pgm.dropTable('alert_routing_rules', { ifExists: true });
  pgm.dropTable('escalation_levels', { ifExists: true });
  pgm.dropTable('escalation_policies', { ifExists: true });
  pgm.dropTable('schedule_members', { ifExists: true });
  pgm.dropTable('schedule_layers', { ifExists: true });
  pgm.dropTable('oncall_schedules', { ifExists: true });
  pgm.dropTable('alert_notifications', { ifExists: true });
  pgm.dropTable('alerts', { ifExists: true });
};
