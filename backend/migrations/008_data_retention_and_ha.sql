-- Migration: Data Retention, Full-Text Search, and High Availability
-- Version: 008
-- Description: Add tables and indexes for data retention policies, compliance reporting,
--              full-text search optimization, and high availability replication

BEGIN;

-- =====================================================================
-- 1. DATA RETENTION TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS retention_policies (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL UNIQUE,
  retention_days INTEGER NOT NULL DEFAULT 365,
  archive_days INTEGER NOT NULL DEFAULT 180,
  enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS archived_records (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL,
  entity_id TEXT NOT NULL,
  original_table VARCHAR(100) NOT NULL,
  archived_data JSONB NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  archived_by VARCHAR(255),
  retention_policy_id INTEGER REFERENCES retention_policies(id),
  UNIQUE(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS compliance_reports (
  id BIGSERIAL PRIMARY KEY,
  policy_id INTEGER REFERENCES retention_policies(id),
  report_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  records_processed INTEGER DEFAULT 0,
  records_archived INTEGER DEFAULT 0,
  records_deleted INTEGER DEFAULT 0,
  storage_freed_bytes BIGINT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Retention policy indexes
CREATE INDEX IF NOT EXISTS idx_retention_policies_entity_type 
  ON retention_policies(entity_type);
CREATE INDEX IF NOT EXISTS idx_retention_policies_enabled 
  ON retention_policies(enabled);

-- Archived records indexes
CREATE INDEX IF NOT EXISTS idx_archived_records_entity_type 
  ON archived_records(entity_type);
CREATE INDEX IF NOT EXISTS idx_archived_records_archived_at 
  ON archived_records(archived_at);
CREATE INDEX IF NOT EXISTS idx_archived_records_retention_policy 
  ON archived_records(retention_policy_id);

-- Compliance reports indexes
CREATE INDEX IF NOT EXISTS idx_compliance_reports_policy_id 
  ON compliance_reports(policy_id);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_status 
  ON compliance_reports(status);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_report_date 
  ON compliance_reports(report_date);

-- =====================================================================
-- 2. FULL-TEXT SEARCH INDEXES AND ENHANCEMENTS
-- =====================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Create GIN indexes for full-text search on markets
CREATE INDEX IF NOT EXISTS idx_markets_fts ON markets 
  USING gin(to_tsvector('english', 
    coalesce(fighter_a, '') || ' ' ||
    coalesce(fighter_b, '') || ' ' ||
    coalesce(weight_class, '') || ' ' ||
    coalesce(venue, '')
  ));

-- Create trigram indexes for fuzzy search
CREATE INDEX IF NOT EXISTS idx_markets_fighter_a_trgm ON markets 
  USING gin (fighter_a gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_markets_fighter_b_trgm ON markets 
  USING gin (fighter_b gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_markets_venue_trgm ON markets 
  USING gin (venue gin_trgm_ops);

-- Full-text indexes on disputes
CREATE INDEX IF NOT EXISTS idx_disputes_fts ON disputes
  USING gin(to_tsvector('english', 
    coalesce(reason, '') || ' ' ||
    coalesce(admin_notes, '')
  ));

-- Indexes for blockchain events
CREATE INDEX IF NOT EXISTS idx_blockchain_events_fts ON blockchain_events
  USING gin(to_tsvector('english', 
    coalesce(event_type, '')
  ));

-- =====================================================================
-- 3. CONNECTION POOL MONITORING TABLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS pool_metrics_history (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  total_connections INTEGER NOT NULL,
  active_connections INTEGER NOT NULL,
  idle_connections INTEGER NOT NULL,
  waiting_requests INTEGER NOT NULL,
  connection_utilization DECIMAL(5,2) NOT NULL,
  avg_query_time INTEGER NOT NULL,
  connection_errors INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pool_metrics_timestamp 
  ON pool_metrics_history(timestamp DESC);

-- =====================================================================
-- 4. HIGH AVAILABILITY AND REPLICATION TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS replication_status (
  id SERIAL PRIMARY KEY,
  replica_id VARCHAR(100) NOT NULL UNIQUE,
  is_connected BOOLEAN DEFAULT false,
  replica_lag_bytes BIGINT DEFAULT 0,
  replica_lag_seconds INTEGER DEFAULT 0,
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_up_to_date BOOLEAN DEFAULT false,
  sync_percentage DECIMAL(5,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'unknown',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS failover_events (
  id VARCHAR(100) PRIMARY KEY,
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  previous_primary VARCHAR(255) NOT NULL,
  new_primary VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  error_messages TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consistency_checks (
  id BIGSERIAL PRIMARY KEY,
  replica_id VARCHAR(100) NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  primary_checksum TEXT NOT NULL,
  replica_checksum TEXT NOT NULL,
  is_consistent BOOLEAN NOT NULL,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Replication status indexes
CREATE INDEX IF NOT EXISTS idx_replication_status_replica_id 
  ON replication_status(replica_id);
CREATE INDEX IF NOT EXISTS idx_replication_status_is_connected 
  ON replication_status(is_connected);
CREATE INDEX IF NOT EXISTS idx_replication_status_status 
  ON replication_status(status);

-- Failover events indexes
CREATE INDEX IF NOT EXISTS idx_failover_events_timestamp 
  ON failover_events(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_failover_events_success 
  ON failover_events(success);

-- Consistency checks indexes
CREATE INDEX IF NOT EXISTS idx_consistency_checks_replica_id 
  ON consistency_checks(replica_id);
CREATE INDEX IF NOT EXISTS idx_consistency_checks_checked_at 
  ON consistency_checks(checked_at DESC);

-- =====================================================================
-- 5. INSERT DEFAULT RETENTION POLICIES
-- =====================================================================

INSERT INTO retention_policies (entity_type, retention_days, archive_days, enabled, description)
VALUES 
  ('bet', 730, 365, true, 'Keep bets for 2 years, archive after 1 year'),
  ('dispute', 1095, 365, true, 'Keep disputes for 3 years for legal compliance'),
  ('user_session', 90, 30, true, 'Keep sessions for 90 days, archive after 30'),
  ('notification_job', 365, 90, true, 'Keep notifications for 1 year, archive after 3 months'),
  ('blockchain_event', 730, 180, true, 'Keep blockchain events for 2 years')
ON CONFLICT (entity_type) DO NOTHING;

COMMIT;
