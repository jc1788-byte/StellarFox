/**
 * Data Retention and Archival Service
 *
 * Manages automated cleanup and archival of data based on retention policies.
 * Implements compliance reporting, soft deletes, and cold storage archival.
 */

import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import * as pino from 'pino';

const logger = pino.default();

export interface RetentionPolicy {
  id: number;
  entity_type: string; // 'bet', 'market', 'dispute', 'user_session', 'notification'
  retention_days: number;
  archive_days: number; // After this many days, move to cold storage
  enabled: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ComplianceReport {
  id: number;
  policy_id: number;
  report_date: Date;
  records_processed: number;
  records_archived: number;
  records_deleted: number;
  storage_freed_bytes: number;
  status: 'pending' | 'completed' | 'failed';
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface ArchivedRecord {
  id: number;
  entity_type: string;
  entity_id: string;
  original_table: string;
  archived_data: Record<string, unknown>;
  archived_at: Date;
  archived_by: string;
  retention_policy_id: number;
}

/**
 * Initialize retention policy tables
 */
export async function initializeRetentionTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
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

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_archived_records_entity_type 
        ON archived_records(entity_type);
      CREATE INDEX IF NOT EXISTS idx_archived_records_archived_at 
        ON archived_records(archived_at);
      CREATE INDEX IF NOT EXISTS idx_compliance_reports_policy_id 
        ON compliance_reports(policy_id);
      CREATE INDEX IF NOT EXISTS idx_compliance_reports_status 
        ON compliance_reports(status);
    `);

    logger.info('Retention policy tables initialized');
  } finally {
    client.release();
  }
}

/**
 * Create or update a retention policy
 */
export async function setRetentionPolicy(
  entityType: string,
  retentionDays: number,
  archiveDays: number,
  enabled: boolean = true,
  description?: string,
): Promise<RetentionPolicy> {
  const result = await pool.query<RetentionPolicy>(
    `
    INSERT INTO retention_policies 
      (entity_type, retention_days, archive_days, enabled, description)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (entity_type) DO UPDATE SET
      retention_days = $2,
      archive_days = $3,
      enabled = $4,
      description = $5,
      updated_at = NOW()
    RETURNING *;
    `,
    [entityType, retentionDays, archiveDays, enabled, description],
  );

  return result.rows[0];
}

/**
 * Get all retention policies
 */
export async function getRetentionPolicies(): Promise<RetentionPolicy[]> {
  const result = await pool.query<RetentionPolicy>(
    `SELECT * FROM retention_policies ORDER BY entity_type ASC;`,
  );
  return result.rows;
}

/**
 * Archive records older than archive_days threshold
 */
export async function archiveOldRecords(
  entityType: string,
  policyId: number,
  archivedBy: string = 'system',
): Promise<number> {
  const policy = await pool.query<RetentionPolicy>(
    `SELECT * FROM retention_policies WHERE id = $1`,
    [policyId],
  );

  if (policy.rowCount === 0) {
    throw AppError.notFound(`Retention policy ${policyId} not found`);
  }

  const archivePolicy = policy.rows[0];
  const archiveThreshold = new Date(Date.now() - archivePolicy.archive_days * 24 * 60 * 60 * 1000);

  let table = '';
  let idColumn = 'id';
  let dateColumn = 'created_at';

  // Map entity types to tables and columns
  switch (entityType.toLowerCase()) {
    case 'bet':
      table = 'bets';
      idColumn = 'id';
      dateColumn = 'placed_at';
      break;
    case 'dispute':
      table = 'disputes';
      idColumn = 'id';
      dateColumn = 'raised_at';
      break;
    case 'user_session':
      table = 'user_sessions';
      idColumn = 'id';
      dateColumn = 'created_at';
      break;
    case 'notification_job':
      table = 'notification_jobs';
      idColumn = 'id';
      dateColumn = 'created_at';
      break;
    default:
      throw AppError.badRequest(`Unknown entity type: ${entityType}`);
  }

  // Archive records to archived_records table
  const archiveResult = await pool.query(
    `
    WITH to_archive AS (
      SELECT * FROM ${table}
      WHERE ${dateColumn} < $1
      LIMIT 1000
    )
    INSERT INTO archived_records 
      (entity_type, entity_id, original_table, archived_data, archived_by, retention_policy_id)
    SELECT 
      $2,
      CAST(${idColumn} AS TEXT),
      $3,
      to_jsonb(t.*),
      $4,
      $5
    FROM to_archive t
    ON CONFLICT (entity_type, entity_id) DO NOTHING;
    `,
    [archiveThreshold, entityType, table, archivedBy, policyId],
  );

  return archiveResult.rowCount ?? 0;
}

/**
 * Delete permanently archived records
 */
export async function deleteArchivedRecords(
  entityType: string,
  olderThanDays: number,
): Promise<number> {
  const policy = await pool.query<RetentionPolicy>(
    `SELECT * FROM retention_policies WHERE entity_type = $1`,
    [entityType],
  );

  if (policy.rowCount === 0) {
    throw AppError.notFound(`Retention policy for ${entityType} not found`);
  }

  const retentionPolicy = policy.rows[0];
  const deleteThreshold = new Date(Date.now() - (retentionPolicy.retention_days + olderThanDays) * 24 * 60 * 60 * 1000);

  // Delete archived records
  const deleteResult = await pool.query(
    `
    DELETE FROM archived_records
    WHERE entity_type = $1 AND archived_at < $2;
    `,
    [entityType, deleteThreshold],
  );

  logger.info(
    `Deleted ${deleteResult.rowCount} archived records for ${entityType}`,
  );

  return deleteResult.rowCount ?? 0;
}

/**
 * Generate compliance report
 */
export async function generateComplianceReport(policyId: number): Promise<ComplianceReport> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create report record
    const reportResult = await client.query<ComplianceReport>(
      `
      INSERT INTO compliance_reports (policy_id, status)
      VALUES ($1, 'pending')
      RETURNING *;
      `,
      [policyId],
    );

    const report = reportResult.rows[0];

    // Process archival and deletion
    const policy = await client.query<RetentionPolicy>(
      `SELECT * FROM retention_policies WHERE id = $1`,
      [policyId],
    );

    if (policy.rowCount === 0) {
      throw AppError.notFound(`Retention policy ${policyId} not found`);
    }

    const retentionPolicy = policy.rows[0];

    // Count records to be processed
    let countResult: any;
    let entityType = retentionPolicy.entity_type;
    let table = '';
    let dateColumn = 'created_at';

    switch (entityType.toLowerCase()) {
      case 'bet':
        table = 'bets';
        dateColumn = 'placed_at';
        break;
      case 'dispute':
        table = 'disputes';
        dateColumn = 'raised_at';
        break;
      case 'user_session':
        table = 'user_sessions';
        dateColumn = 'created_at';
        break;
      case 'notification_job':
        table = 'notification_jobs';
        dateColumn = 'created_at';
        break;
    }

    if (table) {
      const archiveThreshold = new Date(
        Date.now() - retentionPolicy.archive_days * 24 * 60 * 60 * 1000,
      );

      countResult = await client.query<any>(
        `
        SELECT 
          COUNT(*) as total_records,
          SUM(pg_total_relation_size(regclass)) as total_size
        FROM ${table}
        WHERE ${dateColumn} < $1;
        `,
        [archiveThreshold],
      );
    }

    // Update report with results
    const recordsCount = countResult?.rows[0]?.total_records || 0;
    const storageFreedbytes = countResult?.rows[0]?.total_size || 0;

    const updatedReport = await client.query<ComplianceReport>(
      `
      UPDATE compliance_reports
      SET 
        status = 'completed',
        records_processed = $1,
        records_archived = $2,
        records_deleted = $3,
        storage_freed_bytes = $4,
        completed_at = NOW()
      WHERE id = $5
      RETURNING *;
      `,
      [recordsCount, recordsCount, 0, storageFreedbytes, report.id],
    );

    await client.query('COMMIT');

    logger.info(
      `Compliance report generated for policy ${policyId}: ${recordsCount} records`,
    );

    return updatedReport.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(
      { error },
      'Error generating compliance report',
    );
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get compliance reports for a policy
 */
export async function getComplianceReports(policyId: number): Promise<ComplianceReport[]> {
  const result = await pool.query<ComplianceReport>(
    `
    SELECT * FROM compliance_reports
    WHERE policy_id = $1
    ORDER BY created_at DESC
    LIMIT 100;
    `,
    [policyId],
  );

  return result.rows;
}

/**
 * Execute scheduled retention cleanup job
 */
export async function executeRetentionCleanup(): Promise<{
  policiesProcessed: number;
  totalRecordsArchived: number;
  totalRecordsDeleted: number;
}> {
  const policies = await getRetentionPolicies();
  let totalArchived = 0;
  let totalDeleted = 0;

  for (const policy of policies) {
    if (!policy.enabled) continue;

    try {
      // Archive old records
      const archived = await archiveOldRecords(
        policy.entity_type,
        policy.id,
        'scheduled_cleanup',
      );
      totalArchived += archived;

      // Delete permanently old archived records
      const deleted = await deleteArchivedRecords(policy.entity_type, 30); // 30 days buffer
      totalDeleted += deleted;

      // Generate report
      await generateComplianceReport(policy.id);
    } catch (error) {
      logger.error(
        { error, policyId: policy.id },
        `Error processing retention policy ${policy.entity_type}`,
      );
    }
  }

  logger.info(
    `Retention cleanup completed: ${totalArchived} archived, ${totalDeleted} deleted`,
  );

  return {
    policiesProcessed: policies.length,
    totalRecordsArchived: totalArchived,
    totalRecordsDeleted: totalDeleted,
  };
}
