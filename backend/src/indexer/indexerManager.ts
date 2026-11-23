/**
 * Indexer Manager
 * 
 * Orchestrates all indexer improvements:
 * - Schema validation
 * - Dead Letter Queue
 * - RPC provider management
 * - Batch processing
 */

import { logger } from '../utils/logger';
import { initializeSchemaVersions } from '../services/schemaValidator.service';
import { initializeProviders } from '../services/rpcProvider.service';
import { getPendingRetries, resolveDLQEntry } from '../services/dlq.service';
import type { RawStellarEvent } from './EventProcessor';

/**
 * Initialize all indexer subsystems
 */
export async function initializeIndexerSubsystems(): Promise<void> {
  try {
    logger.info('Initializing indexer subsystems...');

    // Initialize schema versions
    try {
      await initializeSchemaVersions();
      logger.info('Schema versions initialized');
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize schema versions');
    }

    // Initialize RPC providers
    try {
      await initializeProviders();
      logger.info('RPC providers initialized');
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize RPC providers');
    }

    logger.info('All indexer subsystems initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize indexer subsystems');
    throw err;
  }
}

/**
 * Start DLQ retry processor
 * Periodically checks for pending DLQ entries and attempts to reprocess them
 */
export async function startDLQProcessor(): Promise<void> {
  const retryInterval = 60 * 1000; // 1 minute

  const processPendingRetries = async () => {
    try {
      const pending = await getPendingRetries();
      if (pending.length === 0) return;

      logger.info({ count: pending.length }, 'Processing pending DLQ retries');

      // Import here to avoid circular dependency
      const { processEvent } = await import('./StellarIndexer');
      const { replayDLQEntry } = await import('../services/dlq.service');

      let successCount = 0;
      let failureCount = 0;

      for (const entry of pending) {
        try {
          const event = await replayDLQEntry(entry.id);
          if (event) {
            await processEvent(event);
            await resolveDLQEntry(entry.id, 'auto-retry', 'Event reprocessed successfully');
            successCount++;
          }
        } catch (err) {
          failureCount++;
          logger.warn(
            { dlqId: entry.id, txHash: entry.tx_hash, err },
            'DLQ retry failed'
          );
        }
      }

      logger.info(
        { total: pending.length, successCount, failureCount },
        'DLQ retry processing complete'
      );
    } catch (err) {
      logger.error({ err }, 'Error processing DLQ retries');
    }
  };

  // Start the processor
  setInterval(processPendingRetries, retryInterval);
  
  // Run immediately on startup
  await processPendingRetries();
}

/**
 * Get indexer configuration summary
 */
export function getIndexerConfig(): Record<string, any> {
  return {
    batchProcessing: {
      enabled: process.env.BATCH_PROCESSOR_ENABLED === 'true',
      initialSize: Number(process.env.BATCH_PROCESSOR_SIZE ?? 10),
      minSize: Number(process.env.BATCH_PROCESSOR_MIN_SIZE ?? 5),
      maxSize: Number(process.env.BATCH_PROCESSOR_MAX_SIZE ?? 100),
      maxConcurrency: Number(process.env.BATCH_PROCESSOR_CONCURRENCY ?? 3),
      itemTimeoutMs: Number(process.env.BATCH_PROCESSOR_TIMEOUT_MS ?? 30000),
    },
    dlq: {
      enabled: process.env.DLQ_ENABLED === 'true',
      maxRetries: Number(process.env.DLQ_MAX_RETRIES ?? 5),
    },
    schemaValidation: {
      enabled: process.env.SCHEMA_VALIDATION_ENABLED === 'true',
    },
    rpcProviders: {
      primary: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
      healthCheckIntervalMs: Number(process.env.RPC_HEALTH_CHECK_INTERVAL_MS ?? 30000),
      configured: !!process.env.RPC_PROVIDERS,
    },
  };
}

/**
 * Health check for all indexer subsystems
 */
export async function getIndexerSubsystemHealth(): Promise<Record<string, any>> {
  try {
    const { getMetrics } = await import('../services/rpcProvider.service');
    const { getDLQStats } = await import('../services/dlq.service');
    const { getValidationStats } = await import('../services/schemaValidator.service');

    const [rpcMetrics, dlqStats, validationStats] = await Promise.all([
      getMetrics(),
      getDLQStats(),
      getValidationStats(),
    ]);

    return {
      rpc: {
        healthy: rpcMetrics.healthyProviders > 0,
        healthyProviders: rpcMetrics.healthyProviders,
        totalProviders: rpcMetrics.totalProviders,
        successRate: rpcMetrics.successRate,
      },
      dlq: {
        pendingEntries: dlqStats.pendingEntries,
        failedEntries: dlqStats.failedEntries,
        resolvedEntries: dlqStats.resolvedEntries,
        totalEntries: dlqStats.totalEntries,
      },
      schemaValidation: {
        totalValidations: validationStats.totalValidations,
        validationRate: validationStats.validationRate,
        invalidEvents: validationStats.invalidEvents,
      },
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get indexer subsystem health');
    throw err;
  }
}
