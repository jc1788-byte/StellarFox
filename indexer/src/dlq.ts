/**
 * Dead Letter Queue (DLQ) for unprocessable events with replay capabilities
 * and detailed failure tracking.
 */

import { rpc } from '@stellar/stellar-sdk';
import { logger } from './logger';

export interface DLQEvent {
  id: string;
  eventType: string;
  contractAddress: string;
  payload: any;
  ledgerSequence: number;
  ledgerCloseTime: Date;
  txHash: string;
  errorMessage: string;
  errorStack?: string;
  failureCount: number;
  lastErrorAt: Date;
  nextRetryAt?: Date;
  status: 'pending' | 'failed' | 'resolved';
  resolvedAt?: Date;
  resolvedBy?: string; // admin user or 'auto'
  resolutionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DLQStats {
  totalEvents: number;
  pendingEvents: number;
  failedEvents: number;
  resolvedEvents: number;
  oldestEvent: Date | null;
  averageFailureCount: number;
}

export interface ReplayResult {
  eventId: string;
  success: boolean;
  error?: Error;
  attemptedAt: Date;
}

/**
 * In-memory DLQ implementation with persistence hooks
 * (In production, back this with database queries)
 */
export class DeadLetterQueue {
  private events: Map<string, DLQEvent> = new Map();
  private persistenceAdapter?: {
    save: (event: DLQEvent) => Promise<void>;
    load: () => Promise<DLQEvent[]>;
    delete: (eventId: string) => Promise<void>;
    query: (filters: Partial<DLQEvent>) => Promise<DLQEvent[]>;
  };

  constructor(adapter?: typeof DeadLetterQueue.prototype.persistenceAdapter) {
    this.persistenceAdapter = adapter;
  }

  /**
   * Add an event to the DLQ
   */
  async addEvent(
    event: rpc.Api.EventResponse,
    error: Error,
    contractAddress: string,
    eventType: string,
  ): Promise<DLQEvent> {
    const dlqEvent: DLQEvent = {
      id: event.id,
      eventType,
      contractAddress,
      payload: event.value,
      ledgerSequence: event.ledger,
      ledgerCloseTime: new Date((event as any).closeTime * 1000),
      txHash: event.txHash,
      errorMessage: error.message,
      errorStack: error.stack,
      failureCount: 1,
      lastErrorAt: new Date(),
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store locally
    this.events.set(dlqEvent.id, dlqEvent);

    // Persist to adapter if available
    if (this.persistenceAdapter) {
      try {
        await this.persistenceAdapter.save(dlqEvent);
      } catch (err) {
        logger.error(
          { error: err, eventId: dlqEvent.id },
          'Failed to persist DLQ event',
        );
      }
    }

    logger.warn(
      {
        eventId: dlqEvent.id,
        eventType: dlqEvent.eventType,
        error: error.message,
      },
      'Event added to DLQ',
    );

    return dlqEvent;
  }

  /**
   * Increment failure count for an event
   */
  async recordFailure(
    eventId: string,
    error: Error,
  ): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) return;

    event.failureCount++;
    event.lastErrorAt = new Date();
    event.errorMessage = error.message;
    event.errorStack = error.stack;
    event.updatedAt = new Date();

    // Exponential backoff for retries: 2^n minutes
    const backoffMinutes = Math.pow(2, event.failureCount - 1);
    event.nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

    // Mark as permanently failed after 10 attempts
    if (event.failureCount >= 10) {
      event.status = 'failed';
    }

    if (this.persistenceAdapter) {
      try {
        await this.persistenceAdapter.save(event);
      } catch (err) {
        logger.error({ error: err, eventId }, 'Failed to update DLQ event');
      }
    }

    logger.debug(
      {
        eventId,
        failureCount: event.failureCount,
        nextRetryAt: event.nextRetryAt,
      },
      'DLQ event failure recorded',
    );
  }

  /**
   * Get an event from the DLQ
   */
  getEvent(eventId: string): DLQEvent | undefined {
    return this.events.get(eventId);
  }

  /**
   * Get all pending events ready for retry
   */
  async getPendingRetries(): Promise<DLQEvent[]> {
    const now = new Date();

    if (this.persistenceAdapter) {
      return this.persistenceAdapter.query({
        status: 'pending',
      });
    }

    return Array.from(this.events.values())
      .filter(
        (e) =>
          e.status === 'pending' &&
          e.nextRetryAt &&
          e.nextRetryAt <= now,
      )
      .sort((a, b) => (a.nextRetryAt?.getTime() || 0) - (b.nextRetryAt?.getTime() || 0));
  }

  /**
   * Replay an event (attempt to reprocess it)
   */
  async replayEvent(
    eventId: string,
    processor: (event: DLQEvent) => Promise<void>,
  ): Promise<ReplayResult> {
    const event = this.events.get(eventId);
    if (!event) {
      return {
        eventId,
        success: false,
        error: new Error('Event not found in DLQ'),
        attemptedAt: new Date(),
      };
    }

    try {
      await processor(event);

      // Mark as resolved
      event.status = 'resolved';
      event.resolvedAt = new Date();
      event.resolvedBy = 'auto';
      event.resolutionNotes = 'Auto-resolved after successful replay';
      event.updatedAt = new Date();

      if (this.persistenceAdapter) {
        await this.persistenceAdapter.save(event);
      }

      logger.info(
        { eventId, failureCount: event.failureCount },
        'DLQ event successfully replayed',
      );

      return {
        eventId,
        success: true,
        attemptedAt: new Date(),
      };
    } catch (error) {
      await this.recordFailure(eventId, error instanceof Error ? error : new Error(String(error)));

      return {
        eventId,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        attemptedAt: new Date(),
      };
    }
  }

  /**
   * Resolve an event manually (admin action)
   */
  async resolveEvent(
    eventId: string,
    resolvedBy: string,
    notes: string,
  ): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found in DLQ`);
    }

    event.status = 'resolved';
    event.resolvedAt = new Date();
    event.resolvedBy = resolvedBy;
    event.resolutionNotes = notes;
    event.updatedAt = new Date();

    if (this.persistenceAdapter) {
      await this.persistenceAdapter.save(event);
    }

    logger.info(
      { eventId, resolvedBy, notes },
      'DLQ event manually resolved',
    );
  }

  /**
   * Get DLQ statistics
   */
  getStats(): DLQStats {
    const events = Array.from(this.events.values());
    const pending = events.filter((e) => e.status === 'pending');
    const failed = events.filter((e) => e.status === 'failed');
    const resolved = events.filter((e) => e.status === 'resolved');

    const averageFailureCount =
      events.length > 0
        ? events.reduce((sum, e) => sum + e.failureCount, 0) / events.length
        : 0;

    const oldestEvent = events.length > 0
      ? new Date(Math.min(...events.map((e) => e.createdAt.getTime())))
      : null;

    return {
      totalEvents: events.length,
      pendingEvents: pending.length,
      failedEvents: failed.length,
      resolvedEvents: resolved.length,
      oldestEvent,
      averageFailureCount,
    };
  }

  /**
   * Clean up resolved events older than specified age
   */
  async cleanup(ageMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - ageMs);
    const toDelete: string[] = [];

    this.events.forEach((event, id) => {
      if (event.status === 'resolved' && event.resolvedAt && event.resolvedAt < cutoff) {
        toDelete.push(id);
      }
    });

    for (const id of toDelete) {
      this.events.delete(id);
      if (this.persistenceAdapter) {
        try {
          await this.persistenceAdapter.delete(id);
        } catch (err) {
          logger.error({ error: err, eventId: id }, 'Failed to delete DLQ event');
        }
      }
    }

    logger.info({ deletedCount: toDelete.length }, 'DLQ cleanup completed');
    return toDelete.length;
  }

  /**
   * Load events from persistence
   */
  async loadFromPersistence(): Promise<void> {
    if (!this.persistenceAdapter) return;

    try {
      const events = await this.persistenceAdapter.load();
      events.forEach((event) => {
        this.events.set(event.id, event);
      });
      logger.info({ eventCount: events.length }, 'DLQ events loaded from persistence');
    } catch (err) {
      logger.error({ error: err }, 'Failed to load DLQ events from persistence');
    }
  }
}

export default DeadLetterQueue;
