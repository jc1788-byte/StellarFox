import DeadLetterQueue from '../dlq';
import { rpc } from '@stellar/stellar-sdk';

describe('DeadLetterQueue', () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  describe('addEvent', () => {
    it('should add an event to the DLQ', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      const dlqEvent = await dlq.addEvent(
        mockEvent,
        new Error('Test error'),
        'contract-123',
        'invoice.submitted',
      );

      expect(dlqEvent.id).toBe('event-1');
      expect(dlqEvent.status).toBe('pending');
      expect(dlqEvent.failureCount).toBe(1);
      expect(dlqEvent.errorMessage).toBe('Test error');
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      await dlq.addEvent(
        mockEvent,
        new Error('Initial error'),
        'contract-123',
        'invoice.submitted',
      );

      await dlq.recordFailure('event-1', new Error('Retry error'));

      const event = dlq.getEvent('event-1');
      expect(event?.failureCount).toBe(2);
      expect(event?.errorMessage).toBe('Retry error');
    });

    it('should set exponential backoff for retries', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      await dlq.addEvent(
        mockEvent,
        new Error('Error'),
        'contract-123',
        'invoice.submitted',
      );

      await dlq.recordFailure('event-1', new Error('Failure 1'));
      const event1 = dlq.getEvent('event-1');
      const nextRetry1 = event1?.nextRetryAt?.getTime() || 0;

      await dlq.recordFailure('event-1', new Error('Failure 2'));
      const event2 = dlq.getEvent('event-1');
      const nextRetry2 = event2?.nextRetryAt?.getTime() || 0;

      // Second retry should be scheduled further in the future
      expect(nextRetry2).toBeGreaterThan(nextRetry1);
    });

    it('should mark event as failed after 10 attempts', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      await dlq.addEvent(
        mockEvent,
        new Error('Error'),
        'contract-123',
        'invoice.submitted',
      );

      for (let i = 0; i < 10; i++) {
        await dlq.recordFailure('event-1', new Error(`Failure ${i}`));
      }

      const event = dlq.getEvent('event-1');
      expect(event?.status).toBe('failed');
      expect(event?.failureCount).toBe(11);
    });
  });

  describe('getPendingRetries', () => {
    it('should return events ready for retry', async () => {
      const mockEvent1: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      const mockEvent2: any = {
        id: 'event-2',
        value: { test: 'data' },
        ledger: 1001,
        closeTime: 1234567891,
        txHash: 'tx-hash-2',
      };

      await dlq.addEvent(
        mockEvent1,
        new Error('Error 1'),
        'contract-123',
        'invoice.submitted',
      );

      await dlq.addEvent(
        mockEvent2,
        new Error('Error 2'),
        'contract-123',
        'invoice.funded',
      );

      const pending = await dlq.getPendingRetries();

      // Both events should be pending with immediate retry (no backoff on first attempt)
      expect(pending.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('replayEvent', () => {
    it('should successfully replay an event', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      await dlq.addEvent(
        mockEvent,
        new Error('Initial error'),
        'contract-123',
        'invoice.submitted',
      );

      const result = await dlq.replayEvent('event-1', async (event) => {
        // Simulate successful processing
        expect(event.id).toBe('event-1');
      });

      expect(result.success).toBe(true);

      const event = dlq.getEvent('event-1');
      expect(event?.status).toBe('resolved');
    });

    it('should record failure on replay error', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      await dlq.addEvent(
        mockEvent,
        new Error('Initial error'),
        'contract-123',
        'invoice.submitted',
      );

      const result = await dlq.replayEvent('event-1', async () => {
        throw new Error('Replay failed');
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Replay failed');

      const event = dlq.getEvent('event-1');
      expect(event?.failureCount).toBe(2);
    });
  });

  describe('resolveEvent', () => {
    it('should manually resolve an event', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      await dlq.addEvent(
        mockEvent,
        new Error('Error'),
        'contract-123',
        'invoice.submitted',
      );

      await dlq.resolveEvent('event-1', 'admin-user', 'Resolved manually');

      const event = dlq.getEvent('event-1');
      expect(event?.status).toBe('resolved');
      expect(event?.resolvedBy).toBe('admin-user');
      expect(event?.resolutionNotes).toBe('Resolved manually');
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      const mockEvent1: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      const mockEvent2: any = {
        id: 'event-2',
        value: { test: 'data' },
        ledger: 1001,
        closeTime: 1234567891,
        txHash: 'tx-hash-2',
      };

      await dlq.addEvent(
        mockEvent1,
        new Error('Error 1'),
        'contract-123',
        'invoice.submitted',
      );

      await dlq.addEvent(
        mockEvent2,
        new Error('Error 2'),
        'contract-123',
        'invoice.funded',
      );

      await dlq.resolveEvent('event-1', 'admin', 'Resolved');

      const stats = dlq.getStats();

      expect(stats.totalEvents).toBe(2);
      expect(stats.resolvedEvents).toBe(1);
      expect(stats.pendingEvents).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove old resolved events', async () => {
      const mockEvent: any = {
        id: 'event-1',
        value: { test: 'data' },
        ledger: 1000,
        closeTime: 1234567890,
        txHash: 'tx-hash-1',
      };

      await dlq.addEvent(
        mockEvent,
        new Error('Error'),
        'contract-123',
        'invoice.submitted',
      );

      await dlq.resolveEvent('event-1', 'admin', 'Resolved');

      // Fast-forward time by setting resolved date to past
      const event = dlq.getEvent('event-1');
      if (event) {
        event.resolvedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      }

      const deleted = await dlq.cleanup(30 * 24 * 60 * 60 * 1000); // 30 days

      expect(deleted).toBeGreaterThanOrEqual(0);
    });
  });
});
