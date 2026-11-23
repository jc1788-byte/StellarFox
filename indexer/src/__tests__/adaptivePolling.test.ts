// ============================================================
// Adaptive Polling Tests
// ============================================================

import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdaptivePoller, PollingCircuitBreaker } from '../adaptivePolling';

describe('Adaptive Polling', () => {
  describe('AdaptivePoller', () => {
    let poller: AdaptivePoller;

    beforeEach(() => {
      poller = new AdaptivePoller({
        minIntervalMs: 1000,
        maxIntervalMs: 60000,
        initialIntervalMs: 5000,
        errorMultiplier: 1.5,
        successDivisor: 1.2,
        jitterPercent: 20,
      });
    });

    it('should initialize with default interval', () => {
      expect(poller.getInterval()).toBe(5000);
    });

    it('should decrease interval on success with events', () => {
      const initialInterval = poller.getInterval();
      poller.recordSuccess(10); // 10 events found
      poller.recordSuccess(5); // Another success with events
      const newInterval = poller.getInterval();
      // Should be lower than initial (with some jitter)
      expect(newInterval).toBeLessThanOrEqual(initialInterval);
    });

    it('should increase interval on error', () => {
      const initialInterval = poller.getInterval();
      const error = new Error('Connection timeout');
      poller.recordError(error);
      const newInterval = poller.getInterval();
      // Should be higher than initial
      expect(newInterval).toBeGreaterThan(initialInterval);
    });

    it('should exponentially backoff on consecutive errors', () => {
      const intervals: number[] = [poller.getInterval()];
      
      for (let i = 0; i < 3; i++) {
        poller.recordError(new Error('Error'));
        intervals.push(poller.getInterval());
      }

      // Each interval should be increasingly larger
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1]);
      }
    });

    it('should cap exponential growth at max interval', () => {
      for (let i = 0; i < 20; i++) {
        poller.recordError(new Error('Error'));
      }
      expect(poller.getInterval()).toBeLessThanOrEqual(60000);
    });

    it('should reset on success after errors', () => {
      poller.recordError(new Error('Error'));
      poller.recordError(new Error('Error'));
      const errorInterval = poller.getInterval();
      
      poller.recordSuccess(5);
      const newInterval = poller.getInterval();
      
      // Success should reduce backoff
      expect(newInterval).toBeLessThan(errorInterval);
    });

    it('should track metrics', () => {
      poller.recordSuccess(5);
      poller.recordError(new Error('Test'));
      const metrics = poller.getMetrics();

      expect(metrics.eventsProcessed).toBe(5);
      expect(metrics.totalPollAttempts).toBe(2);
      expect(metrics.totalFailedAttempts).toBe(1);
    });

    it('should detect backoff state', () => {
      expect(poller.isInBackoff()).toBe(false);
      poller.recordError(new Error('Error'));
      expect(poller.isInBackoff()).toBe(true);
    });

    it('should reset state', () => {
      poller.recordError(new Error('Error'));
      poller.recordError(new Error('Error'));
      poller.reset();
      
      const metrics = poller.getMetrics();
      expect(metrics.consecutiveErrors).toBe(0);
      expect(metrics.totalPollAttempts).toBe(0);
      expect(poller.getInterval()).toBe(5000);
    });
  });

  describe('PollingCircuitBreaker', () => {
    let breaker: PollingCircuitBreaker;

    beforeEach(() => {
      breaker = new PollingCircuitBreaker(3, 2, 1000);
    });

    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
      expect(breaker.canProceed()).toBe(true);
    });

    it('should open after failure threshold', () => {
      expect(breaker.canProceed()).toBe(true);
      breaker.recordFailure();
      expect(breaker.canProceed()).toBe(true);
      breaker.recordFailure();
      expect(breaker.canProceed()).toBe(true);
      breaker.recordFailure(); // 3rd failure
      
      expect(breaker.getState()).toBe('open');
      expect(breaker.canProceed()).toBe(false);
    });

    it('should transition to half-open after timeout', async () => {
      // Trigger open state
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getState()).toBe('open');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(breaker.canProceed()).toBe(true);
      expect(breaker.getState()).toBe('half-open');
    });

    it('should close after successful recovery', () => {
      // Open circuit
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
      }

      // Transition to half-open
      breaker.recordSuccess();
      breaker.recordSuccess(); // 2nd success

      expect(breaker.getState()).toBe('closed');
      expect(breaker.canProceed()).toBe(true);
    });

    it('should reset', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      
      breaker.reset();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.canProceed()).toBe(true);
    });
  });
});
