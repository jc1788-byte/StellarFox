import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { getCursor, saveCursor, getLastKnownLedger, upsertInvoice } from './db';
import { updateLastLedger, setDatabaseHealth, setRpcHealth } from './health';
import { detectLedgerAnomaly, computeResyncStartLedger } from './ledgerContinuity';
import { calculateBackoff, loadBackoffConfigFromEnv } from './backoff';
import { broadcast } from './ws';
import { 
  recordEventSuccess, 
  recordEventFailure, 
  recordBatchSuccess, 
  recordBatchFailure,
  incrementQueueDepth,
  decrementQueueDepth,
  setQueueDepth,
} from './metrics';
import {
  initializeCheckpoints,
  createCheckpoint,
  shouldCreateCheckpoint,
  getRecoveryInfo,
} from './checkpointRecovery';
import {
  filterAndSampleEvents,
} from './eventFiltering';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.FACTORY_CONTRACT_ADDRESS;

if (!CONTRACT_ID) {
  throw new Error('FACTORY_CONTRACT_ADDRESS environment variable is not set. Cannot initialize indexer.');
}

const server = new rpc.Server(RPC_URL);

// ── Enhanced polling configuration ──────────────────────────────────────
const ADAPTIVE_POLLING_CONFIG = {
  minIntervalMs: parseInt(process.env.POLLING_MIN_INTERVAL_MS || '1000', 10),
  maxIntervalMs: parseInt(process.env.POLLING_MAX_INTERVAL_MS || '60000', 10),
  initialIntervalMs: parseInt(process.env.POLLING_INITIAL_INTERVAL_MS || '5000', 10),
  // Increase interval when errors occur
  errorMultiplier: parseFloat(process.env.POLLING_ERROR_MULTIPLIER || '1.5'),
  // Decrease interval when events are found (high activity)
  successDivisor: parseFloat(process.env.POLLING_SUCCESS_DIVISOR || '1.2'),
  jitterPercent: parseInt(process.env.POLLING_JITTER_PERCENT || '20', 10),
};

// ── Polling state for health monitoring ────────────────────────────────────
interface PollerHealth {
  isRunning: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessfulPollAt: string | null;
  eventsProcessed: number;
  reorgsDetected: number;
  lastReorgAt: string | null;
  ledgerGapsDetected: number;
  lastLedgerGapAt: string | null;
  currentPollingIntervalMs: number;
  averageEventsPerPoll: number;
  lastPollingAdaptationAt: string | null;
  errorRecoveryAttemptsCount: number;
}

let pollerHealth: PollerHealth = {
  isRunning: false,
  consecutiveFailures: 0,
  lastError: null,
  lastErrorAt: null,
  lastSuccessfulPollAt: null,
  eventsProcessed: 0,
  reorgsDetected: 0,
  lastReorgAt: null,
  ledgerGapsDetected: 0,
  lastLedgerGapAt: null,
  currentPollingIntervalMs: ADAPTIVE_POLLING_CONFIG.initialIntervalMs,
  averageEventsPerPoll: 0,
  lastPollingAdaptationAt: null,
  errorRecoveryAttemptsCount: 0,
};

export function getPollerHealth(): PollerHealth {
  return { ...pollerHealth };
}

// ── Exponential backoff strategy (tunable via POLLER_*_BACKOFF_MS env vars) ─
const BACKOFF_CONFIG = loadBackoffConfigFromEnv();

// ── Structured logging ──────────────────────────────────────────────────────
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

function log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };
  console.log(JSON.stringify(entry));
}

export async function pollEvents() {
  log('info', 'Initializing indexer poller', { contractId: CONTRACT_ID, rpcUrl: RPC_URL });
  
  // Initialize checkpoints for recovery
  try {
    await initializeCheckpoints();
    const recoveryInfo = getRecoveryInfo();
    if (recoveryInfo.hasCheckpoint) {
      log('info', 'Checkpoint recovery enabled', { recoveryInfo });
    }
  } catch (err) {
    log('warn', 'Failed to initialize checkpoints', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log('info', 'Indexer poller started', { contractId: CONTRACT_ID, rpcUrl: RPC_URL });
  pollerHealth.isRunning = true;

  let cursor = (await getCursor()) || '';
  // Last ledger sequence we successfully processed, used to detect re-orgs
  // (ledger sequence moving backward) and gaps (skipped sequences) across polls.
  let lastProcessedLedger: number | null = await getLastKnownLedger();
  // Set when a re-org is detected; forces the next request to resync from a
  // safe ledger instead of trusting the (possibly now-invalid) cursor.
  let pendingResyncLedger: number | null = null;

  // ── Graceful shutdown handlers ──────────────────────────────────────────
  // Save cursor before exit to avoid re-processing events on restart
  const handleShutdown = async (signal: string) => {
    log('info', `${signal} received, saving cursor and exiting gracefully`, { cursor });
    pollerHealth.isRunning = false;
    try {
      await saveCursor(cursor);
      log('info', 'Cursor saved successfully', { cursor });
    } catch (err) {
      log('error', 'Failed to save cursor during graceful shutdown', {
        error: err instanceof Error ? err.message : String(err),
        cursor,
      });
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  // Recursive async loop with exponential backoff
  async function pollLoop(): Promise<void> {
    try {
      const pollStartTime = Date.now();
      // A pending resync (set after a re-org) always takes priority over the
      // persisted cursor, since the cursor may point past ledgers that no
      // longer exist on the canonical chain.
      const resyncLedger = pendingResyncLedger;
      pendingResyncLedger = null;
      if (resyncLedger !== null) {
        cursor = '';
      }

      // Build request with proper typing (use any to bypass strict filter type checking)
      const request: any = (cursor && resyncLedger === null)
        ? {
            cursor,
            filters: [
              {
                type: 'contract',
                contractIds: [CONTRACT_ID],
                topics: [['*']]
              }
            ],
            limit: 100
          }
        : {
            startLedger: resyncLedger ?? (await getLatestLedger()),
            filters: [
              {
                type: 'contract',
                contractIds: [CONTRACT_ID],
                topics: [['*']]
              }
            ],
            limit: 100
          };

      // Poll for events with pagination support
      let paginationCursor = cursor || '';
      let totalEventsProcessed = 0;
      let hasMore = true;
      let reorgTriggered = false;

      while (hasMore) {
        // Build paginated request
        const filters = request.filters || [
          {
            type: 'contract',
            contractIds: [CONTRACT_ID],
            topics: [['*']]
          }
        ];

        // Build request with proper typing
        let paginatedRequest: any = {
          filters,
          limit: 100,
        };

        // Set cursor or startLedger
        if (paginationCursor) {
          paginatedRequest.cursor = paginationCursor;
        } else if (request.startLedger) {
          paginatedRequest.startLedger = request.startLedger;
        }

        const response = await server.getEvents(paginatedRequest);

        // Process all events on this page
        if (response.events && response.events.length > 0) {
          // Update queue depth
          setQueueDepth(response.events.length);

          // Apply filtering and sampling
          const filteredAndSampledEvents = filterAndSampleEvents(response.events, response.events.length);
          
          // Calculate how many events were filtered/sampled out
          const filteredOutCount = response.events.length - filteredAndSampledEvents.length;

          for (const event of filteredAndSampledEvents) {
            const eventStartTime = Date.now();
            try {
              const eventLedger = event.ledger;

              if (eventLedger) {
                const anomaly = detectLedgerAnomaly(eventLedger, lastProcessedLedger);

                if (anomaly.type === 'reorg') {
                  pollerHealth.reorgsDetected++;
                  pollerHealth.lastReorgAt = new Date().toISOString();
                  log('warn', 'Ledger re-org detected; discarding cursor and re-syncing from a safe ledger', {
                    lastProcessedLedger: anomaly.fromLedger,
                    incomingEventLedger: anomaly.toLedger,
                  });
                  broadcast({
                    type: 'poller.reorg_detected',
                    timestamp: new Date().toISOString(),
                    data: { lastProcessedLedger: anomaly.fromLedger, incomingEventLedger: anomaly.toLedger },
                  });
                  // Don't trust or process events from a superseded ledger view.
                  // Rewind and let the next poll iteration re-fetch canonical events.
                  pendingResyncLedger = computeResyncStartLedger(anomaly.fromLedger);
                  reorgTriggered = true;
                  recordEventFailure(Date.now() - eventStartTime);
                  break;
                }

                if (anomaly.type === 'gap') {
                  pollerHealth.ledgerGapsDetected++;
                  pollerHealth.lastLedgerGapAt = new Date().toISOString();
                  log('warn', 'Missing ledger sequence(s) detected between polls', {
                    fromLedger: anomaly.fromLedger,
                    toLedger: anomaly.toLedger,
                    missingCount: anomaly.missingCount,
                  });
                }
              }

              processEvent(event);
              recordEventSuccess(Date.now() - eventStartTime);

              if (eventLedger) {
                lastProcessedLedger = eventLedger;
                updateLastLedger(eventLedger);
              }
            } catch (err) {
              recordEventFailure(Date.now() - eventStartTime);
              log('error', 'Failed to process event', {
                eventId: event.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (!reorgTriggered) {
            totalEventsProcessed += filteredAndSampledEvents.length;
          }

          // Record filtering metrics
          if (filteredOutCount > 0) {
            log('warn', 'Events filtered/sampled out', {
              filteredOutCount,
              keptCount: filteredAndSampledEvents.length,
              totalCount: response.events.length,
            });
          }
        }

        if (reorgTriggered) {
          // Skip cursor persistence entirely this round; pendingResyncLedger
          // drives the next iteration's request instead.
          hasMore = false;
          break;
        }

        // Check if there are more pages using paging_token (the cursor field)
        // Stellar RPC uses paging_token for pagination; if it exists and events were returned,
        // there may be more data
        const pagingToken = (response as any).paging_token;
        if (pagingToken && response.events && response.events.length > 0) {
          paginationCursor = pagingToken;
          hasMore = true;
        } else {
          hasMore = false;
          // Only advance main cursor when all pages are consumed
          const oldCursor = cursor;
          cursor = response.cursor || pagingToken || '';
          await saveCursor(cursor, lastProcessedLedger ?? undefined);
          
          // Create checkpoint if threshold reached
          if (shouldCreateCheckpoint(totalEventsProcessed)) {
            try {
              await createCheckpoint(
                lastProcessedLedger ?? 0,
                cursor,
                0, // batchId not used in current flow
                totalEventsProcessed,
              );
              log('info', 'Checkpoint created', {
                ledger: lastProcessedLedger,
                cursor: cursor.substring(0, 20) + '...',
                eventsInBatch: totalEventsProcessed,
              });
            } catch (err) {
              log('warn', 'Failed to create checkpoint', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          pollerHealth.eventsProcessed += totalEventsProcessed;
          decrementQueueDepth(totalEventsProcessed);

          if (totalEventsProcessed > 0) {
            recordBatchSuccess(Date.now() - pollStartTime);
            log('info', 'Events polled and processed (with pagination)', {
              eventCount: totalEventsProcessed,
              oldCursor,
              newCursor: cursor,
              consecutiveFailures: pollerHealth.consecutiveFailures,
            });
          } else {
            log('info', 'Poll successful but no new events', {
              cursor,
              consecutiveFailures: pollerHealth.consecutiveFailures,
            });
          }
        }
      }

      // Reset failure counter on success
      pollerHealth.consecutiveFailures = 0;
      pollerHealth.lastError = null;
      pollerHealth.lastErrorAt = null;
      pollerHealth.lastSuccessfulPollAt = new Date().toISOString();

      // Mark dependencies as healthy
      setRpcHealth(true);
      
      // Schedule next poll immediately (no fixed interval, just loop)
      await new Promise(resolve => setImmediate(resolve));
      await pollLoop();

    } catch (err) {
      pollerHealth.consecutiveFailures++;
      pollerHealth.lastError = err instanceof Error ? err.message : String(err);
      pollerHealth.lastErrorAt = new Date().toISOString();

      // Mark RPC as unhealthy on error
      setRpcHealth(false, pollerHealth.lastError);
      recordBatchFailure();

      const backoffMs = calculateBackoff(pollerHealth.consecutiveFailures, BACKOFF_CONFIG);

      log('error', 'Poll failed, scheduling retry', {
        error: pollerHealth.lastError,
        consecutiveFailures: pollerHealth.consecutiveFailures,
        backoffMs,
        cursor,
      });

      broadcast({
        type: 'poller.retry_scheduled',
        timestamp: new Date().toISOString(),
        data: { consecutiveFailures: pollerHealth.consecutiveFailures, backoffMs },
      });

      // Wait with exponential backoff before retrying
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      await pollLoop();
    }
  }

  // Start the polling loop
  pollLoop().catch(err => {
    log('error', 'Polling loop terminated with unrecoverable error', {
      error: err instanceof Error ? err.message : String(err),
    });
    pollerHealth.isRunning = false;
    process.exit(1);
  });
}

async function getLatestLedger(): Promise<number> {
  try {
    const health = await server.getLatestLedger();
    return health.sequence;
  } catch (err) {
    log('error', 'Failed to get latest ledger', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Return a conservative starting point
    return 1;
  }
}

export function processEvent(event: rpc.Api.EventResponse) {
  // Topics are scVals, typically symbol strings
  const topics = event.topic.map((t: any) => {
    try {
      return scValToNative(t);
    } catch {
      return null;
    }
  });

  const eventType = topics[0]; // e.g. 'submitted', 'funded', 'paid', 'defaulted'
  if (!eventType) return;

  try {
    const data = scValToNative(event.value);
    
    // Assume data contains { id, freelancer, payer, amount, dueDate } for 'submitted'
    // and just { id } for status changes. This is dependent on contract implementation.
    
    if (eventType === 'submitted') {
      const invoiceId = data.id;
      upsertInvoice({
        id: invoiceId,
        freelancer: data.freelancer || '',
        payer: data.payer || '',
        amount: data.amount || 0,
        due_date: data.dueDate || new Date().toISOString(),
        status: 'Pending'
      });
      log('info', 'Processed event: submitted', { invoiceId });
      broadcast({ type: 'invoice.submitted', timestamp: new Date().toISOString(), data: { invoiceId } });
    } else if (eventType === 'funded') {
      const invoiceId = data.id || data;
      upsertInvoice({
        id: invoiceId,
        freelancer: '', payer: '', amount: 0, due_date: '',
        status: 'Funded'
      });
      log('info', 'Processed event: funded', { invoiceId });
      broadcast({ type: 'invoice.funded', timestamp: new Date().toISOString(), data: { invoiceId } });
    } else if (eventType === 'paid') {
      const invoiceId = data.id || data;
      upsertInvoice({
        id: invoiceId,
        freelancer: '', payer: '', amount: 0, due_date: '',
        status: 'Paid'
      });
      log('info', 'Processed event: paid', { invoiceId });
      broadcast({ type: 'invoice.paid', timestamp: new Date().toISOString(), data: { invoiceId } });
    } else if (eventType === 'defaulted') {
      const invoiceId = data.id || data;
      upsertInvoice({
        id: invoiceId,
        freelancer: '', payer: '', amount: 0, due_date: '',
        status: 'Defaulted'
      });
      log('info', 'Processed event: defaulted', { invoiceId });
      broadcast({ type: 'invoice.defaulted', timestamp: new Date().toISOString(), data: { invoiceId } });
    }
  } catch (err) {
    log('error', 'Failed to process event', {
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
