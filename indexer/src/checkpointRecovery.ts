/**
 * Checkpoint-based recovery system for the indexer
 * 
 * Enables resumption from the last processed position after:
 * - Service restarts
 * - Process failures
 * - Network interruptions
 * 
 * Maintains checkpoints at configurable intervals to minimize data loss
 * and enable efficient recovery without full re-indexing.
 */

import fs from 'fs/promises';
import path from 'path';

interface Checkpoint {
  ledgerSequence: number;
  pagingToken: string;
  processedAt: string;
  batchId: number;
  eventsInBatch: number;
  checkpointId: string;
}

interface CheckpointMetadata {
  version: string;
  checkpoints: Checkpoint[];
  lastCheckpointAt: string;
  recoveryEnabled: boolean;
}

const CHECKPOINT_DIR = path.join(__dirname, '../checkpoints');
const CHECKPOINT_METADATA_FILE = path.join(CHECKPOINT_DIR, 'checkpoints.json');
const CHECKPOINT_INTERVAL_EVENTS = parseInt(process.env.CHECKPOINT_INTERVAL_EVENTS || '1000', 10);
const MAX_CHECKPOINTS_TO_KEEP = parseInt(process.env.MAX_CHECKPOINTS_TO_KEEP || '10', 10);

let checkpointMetadata: CheckpointMetadata = {
  version: '1.0',
  checkpoints: [],
  lastCheckpointAt: new Date().toISOString(),
  recoveryEnabled: true,
};

let eventCountSinceCheckpoint = 0;

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize checkpoint directory and load existing checkpoints
 */
export async function initializeCheckpoints(): Promise<void> {
  try {
    await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
    
    // Try to load existing checkpoints
    try {
      const data = await fs.readFile(CHECKPOINT_METADATA_FILE, 'utf-8');
      checkpointMetadata = JSON.parse(data);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      // No existing checkpoints, start fresh
      checkpointMetadata = {
        version: '1.0',
        checkpoints: [],
        lastCheckpointAt: new Date().toISOString(),
        recoveryEnabled: true,
      };
    }
  } catch (err) {
    console.error('Failed to initialize checkpoints:', err);
    throw err;
  }
}

/**
 * Create a new checkpoint for recovery purposes
 */
export async function createCheckpoint(
  ledgerSequence: number,
  pagingToken: string,
  batchId: number,
  eventsInBatch: number,
): Promise<Checkpoint> {
  const checkpointId = `ckpt-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const checkpoint: Checkpoint = {
    ledgerSequence,
    pagingToken,
    batchId,
    eventsInBatch,
    processedAt: new Date().toISOString(),
    checkpointId,
  };

  checkpointMetadata.checkpoints.push(checkpoint);
  checkpointMetadata.lastCheckpointAt = new Date().toISOString();

  // Keep only the most recent MAX_CHECKPOINTS_TO_KEEP checkpoints
  if (checkpointMetadata.checkpoints.length > MAX_CHECKPOINTS_TO_KEEP) {
    const checkpointsToRemove = checkpointMetadata.checkpoints.splice(
      0,
      checkpointMetadata.checkpoints.length - MAX_CHECKPOINTS_TO_KEEP,
    );

    // Delete checkpoint files
    for (const oldCkpt of checkpointsToRemove) {
      try {
        await fs.unlink(getCheckpointFilePath(oldCkpt.checkpointId));
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`Failed to delete old checkpoint ${oldCkpt.checkpointId}:`, err);
        }
      }
    }
  }

  // Persist checkpoint metadata
  await saveCheckpointMetadata();

  // Persist individual checkpoint
  await saveCheckpointData(checkpoint);

  return checkpoint;
}

/**
 * Should a checkpoint be created based on event count since last checkpoint?
 */
export function shouldCreateCheckpoint(eventCount: number = 1): boolean {
  eventCountSinceCheckpoint += eventCount;
  if (eventCountSinceCheckpoint >= CHECKPOINT_INTERVAL_EVENTS) {
    eventCountSinceCheckpoint = 0;
    return true;
  }
  return false;
}

/**
 * Reset the event counter (useful after creating a checkpoint)
 */
export function resetEventCounter(): void {
  eventCountSinceCheckpoint = 0;
}

// ─── Recovery ────────────────────────────────────────────────────────────────

/**
 * Get the most recent checkpoint for recovery
 */
export function getLatestCheckpoint(): Checkpoint | null {
  if (checkpointMetadata.checkpoints.length === 0) {
    return null;
  }
  return checkpointMetadata.checkpoints[checkpointMetadata.checkpoints.length - 1];
}

/**
 * Get a specific checkpoint by ID
 */
export function getCheckpointById(checkpointId: string): Checkpoint | null {
  return checkpointMetadata.checkpoints.find((cp) => cp.checkpointId === checkpointId) ?? null;
}

/**
 * Get all available checkpoints (for debugging/monitoring)
 */
export function getAllCheckpoints(): Checkpoint[] {
  return [...checkpointMetadata.checkpoints];
}

/**
 * Recover to a specific checkpoint (returns recovery state)
 */
export async function recoverToCheckpoint(checkpointId: string): Promise<{
  success: boolean;
  ledgerSequence: number | null;
  pagingToken: string | null;
  batchId: number | null;
  error?: string;
}> {
  const checkpoint = getCheckpointById(checkpointId);

  if (!checkpoint) {
    return {
      success: false,
      ledgerSequence: null,
      pagingToken: null,
      batchId: null,
      error: `Checkpoint not found: ${checkpointId}`,
    };
  }

  return {
    success: true,
    ledgerSequence: checkpoint.ledgerSequence,
    pagingToken: checkpoint.pagingToken,
    batchId: checkpoint.batchId,
  };
}

/**
 * Get recovery info for automatic recovery (latest checkpoint)
 */
export function getRecoveryInfo(): {
  hasCheckpoint: boolean;
  checkpointId: string | null;
  ledgerSequence: number | null;
  pagingToken: string | null;
  recoveredFrom?: string;
} {
  const latest = getLatestCheckpoint();

  if (!latest) {
    return {
      hasCheckpoint: false,
      checkpointId: null,
      ledgerSequence: null,
      pagingToken: null,
    };
  }

  return {
    hasCheckpoint: true,
    checkpointId: latest.checkpointId,
    ledgerSequence: latest.ledgerSequence,
    pagingToken: latest.pagingToken,
    recoveredFrom: latest.processedAt,
  };
}

// ─── Persistence ────────────────────────────────────────────────────────────

/**
 * Save checkpoint metadata to disk
 */
async function saveCheckpointMetadata(): Promise<void> {
  try {
    await fs.writeFile(
      CHECKPOINT_METADATA_FILE,
      JSON.stringify(checkpointMetadata, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.error('Failed to save checkpoint metadata:', err);
    throw err;
  }
}

/**
 * Save individual checkpoint data to disk
 */
async function saveCheckpointData(checkpoint: Checkpoint): Promise<void> {
  try {
    const filePath = getCheckpointFilePath(checkpoint.checkpointId);
    await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to save checkpoint data for ${checkpoint.checkpointId}:`, err);
    throw err;
  }
}

/**
 * Get the file path for a checkpoint
 */
function getCheckpointFilePath(checkpointId: string): string {
  return path.join(CHECKPOINT_DIR, `${checkpointId}.json`);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Mark recovery as disabled (e.g., after successful one-time recovery)
 */
export function disableRecovery(): void {
  checkpointMetadata.recoveryEnabled = false;
}

/**
 * Enable recovery mode
 */
export function enableRecovery(): void {
  checkpointMetadata.recoveryEnabled = true;
}

/**
 * Clear all checkpoints (use with caution)
 */
export async function clearAllCheckpoints(): Promise<void> {
  try {
    // Delete all checkpoint files
    for (const checkpoint of checkpointMetadata.checkpoints) {
      try {
        await fs.unlink(getCheckpointFilePath(checkpoint.checkpointId));
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`Failed to delete checkpoint ${checkpoint.checkpointId}:`, err);
        }
      }
    }

    // Reset metadata
    checkpointMetadata.checkpoints = [];
    checkpointMetadata.lastCheckpointAt = new Date().toISOString();

    // Persist empty metadata
    await saveCheckpointMetadata();
  } catch (err) {
    console.error('Failed to clear all checkpoints:', err);
    throw err;
  }
}

/**
 * Get checkpoint statistics
 */
export function getCheckpointStats(): {
  totalCheckpoints: number;
  oldestCheckpoint: string | null;
  newestCheckpoint: string | null;
  recoveryEnabled: boolean;
  diskUsageEstimate: number;
} {
  const checkpoints = checkpointMetadata.checkpoints;

  return {
    totalCheckpoints: checkpoints.length,
    oldestCheckpoint: checkpoints.length > 0 ? checkpoints[0].processedAt : null,
    newestCheckpoint: checkpoints.length > 0 ? checkpoints[checkpoints.length - 1].processedAt : null,
    recoveryEnabled: checkpointMetadata.recoveryEnabled,
    diskUsageEstimate: Math.round(checkpoints.length * 500), // Rough estimate: ~500 bytes per checkpoint
  };
}
