/**
 * Dead Letter Queue (DLQ) Service
 * 
 * Manages failed events with:
 * - Detailed failure tracking and diagnostics
 * - Exponential backoff retry scheduling
 * - Admin replay capabilities
 * - Comprehensive error logging and metrics
 */

import { pool } from '../config/db';
import { logger } from '../utils/logger';
import type { RawStellarEvent } from '../indexer/EventProcessor';

export interface DLQEntry {
  id: number;
  event_type: string;
  contract_address: string;
  payload: Record<string, unknown>;
  ledger_sequence: number;
  ledger_close_time: string;
  tx_hash: string;
  error_message: string;
  error_stack?: string;
  failure_count: number;
  last_error_at: string;
  next_retry_at?: string;
  status: 'pending' | 'failed' | 'resolved';
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface DLQStats {
  totalEntries: number;
  pendingEntries: number;
  failedEntries: number;
  resolvedEntries: number;
  oldestPendingAge: number | null;
  averageRetries: number;
}

const MAX_BACKOFF_MINUTES = 60;
const INITIAL_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Send a failed event to the DLQ
 */
export async function sendToDLQ(
  event: RawStellarEvent,
  error: Error | unknown,
  existingFailureCount: number = 0
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  const failureCount = existingFailureCount + 1;

  // Calculate next retry time with exponential backoff
  const backoffMs = calculateBackoff(failureCount);
  const nextRetryAt = new Date(Date.now() + backoffMs);

  try {
    await pool.query(
      `INSERT INTO dead_letter_queue
         (event_type, contract_address, payload, ledger_sequence, ledger_close_time, tx_hash,
          error_message, error_stack, failure_count, last_error_at, next_retry_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tx_hash) DO UPDATE
         SET failure_count = dead_letter_queue.failure_count + 1,
             last_error_at = NOW(),
             error_message = EXCLUDED.error_message,
             error_stack = EXCLUDED.error_stack,
             next_retry_at = $11,
             updated_at = NOW()`,
      [
        event.event_type,
        event.contract_address,
        event.data,
        event.ledger_sequence,
        event.ledger_close_time,
        event.tx_hash,
        errorMessage,
        errorStack || null,
        failureCount,
        new Date(),
        nextRetryAt,
        'pending',
      ]
    );

    logger.warn(
      {
        txHash: event.tx_hash,
        eventType: event.event_type,
        failureCount,
        nextRetryAt: nextRetryAt.toISOString(),
        error: errorMessage,
      },
      'Event sent to DLQ'
    );
  } catch (err) {
    logger.error(
      { txHash: event.tx_hash, err },
      'Failed to insert event into DLQ'
    );
    throw err;
  }
}

/**
 * Calculate exponential backoff time in milliseconds
 */
function calculateBackoff(failureCount: number): number {
  const exponential = INITIAL_BACKOFF_MS * Math.pow(2, Math.max(failureCount - 1, 0));
  const maxBackoffMs = MAX_BACKOFF_MINUTES * 60 * 1000;
  const backoff = Math.min(exponential, maxBackoffMs);
  // Add jitter (±10%)
  const jitter = backoff * 0.1 * (Math.random() * 2 - 1);
  return Math.round(backoff + jitter);
}

/**
 * Get all pending DLQ entries ready for retry
 */
export async function getPendingRetries(): Promise<DLQEntry[]> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM dead_letter_queue
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY failure_count ASC, next_retry_at ASC
       LIMIT 100`
    );
    return rows as DLQEntry[];
  } catch (err) {
    logger.error({ err }, 'Failed to query pending DLQ retries');
    throw err;
  }
}

/**
 * Mark a DLQ entry as resolved
 */
export async function resolveDLQEntry(
  dlqId: number,
  resolvedBy: string = 'auto',
  notes?: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE dead_letter_queue
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolution_notes = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [resolvedBy, notes || null, dlqId]
    );

    logger.info(
      { dlqId, resolvedBy, notes },
      'DLQ entry resolved'
    );
  } catch (err) {
    logger.error({ dlqId, err }, 'Failed to resolve DLQ entry');
    throw err;
  }
}

/**
 * Mark a DLQ entry as permanently failed
 */
export async function failDLQEntry(
  dlqId: number,
  reason: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE dead_letter_queue
       SET status = 'failed',
           resolution_notes = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [reason, dlqId]
    );

    logger.warn(
      { dlqId, reason },
      'DLQ entry marked as failed'
    );
  } catch (err) {
    logger.error({ dlqId, err }, 'Failed to mark DLQ entry as failed');
    throw err;
  }
}

/**
 * Get DLQ statistics
 */
export async function getDLQStats(): Promise<DLQStats> {
  try {
    const { rows: [stats] } = await pool.query(
      `SELECT
         COUNT(*) as total_entries,
         COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_entries,
         COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_entries,
         COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_entries,
         EXTRACT(EPOCH FROM (NOW() - MIN(CASE WHEN status = 'pending' THEN created_at END)))::integer as oldest_pending_age_secs,
         ROUND(AVG(failure_count)) as avg_retries
       FROM dead_letter_queue`
    );

    return {
      totalEntries: Number(stats.total_entries) || 0,
      pendingEntries: Number(stats.pending_entries) || 0,
      failedEntries: Number(stats.failed_entries) || 0,
      resolvedEntries: Number(stats.resolved_entries) || 0,
      oldestPendingAge: stats.oldest_pending_age_secs ? Number(stats.oldest_pending_age_secs) : null,
      averageRetries: Number(stats.avg_retries) || 0,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get DLQ stats');
    throw err;
  }
}

/**
 * Get a specific DLQ entry by ID
 */
export async function getDLQEntry(dlqId: number): Promise<DLQEntry | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM dead_letter_queue WHERE id = $1`,
      [dlqId]
    );
    return rows[0] as DLQEntry | undefined || null;
  } catch (err) {
    logger.error({ dlqId, err }, 'Failed to get DLQ entry');
    throw err;
  }
}

/**
 * Get DLQ entries with filtering and pagination
 */
export async function getDLQEntries(
  filters: {
    status?: 'pending' | 'failed' | 'resolved';
    eventType?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ entries: DLQEntry[], total: number }> {
  try {
    const { status, eventType, limit = 50, offset = 0 } = filters;

    let query = `SELECT * FROM dead_letter_queue WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    if (eventType) {
      query += ` AND event_type = $${params.length + 1}`;
      params.push(eventType);
    }

    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const { rows: [countResult] } = await pool.query(countQuery, params);
    const total = Number(countResult.count) || 0;

    // Get paginated results
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows: entries } = await pool.query(query, params);
    return { entries: entries as DLQEntry[], total };
  } catch (err) {
    logger.error({ filters, err }, 'Failed to get DLQ entries');
    throw err;
  }
}

/**
 * Replay a DLQ event (returns the parsed event for re-processing)
 */
export async function replayDLQEntry(dlqId: number): Promise<RawStellarEvent | null> {
  try {
    const entry = await getDLQEntry(dlqId);
    if (!entry) {
      logger.warn({ dlqId }, 'DLQ entry not found for replay');
      return null;
    }

    // Parse the stored payload back into a RawStellarEvent
    const event: RawStellarEvent = {
      contract_address: entry.contract_address,
      event_type: entry.event_type,
      topics: [],
      data: typeof entry.payload === 'string' ? entry.payload : JSON.stringify(entry.payload),
      ledger_sequence: entry.ledger_sequence,
      ledger_close_time: entry.ledger_close_time,
      tx_hash: entry.tx_hash,
    };

    logger.info({ dlqId, txHash: entry.tx_hash }, 'Replaying DLQ entry');
    return event;
  } catch (err) {
    logger.error({ dlqId, err }, 'Failed to replay DLQ entry');
    throw err;
  }
}

/**
 * Cleanup old resolved entries
 */
export async function cleanupResolvedEntries(daysToKeep: number = 30): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const { rowCount } = await pool.query(
      `DELETE FROM dead_letter_queue
       WHERE status = 'resolved' AND resolved_at < $1`,
      [cutoffDate]
    );

    logger.info(
      { deletedCount: rowCount, daysToKeep, cutoffDate },
      'Cleaned up old DLQ entries'
    );
    return rowCount || 0;
  } catch (err) {
    logger.error({ daysToKeep, err }, 'Failed to cleanup DLQ entries');
    throw err;
  }
}

/**
 * Export DLQ entries to CSV format
 */
export async function exportDLQToCSV(filters?: any): Promise<string> {
  try {
    const { entries } = await getDLQEntries({ ...filters, limit: 100000 });

    const headers = [
      'ID', 'Event Type', 'TX Hash', 'Status', 'Failure Count',
      'Error Message', 'Created At', 'Last Error At', 'Next Retry At',
    ];

    const rows = entries.map((entry) => [
      entry.id,
      entry.event_type,
      entry.tx_hash,
      entry.status,
      entry.failure_count,
      `"${entry.error_message.replace(/"/g, '""')}"`,
      entry.created_at,
      entry.last_error_at,
      entry.next_retry_at || 'N/A',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    return csv;
  } catch (err) {
    logger.error({ err }, 'Failed to export DLQ to CSV');
    throw err;
  }
}
