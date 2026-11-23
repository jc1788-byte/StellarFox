/**
 * Dynamic batch processor with adaptive batch sizing, parallel processing,
 * and backpressure handling.
 */

import { rpc } from '@stellar/stellar-sdk';
import { logger } from './logger';

export interface BatchProcessorConfig {
  minBatchSize: number;
  maxBatchSize: number;
  initialBatchSize: number;
  scaleUpThreshold: number; // % of workers available
  scaleDownThreshold: number; // % of errors
  maxWorkers: number;
  backpressureLimit: number; // max queued items before pausing
}

export interface BatchMetrics {
  processingTimeMs: number;
  throughput: number; // events/second
  errorRate: number; // 0-1
  activeWorkers: number;
  queuedEvents: number;
  currentBatchSize: number;
}

export class DynamicBatchProcessor {
  private config: BatchProcessorConfig;
  private metrics: BatchMetrics;
  private queue: any[] = [];
  private activeWorkers = 0;
  private paused = false;

  constructor(config: Partial<BatchProcessorConfig> = {}) {
    this.config = {
      minBatchSize: config.minBatchSize || 10,
      maxBatchSize: config.maxBatchSize || 500,
      initialBatchSize: config.initialBatchSize || 100,
      scaleUpThreshold: config.scaleUpThreshold || 0.8, // 80% utilization
      scaleDownThreshold: config.scaleDownThreshold || 0.2, // 20% error rate
      maxWorkers: config.maxWorkers || 4,
      backpressureLimit: config.backpressureLimit || 1000,
    };

    this.metrics = {
      processingTimeMs: 0,
      throughput: 0,
      errorRate: 0,
      activeWorkers: 0,
      queuedEvents: 0,
      currentBatchSize: this.config.initialBatchSize,
    };
  }

  /**
   * Adaptively scale batch size based on performance metrics
   */
  private scaleBatchSize(errorRate: number, workerUtilization: number): void {
    const oldSize = this.metrics.currentBatchSize;

    // Scale up if we have capacity and low error rate
    if (workerUtilization > this.config.scaleUpThreshold && errorRate < 0.05) {
      this.metrics.currentBatchSize = Math.min(
        this.metrics.currentBatchSize * 1.2,
        this.config.maxBatchSize,
      );
    }
    // Scale down if error rate is high
    else if (errorRate > this.config.scaleDownThreshold) {
      this.metrics.currentBatchSize = Math.max(
        this.metrics.currentBatchSize * 0.8,
        this.config.minBatchSize,
      );
    }

    if (oldSize !== this.metrics.currentBatchSize) {
      logger.debug(
        {
          oldSize,
          newSize: Math.round(this.metrics.currentBatchSize),
          errorRate: (errorRate * 100).toFixed(2),
          utilization: (workerUtilization * 100).toFixed(2),
        },
        'Batch size adjusted',
      );
    }
  }

  /**
   * Check if backpressure should apply (pause processing)
   */
  private checkBackpressure(): void {
    if (this.queue.length > this.config.backpressureLimit) {
      if (!this.paused) {
        this.paused = true;
        logger.warn(
          { queueSize: this.queue.length, limit: this.config.backpressureLimit },
          'Backpressure applied: pausing event processing',
        );
      }
    } else if (this.paused && this.queue.length < this.config.backpressureLimit * 0.7) {
      this.paused = false;
      logger.info(
        { queueSize: this.queue.length },
        'Backpressure released: resuming event processing',
      );
    }
  }

  /**
   * Process a batch of events in parallel
   */
  async processBatch(
    events: any[],
    processor: (event: any) => Promise<void>,
  ): Promise<{ successful: number; failed: number; errors: Error[] }> {
    const startTime = Date.now();
    const batchSize = Math.round(this.metrics.currentBatchSize);
    const workerCount = Math.min(
      Math.ceil(events.length / batchSize),
      this.config.maxWorkers,
    );

    const results = {
      successful: 0,
      failed: 0,
      errors: [] as Error[],
    };

    // Split events into chunks for parallel processing
    const chunks: any[][] = [];
    for (let i = 0; i < events.length; i += batchSize) {
      chunks.push(events.slice(i, i + batchSize));
    }

    // Process chunks in parallel with worker limit
    this.metrics.activeWorkers = 0;
    for (let i = 0; i < chunks.length; i += workerCount) {
      const batch = chunks.slice(i, i + workerCount);
      this.metrics.activeWorkers = Math.min(batch.length, workerCount);

      try {
        const promises = batch.map(async (chunk) => {
          for (const event of chunk) {
            try {
              await processor(event);
              results.successful++;
            } catch (error) {
              results.failed++;
              results.errors.push(error instanceof Error ? error : new Error(String(error)));
            }
          }
        });

        await Promise.all(promises);
      } catch (error) {
        logger.error({ error }, 'Batch processing error');
      }
    }

    // Update metrics
    const processingTimeMs = Date.now() - startTime;
    this.metrics.processingTimeMs = processingTimeMs;
    this.metrics.throughput = results.successful / (processingTimeMs / 1000);
    this.metrics.errorRate =
      results.successful + results.failed > 0
        ? results.failed / (results.successful + results.failed)
        : 0;
    this.metrics.queuedEvents = this.queue.length;
    this.metrics.activeWorkers = 0;

    // Adaptively scale batch size
    const workerUtilization = workerCount / this.config.maxWorkers;
    this.scaleBatchSize(this.metrics.errorRate, workerUtilization);

    // Check backpressure
    this.checkBackpressure();

    return results;
  }

  /**
   * Enqueue event for processing
   */
  enqueue(event: any): boolean {
    if (this.paused) {
      return false;
    }

    this.queue.push(event);
    this.metrics.queuedEvents = this.queue.length;
    return true;
  }

  /**
   * Get current metrics
   */
  getMetrics(): BatchMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if processor is accepting new events
   */
  isAcceptingEvents(): boolean {
    return !this.paused;
  }
}

export default DynamicBatchProcessor;
