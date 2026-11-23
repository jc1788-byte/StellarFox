-- Create monitoring metrics table
CREATE TABLE IF NOT EXISTS monitoring_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  labels JSONB,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_metrics_name_time 
  ON monitoring_metrics(metric_name, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitoring_metrics_collected
  ON monitoring_metrics(collected_at DESC);

-- Create alert definitions table
CREATE TABLE IF NOT EXISTS alert_definitions (
  id SERIAL PRIMARY KEY,
  alert_name TEXT NOT NULL UNIQUE,
  condition TEXT NOT NULL,
  threshold NUMERIC NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_definitions_name 
  ON alert_definitions(alert_name);

-- Create alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  alert_definition_id INTEGER NOT NULL REFERENCES alert_definitions(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  value NUMERIC,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_time 
  ON alerts(status, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_definition 
  ON alerts(alert_definition_id);

-- Create backup metadata table
CREATE TABLE IF NOT EXISTS backup_metadata (
  id SERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL UNIQUE,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('full', 'incremental', 'wal')),
  location TEXT NOT NULL,
  size_bytes BIGINT,
  checksum TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_metadata_status_time 
  ON backup_metadata(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_backup_metadata_backup_id 
  ON backup_metadata(backup_id);

-- Create query analysis cache table
CREATE TABLE IF NOT EXISTS query_analysis_cache (
  id SERIAL PRIMARY KEY,
  query_hash TEXT NOT NULL UNIQUE,
  query_text TEXT NOT NULL,
  execution_plan JSONB NOT NULL,
  avg_execution_time_ms NUMERIC,
  recommendations JSONB,
  analysis_count INTEGER DEFAULT 1,
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_analysis_hash 
  ON query_analysis_cache(query_hash);

-- Create query performance history table
CREATE TABLE IF NOT EXISTS query_performance_history (
  id BIGSERIAL PRIMARY KEY,
  query_hash TEXT NOT NULL,
  execution_time_ms NUMERIC NOT NULL,
  rows_affected INTEGER,
  execution_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_perf_hash_date 
  ON query_performance_history(query_hash, execution_date DESC);

-- Create table size history table
CREATE TABLE IF NOT EXISTS table_size_history (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  size_mb NUMERIC NOT NULL,
  row_count BIGINT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_table_size_history_name_date 
  ON table_size_history(table_name, recorded_at DESC);

-- Insert default alert definitions
INSERT INTO alert_definitions (alert_name, condition, threshold, severity) VALUES
  ('high_connection_count', 'connections_active > 80', 80, 'high'),
  ('cache_hit_low', 'cache_hit_ratio < 80', 80, 'medium'),
  ('slow_queries_high', 'slow_queries_count > 5', 5, 'medium'),
  ('lock_wait_detected', 'lock_count > 10', 10, 'high'),
  ('disk_space_critical', 'disk_usage_percent > 90', 90, 'critical')
ON CONFLICT DO NOTHING;

-- Create function to clean up old metrics
CREATE OR REPLACE FUNCTION cleanup_old_metrics()
RETURNS void AS $$
BEGIN
  DELETE FROM monitoring_metrics 
  WHERE collected_at < NOW() - INTERVAL '30 days';
  
  DELETE FROM query_performance_history 
  WHERE execution_date < NOW() - INTERVAL '30 days';
  
  DELETE FROM table_size_history 
  WHERE recorded_at < NOW() - INTERVAL '30 days';
  
  DELETE FROM alerts 
  WHERE resolved_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup job (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-old-metrics', '0 3 * * *', 'SELECT cleanup_old_metrics()');
