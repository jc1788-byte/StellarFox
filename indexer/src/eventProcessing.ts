// ============================================================
// BANKERCHANGER — Event Processing Service
// Implements event deduplication, ordering, and exactly-once semantics
// ============================================================

import { db } from './db';

export interface ProcessedEvent {
  eventId: string;
  contractId: string;
  ledgerSequence: number;
  txIndex: number;
  eventIndex: number;
  type: string;
  timestamp: Date;
  data: Record<string, any>;
  processedAt: Date;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  reason?: string;
  existingEventId?: string;
}

export interface EventProcessingContext {
  transactionHash?: string;
  ledgerSequence: number;
  txIndex: number;
  eventIndex: number;
}

/**
 * Event deduplication service using multi-key indexing
 */
export class EventDeduplicator {
  private processedEventIds = new Map<string, Date>();
  private readonly idleTimeout = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Generates a unique event ID combining ledger, transaction, and event indices
   * This ensures each event in the Stellar ledger has a unique identifier
   */
  generateEventId(context: EventProcessingContext): string {
    return `${context.ledgerSequence}:${context.txIndex}:${context.eventIndex}`;
  }

  /**
   * Checks if an event has already been processed
   */
  async isDuplicate(eventId: string): Promise<DeduplicationResult> {
    // Check in-memory cache first
    const cachedTime = this.processedEventIds.get(eventId);
    if (cachedTime) {
      return {
        isDuplicate: true,
        reason: 'in_memory_cache',
        existingEventId: eventId,
      };
    }

    // Check database
    try {
      const result = await db.query(
        `SELECT id, processed_at FROM processed_events WHERE event_id = $1 LIMIT 1`,
        [eventId],
      );

      if (result.rows.length > 0) {
        const processedAt = new Date(result.rows[0].processed_at);
        this.processedEventIds.set(eventId, processedAt);
        return {
          isDuplicate: true,
          reason: 'database',
          existingEventId: eventId,
        };
      }
    } catch (error) {
      console.error(`[EventDeduplicator] Database error checking duplicate: ${eventId}`, error);
      // On database error, assume not duplicate to allow reprocessing
      return { isDuplicate: false };
    }

    return { isDuplicate: false };
  }

  /**
   * Records an event as processed with atomic write semantics
   */
  async recordProcessedEvent(
    eventId: string,
    context: EventProcessingContext,
    eventData: Record<string, any>,
  ): Promise<boolean> {
    try {
      // Use INSERT ... ON CONFLICT DO NOTHING for idempotent writes
      const result = await db.query(
        `INSERT INTO processed_events 
         (event_id, ledger_sequence, tx_index, event_index, event_data, processed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (event_id) DO NOTHING`,
        [
          eventId,
          context.ledgerSequence,
          context.txIndex,
          context.eventIndex,
          JSON.stringify(eventData),
        ],
      );

      // Update cache
      if (result.rowCount && result.rowCount > 0) {
        this.processedEventIds.set(eventId, new Date());
        return true;
      }
      return false;
    } catch (error) {
      console.error(`[EventDeduplicator] Failed to record processed event: ${eventId}`, error);
      throw error;
    }
  }

  /**
   * Cleans up old cache entries to prevent memory leaks
   */
  cleanCache(): void {
    const now = Date.now();
    for (const [eventId, processedAt] of this.processedEventIds.entries()) {
      if (now - processedAt.getTime() > this.idleTimeout) {
        this.processedEventIds.delete(eventId);
      }
    }
  }
}

/**
 * Event ordering service ensuring strict ledger order processing
 */
export class EventOrderingManager {
  private processingQueue: Array<{
    eventId: string;
    ledgerSequence: number;
    txIndex: number;
    eventIndex: number;
    timestamp: Date;
  }> = [];
  private lastProcessedLedger = 0;
  private lastProcessedTxIndex = -1;
  private lastProcessedEventIndex = -1;

  /**
   * Validates event ordering and detects violations
   */
  validateOrdering(context: EventProcessingContext): {
    isValid: boolean;
    error?: string;
  } {
    const { ledgerSequence, txIndex, eventIndex } = context;

    // Ledger must be monotonically increasing or equal
    if (ledgerSequence < this.lastProcessedLedger) {
      return {
        isValid: false,
        error: `Ledger sequence went backwards: ${this.lastProcessedLedger} -> ${ledgerSequence}`,
      };
    }

    // If same ledger, tx index must be increasing
    if (ledgerSequence === this.lastProcessedLedger && txIndex < this.lastProcessedTxIndex) {
      return {
        isValid: false,
        error: `Transaction index went backwards in ledger ${ledgerSequence}: ${this.lastProcessedTxIndex} -> ${txIndex}`,
      };
    }

    // If same ledger and tx, event index must be increasing
    if (
      ledgerSequence === this.lastProcessedLedger &&
      txIndex === this.lastProcessedTxIndex &&
      eventIndex <= this.lastProcessedEventIndex
    ) {
      return {
        isValid: false,
        error: `Event index went backwards in tx ${ledgerSequence}:${txIndex}: ${this.lastProcessedEventIndex} -> ${eventIndex}`,
      };
    }

    return { isValid: true };
  }

  /**
   * Records the processing of an event for future ordering checks
   */
  recordProcessing(context: EventProcessingContext): void {
    this.lastProcessedLedger = context.ledgerSequence;
    this.lastProcessedTxIndex = context.txIndex;
    this.lastProcessedEventIndex = context.eventIndex;
  }

  /**
   * Gets the last processed ledger sequence for checkpoint/resume
   */
  getLastProcessedLedger(): number {
    return this.lastProcessedLedger;
  }

  /**
   * Resets ordering state (useful after ledger reorg)
   */
  reset(): void {
    this.processingQueue = [];
    this.lastProcessedLedger = 0;
    this.lastProcessedTxIndex = -1;
    this.lastProcessedEventIndex = -1;
  }
}

/**
 * Exactly-once event processor combining deduplication and ordering
 */
export class ExactlyOnceEventProcessor {
  private deduplicator: EventDeduplicator;
  private orderingManager: EventOrderingManager;
  private stats = {
    totalProcessed: 0,
    duplicatesDetected: 0,
    orderingViolations: 0,
    failedProcessing: 0,
  };

  constructor() {
    this.deduplicator = new EventDeduplicator();
    this.orderingManager = new EventOrderingManager();
  }

  /**
   * Processes an event with exactly-once semantics
   */
  async processEvent(
    context: EventProcessingContext,
    eventData: Record<string, any>,
    handler: (context: EventProcessingContext, data: Record<string, any>) => Promise<void>,
  ): Promise<{ success: boolean; error?: string }> {
    const eventId = this.deduplicator.generateEventId(context);

    // Check for duplicates first
    const dupResult = await this.deduplicator.isDuplicate(eventId);
    if (dupResult.isDuplicate) {
      this.stats.duplicatesDetected++;
      console.warn(`[ExactlyOnce] Duplicate event detected: ${eventId} (${dupResult.reason})`);
      return { success: false, error: 'duplicate_event' };
    }

    // Validate ordering
    const orderingValidation = this.orderingManager.validateOrdering(context);
    if (!orderingValidation.isValid) {
      this.stats.orderingViolations++;
      console.error(`[ExactlyOnce] Ordering violation: ${orderingValidation.error}`);
      return { success: false, error: 'ordering_violation' };
    }

    try {
      // Process the event
      await handler(context, eventData);

      // Record as processed (idempotent)
      await this.deduplicator.recordProcessedEvent(eventId, context, eventData);

      // Update ordering state
      this.orderingManager.recordProcessing(context);

      this.stats.totalProcessed++;
      return { success: true };
    } catch (error) {
      this.stats.failedProcessing++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ExactlyOnce] Event processing failed: ${eventId}`, errorMsg);
      return { success: false, error: `processing_error: ${errorMsg}` };
    }
  }

  /**
   * Batch process events with ordering guarantee
   */
  async processBatch(
    events: Array<{
      context: EventProcessingContext;
      data: Record<string, any>;
    }>,
    handler: (context: EventProcessingContext, data: Record<string, any>) => Promise<void>,
  ): Promise<{
    processed: number;
    failed: number;
    duplicates: number;
  }> {
    let processed = 0;
    let failed = 0;
    let duplicates = 0;

    // Sort events by ledger, tx, event index for ordering
    const sortedEvents = events.sort((a, b) => {
      if (a.context.ledgerSequence !== b.context.ledgerSequence) {
        return a.context.ledgerSequence - b.context.ledgerSequence;
      }
      if (a.context.txIndex !== b.context.txIndex) {
        return a.context.txIndex - b.context.txIndex;
      }
      return a.context.eventIndex - b.context.eventIndex;
    });

    for (const event of sortedEvents) {
      const result = await this.processEvent(event.context, event.data, handler);
      if (result.success) {
        processed++;
      } else if (result.error === 'duplicate_event') {
        duplicates++;
      } else {
        failed++;
      }
    }

    return { processed, failed, duplicates };
  }

  /**
   * Gets processing statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Periodic maintenance (cleanup old cache entries)
   */
  maintenance(): void {
    this.deduplicator.cleanCache();
  }

  /**
   * Resets processor state (after ledger reorg, for example)
   */
  reset(): void {
    this.deduplicator = new EventDeduplicator();
    this.orderingManager.reset();
    this.stats = {
      totalProcessed: 0,
      duplicatesDetected: 0,
      orderingViolations: 0,
      failedProcessing: 0,
    };
  }
}
