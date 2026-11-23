/**
 * Event filtering and sampling strategies
 * 
 * Reduces unnecessary processing and storage by:
 * - Filtering events based on type, contract, topics
 * - Sampling events using various strategies (random, systematic, adaptive)
 * - Batching related events for efficiency
 */

import { rpc } from '@stellar/stellar-sdk';

// ─── Filter Types ────────────────────────────────────────────────────────────

interface EventFilter {
  eventTypes?: string[]; // Whitelist specific event types
  contractIds?: string[]; // Whitelist specific contracts
  topics?: string[]; // Whitelist specific topics
  excludeEventTypes?: string[]; // Blacklist event types
  excludeContractIds?: string[]; // Blacklist contracts
  minLedger?: number; // Only events from this ledger onward
  maxLedger?: number; // Only events up to this ledger
}

interface SamplingConfig {
  strategy: 'none' | 'random' | 'systematic' | 'adaptive';
  sampleRate?: number; // 0-1, percentage of events to keep
  sampleEveryN?: number; // For systematic sampling: keep 1 in N events
  adaptiveThreshold?: number; // For adaptive: queue depth threshold to trigger sampling
  adaptiveRate?: number; // For adaptive: sampling rate when threshold exceeded
}

// ─── State ───────────────────────────────────────────────────────────────────

let currentFilter: EventFilter = {};
let currentSamplingConfig: SamplingConfig = { strategy: 'none' };
let randomSamplingCounter = 0;
let systematicSamplingCounter = 0;

// ─── Filter Configuration ────────────────────────────────────────────────────

/**
 * Set the active event filter
 */
export function setEventFilter(filter: EventFilter): void {
  currentFilter = filter;
}

/**
 * Get the current event filter
 */
export function getEventFilter(): EventFilter {
  return { ...currentFilter };
}

/**
 * Clear the event filter (allow all events)
 */
export function clearEventFilter(): void {
  currentFilter = {};
}

/**
 * Create a filter that only allows specified event types
 */
export function createEventTypeFilter(eventTypes: string[]): EventFilter {
  return { eventTypes };
}

/**
 * Create a filter that only allows specified contracts
 */
export function createContractFilter(contractIds: string[]): EventFilter {
  return { contractIds };
}

/**
 * Create a combined filter
 */
export function createCombinedFilter(
  eventTypes?: string[],
  contractIds?: string[],
  topics?: string[],
): EventFilter {
  return {
    eventTypes,
    contractIds,
    topics,
  };
}

// ─── Sampling Configuration ──────────────────────────────────────────────────

/**
 * Set the sampling strategy
 */
export function setSamplingConfig(config: SamplingConfig): void {
  if (config.strategy === 'none') {
    currentSamplingConfig = { strategy: 'none' };
  } else if (config.strategy === 'random') {
    currentSamplingConfig = {
      strategy: 'random',
      sampleRate: config.sampleRate ?? 0.1, // Default to 10%
    };
  } else if (config.strategy === 'systematic') {
    currentSamplingConfig = {
      strategy: 'systematic',
      sampleEveryN: config.sampleEveryN ?? 10, // Default to every 10th event
    };
  } else if (config.strategy === 'adaptive') {
    currentSamplingConfig = {
      strategy: 'adaptive',
      adaptiveThreshold: config.adaptiveThreshold ?? 1000, // Default threshold
      adaptiveRate: config.adaptiveRate ?? 0.5, // Default to 50% sampling
    };
  }

  randomSamplingCounter = 0;
  systematicSamplingCounter = 0;
}

/**
 * Get the current sampling configuration
 */
export function getSamplingConfig(): SamplingConfig {
  return { ...currentSamplingConfig };
}

/**
 * Disable sampling (keep all events)
 */
export function disableSampling(): void {
  currentSamplingConfig = { strategy: 'none' };
}

/**
 * Enable random sampling
 */
export function enableRandomSampling(sampleRate: number = 0.1): void {
  setSamplingConfig({
    strategy: 'random',
    sampleRate: Math.max(0.01, Math.min(1, sampleRate)), // Clamp 0.01-1
  });
}

/**
 * Enable systematic sampling (keep 1 in N events)
 */
export function enableSystematicSampling(sampleEveryN: number = 10): void {
  setSamplingConfig({
    strategy: 'systematic',
    sampleEveryN: Math.max(1, Math.round(sampleEveryN)),
  });
}

/**
 * Enable adaptive sampling (triggered by queue depth)
 */
export function enableAdaptiveSampling(
  threshold: number = 1000,
  sampleRate: number = 0.5,
): void {
  setSamplingConfig({
    strategy: 'adaptive',
    adaptiveThreshold: threshold,
    adaptiveRate: Math.max(0.01, Math.min(1, sampleRate)),
  });
}

// ─── Filtering Logic ─────────────────────────────────────────────────────────

/**
 * Check if an event passes the active filter
 */
export function passesFilter(event: rpc.Api.EventResponse): boolean {
  // Check event type filter
  if (currentFilter.eventTypes && currentFilter.eventTypes.length > 0) {
    // Extract event type from topics[0] if available
    const eventType = extractEventType(event);
    if (eventType && !currentFilter.eventTypes.includes(eventType)) {
      return false;
    }
  }

  // Check event type exclusion
  if (currentFilter.excludeEventTypes && currentFilter.excludeEventTypes.length > 0) {
    const eventType = extractEventType(event);
    if (eventType && currentFilter.excludeEventTypes.includes(eventType)) {
      return false;
    }
  }

  // Check contract ID filter
  if (currentFilter.contractIds && currentFilter.contractIds.length > 0) {
    if (!currentFilter.contractIds.includes(event.contractId)) {
      return false;
    }
  }

  // Check contract ID exclusion
  if (currentFilter.excludeContractIds && currentFilter.excludeContractIds.length > 0) {
    if (currentFilter.excludeContractIds.includes(event.contractId)) {
      return false;
    }
  }

  // Check topics filter
  if (currentFilter.topics && currentFilter.topics.length > 0) {
    const eventTopics = extractTopics(event);
    const hasMatchingTopic = eventTopics.some((topic) => currentFilter.topics!.includes(topic));
    if (!hasMatchingTopic) {
      return false;
    }
  }

  // Check ledger range
  if (currentFilter.minLedger && event.ledger < currentFilter.minLedger) {
    return false;
  }
  if (currentFilter.maxLedger && event.ledger > currentFilter.maxLedger) {
    return false;
  }

  return true;
}

// ─── Sampling Logic ──────────────────────────────────────────────────────────

/**
 * Check if an event should be sampled based on active strategy
 * Returns true if event should be KEPT, false if it should be DROPPED
 */
export function shouldSampleEvent(queueDepth: number = 0): boolean {
  if (currentSamplingConfig.strategy === 'none') {
    return true; // Keep all events
  }

  if (currentSamplingConfig.strategy === 'random') {
    const rate = currentSamplingConfig.sampleRate ?? 0.1;
    return Math.random() < rate;
  }

  if (currentSamplingConfig.strategy === 'systematic') {
    const everyN = currentSamplingConfig.sampleEveryN ?? 10;
    systematicSamplingCounter++;
    return systematicSamplingCounter % everyN === 1; // Keep every Nth event
  }

  if (currentSamplingConfig.strategy === 'adaptive') {
    const threshold = currentSamplingConfig.adaptiveThreshold ?? 1000;
    const adaptiveRate = currentSamplingConfig.adaptiveRate ?? 0.5;

    // If queue depth exceeds threshold, start sampling
    if (queueDepth > threshold) {
      return Math.random() < adaptiveRate;
    }

    // Otherwise keep all events
    return true;
  }

  return true; // Default: keep all events
}

/**
 * Filter and sample a batch of events
 */
export function filterAndSampleEvents(
  events: rpc.Api.EventResponse[],
  queueDepth: number = 0,
): rpc.Api.EventResponse[] {
  return events.filter((event) => {
    // First apply filter
    if (!passesFilter(event)) {
      return false;
    }

    // Then apply sampling
    return shouldSampleEvent(queueDepth);
  });
}

/**
 * Calculate filtering efficiency statistics
 */
export function getFilteringStats(): {
  filter: EventFilter;
  sampling: SamplingConfig;
  estimatedReductionPercent: number;
} {
  let estimatedReduction = 0;

  // Estimate reduction from filter (rough heuristic)
  const filterFactors = [
    currentFilter.eventTypes ? 0.7 : 0,
    currentFilter.contractIds ? 0.5 : 0,
    currentFilter.excludeEventTypes ? 0.2 : 0,
  ];
  estimatedReduction += Math.min(0.9, filterFactors.reduce((a, b) => a + b, 0));

  // Add sampling reduction
  if (currentSamplingConfig.strategy === 'random') {
    const rate = currentSamplingConfig.sampleRate ?? 0.1;
    estimatedReduction += (1 - rate) * 0.5; // Weighted to account for filter
  } else if (currentSamplingConfig.strategy === 'systematic') {
    const everyN = currentSamplingConfig.sampleEveryN ?? 10;
    estimatedReduction += ((everyN - 1) / everyN) * 0.5;
  }

  return {
    filter: { ...currentFilter },
    sampling: { ...currentSamplingConfig },
    estimatedReductionPercent: Math.round(Math.min(95, estimatedReduction * 100)),
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Extract event type from topics[0]
 */
function extractEventType(event: rpc.Api.EventResponse): string | null {
  if (!event.topic || event.topic.length === 0) {
    return null;
  }

  try {
    const { scValToNative } = require('@stellar/stellar-sdk');
    const eventType = scValToNative(event.topic[0]) as any;
    return String(eventType ?? '');
  } catch {
    return null;
  }
}

/**
 * Extract all topics from an event
 */
function extractTopics(event: rpc.Api.EventResponse): string[] {
  if (!event.topic) {
    return [];
  }

  try {
    const { scValToNative } = require('@stellar/stellar-sdk');
    return event.topic.map((t: any) => {
      try {
        const topic = scValToNative(t) as any;
        return String(topic ?? '');
      } catch {
        return null;
      }
    }).filter((t: any): t is string => t !== null);
  } catch {
    return [];
  }
}

/**
 * Get predefined filter preset for common use cases
 */
export function getFilterPreset(preset: 'invoices' | 'markets' | 'trades'): EventFilter {
  switch (preset) {
    case 'invoices':
      return {
        eventTypes: ['submitted', 'funded', 'paid', 'defaulted'],
      };
    case 'markets':
      return {
        eventTypes: ['market_created', 'market_resolved'],
      };
    case 'trades':
      return {
        eventTypes: ['bet_placed', 'bet_resolved', 'liquidity_added', 'liquidity_removed'],
      };
    default:
      return {};
  }
}

/**
 * Apply a filter preset
 */
export function applyFilterPreset(preset: 'invoices' | 'markets' | 'trades'): void {
  const filter = getFilterPreset(preset);
  setEventFilter(filter);
}
