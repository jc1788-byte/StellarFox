/**
 * Batch Processing Service
 * 
 * Handles dynamic batch processing of events with:
 * - Dynamic batch sizing based on event rate
 * - Parallel processing with concurrency control
 * - Backpressure handling to prevent memory overflow
 * - Adaptive batching for optimal throughput
 */

import { logger } from '../utils/logger';

export interface BatchItem<T> {
  id: string;
  data: T;
  retries?: number;
}

export interface BatchProcessorConfig {
  /** Initial batch size */
  initialBatchSize: number;
  /** Minimum batch size */
  minBatchSize: number;
  /** Maximum batch size */
  maxBatchSize: number;
  /** Maximum concurrent batches to process */
  maxConcurrency: number;
  /** Timeout for a single item (ms) */
  itemTimeoutMs: number;
  /** Max retries for failed items */
  maxRetries: number;
  /** Enable adaptive batch sizing */
  adaptiveBatching: boolean;
  /** Time window for rate calculation (ms) */
  rateWindowMs: number;
  /** High water mark for backpressure (queue size) */
  highWaterMark: number;
  /** Low water mark for resuming (queue size) */
  lowWaterMark: number;
}

export interface ProcessingMetrics {
  successCount: number;
  failureCount: number;
  totalItemsProcessed: number;
  averageTimeMs: number;
  currentBatchSize: number;
  queueSize: number;
  throughputPerSecond: number;
}

/**
 * Generic batch processor with adaptive batching and backpressure handling
 */
export class BatchProcessor<T> {
  private queue: BatchItem<T>[] = [];
  private processing = false;
  private metrics: ProcessingMetrics = {
    successCount: 0,
    failureCount: 0,
    totalItemsProcessed: 0,
    averageTimeMs: 0,
    currentBatchSize: 0,
    queueSize: 0,
    throughputPerSecond: 0,
  };
  private config: BatchProcessorConfig;
  private currentBatchSize: number;
  private processingTimes: number[] = [];
  private lastRateCalculation = Date.now();
  private itemsInWindow = 0;
  private isPaused = false;
  private pauseResolvers: Array<() => void> = [];

  constructor(config: Partial<BatchProcessorConfig> = {}) {
    this.config = {
      initialBatchSize: config.initialBatchSize ?? 10,
      minBatchSize: config.minBatchSize ?? 5,
      maxBatchSize: config.maxBatchSize ?? 100,
      maxConcurrency: config.maxConcurrency ?? 3,
      itemTimeoutMs: config.itemTimeoutMs ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      adaptiveBatching: config.adaptiveBatching ?? true,
      rateWindowMs: config.rateWindowMs ?? 5000,
      highWaterMark: config.highWaterMark ?? 1000,
      lowWaterMark: config.lowWaterMark ?? 500,
    };

    this.currentBatchSize = this.config.initialBatchSize;
    logger.info({ config: this.config }, 'BatchProcessor initialized');
  }

  /**
   * Add an item to the processing queue
   */
  async enqueue(item: T, itemId?: string): Promise<void> {
    // Check backpressure
    if (this.queue.length >= this.config.highWaterMark) {
      logger.warn(
        { queueSize: this.queue.length, highWaterMark: this.config.highWaterMark },
        'BatchProcessor: Backpressure triggered, pausing enqueue'
      );
      
      // Wait until queue drains below low water mark
      await new Promise<void>((resolve) => {
        this.pauseResolvers.push(resolve);
        this.isPaused = true;
      });
    }

    const batchItem: BatchItem<T> = {
      id: itemId || crypto.randomUUID(),
      data: item,
      retries: 0,
    };

    this.queue.push(batchItem);
    this.metrics.queueSize = this.queue.length;

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }
  }

  /**
   * Add multiple items to the queue
   */
  async enqueueBatch(items: T[], itemIds?: string[]): Promise<void> {
    for (let i = 0; i < items.length; i++) {
      await this.enqueue(items[i], itemIds?.[i]);
    }
  }

  /**
   * Process batches continuously
   */
  private async startProcessing(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    const concurrencyLimiter = new ConcurrencyLimiter(this.config.maxConcurrency);

    try {
      while (this.queue.length > 0 || this.processing) {
        // Check if we should resume from backpressure
        if (this.isPaused && this.queue.length < this.config.lowWaterMark) {
          this.isPaused = false;
          const resolvers = this.pauseResolvers.splice(0);
          resolvers.forEach((r) => r());
          logger.info('BatchProcessor: Resuming from backpressure');
        }

        const batch = this.takeBatch();
        if (batch.length === 0) break;

        // Process batch with concurrency control
        await concurrencyLimiter.run(async () => {
          await this.processBatch(batch);
        });

        // Update metrics
        this.metrics.queueSize = this.queue.length;
      }
    } catch (err) {
      logger.error({ err }, 'BatchProcessor: Error during processing');
    } finally {
      this.processing = false;
    }
  }

  /**
   * Take a batch from the queue
   */
  private takeBatch(): BatchItem<T>[] {
    const batch = this.queue.splice(0, this.currentBatchSize);
    this.metrics.currentBatchSize = batch.length;
    return batch;
  }

  /**
   * Process a single batch
   */
  private async processBatch(batch: BatchItem<T>[]): Promise<void> {
    const startTime = Date.now();

    // Process items in parallel with timeout
    const results = await Promise.allSettled(
      batch.map((item) => this.processItem(item))
    );

    // Track timing for adaptive batching
    const batchTime = Date.now() - startTime;
    this.processingTimes.push(batchTime);
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }

    // Count successes and failures
    let successes = 0;
    let failures = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successes++;
      } else {
        failures++;
      }
    }

    this.metrics.successCount += successes;
    this.metrics.failureCount += failures;
    this.metrics.totalItemsProcessed += batch.length;

    // Update average processing time
    const avgTime = this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
    this.metrics.averageTimeMs = Math.round(avgTime);

    // Calculate throughput
    const now = Date.now();
    const elapsedMs = now - this.lastRateCalculation;
    if (elapsedMs >= this.config.rateWindowMs) {
      this.metrics.throughputPerSecond = Math.round((this.itemsInWindow / elapsedMs) * 1000);
      this.itemsInWindow = 0;
      this.lastRateCalculation = now;

      // Adapt batch size if enabled
      if (this.config.adaptiveBatching) {
        this.adaptBatchSize();
      }
    }

    this.itemsInWindow += batch.length;

    logger.debug(
      {
        batchSize: batch.length,
        successes,
        failures,
        batchTimeMs: batchTime,
        avgTimeMs: this.metrics.averageTimeMs,
      },
      'BatchProcessor: Batch processed'
    );
  }

  /**
   * Process a single item with timeout and retry logic
   */
  private async processItem(item: BatchItem<T>): Promise<void> {
    try {
      await Promise.race([
        this.processItemInternal(item),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Item processing timeout')), this.config.itemTimeoutMs)
        ),
      ]);
    } catch (err) {
      const retries = (item.retries ?? 0) + 1;

      if (retries < this.config.maxRetries) {
        logger.warn(
          { itemId: item.id, attempt: retries, maxRetries: this.config.maxRetries, err },
          'BatchProcessor: Item failed, will retry'
        );
        item.retries = retries;
        this.queue.push(item); // Re-queue for retry
      } else {
        logger.error(
          { itemId: item.id, attempts: retries, err },
          'BatchProcessor: Item failed after max retries'
        );
        throw err;
      }
    }
  }

  /**
   * Internal method to process item (override in subclass)
   */
  protected async processItemInternal(_item: BatchItem<T>): Promise<void> {
    throw new Error('processItemInternal must be implemented');
  }

  /**
   * Adapt batch size based on throughput and latency
   */
  private adaptBatchSize(): void {
    if (!this.config.adaptiveBatching) return;

    const avgTime = this.metrics.averageTimeMs;
    const currentSize = this.currentBatchSize;

    // If average time is low and throughput is good, increase batch size
    if (avgTime < 100 && this.metrics.throughputPerSecond > 50) {
      const newSize = Math.min(Math.ceil(currentSize * 1.2), this.config.maxBatchSize);
      if (newSize !== currentSize) {
        logger.info(
          { oldSize: currentSize, newSize, reason: 'Low latency, high throughput' },
          'BatchProcessor: Increasing batch size'
        );
        this.currentBatchSize = newSize;
      }
    }

    // If average time is high or queue is building up, decrease batch size
    if (avgTime > 500 || this.queue.length > this.config.highWaterMark * 0.8) {
      const newSize = Math.max(Math.ceil(currentSize * 0.8), this.config.minBatchSize);
      if (newSize !== currentSize) {
        logger.info(
          { oldSize: currentSize, newSize, reason: 'High latency or queue buildup' },
          'BatchProcessor: Decreasing batch size'
        );
        this.currentBatchSize = newSize;
      }
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): ProcessingMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      successCount: 0,
      failureCount: 0,
      totalItemsProcessed: 0,
      averageTimeMs: 0,
      currentBatchSize: this.currentBatchSize,
      queueSize: this.queue.length,
      throughputPerSecond: 0,
    };
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Wait for queue to be empty
   */
  async drain(): Promise<void> {
    while (this.queue.length > 0 || this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Helper class to limit concurrency of async operations
 */
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.limit) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }
  }
}

export { ConcurrencyLimiter };
