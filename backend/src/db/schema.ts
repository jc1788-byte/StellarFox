import {
  pgTable,
  serial,
  text,
  numeric,
  bigserial,
  boolean,
  timestamp,
  integer,
  jsonb,
  date,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const markets = pgTable(
  'markets',
  {
    id: serial('id').primaryKey(),
    market_id: text('market_id').notNull().unique(),
    contract_address: text('contract_address').notNull(),
    match_id: text('match_id').notNull(),
    fighter_a: text('fighter_a').notNull(),
    fighter_b: text('fighter_b').notNull(),
    category: text('category').notNull().default('OTHER'),
    weight_class: text('weight_class').default(''),
    title_fight: boolean('title_fight').default(false),
    venue: text('venue').default(''),
    scheduled_at: timestamp('scheduled_at', { withTimezone: true }).defaultNow(),
    status: text('status').default('open'),
    outcome: text('outcome'),
    pool_a: numeric('pool_a').default('0'),
    pool_b: numeric('pool_b').default('0'),
    pool_draw: numeric('pool_draw').default('0'),
    total_pool: numeric('total_pool').default('0'),
    min_bet_amount: numeric('min_bet_amount').notNull().default('1000000'),
    fee_bps: integer('fee_bps').default(200),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
    oracle_used: text('oracle_used'),
    lock_before_secs: integer('lock_before_secs').default(3600),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    ledger_sequence: integer('ledger_sequence').default(0),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    deleted_by: text('deleted_by'),
  },
  (table) => ({
    market_id_idx: uniqueIndex('markets_market_id_idx').on(table.market_id),
    status_idx: index('markets_status_idx').on(table.status),
    category_idx: index('markets_category_idx').on(table.category),
    scheduled_at_idx: index('markets_scheduled_at_idx').on(table.scheduled_at),
    category_idx: index('markets_category_idx').on(sql`LOWER(${table.weight_class})`),
    search_idx: index('markets_search_idx').using(
      'gin',
      sql`to_tsvector('simple', concat_ws(' ', ${table.fighter_a}, ${table.fighter_b}, ${table.weight_class}, ${table.venue}))`,
    ),
  }),
);

export const probability_snapshots = pgTable(
  'probability_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    market_id: text('market_id').notNull(),
    sampled_at: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    probability_a: numeric('probability_a', { precision: 12, scale: 10 }).notNull(),
    probability_b: numeric('probability_b', { precision: 12, scale: 10 }).notNull(),
    probability_draw: numeric('probability_draw', { precision: 12, scale: 10 }).notNull(),
    pool_a: numeric('pool_a').notNull(),
    pool_b: numeric('pool_b').notNull(),
    pool_draw: numeric('pool_draw').notNull(),
    total_pool: numeric('total_pool').notNull(),
  },
  (table) => ({
    market_sample_unique_idx: uniqueIndex('probability_snapshots_market_sample_unique').on(
      table.market_id,
      table.sampled_at,
      table.source,
    ),
    market_sample_idx: index('probability_snapshots_market_sample_idx').on(
      table.market_id,
      table.sampled_at,
    ),
  }),
);

// ── Capacity Planning Tables ──────────────────────────────────────────────────

/** Resource metrics - current metric readings */
export const resourceMetrics = pgTable(
  'resource_metrics',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    resourceType: text('resource_type').notNull(), // cpu, memory, disk, connections, etc.
    metricName: text('metric_name').notNull(), // specific metric name
    value: numeric('value').notNull(),
    unit: text('unit').notNull(), // percentage, bytes, count, etc.
    hostId: text('host_id'), // server/container identifier
    serviceName: text('service_name'), // service generating metric
    metadata: jsonb('metadata'), // additional context
  },
  (table) => ({
    timestamp_idx: index('idx_resource_metrics_timestamp').on(table.timestamp),
    type_name_idx: index('idx_resource_metrics_type_name').on(table.resourceType, table.metricName),
  }),
);

/** Capacity trends - aggregated metrics over time periods */
export const capacityTrends = pgTable(
  'capacity_trends',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resourceType: text('resource_type').notNull(),
    metricName: text('metric_name').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    periodType: text('period_type').notNull(), // 'hourly', 'daily', 'weekly', 'monthly'
    avgValue: numeric('avg_value').notNull(),
    minValue: numeric('min_value').notNull(),
    maxValue: numeric('max_value').notNull(),
    p95Value: numeric('p95_value'),
    p99Value: numeric('p99_value'),
    sampleCount: integer('sample_count').notNull().default(1),
    trendDirection: text('trend_direction'), // 'increasing', 'decreasing', 'stable'
    trendRate: numeric('trend_rate'), // rate of change per day
    volatility: numeric('volatility'), // standard deviation as percent of mean
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resource_period_idx: index('idx_capacity_trends_resource_period').on(
      table.resourceType,
      table.metricName,
      table.periodType,
      table.periodStart,
    ),
  }),
);

/** Capacity forecasts - predicted future values */
export const capacityForecasts = pgTable(
  'capacity_forecasts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resourceType: text('resource_type').notNull(),
    metricName: text('metric_name').notNull(),
    forecastDate: date('forecast_date').notNull(),
    forecastTimestamp: timestamp('forecast_timestamp', { withTimezone: true }).notNull().defaultNow(),
    forecastMethod: text('forecast_method').notNull(), // 'linear_regression', 'exponential_smoothing', 'arima'
    forecastValue: numeric('forecast_value').notNull(),
    confidenceIntervalLower: numeric('confidence_interval_lower'),
    confidenceIntervalUpper: numeric('confidence_interval_upper'),
    confidenceLevel: numeric('confidence_level'), // 0-1
    modelRSquared: numeric('model_r_squared'), // R² fit value
    mape: numeric('mape'), // Mean Absolute Percentage Error
    actualValue: numeric('actual_value'), // actual value when known
    predictionError: numeric('prediction_error'), // error when actual is known
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resource_date_idx: index('idx_capacity_forecasts_resource_date').on(
      table.resourceType,
      table.metricName,
      table.forecastDate,
    ),
  }),
);

/** Capacity thresholds - alert thresholds */
export const capacityThresholds = pgTable(
  'capacity_thresholds',
  {
    id: serial('id').primaryKey(),
    resourceType: text('resource_type').notNull(),
    metricName: text('metric_name').notNull(),
    warningThreshold: numeric('warning_threshold').notNull(),
    criticalThreshold: numeric('critical_threshold').notNull(),
    forecastWarningDays: integer('forecast_warning_days').notNull().default(7),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/** Capacity alerts - alert history */
export const capacityAlerts = pgTable(
  'capacity_alerts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    thresholdId: integer('threshold_id'),
    resourceType: text('resource_type').notNull(),
    metricName: text('metric_name').notNull(),
    alertLevel: text('alert_level').notNull(), // 'warning', 'critical'
    currentValue: numeric('current_value').notNull(),
    thresholdValue: numeric('threshold_value').notNull(),
    alertType: text('alert_type'), // 'current_value', 'forecast_based'
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resolved_idx: index('idx_capacity_alerts_resolved').on(table.resolvedAt),
  }),
);

/** Capacity recommendations - actionable recommendations */
export const capacityRecommendations = pgTable(
  'capacity_recommendations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resourceType: text('resource_type').notNull(),
    metricName: text('metric_name').notNull(),
    recommendation: text('recommendation').notNull(),
    urgency: text('urgency').notNull(), // 'low', 'medium', 'high'
    recommendedAction: text('recommended_action'),
    estimatedImpact: text('estimated_impact'),
    implementationEffort: text('implementation_effort'), // 'easy', 'moderate', 'difficult'
    forecastDate: date('forecast_date'),
    implemented: boolean('implemented').default(false),
    implementedAt: timestamp('implemented_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    urgency_idx: index('idx_capacity_recommendations_urgency').on(table.urgency),
  }),
);

export const bets = pgTable(
  'bets',
  {
    id: serial('id').primaryKey(),
    market_id: text('market_id').notNull().references(() => markets.market_id),
    bettor_address: text('bettor_address').notNull(),
    side: text('side').notNull(),
    amount: numeric('amount').notNull(),
    amount_xlm: numeric('amount_xlm').default('0'),
    placed_at: timestamp('placed_at', { withTimezone: true }).defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    claimed: boolean('claimed').default(false),
    claimed_at: timestamp('claimed_at', { withTimezone: true }),
    payout: numeric('payout'),
    tx_hash: text('tx_hash').notNull().unique(),
    ledger_sequence: integer('ledger_sequence').default(0),
  },
  (table) => ({
    market_id_idx: index('bets_market_id_idx').on(table.market_id),
    bettor_address_idx: index('bets_bettor_address_idx').on(table.bettor_address),
    expires_at_idx: index('bets_expires_at_idx').on(table.expires_at),
    market_id_claimed_idx: index('bets_market_id_claimed_idx').on(table.market_id, table.claimed),
    tx_hash_idx: uniqueIndex('bets_tx_hash_idx').on(table.tx_hash),
  }),
);

export const blockchain_events = pgTable(
  'blockchain_events',
  {
    id: serial('id').primaryKey(),
    contract_address: text('contract_address').notNull(),
    event_type: text('event_type').notNull(),
    payload: jsonb('payload').default('{}'),
    ledger_sequence: integer('ledger_sequence').notNull(),
    ledger_close_time: timestamp('ledger_close_time', { withTimezone: true }).defaultNow(),
    tx_hash: text('tx_hash').notNull().unique(),
    processed: boolean('processed').default(false),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tx_hash_idx: uniqueIndex('blockchain_events_tx_hash_idx').on(table.tx_hash),
    processed_idx: index('blockchain_events_processed_idx').on(table.processed),
  }),
);

export const indexer_checkpoints = pgTable('indexer_checkpoints', {
  id: serial('id').primaryKey(),
  last_processed_ledger: integer('last_processed_ledger').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const indexer_ledger_ranges = pgTable(
  'indexer_ledger_ranges',
  {
    id: serial('id').primaryKey(),
    start_ledger: integer('start_ledger').notNull(),
    end_ledger: integer('end_ledger').notNull(),
    processed_at: timestamp('processed_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    rangeUnique: uniqueIndex('indexer_ledger_ranges_range_unique').on(
      table.start_ledger,
      table.end_ledger,
    ),
    startIdx: index('indexer_ledger_ranges_start_idx').on(table.start_ledger),
  }),
);

export const oracle_reports = pgTable(
  'oracle_reports',
  {
    id: serial('id').primaryKey(),
    match_id: text('match_id').notNull(),
    oracle_address: text('oracle_address').notNull(),
    outcome: text('outcome').notNull(),
    reported_at: timestamp('reported_at', { withTimezone: true }).notNull(),
    signature: text('signature').notNull(),
    accepted: boolean('accepted').default(false),
    tx_hash: text('tx_hash'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    match_id_idx: index('oracle_reports_match_id_idx').on(table.match_id),
    oracle_address_idx: index('oracle_reports_oracle_address_idx').on(table.oracle_address),
  }),
);

export const notification_jobs = pgTable(
  'notification_jobs',
  {
    id: serial('id').primaryKey(),
    bettor_address: text('bettor_address').notNull(),
    market_id: text('market_id').notNull().references(() => markets.market_id),
    job_type: text('job_type').notNull(),
    status: text('status').default('pending'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    market_id_idx: index('notification_jobs_market_id_idx').on(table.market_id),
    status_idx: index('notification_jobs_status_idx').on(table.status),
  }),
);

export const disputes = pgTable(
  'disputes',
  {
    id: serial('id').primaryKey(),
    market_id: text('market_id').notNull().references(() => markets.market_id),
    user_id: text('user_id'),
    reason: text('reason').notNull(),
    evidence_url: text('evidence_url'),
    status: text('status').default('open'),
    admin_notes: text('admin_notes'),
    final_outcome: text('final_outcome'),
    raised_at: timestamp('raised_at', { withTimezone: true }).defaultNow(),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    market_id_idx: index('disputes_market_id_idx').on(table.market_id),
    status_idx: index('disputes_status_idx').on(table.status),
    user_id_idx: index('disputes_user_id_idx').on(table.user_id),
  }),
);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    password_hash: text('password_hash').notNull(),
    stellar_address: text('stellar_address'),
    email_verified: boolean('email_verified').default(false),
    two_factor_enabled: boolean('two_factor_enabled').default(false),
    two_factor_secret: text('two_factor_secret'), // AES-GCM encrypted
    role: text('role').default('user'), // 'user' | 'admin'
    session_version: integer('session_version').default(0),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    email_idx: uniqueIndex('users_email_idx').on(table.email),
  }),
);

export const user_sessions = pgTable(
  'user_sessions',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    session_token: text('session_token').notNull().unique(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('user_sessions_user_id_idx').on(table.user_id),
    expires_at_idx: index('user_sessions_expires_at_idx').on(table.expires_at),
  }),
);

export const password_reset_tokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull(),
    token_hash: text('token_hash').notNull().unique(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('password_reset_tokens_user_id_idx').on(table.user_id),
    expires_at_idx: index('password_reset_tokens_expires_at_idx').on(table.expires_at),
  }),
);

export const distributions = pgTable(
  'distributions',
  {
    id: serial('id').primaryKey(),
    market_id: text('market_id').notNull().references(() => markets.market_id),
    bettor_address: text('bettor_address').notNull(),
    amount: numeric('amount').notNull(),
    status: text('status').default('pending'),
    tx_hash: text('tx_hash'),
    archived_at: timestamp('archived_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    market_id_idx: index('distributions_market_id_idx').on(table.market_id),
    status_idx: index('distributions_status_idx').on(table.status),
    created_at_idx: index('distributions_created_at_idx').on(table.created_at),
  }),
);

export const shares = pgTable(
  'shares',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull(),
    market_id: text('market_id').notNull().references(() => markets.market_id),
    outcome_id: integer('outcome_id').notNull(),
    quantity: numeric('quantity').notNull(),
    cost_basis: numeric('cost_basis').notNull(),
    realized_pnl: numeric('realized_pnl').default('0'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('shares_user_id_idx').on(table.user_id),
    market_id_idx: index('shares_market_id_idx').on(table.market_id),
    user_market_outcome_idx: uniqueIndex('shares_user_market_outcome_idx').on(
      table.user_id,
      table.market_id,
      table.outcome_id
    ),
  }),
);

export const proposals = pgTable(
  'proposals',
  {
    id: serial('id').primaryKey(),
    proposal_id: text('proposal_id').notNull().unique(),
    type: text('type').notNull(), // 'fee_rate' | 'add_token' | 'remove_token' | 'max_discount_rate'
    value: text('value').notNull(), // Stored as string; numeric or address depending on type
    description: text('description').notNull(),
    status: text('status').default('active'), // 'active' | 'passed' | 'failed' | 'executed'
    proposer: text('proposer').notNull(),
    votes_for: numeric('votes_for').default('0'),
    votes_against: numeric('votes_against').default('0'),
    votes_abstain: numeric('votes_abstain').default('0'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    executed_at: timestamp('executed_at', { withTimezone: true }),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    proposal_id_idx: uniqueIndex('proposals_proposal_id_idx').on(table.proposal_id),
    status_idx: index('proposals_status_idx').on(table.status),
    created_at_idx: index('proposals_created_at_idx').on(table.created_at),
  }),
);

export const user_streaks = pgTable(
  'user_streaks',
  {
    id: serial('id').primaryKey(),
    address: text('address').notNull(),
    current_streak: integer('current_streak').notNull().default(0),
    best_streak: integer('best_streak').notNull().default(0),
    total_predictions: integer('total_predictions').notNull().default(0),
    last_prediction_date: date('last_prediction_date'),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    address_idx: uniqueIndex('user_streaks_address_idx').on(table.address),
  }),
);

export const achievements = pgTable(
  'achievements',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull().default('general'), // 'streak' | 'volume' | 'referral' | 'general'
    threshold: integer('threshold').notNull().default(0),
    reward_label: text('reward_label').notNull().default(''),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    code_idx: uniqueIndex('achievements_code_idx').on(table.code),
  }),
);

export const user_achievements = pgTable(
  'user_achievements',
  {
    id: serial('id').primaryKey(),
    address: text('address').notNull(),
    achievement_id: integer('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    earned_at: timestamp('earned_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    address_idx: index('user_achievements_address_idx').on(table.address),
    address_achievement_unique: uniqueIndex('user_achievements_address_achievement_idx').on(
      table.address,
      table.achievement_id,
    ),
  }),
);

export const referrals = pgTable(
  'referrals',
  {
    id: serial('id').primaryKey(),
    referrer_address: text('referrer_address').notNull(),
    referred_address: text('referred_address').notNull(),
    referral_code: text('referral_code').notNull(),
    status: text('status').notNull().default('active'), // 'active' | 'converted'
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    converted_at: timestamp('converted_at', { withTimezone: true }),
  },
  (table) => ({
    referred_address_idx: uniqueIndex('referrals_referred_address_idx').on(table.referred_address),
    referrer_address_idx: index('referrals_referrer_address_idx').on(table.referrer_address),
  }),
);

export const referral_payouts = pgTable(
  'referral_payouts',
  {
    id: serial('id').primaryKey(),
    referrer_address: text('referrer_address').notNull(),
    referred_address: text('referred_address').notNull(),
    level: integer('level').notNull().default(1),
    amount: numeric('amount').notNull().default('0'),
    source_amount: numeric('source_amount').notNull().default('0'),
    rate_bps: integer('rate_bps').notNull().default(0),
    status: text('status').notNull().default('pending'), // 'pending' | 'paid'
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    referrer_address_idx: index('referral_payouts_referrer_address_idx').on(table.referrer_address),
  }),
);

export const user_notifications = pgTable(
  'user_notifications',
  {
    id: serial('id').primaryKey(),
    address: text('address').notNull(),
    type: text('type').notNull(), // 'streak' | 'achievement' | 'referral' | 'leaderboard'
    title: text('title').notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload').default('{}'),
    read: boolean('read').default(false),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    address_idx: index('user_notifications_address_idx').on(table.address),
    read_idx: index('user_notifications_read_idx').on(table.read),
  }),
);

// ============================================================================
// Security Features: MFA, Secrets, ABAC, Scanning
// ============================================================================

// MFA Credentials table
export const mfaCredentials = pgTable(
  'mfa_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'totp' | 'sms' | 'email' | 'biometric'
    credential: text('credential').notNull(), // encrypted secret
    backupCodes: text('backup_codes'), // encrypted JSON array
    isEnabled: boolean('is_enabled').default(false),
    isVerified: boolean('is_verified').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
  },
  (table) => ({
    userId_idx: index('mfa_credentials_user_id_idx').on(table.userId),
    type_idx: index('mfa_credentials_type_idx').on(table.type),
  }),
);

// MFA Audit Log table
export const mfaAuditLog = pgTable(
  'mfa_audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    action: text('action').notNull(), // 'mfa_registered', 'mfa_enabled', 'mfa_disabled', etc.
    mfaType: text('mfa_type'),
    success: boolean('success').default(true),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userId_idx: index('mfa_audit_log_user_id_idx').on(table.userId),
    action_idx: index('mfa_audit_log_action_idx').on(table.action),
    timestamp_idx: index('mfa_audit_log_timestamp_idx').on(table.timestamp),
  }),
);

// Encrypted Secrets table
export const encryptedSecrets = pgTable(
  'encrypted_secrets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    type: text('type').notNull(), // 'api_key' | 'database_url' | 'token' | 'custom'
    encryptedValue: text('encrypted_value').notNull(),
    iv: text('iv').notNull(), // initialization vector
    authTag: text('auth_tag').notNull(), // authentication tag for GCM
    isRotated: boolean('is_rotated').default(false),
    rotationInterval: integer('rotation_interval'), // days
    nextRotationAt: timestamp('next_rotation_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => ({
    name_idx: uniqueIndex('encrypted_secrets_name_idx').on(table.name),
    type_idx: index('encrypted_secrets_type_idx').on(table.type),
    nextRotationAt_idx: index('encrypted_secrets_next_rotation_idx').on(table.nextRotationAt),
  }),
);

// Secret Rotation Log table
export const secretRotationLog = pgTable(
  'secret_rotation_log',
  {
    id: text('id').primaryKey(),
    secretId: text('secret_id').notNull().references(() => encryptedSecrets.id, { onDelete: 'cascade' }),
    oldEncryptedValue: text('old_encrypted_value').notNull(),
    newEncryptedValue: text('new_encrypted_value').notNull(),
    oldIv: text('old_iv').notNull(),
    newIv: text('new_iv').notNull(),
    oldAuthTag: text('old_auth_tag').notNull(),
    newAuthTag: text('new_auth_tag').notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }).defaultNow(),
    rotatedBy: text('rotated_by').notNull(),
    reason: text('reason').default('scheduled'),
    status: text('status').notNull(), // 'pending' | 'completed' | 'failed'
  },
  (table) => ({
    secretId_idx: index('secret_rotation_log_secret_id_idx').on(table.secretId),
    rotatedAt_idx: index('secret_rotation_log_rotated_at_idx').on(table.rotatedAt),
  }),
);

// Secret Audit Log table
export const secretAuditLog = pgTable(
  'secret_audit_log',
  {
    id: text('id').primaryKey(),
    secretId: text('secret_id').notNull(),
    action: text('action').notNull(), // 'secret_created', 'secret_accessed', 'secret_rotated', etc.
    userId: text('user_id').notNull(),
    success: boolean('success').default(true),
    details: text('details'),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    secretId_idx: index('secret_audit_log_secret_id_idx').on(table.secretId),
    userId_idx: index('secret_audit_log_user_id_idx').on(table.userId),
    action_idx: index('secret_audit_log_action_idx').on(table.action),
    timestamp_idx: index('secret_audit_log_timestamp_idx').on(table.timestamp),
  }),
);

// ABAC Policies table
export const abacPolicies = pgTable(
  'abac_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    effect: text('effect').notNull(), // 'allow' | 'deny'
    subjectPolicy: text('subject_policy').notNull(), // JSON-serialized condition
    actionPolicy: text('action_policy').notNull(), // JSON-serialized condition
    resourcePolicy: text('resource_policy').notNull(), // JSON-serialized condition
    conditionPolicy: text('condition_policy'), // JSON-serialized condition (optional)
    priority: integer('priority').default(0),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    isEnabled: boolean('is_enabled').default(true),
  },
  (table) => ({
    name_idx: index('abac_policies_name_idx').on(table.name),
    effect_idx: index('abac_policies_effect_idx').on(table.effect),
    priority_idx: index('abac_policies_priority_idx').on(table.priority),
  }),
);

// ABAC Audit Log table
export const abacAuditLog = pgTable(
  'abac_audit_log',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(), // 'access_granted', 'access_denied', 'policy_created', etc.
    resourceId: text('resource_id').notNull(),
    userId: text('user_id').notNull(),
    success: boolean('success').default(true),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    resourceId_idx: index('abac_audit_log_resource_id_idx').on(table.resourceId),
    userId_idx: index('abac_audit_log_user_id_idx').on(table.userId),
    action_idx: index('abac_audit_log_action_idx').on(table.action),
    timestamp_idx: index('abac_audit_log_timestamp_idx').on(table.timestamp),
  }),
);

// Security Scan Results table
export const securityScanResults = pgTable(
  'security_scan_results',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(), // 'sast' | 'dast' | 'dependency' | 'container'
    status: text('status').notNull(), // 'pending' | 'running' | 'completed' | 'failed'
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    resultsPath: text('results_path'),
    totalIssues: integer('total_issues').default(0),
    criticalIssues: integer('critical_issues').default(0),
    highIssues: integer('high_issues').default(0),
    mediumIssues: integer('medium_issues').default(0),
    lowIssues: integer('low_issues').default(0),
    logs: text('logs'),
  },
  (table) => ({
    type_idx: index('security_scan_results_type_idx').on(table.type),
    status_idx: index('security_scan_results_status_idx').on(table.status),
    startedAt_idx: index('security_scan_results_started_at_idx').on(table.startedAt),
  }),
);

// Security Vulnerabilities table
export const securityVulnerabilities = pgTable(
  'security_vulnerabilities',
  {
    id: text('id').primaryKey(),
    scanId: text('scan_id').notNull().references(() => securityScanResults.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'CVE', 'secret_leak', 'code_injection', etc.
    severity: text('severity').notNull(), // 'critical' | 'high' | 'medium' | 'low' | 'info'
    title: text('title').notNull(),
    description: text('description'),
    affectedComponent: text('affected_component').notNull(),
    affectedVersion: text('affected_version'),
    remediationAdvice: text('remediation_advice'),
    cvssScore: numeric('cvss_score', { precision: 4, scale: 1 }),
    cweId: text('cwe_id'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
    status: text('status').notNull(), // 'open' | 'acknowledged' | 'remediated' | 'false_positive'
  },
  (table) => ({
    scanId_idx: index('security_vulnerabilities_scan_id_idx').on(table.scanId),
    severity_idx: index('security_vulnerabilities_severity_idx').on(table.severity),
    status_idx: index('security_vulnerabilities_status_idx').on(table.status),
// Analytics tables
export const analyticsUserSessions = pgTable(
  'user_sessions',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    session_id: text('session_id').notNull().unique(),
    device_info: jsonb('device_info'),
    browser: text('browser'),
    os: text('os'),
    ip_address: text('ip_address'),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    ended_at: timestamp('ended_at', { withTimezone: true }),
    duration_seconds: integer('duration_seconds'),
    page_views: integer('page_views').default(0),
    events_count: integer('events_count').default(0),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('user_sessions_user_id_idx').on(table.user_id),
    session_id_idx: index('user_sessions_session_id_idx').on(table.session_id),
    started_at_idx: index('user_sessions_started_at_idx').on(table.started_at),
  }),
);

export const analyticsUserEvents = pgTable(
  'user_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    session_id: text('session_id').notNull().references(() => analyticsUserSessions.session_id, { onDelete: 'cascade' }),
    event_type: text('event_type').notNull(),
    event_name: text('event_name').notNull(),
    page_url: text('page_url'),
    referrer_url: text('referrer_url'),
    event_data: jsonb('event_data'),
    duration_ms: integer('duration_ms'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('user_events_user_id_idx').on(table.user_id),
    session_id_idx: index('user_events_session_id_idx').on(table.session_id),
    event_type_idx: index('user_events_event_type_idx').on(table.event_type),
    event_name_idx: index('user_events_event_name_idx').on(table.event_name),
    timestamp_idx: index('user_events_timestamp_idx').on(table.timestamp),
  }),
);

export const pageAnalytics = pgTable(
  'page_analytics',
  {
    id: serial('id').primaryKey(),
    page_url: text('page_url').notNull(),
    page_name: text('page_name').notNull(),
    date: date('date').notNull(),
    unique_visitors: integer('unique_visitors').default(0),
    page_views: integer('page_views').default(0),
    avg_time_on_page_seconds: numeric('avg_time_on_page_seconds').default('0'),
    bounce_rate: numeric('bounce_rate', { precision: 5, scale: 2 }).default('0'),
    scroll_depth_avg: numeric('scroll_depth_avg', { precision: 5, scale: 2 }).default('0'),
    ctr: numeric('ctr', { precision: 5, scale: 2 }).default('0'),
    conversion_rate: numeric('conversion_rate', { precision: 5, scale: 2 }).default('0'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    page_url_date_idx: index('page_analytics_page_url_date_idx').on(table.page_url, table.date),
    date_idx: index('page_analytics_date_idx').on(table.date),
  }),
);

export const heatmapData = pgTable(
  'heatmap_data',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    session_id: text('session_id').notNull().references(() => analyticsUserSessions.session_id, { onDelete: 'cascade' }),
    page_url: text('page_url').notNull(),
    interaction_type: text('interaction_type').notNull(),
    x_coordinate: integer('x_coordinate').notNull(),
    y_coordinate: integer('y_coordinate').notNull(),
    element_id: text('element_id'),
    element_class: text('element_class'),
    element_text: text('element_text'),
    viewport_width: integer('viewport_width'),
    viewport_height: integer('viewport_height'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('heatmap_data_user_id_idx').on(table.user_id),
    session_id_idx: index('heatmap_data_session_id_idx').on(table.session_id),
    page_url_idx: index('heatmap_data_page_url_idx').on(table.page_url),
    interaction_type_idx: index('heatmap_data_interaction_type_idx').on(table.interaction_type),
  }),
);

export const sessionRecordings = pgTable(
  'session_recordings',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    session_id: text('session_id').notNull().references(() => analyticsUserSessions.session_id, { onDelete: 'cascade' }),
    recording_url: text('recording_url'),
    storage_key: text('storage_key'),
    duration_seconds: integer('duration_seconds'),
    event_count: integer('event_count').default(0),
    file_size_bytes: bigserial('file_size_bytes'),
    status: text('status').default('processing'),
    started_at: timestamp('started_at', { withTimezone: true }).notNull(),
    ended_at: timestamp('ended_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('session_recordings_user_id_idx').on(table.user_id),
    session_id_idx: index('session_recordings_session_id_idx').on(table.session_id),
    status_idx: index('session_recordings_status_idx').on(table.status),
  }),
);

export const heatmapAggregates = pgTable(
  'heatmap_aggregates',
  {
    id: serial('id').primaryKey(),
    page_url: text('page_url').notNull(),
    date: date('date').notNull(),
    interaction_type: text('interaction_type').notNull(),
    heatmap_json: jsonb('heatmap_json').notNull(),
    sample_count: integer('sample_count').default(0),
    grid_size: integer('grid_size').default(50),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    page_url_date_interaction_idx: index('heatmap_aggregates_page_url_date_interaction_idx').on(
      table.page_url,
      table.date,
      table.interaction_type,
    ),
    page_url_interaction_idx: index('heatmap_aggregates_page_url_interaction_idx').on(
      table.page_url,
      table.interaction_type,
    ),
  }),
);

export const userAnalyticsSummary = pgTable(
  'user_analytics_summary',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    sessions_count: integer('sessions_count').default(0),
    page_views: integer('page_views').default(0),
    events_count: integer('events_count').default(0),
    total_time_seconds: integer('total_time_seconds').default(0),
    unique_pages_visited: integer('unique_pages_visited').default(0),
    conversions: integer('conversions').default(0),
    conversion_value: numeric('conversion_value', { precision: 15, scale: 2 }).default('0'),
    goals_completed: jsonb('goals_completed'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_date_idx: index('user_analytics_summary_user_id_date_idx').on(table.user_id, table.date),
    date_idx: index('user_analytics_summary_date_idx').on(table.date),
  }),
);

export const analyticsCustomEvents = pgTable(
  'analytics_custom_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    user_id: text('user_id'),
    event_category: text('event_category').notNull(),
    event_label: text('event_label').notNull(),
    event_value: integer('event_value'),
    event_metadata: jsonb('event_metadata'),
    page_url: text('page_url'),
    session_id: text('session_id'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('analytics_custom_events_user_id_idx').on(table.user_id),
    event_category_idx: index('analytics_custom_events_event_category_idx').on(table.event_category),
    event_category_timestamp_idx: index('analytics_custom_events_event_category_timestamp_idx').on(
      table.event_category,
      table.timestamp,
    ),
    timestamp_idx: index('analytics_custom_events_timestamp_idx').on(table.timestamp),
  }),
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type Bet = typeof bets.$inferSelect;
export type NewBet = typeof bets.$inferInsert;
export type BlockchainEvent = typeof blockchain_events.$inferSelect;
export type OracleReport = typeof oracle_reports.$inferSelect;
export type NotificationJob = typeof notification_jobs.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;
export type NewDispute = typeof disputes.$inferInsert;
export type User = typeof users.$inferSelect;
export type MFACredential = typeof mfaCredentials.$inferSelect;
export type EncryptedSecret = typeof encryptedSecrets.$inferSelect;
export type ABACPolicy = typeof abacPolicies.$inferSelect;
export type SecurityScanResult = typeof securityScanResults.$inferSelect;
export type SecurityVulnerability = typeof securityVulnerabilities.$inferSelect;
export type AnalyticsUserSession = typeof analyticsUserSessions.$inferSelect;
export type NewAnalyticsUserSession = typeof analyticsUserSessions.$inferInsert;
export type AnalyticsUserEvent = typeof analyticsUserEvents.$inferSelect;
export type NewAnalyticsUserEvent = typeof analyticsUserEvents.$inferInsert;
export type PageAnalytics = typeof pageAnalytics.$inferSelect;
export type HeatmapData = typeof heatmapData.$inferSelect;
export type NewHeatmapData = typeof heatmapData.$inferInsert;
export type SessionRecording = typeof sessionRecordings.$inferSelect;
export type HeatmapAggregate = typeof heatmapAggregates.$inferSelect;
export type UserAnalyticsSummary = typeof userAnalyticsSummary.$inferSelect;
export type AnalyticsCustomEvent = typeof analyticsCustomEvents.$inferSelect;
export type NewAnalyticsCustomEvent = typeof analyticsCustomEvents.$inferInsert;
export type NewUser = typeof users.$inferInsert;
export type UserSession = typeof user_sessions.$inferSelect;
export type PasswordResetToken = typeof password_reset_tokens.$inferSelect;
export type Distribution = typeof distributions.$inferSelect;
export type NewDistribution = typeof distributions.$inferInsert;
export type Share = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;

export const user_streaks = pgTable(
  'user_streaks',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id),
    current_streak: integer('current_streak').default(0),
    longest_streak: integer('longest_streak').default(0),
    total_wins: integer('total_wins').default(0),
    total_losses: integer('total_losses').default(0),
    last_result: text('last_result'), // 'win' | 'loss'
    last_resolved_at: timestamp('last_resolved_at', { withTimezone: true }),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: uniqueIndex('user_streaks_user_id_idx').on(table.user_id),
  }),
);

export const achievements = pgTable(
  'achievements',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    criteria: jsonb('criteria').default('{}'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    code_idx: uniqueIndex('achievements_code_idx').on(table.code),
  }),
);

export const user_achievements = pgTable(
  'user_achievements',
  {
    id: serial('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id),
    achievement_code: text('achievement_code').notNull().references(() => achievements.code),
    awarded_at: timestamp('awarded_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    user_id_idx: index('user_achievements_user_id_idx').on(table.user_id),
    user_achievement_idx: uniqueIndex('user_achievements_user_achievement_idx').on(
      table.user_id,
      table.achievement_code,
    ),
  }),
);

export const referrals = pgTable(
  'referrals',
  {
    id: serial('id').primaryKey(),
    referrer_id: text('referrer_id').notNull().references(() => users.id),
    referred_id: text('referred_id').notNull().references(() => users.id),
    status: text('status').default('pending'), // 'pending' | 'active'
    bonus_rate_bps: integer('bonus_rate_bps').default(500),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    referrer_id_idx: index('referrals_referrer_id_idx').on(table.referrer_id),
    referred_id_idx: uniqueIndex('referrals_referred_id_idx').on(table.referred_id),
  }),
);

export const referral_payouts = pgTable(
  'referral_payouts',
  {
    id: serial('id').primaryKey(),
    referrer_id: text('referrer_id').notNull().references(() => users.id),
    referred_id: text('referred_id').notNull().references(() => users.id),
    tier: integer('tier').notNull().default(1),
    source_amount: numeric('source_amount').notNull(),
    payout_amount: numeric('payout_amount').notNull(),
    status: text('status').default('pending'), // 'pending' | 'paid'
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    paid_at: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => ({
    referrer_id_idx: index('referral_payouts_referrer_id_idx').on(table.referrer_id),
    referred_id_idx: index('referral_payouts_referred_id_idx').on(table.referred_id),
    status_idx: index('referral_payouts_status_idx').on(table.status),
  }),
);

export type UserStreak = typeof user_streaks.$inferSelect;
export type NewUserStreak = typeof user_streaks.$inferInsert;
export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;
export type UserAchievement = typeof user_achievements.$inferSelect;
export type NewUserAchievement = typeof user_achievements.$inferInsert;
export type Referral = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;
export type ReferralPayout = typeof referral_payouts.$inferSelect;
export type NewReferralPayout = typeof referral_payouts.$inferInsert;
export type UserNotification = typeof user_notifications.$inferSelect;
export type NewUserNotification = typeof user_notifications.$inferInsert;
