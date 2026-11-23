/**
 * Event processing metrics tracker
 * 
 * Tracks:
 * - Latency: Time to process individual events and batches
 * - Throughput: Events processed per second, batches processed per minute
 * - Error rates: Failed events, failed batches, error percentages
 * - Queue depth: Number of pending events to process
 */

interface EventMetrics {
  totalEvents: number;
  failedEvents: number;
  totalLatencyMs: number; // Cumulative latency for averaging
  minLatencyMs: number;
  maxLatencyMs: number;
  errorRate: number; // 0-100
}

interface BatchMetrics {
  totalBatches: number;
  failedBatches: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  errorRate: number; // 0-100
}

interface ThroughputMetrics {
  eventsPerSecond: number;
  batchesPerMinute: number;
  lastCalculatedAt: Date;
}

interface QueueMetrics {
  pendingEvents: number;
  lastUpdatedAt: Date;
}

interface MetricsSnapshot {
  events: EventMetrics;
  batches: BatchMetrics;
  throughput: ThroughputMetrics;
  queue: QueueMetrics;
  collectedAt: Date;
}

// ─── Internal State ──────────────────────────────────────────────────────────

const eventMetrics: EventMetrics = {
  totalEvents: 0,
  failedEvents: 0,
  totalLatencyMs: 0,
  minLatencyMs: Number.MAX_SAFE_INTEGER,
  maxLatencyMs: 0,
  errorRate: 0,
};

const batchMetrics: BatchMetrics = {
  totalBatches: 0,
  failedBatches: 0,
  totalLatencyMs: 0,
  minLatencyMs: Number.MAX_SAFE_INTEGER,
  maxLatencyMs: 0,
  errorRate: 0,
};

const queueMetrics: QueueMetrics = {
  pendingEvents: 0,
  lastUpdatedAt: new Date(),
};

let lastThroughputCalculation = Date.now();
let eventCountAtLastCalculation = 0;
let batchCountAtLastCalculation = 0;

// ─── Event Metrics ───────────────────────────────────────────────────────────

/**
 * Record a successfully processed event
 */
export function recordEventSuccess(latencyMs: number): void {
  eventMetrics.totalEvents++;
  eventMetrics.totalLatencyMs += latencyMs;
  eventMetrics.minLatencyMs = Math.min(eventMetrics.minLatencyMs, latencyMs);
  eventMetrics.maxLatencyMs = Math.max(eventMetrics.maxLatencyMs, latencyMs);
  updateEventErrorRate();
}

/**
 * Record a failed event
 */
export function recordEventFailure(latencyMs?: number): void {
  eventMetrics.totalEvents++;
  eventMetrics.failedEvents++;
  if (latencyMs !== undefined) {
    eventMetrics.totalLatencyMs += latencyMs;
    eventMetrics.minLatencyMs = Math.min(eventMetrics.minLatencyMs, latencyMs);
    eventMetrics.maxLatencyMs = Math.max(eventMetrics.maxLatencyMs, latencyMs);
  }
  updateEventErrorRate();
}

/**
 * Get average event processing latency
 */
export function getAverageEventLatency(): number {
  if (eventMetrics.totalEvents === 0) return 0;
  return eventMetrics.totalLatencyMs / eventMetrics.totalEvents;
}

// ─── Batch Metrics ───────────────────────────────────────────────────────────

/**
 * Record a successfully processed batch
 */
export function recordBatchSuccess(latencyMs: number): void {
  batchMetrics.totalBatches++;
  batchMetrics.totalLatencyMs += latencyMs;
  batchMetrics.minLatencyMs = Math.min(batchMetrics.minLatencyMs, latencyMs);
  batchMetrics.maxLatencyMs = Math.max(batchMetrics.maxLatencyMs, latencyMs);
  updateBatchErrorRate();
}

/**
 * Record a failed batch
 */
export function recordBatchFailure(latencyMs?: number): void {
  batchMetrics.totalBatches++;
  batchMetrics.failedBatches++;
  if (latencyMs !== undefined) {
    batchMetrics.totalLatencyMs += latencyMs;
    batchMetrics.minLatencyMs = Math.min(batchMetrics.minLatencyMs, latencyMs);
    batchMetrics.maxLatencyMs = Math.max(batchMetrics.maxLatencyMs, latencyMs);
  }
  updateBatchErrorRate();
}

/**
 * Get average batch processing latency
 */
export function getAverageBatchLatency(): number {
  if (batchMetrics.totalBatches === 0) return 0;
  return batchMetrics.totalLatencyMs / batchMetrics.totalBatches;
}

// ─── Queue Metrics ───────────────────────────────────────────────────────────

/**
 * Update the number of pending events in queue
 */
export function setQueueDepth(pendingCount: number): void {
  queueMetrics.pendingEvents = pendingCount;
  queueMetrics.lastUpdatedAt = new Date();
}

/**
 * Increment queue depth
 */
export function incrementQueueDepth(count: number = 1): void {
  queueMetrics.pendingEvents = Math.max(0, queueMetrics.pendingEvents + count);
  queueMetrics.lastUpdatedAt = new Date();
}

/**
 * Decrement queue depth
 */
export function decrementQueueDepth(count: number = 1): void {
  queueMetrics.pendingEvents = Math.max(0, queueMetrics.pendingEvents - count);
  queueMetrics.lastUpdatedAt = new Date();
}

// ─── Throughput Metrics ──────────────────────────────────────────────────────

/**
 * Calculate events per second and batches per minute
 */
function calculateThroughput(): { eventsPerSecond: number; batchesPerMinute: number } {
  const now = Date.now();
  const timeDeltaMs = now - lastThroughputCalculation;

  if (timeDeltaMs === 0) {
    return { eventsPerSecond: 0, batchesPerMinute: 0 };
  }

  const eventDelta = eventMetrics.totalEvents - eventCountAtLastCalculation;
  const batchDelta = batchMetrics.totalBatches - batchCountAtLastCalculation;

  const eventsPerSecond = (eventDelta / timeDeltaMs) * 1000;
  const batchesPerMinute = (batchDelta / timeDeltaMs) * 60000;

  // Reset for next calculation
  lastThroughputCalculation = now;
  eventCountAtLastCalculation = eventMetrics.totalEvents;
  batchCountAtLastCalculation = batchMetrics.totalBatches;

  return { eventsPerSecond, batchesPerMinute };
}

// ─── Error Rate Calculations ─────────────────────────────────────────────────

function updateEventErrorRate(): void {
  if (eventMetrics.totalEvents === 0) {
    eventMetrics.errorRate = 0;
  } else {
    eventMetrics.errorRate = (eventMetrics.failedEvents / eventMetrics.totalEvents) * 100;
  }
}

function updateBatchErrorRate(): void {
  if (batchMetrics.totalBatches === 0) {
    batchMetrics.errorRate = 0;
  } else {
    batchMetrics.errorRate = (batchMetrics.failedBatches / batchMetrics.totalBatches) * 100;
  }
}

// ─── Snapshot and Export ─────────────────────────────────────────────────────

/**
 * Get a complete snapshot of all metrics
 */
export function getMetricsSnapshot(): MetricsSnapshot {
  const { eventsPerSecond, batchesPerMinute } = calculateThroughput();

  return {
    events: {
      totalEvents: eventMetrics.totalEvents,
      failedEvents: eventMetrics.failedEvents,
      totalLatencyMs: eventMetrics.totalLatencyMs,
      minLatencyMs: eventMetrics.minLatencyMs === Number.MAX_SAFE_INTEGER ? 0 : eventMetrics.minLatencyMs,
      maxLatencyMs: eventMetrics.maxLatencyMs,
      errorRate: Number(eventMetrics.errorRate.toFixed(2)),
    },
    batches: {
      totalBatches: batchMetrics.totalBatches,
      failedBatches: batchMetrics.failedBatches,
      totalLatencyMs: batchMetrics.totalLatencyMs,
      minLatencyMs: batchMetrics.minLatencyMs === Number.MAX_SAFE_INTEGER ? 0 : batchMetrics.minLatencyMs,
      maxLatencyMs: batchMetrics.maxLatencyMs,
      errorRate: Number(batchMetrics.errorRate.toFixed(2)),
    },
    throughput: {
      eventsPerSecond: Number(eventsPerSecond.toFixed(2)),
      batchesPerMinute: Number(batchesPerMinute.toFixed(2)),
      lastCalculatedAt: new Date(),
    },
    queue: {
      pendingEvents: queueMetrics.pendingEvents,
      lastUpdatedAt: queueMetrics.lastUpdatedAt,
    },
    collectedAt: new Date(),
  };
}

/**
 * Get metrics formatted for Prometheus-style output
 */
export function getPrometheusMetrics(): string {
  const snapshot = getMetricsSnapshot();
  const lines: string[] = [];

  // Event metrics
  lines.push(`# HELP indexer_events_total Total number of events processed`);
  lines.push(`# TYPE indexer_events_total counter`);
  lines.push(`indexer_events_total{status="success"} ${snapshot.events.totalEvents - snapshot.events.failedEvents}`);
  lines.push(`indexer_events_total{status="failed"} ${snapshot.events.failedEvents}`);
  lines.push('');

  lines.push(`# HELP indexer_events_latency_ms Event processing latency in milliseconds`);
  lines.push(`# TYPE indexer_events_latency_ms gauge`);
  lines.push(`indexer_events_latency_ms{quantile="min"} ${snapshot.events.minLatencyMs}`);
  lines.push(`indexer_events_latency_ms{quantile="max"} ${snapshot.events.maxLatencyMs}`);
  lines.push(`indexer_events_latency_ms{quantile="avg"} ${getAverageEventLatency().toFixed(2)}`);
  lines.push('');

  lines.push(`# HELP indexer_events_error_rate Event error rate as percentage`);
  lines.push(`# TYPE indexer_events_error_rate gauge`);
  lines.push(`indexer_events_error_rate ${snapshot.events.errorRate}`);
  lines.push('');

  // Batch metrics
  lines.push(`# HELP indexer_batches_total Total number of batches processed`);
  lines.push(`# TYPE indexer_batches_total counter`);
  lines.push(`indexer_batches_total{status="success"} ${snapshot.batches.totalBatches - snapshot.batches.failedBatches}`);
  lines.push(`indexer_batches_total{status="failed"} ${snapshot.batches.failedBatches}`);
  lines.push('');

  lines.push(`# HELP indexer_batches_latency_ms Batch processing latency in milliseconds`);
  lines.push(`# TYPE indexer_batches_latency_ms gauge`);
  lines.push(`indexer_batches_latency_ms{quantile="min"} ${snapshot.batches.minLatencyMs}`);
  lines.push(`indexer_batches_latency_ms{quantile="max"} ${snapshot.batches.maxLatencyMs}`);
  lines.push(`indexer_batches_latency_ms{quantile="avg"} ${getAverageBatchLatency().toFixed(2)}`);
  lines.push('');

  lines.push(`# HELP indexer_batches_error_rate Batch error rate as percentage`);
  lines.push(`# TYPE indexer_batches_error_rate gauge`);
  lines.push(`indexer_batches_error_rate ${snapshot.batches.errorRate}`);
  lines.push('');

  // Throughput metrics
  lines.push(`# HELP indexer_throughput_events_per_sec Events processed per second`);
  lines.push(`# TYPE indexer_throughput_events_per_sec gauge`);
  lines.push(`indexer_throughput_events_per_sec ${snapshot.throughput.eventsPerSecond}`);
  lines.push('');

  lines.push(`# HELP indexer_throughput_batches_per_min Batches processed per minute`);
  lines.push(`# TYPE indexer_throughput_batches_per_min gauge`);
  lines.push(`indexer_throughput_batches_per_min ${snapshot.throughput.batchesPerMinute}`);
  lines.push('');

  // Queue metrics
  lines.push(`# HELP indexer_queue_depth Number of pending events in queue`);
  lines.push(`# TYPE indexer_queue_depth gauge`);
  lines.push(`indexer_queue_depth ${snapshot.queue.pendingEvents}`);

  return lines.join('\n');
}

/**
 * Reset all metrics (useful for testing or restart scenarios)
 */
export function resetMetrics(): void {
  eventMetrics.totalEvents = 0;
  eventMetrics.failedEvents = 0;
  eventMetrics.totalLatencyMs = 0;
  eventMetrics.minLatencyMs = Number.MAX_SAFE_INTEGER;
  eventMetrics.maxLatencyMs = 0;
  eventMetrics.errorRate = 0;

  batchMetrics.totalBatches = 0;
  batchMetrics.failedBatches = 0;
  batchMetrics.totalLatencyMs = 0;
  batchMetrics.minLatencyMs = Number.MAX_SAFE_INTEGER;
  batchMetrics.maxLatencyMs = 0;
  batchMetrics.errorRate = 0;

  queueMetrics.pendingEvents = 0;
  queueMetrics.lastUpdatedAt = new Date();

  lastThroughputCalculation = Date.now();
  eventCountAtLastCalculation = 0;
  batchCountAtLastCalculation = 0;
}
