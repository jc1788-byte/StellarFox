// ============================================================
// Event Processing Tests
// ============================================================

import { describe, it, expect, beforeEach, vi } from '@jest/globals';
import { EventDeduplicator, EventOrderingManager, ExactlyOnceEventProcessor } from '../eventProcessing';
import type { EventProcessingContext } from '../eventProcessing';

describe('Event Processing', () => {
  describe('EventDeduplicator', () => {
    let deduplicator: EventDeduplicator;

    beforeEach(() => {
      deduplicator = new EventDeduplicator();
    });

    it('should generate unique event IDs', () => {
      const context1: EventProcessingContext = {
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      };

      const context2: EventProcessingContext = {
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 1,
      };

      const id1 = deduplicator.generateEventId(context1);
      const id2 = deduplicator.generateEventId(context2);

      expect(id1).toBe('100:0:0');
      expect(id2).toBe('100:0:1');
      expect(id1).not.toBe(id2);
    });

    it('should detect duplicates in memory', async () => {
      const context: EventProcessingContext = {
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      };

      const eventId = deduplicator.generateEventId(context);
      
      // First check should not be duplicate
      let result = await deduplicator.isDuplicate(eventId);
      expect(result.isDuplicate).toBe(false);

      // Record it
      await deduplicator.recordProcessedEvent(eventId, context, {});

      // Second check should be duplicate
      result = await deduplicator.isDuplicate(eventId);
      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe('in_memory_cache');
    });

    it('should cache events', async () => {
      const context: EventProcessingContext = {
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      };

      const eventId = deduplicator.generateEventId(context);
      await deduplicator.recordProcessedEvent(eventId, context, {});
      
      // Should find in cache
      const result = await deduplicator.isDuplicate(eventId);
      expect(result.isDuplicate).toBe(true);
    });
  });

  describe('EventOrderingManager', () => {
    let manager: EventOrderingManager;

    beforeEach(() => {
      manager = new EventOrderingManager();
    });

    it('should validate monotonic ledger sequence', () => {
      let result = manager.validateOrdering({
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      });
      expect(result.isValid).toBe(true);

      manager.recordProcessing({
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      });

      // Next ledger should be valid
      result = manager.validateOrdering({
        ledgerSequence: 101,
        txIndex: 0,
        eventIndex: 0,
      });
      expect(result.isValid).toBe(true);

      // Same ledger should be valid
      result = manager.validateOrdering({
        ledgerSequence: 101,
        txIndex: 0,
        eventIndex: 0,
      });
      expect(result.isValid).toBe(true);

      manager.recordProcessing({
        ledgerSequence: 101,
        txIndex: 0,
        eventIndex: 0,
      });

      // Going backward should fail
      result = manager.validateOrdering({
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      });
      expect(result.isValid).toBe(false);
    });

    it('should detect transaction index violations', () => {
      manager.recordProcessing({
        ledgerSequence: 100,
        txIndex: 5,
        eventIndex: 0,
      });

      // Same ledger but lower tx index should fail
      const result = manager.validateOrdering({
        ledgerSequence: 100,
        txIndex: 3,
        eventIndex: 0,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Transaction index went backwards');
    });

    it('should detect event index violations', () => {
      manager.recordProcessing({
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 5,
      });

      // Same ledger and tx but lower event index should fail
      const result = manager.validateOrdering({
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 3,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Event index went backwards');
    });

    it('should reset state', () => {
      manager.recordProcessing({
        ledgerSequence: 100,
        txIndex: 5,
        eventIndex: 3,
      });

      manager.reset();
      const result = manager.validateOrdering({
        ledgerSequence: 1,
        txIndex: 0,
        eventIndex: 0,
      });
      expect(result.isValid).toBe(true);
    });
  });

  describe('ExactlyOnceEventProcessor', () => {
    let processor: ExactlyOnceEventProcessor;
    let mockHandler: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      processor = new ExactlyOnceEventProcessor();
      mockHandler = vi.fn(async () => {});
    });

    it('should process events exactly once', async () => {
      const context: EventProcessingContext = {
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      };

      const result = await processor.processEvent(context, {}, mockHandler);
      expect(result.success).toBe(true);

      const stats = processor.getStats();
      expect(stats.totalProcessed).toBe(1);
      expect(stats.duplicatesDetected).toBe(0);
    });

    it('should reject duplicate events', async () => {
      const context: EventProcessingContext = {
        ledgerSequence: 100,
        txIndex: 0,
        eventIndex: 0,
      };

      // First call should succeed
      let result = await processor.processEvent(context, {}, mockHandler);
      expect(result.success).toBe(true);

      // Second call with same context should be rejected
      result = await processor.processEvent(context, {}, mockHandler);
      expect(result.success).toBe(false);
      expect(result.error).toBe('duplicate_event');

      const stats = processor.getStats();
      expect(stats.duplicatesDetected).toBe(1);
    });

    it('should detect ordering violations', async () => {
      // Process event 1
      await processor.processEvent(
        { ledgerSequence: 100, txIndex: 0, eventIndex: 0 },
        {},
        mockHandler
      );

      // Try to process earlier event
      const result = await processor.processEvent(
        { ledgerSequence: 100, txIndex: 0, eventIndex: 0 },
        {},
        mockHandler
      );

      expect(result.success).toBe(false);
    });

    it('should batch process events in order', async () => {
      const events = [
        { context: { ledgerSequence: 100, txIndex: 0, eventIndex: 0 }, data: {} },
        { context: { ledgerSequence: 100, txIndex: 0, eventIndex: 1 }, data: {} },
        { context: { ledgerSequence: 100, txIndex: 1, eventIndex: 0 }, data: {} },
      ];

      const result = await processor.processBatch(events, mockHandler);
      expect(result.processed).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.duplicates).toBe(0);
    });
  });
});
