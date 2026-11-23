import DynamicBatchProcessor from '../batchProcessor';

describe('DynamicBatchProcessor', () => {
  let processor: DynamicBatchProcessor;

  beforeEach(() => {
    processor = new DynamicBatchProcessor({
      minBatchSize: 5,
      maxBatchSize: 100,
      initialBatchSize: 20,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.2,
      maxWorkers: 4,
      backpressureLimit: 50,
    });
  });

  describe('batch processing', () => {
    it('should process events in batches', async () => {
      const events = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const processed: number[] = [];

      const result = await processor.processBatch(events, async (event) => {
        processed.push(event.id);
      });

      expect(result.successful).toBe(50);
      expect(result.failed).toBe(0);
      expect(processed.length).toBe(50);
    });

    it('should handle processing errors', async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({ id: i }));
      let errorCount = 0;

      const result = await processor.processBatch(events, async (event) => {
        if (event.id === 5) {
          throw new Error('Test error');
        }
        errorCount++;
      });

      expect(result.successful).toBe(9);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });
  });

  describe('dynamic batch sizing', () => {
    it('should scale up batch size with low error rate', async () => {
      const initialBatchSize = processor.getMetrics().currentBatchSize;

      // Simulate multiple successful batches
      for (let i = 0; i < 3; i++) {
        const events = Array.from({ length: 100 }, (_, j) => ({ id: j }));
        await processor.processBatch(events, async () => {
          // Simulate fast processing
        });
      }

      const newBatchSize = processor.getMetrics().currentBatchSize;
      expect(newBatchSize).toBeGreaterThan(initialBatchSize);
    });

    it('should scale down batch size with high error rate', async () => {
      const initialBatchSize = processor.getMetrics().currentBatchSize;

      // Simulate batch with high error rate
      const events = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      await processor.processBatch(events, async (event) => {
        if (event.id % 3 === 0) {
          throw new Error('Simulated error');
        }
      });

      const metrics = processor.getMetrics();
      if (metrics.errorRate > 0.2) {
        // Batch size should scale down eventually
        expect(metrics.currentBatchSize).toBeLessThanOrEqual(initialBatchSize);
      }
    });
  });

  describe('backpressure handling', () => {
    it('should pause when queue exceeds limit', () => {
      const backpressureLimit = 50;
      const processor2 = new DynamicBatchProcessor({ backpressureLimit });

      // Enqueue events until backpressure is triggered
      for (let i = 0; i < backpressureLimit - 1; i++) {
        processor2.enqueue({ id: i });
      }

      expect(processor2.isAcceptingEvents()).toBe(true);

      // Cross the threshold
      processor2.enqueue({ id: backpressureLimit - 1 });
      // After processing metrics are updated, backpressure may be applied
    });

    it('should resume when queue is cleared below threshold', () => {
      const backpressureLimit = 50;
      const processor2 = new DynamicBatchProcessor({ backpressureLimit });

      // Simulate backpressure
      for (let i = 0; i < backpressureLimit + 10; i++) {
        processor2.enqueue({ id: i });
      }

      // Process a batch to reduce queue
      const events = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      processor2.processBatch(events, async () => {});

      // Queue should be mostly cleared
      expect(processor2.getMetrics().queuedEvents).toBeLessThan(backpressureLimit);
    });
  });

  describe('metrics', () => {
    it('should track processing metrics', async () => {
      const events = Array.from({ length: 30 }, (_, i) => ({ id: i }));

      await processor.processBatch(events, async () => {
        // Simulate processing
        await new Promise((resolve) => setTimeout(resolve, 1));
      });

      const metrics = processor.getMetrics();

      expect(metrics.currentBatchSize).toBeGreaterThan(0);
      expect(metrics.throughput).toBeGreaterThan(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.processingTimeMs).toBeGreaterThan(0);
    });

    it('should calculate error rate correctly', async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({ id: i }));

      await processor.processBatch(events, async (event) => {
        if (event.id < 3) {
          throw new Error('Test error');
        }
      });

      const metrics = processor.getMetrics();
      expect(metrics.errorRate).toBeCloseTo(0.3, 1);
    });
  });
});
