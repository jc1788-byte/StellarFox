-- ============================================================
-- Migration: Add processed_events table for event deduplication
-- ============================================================

-- Create processed_events table for tracking exactly-once event processing
CREATE TABLE IF NOT EXISTS processed_events (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL UNIQUE,
  ledger_sequence BIGINT NOT NULL,
  tx_index INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  event_data JSONB NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Composite index for ordering validation
  CONSTRAINT uk_ledger_tx_event UNIQUE (ledger_sequence, tx_index, event_index)
);

-- Index on event_id for fast deduplication lookups
CREATE INDEX IF NOT EXISTS idx_processed_events_event_id ON processed_events(event_id);

-- Index on ledger_sequence for range queries and ordering validation
CREATE INDEX IF NOT EXISTS idx_processed_events_ledger_seq ON processed_events(ledger_sequence);

-- Index on processed_at for cleanup operations
CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at ON processed_events(processed_at);

-- Composite index for ordering validation queries
CREATE INDEX IF NOT EXISTS idx_processed_events_ledger_tx_event 
  ON processed_events(ledger_sequence, tx_index, event_index);

-- Add full-text search index to markets table if not already present
-- This supports advanced search with highlighting
CREATE INDEX IF NOT EXISTS idx_markets_fts ON markets USING GIN (fts);

-- Add text search vector column to markets if not present
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'markets' AND column_name = 'fts') THEN
    ALTER TABLE markets ADD COLUMN fts tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', COALESCE(fighter_a_name, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(fighter_b_name, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(weight_class, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(venue, '')), 'C')
    ) STORED;
  END IF;
END $$;
