/**
 * Event Schema Validator Service
 * 
 * Manages schema validation for events with:
 * - Schema versioning and management
 * - Validation error tracking and diagnostics
 * - Migration capabilities between versions
 * - Comprehensive audit logging
 */

import { z } from 'zod';
import { pool } from '../config/db';
import { logger } from '../utils/logger';
import type { RawStellarEvent } from '../indexer/EventProcessor';

export interface SchemaVersion {
  eventType: string;
  version: number;
  schema: z.ZodType<any>;
  description?: string;
  isActive: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  schemaVersion?: number;
}

/**
 * Schema definitions for all event types
 * Versioned to support schema evolution
 */
const EVENT_SCHEMAS: Record<string, Record<number, z.ZodType<any>>> = {
  market_created: {
    1: z.object({
      market_id: z.string().min(1),
      contract_address: z.string().min(1),
      match_id: z.string().optional(),
      fighter_a: z.string().optional(),
      fighter_b: z.string().optional(),
      category: z.string().optional(),
      weight_class: z.string().optional(),
      title_fight: z.boolean().optional(),
      venue: z.string().optional(),
      scheduled_at: z.union([z.string(), z.number()]).optional(),
      fee_bps: z.number().int().optional(),
      lock_before_secs: z.number().int().optional(),
    }),
  },
  bet_placed: {
    1: z.object({
      market_id: z.string().min(1),
      bettor_address: z.string().min(1),
      side: z.string().min(1),
      amount: z.union([z.string(), z.number()]),
      amount_xlm: z.union([z.string(), z.number()]).optional(),
      placed_at: z.union([z.string(), z.number()]).optional(),
      claimed: z.boolean().optional(),
    }),
  },
  market_locked: {
    1: z.object({
      market_id: z.string().min(1),
    }),
  },
  market_resolved: {
    1: z.object({
      market_id: z.string().min(1),
      outcome: z.string().min(1),
      oracle_address: z.string().optional(),
      signature: z.string().optional(),
      match_id: z.string().optional(),
    }),
  },
  market_cancelled: {
    1: z.object({
      market_id: z.string().min(1),
    }),
  },
  winnings_claimed: {
    1: z.object({
      market_id: z.string().min(1),
      bettor_address: z.string().min(1),
      payout: z.union([z.string(), z.number()]).optional(),
    }),
  },
  refund_claimed: {
    1: z.object({
      market_id: z.string().min(1),
      bettor_address: z.string().min(1),
      refund_amount: z.union([z.string(), z.number()]).optional(),
    }),
  },
};

/**
 * Initialize schema versions in the database
 */
export async function initializeSchemaVersions(): Promise<void> {
  try {
    // Clear existing versions
    await pool.query('DELETE FROM event_schema_versions');

    for (const [eventType, versions] of Object.entries(EVENT_SCHEMAS)) {
      for (const [versionStr, schema] of Object.entries(versions)) {
        const version = parseInt(versionStr, 10);

        await pool.query(
          `INSERT INTO event_schema_versions
             (event_type, version, schema, is_active)
           VALUES ($1, $2, $3, $4)`,
          [
            eventType,
            version,
            JSON.stringify(schema),
            true,
          ]
        );
      }
    }

    logger.info('Event schema versions initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize schema versions');
    throw err;
  }
}

/**
 * Get the active schema version for an event type
 */
function getActiveSchema(eventType: string): z.ZodType<any> | null {
  const versions = EVENT_SCHEMAS[eventType];
  if (!versions) return null;

  // Get the highest version number
  const versionNumbers = Object.keys(versions)
    .map((v) => parseInt(v, 10))
    .sort((a, b) => b - a);

  if (versionNumbers.length === 0) return null;

  return versions[versionNumbers[0]];
}

/**
 * Validate an event against its schema
 */
export async function validateEvent(
  event: RawStellarEvent
): Promise<ValidationResult> {
  try {
    // Parse the payload
    let payload: any;
    try {
      payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return {
        isValid: false,
        errors: ['Failed to parse event data as JSON'],
      };
    }

    // Get the schema for this event type
    const schema = getActiveSchema(event.event_type);
    if (!schema) {
      return {
        isValid: false,
        errors: [`Unknown event type: ${event.event_type}`],
      };
    }

    // Validate the payload
    const result = schema.safeParse(payload);

    const validationResult: ValidationResult = {
      isValid: result.success,
    };

    if (!result.success) {
      validationResult.errors = result.error.errors.map(
        (err) => `${err.path.join('.')}: ${err.message}`
      );
    }

    // Record validation result
    await recordValidationResult(
      event.tx_hash,
      event.event_type,
      1, // version
      result.success,
      result.success ? undefined : result.error.errors,
      payload,
      event.ledger_sequence
    );

    return validationResult;
  } catch (err) {
    logger.error({ eventType: event.event_type, err }, 'Schema validation error');
    throw err;
  }
}

/**
 * Record validation result in database
 */
async function recordValidationResult(
  txHash: string,
  eventType: string,
  schemaVersion: number,
  isValid: boolean,
  errors?: any,
  payload?: any,
  ledgerSequence?: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO event_validation_results
         (tx_hash, event_type, schema_version, is_valid, validation_errors, payload_received, ledger_sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tx_hash) DO UPDATE
         SET is_valid = EXCLUDED.is_valid,
             validation_errors = EXCLUDED.validation_errors,
             checked_at = NOW()`,
      [
        txHash,
        eventType,
        schemaVersion,
        isValid,
        errors ? JSON.stringify(errors) : null,
        payload ? JSON.stringify(payload) : null,
        ledgerSequence || 0,
      ]
    );
  } catch (err) {
    logger.warn({ txHash, err }, 'Failed to record validation result');
  }
}

/**
 * Get schema validation statistics
 */
export async function getValidationStats(): Promise<{
  totalValidations: number;
  validEvents: number;
  invalidEvents: number;
  validationRate: number;
  eventTypeStats: Array<{
    eventType: string;
    total: number;
    valid: number;
    invalid: number;
    rate: number;
  }>;
}> {
  try {
    const { rows: globalStats } = await pool.query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN is_valid THEN 1 END) as valid,
         COUNT(CASE WHEN NOT is_valid THEN 1 END) as invalid
       FROM event_validation_results`
    );

    const { rows: byEventType } = await pool.query(
      `SELECT
         event_type,
         COUNT(*) as total,
         COUNT(CASE WHEN is_valid THEN 1 END) as valid,
         COUNT(CASE WHEN NOT is_valid THEN 1 END) as invalid
       FROM event_validation_results
       GROUP BY event_type
       ORDER BY total DESC`
    );

    const total = Number(globalStats[0]?.total) || 0;
    const valid = Number(globalStats[0]?.valid) || 0;
    const invalid = Number(globalStats[0]?.invalid) || 0;

    return {
      totalValidations: total,
      validEvents: valid,
      invalidEvents: invalid,
      validationRate: total > 0 ? Math.round((valid / total) * 10000) / 100 : 0,
      eventTypeStats: byEventType.map((row) => {
        const eventTotal = Number(row.total) || 0;
        const eventValid = Number(row.valid) || 0;
        return {
          eventType: row.event_type,
          total: eventTotal,
          valid: eventValid,
          invalid: Number(row.invalid) || 0,
          rate: eventTotal > 0 ? Math.round((eventValid / eventTotal) * 10000) / 100 : 0,
        };
      }),
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get validation stats');
    throw err;
  }
}

/**
 * Get invalid events for review
 */
export async function getInvalidEvents(
  limit: number = 50,
  offset: number = 0
): Promise<{
  events: any[];
  total: number;
}> {
  try {
    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*) as count FROM event_validation_results WHERE NOT is_valid`
    );

    const total = Number(countResult[0]?.count) || 0;

    const { rows: events } = await pool.query(
      `SELECT * FROM event_validation_results
       WHERE NOT is_valid
       ORDER BY checked_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return { events, total };
  } catch (err) {
    logger.error({ err }, 'Failed to get invalid events');
    throw err;
  }
}

/**
 * Create a new schema version
 */
export async function createSchemaVersion(
  eventType: string,
  version: number,
  schema: Record<string, any>,
  description?: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO event_schema_versions
         (event_type, version, schema, description, is_active)
       VALUES ($1, $2, $3, $4, false)`,
      [eventType, version, JSON.stringify(schema), description || null]
    );

    logger.info(
      { eventType, version, description },
      'New schema version created'
    );
  } catch (err) {
    logger.error({ eventType, version, err }, 'Failed to create schema version');
    throw err;
  }
}

/**
 * Activate a schema version
 */
export async function activateSchemaVersion(
  eventType: string,
  version: number
): Promise<void> {
  try {
    // Deactivate other versions for this event type
    await pool.query(
      `UPDATE event_schema_versions
       SET is_active = false
       WHERE event_type = $1 AND version != $2`,
      [eventType, version]
    );

    // Activate the requested version
    await pool.query(
      `UPDATE event_schema_versions
       SET is_active = true
       WHERE event_type = $1 AND version = $2`,
      [eventType, version]
    );

    logger.info({ eventType, version }, 'Schema version activated');
  } catch (err) {
    logger.error({ eventType, version, err }, 'Failed to activate schema version');
    throw err;
  }
}

/**
 * Get all schema versions for an event type
 */
export async function getSchemaVersions(
  eventType: string
): Promise<Array<{
  version: number;
  isActive: boolean;
  description?: string;
  createdAt: string;
}>> {
  try {
    const { rows } = await pool.query(
      `SELECT version, is_active, description, created_at
       FROM event_schema_versions
       WHERE event_type = $1
       ORDER BY version DESC`,
      [eventType]
    );

    return rows.map((row) => ({
      version: row.version,
      isActive: row.is_active,
      description: row.description,
      createdAt: row.created_at,
    }));
  } catch (err) {
    logger.error({ eventType, err }, 'Failed to get schema versions');
    throw err;
  }
}

/**
 * Migrate event data between schema versions
 */
export async function migrateEventData(
  fromVersion: number,
  toVersion: number,
  migrationFn: (data: any) => Promise<any>
): Promise<number> {
  try {
    // Get all events using the old schema
    const { rows: events } = await pool.query(
      `SELECT * FROM event_validation_results
       WHERE schema_version = $1`,
      [fromVersion]
    );

    let migratedCount = 0;

    for (const event of events) {
      try {
        const payload = JSON.parse(event.payload_received);
        const migratedPayload = await migrationFn(payload);

        await pool.query(
          `UPDATE event_validation_results
           SET schema_version = $1, payload_received = $2, checked_at = NOW()
           WHERE tx_hash = $3`,
          [toVersion, JSON.stringify(migratedPayload), event.tx_hash]
        );

        migratedCount++;
      } catch (err) {
        logger.warn(
          { txHash: event.tx_hash, err },
          'Failed to migrate event'
        );
      }
    }

    logger.info(
      { fromVersion, toVersion, migratedCount, total: events.length },
      'Event migration complete'
    );

    return migratedCount;
  } catch (err) {
    logger.error({ fromVersion, toVersion, err }, 'Event migration failed');
    throw err;
  }
}

/**
 * Export validation results to CSV
 */
export async function exportValidationResults(
  limit: number = 10000
): Promise<string> {
  try {
    const { rows } = await pool.query(
      `SELECT tx_hash, event_type, schema_version, is_valid, validation_errors, ledger_sequence, checked_at
       FROM event_validation_results
       ORDER BY checked_at DESC
       LIMIT $1`,
      [limit]
    );

    const headers = ['TX Hash', 'Event Type', 'Schema Version', 'Valid', 'Errors', 'Ledger', 'Checked At'];

    const csvRows = rows.map((row) => [
      row.tx_hash,
      row.event_type,
      row.schema_version,
      row.is_valid ? 'Yes' : 'No',
      row.validation_errors ? `"${JSON.stringify(row.validation_errors).replace(/"/g, '""')}"` : '',
      row.ledger_sequence,
      row.checked_at,
    ]);

    const csv = [
      headers.join(','),
      ...csvRows.map((row) => row.join(',')),
    ].join('\n');

    return csv;
  } catch (err) {
    logger.error({ err }, 'Failed to export validation results');
    throw err;
  }
}
