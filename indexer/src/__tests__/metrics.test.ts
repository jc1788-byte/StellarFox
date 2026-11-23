import {
  recordEventSuccess,
  recordEventFailure,
  recordBatchSuccess,
  recordBatchFailure,
  getAverageEventLatency,
  getAverageBatchLatency,
  setQueueDepth,
  incrementQueueDepth,
  decrementQueueDepth,
  getMetricsSnapshot,
  getPrometheusMetrics,
  resetMetrics,
} from '../metrics';

describe('Metrics Module', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('Event Metrics', () => {
    it('should record event success', () => {
      recordEventSuccess(100);
      recordEventSuccess(200);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.events.totalEvents).toBe(2);
      expect(snapshot.events.failedEvents).toBe(0);
      expect(snapshot.events.errorRate).toBe(0);
    });

    it('should track latency for events', () => {
      recordEventSuccess(50);
      recordEventSuccess(150);
      recordEventSuccess(100);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.events.minLatencyMs).toBe(50);
      expect(snapshot.events.maxLatencyMs).toBe(150);
      expect(getAverageEventLatency()).toBe(100);
    });

    it('should record event failures', () => {
      recordEventSuccess(100);
      recordEventFailure(50);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.events.totalEvents).toBe(2);
      expect(snapshot.events.failedEvents).toBe(1);
      expect(snapshot.events.errorRate).toBe(50);
    });

    it('should calculate error rate correctly', () => {
      recordEventSuccess(100);
      recordEventSuccess(100);
      recordEventFailure();
      recordEventFailure();

      const snapshot = getMetricsSnapshot();
      expect(snapshot.events.totalEvents).toBe(4);
      expect(snapshot.events.failedEvents).toBe(2);
      expect(snapshot.events.errorRate).toBe(50);
    });
  });

  describe('Batch Metrics', () => {
    it('should record batch success', () => {
      recordBatchSuccess(1000);
      recordBatchSuccess(1500);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.batches.totalBatches).toBe(2);
      expect(snapshot.batches.failedBatches).toBe(0);
    });

    it('should track batch latency', () => {
      recordBatchSuccess(500);
      recordBatchSuccess(1000);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.batches.minLatencyMs).toBe(500);
      expect(snapshot.batches.maxLatencyMs).toBe(1000);
      expect(getAverageBatchLatency()).toBe(750);
    });

    it('should record batch failures', () => {
      recordBatchSuccess(1000);
      recordBatchFailure(500);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.batches.totalBatches).toBe(2);
      expect(snapshot.batches.failedBatches).toBe(1);
      expect(snapshot.batches.errorRate).toBe(50);
    });
  });

  describe('Queue Metrics', () => {
    it('should track queue depth', () => {
      setQueueDepth(100);
      const snapshot = getMetricsSnapshot();
      expect(snapshot.queue.pendingEvents).toBe(100);
    });

    it('should increment queue depth', () => {
      setQueueDepth(50);
      incrementQueueDepth(25);
      const snapshot = getMetricsSnapshot();
      expect(snapshot.queue.pendingEvents).toBe(75);
    });

    it('should decrement queue depth', () => {
      setQueueDepth(100);
      decrementQueueDepth(30);
      const snapshot = getMetricsSnapshot();
      expect(snapshot.queue.pendingEvents).toBe(70);
    });

    it('should not allow negative queue depth', () => {
      setQueueDepth(10);
      decrementQueueDepth(20);
      const snapshot = getMetricsSnapshot();
      expect(snapshot.queue.pendingEvents).toBe(0);
    });
  });

  describe('Throughput Metrics', () => {
    it('should calculate throughput', () => {
      // Record some events
      recordEventSuccess(10);
      recordEventSuccess(10);
      recordEventSuccess(10);

      const snapshot = getMetricsSnapshot();
      // Throughput values should be computed
      expect(snapshot.throughput.eventsPerSecond).toBeDefined();
      expect(snapshot.throughput.batchesPerMinute).toBeDefined();
    });
  });

  describe('Prometheus Metrics Format', () => {
    it('should output metrics in Prometheus format', () => {
      recordEventSuccess(100);
      recordEventSuccess(200);
      recordBatchSuccess(1000);

      const prometheusOutput = getPrometheusMetrics();

      expect(prometheusOutput).toContain('# HELP');
      expect(prometheusOutput).toContain('# TYPE');
      expect(prometheusOutput).toContain('indexer_events_total');
      expect(prometheusOutput).toContain('indexer_batches_total');
      expect(prometheusOutput).toContain('indexer_queue_depth');
    });

    it('should include all metric types', () => {
      recordEventSuccess(100);
      recordBatchSuccess(500);
      setQueueDepth(50);

      const prometheusOutput = getPrometheusMetrics();

      // Check for all expected metric types
      expect(prometheusOutput).toContain('indexer_events_latency_ms');
      expect(prometheusOutput).toContain('indexer_events_error_rate');
      expect(prometheusOutput).toContain('indexer_batches_latency_ms');
      expect(prometheusOutput).toContain('indexer_throughput_events_per_sec');
    });
  });

  describe('Reset Metrics', () => {
    it('should reset all metrics', () => {
      recordEventSuccess(100);
      recordBatchSuccess(1000);
      setQueueDepth(100);

      resetMetrics();

      const snapshot = getMetricsSnapshot();
      expect(snapshot.events.totalEvents).toBe(0);
      expect(snapshot.batches.totalBatches).toBe(0);
      expect(snapshot.queue.pendingEvents).toBe(0);
    });
  });
});
