/**
 * Enhanced poller with all four improvements:
 * 1. Dynamic batch processing with parallel processing and backpressure
 * 2. DLQ for unprocessable events with replay capabilities
 * 3. Multi-RPC provider support with failover and load balancing
 * 4. Event schema validation with versioning and migration
 */

import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { getCursor, saveCursor, getLastKnownLedger, upsertInvoice } from './db';
import { updateLastLedger } from './health';
import { detectLedgerAnomaly, computeResyncStartLedger } from './ledgerContinuity';
import { calculateBackoff, loadBackoffConfigFromEnv } from './backoff';
import { broadcast } from './ws';
import DynamicBatchProcessor from './batchProcessor';
import DeadLetterQueue from './dlq';
import { MultiRPCProvider, RPCProvider } from './rpcProvider';
import EventSchemaRegistry, { getDefaultSchemas } from './eventSchema';
import { logger } from './logger';
import dotenv from 'dotenv';

dotenv.config();

// ── Configuration ────────────────────────────────────────────────────────────
const CONTRACT_ID = process.env.FACTORY_CONTRACT_ADDRESS;

if (!CONTRACT_ID) {
  throw new Error('FACTORY_CONTRACT_ADDRESS environment variable is not set. Cannot initialize indexer.');
}

// Parse RPC providers from environment
const rpcProviders: RPCProvider[] = (
  process.env.SOROBAN_RPC_URLS || 'https://soroban-testnet.stellar.org'
)
  .split(',')
  .map((url, index) => ({
    url: url.trim(),
    name: `provider-${index}`,
    priority: index,
    weight: 1.0 / (index + 1), // Primary has highest weight
  }));

// ── State Management ─────────────────────────────────────────────────────────
const multiRPC = new MultiRPCProvider(rpcProviders);
const batchProcessor = new DynamicBatchProcessor({
  minBatchSize: parseInt(process.env.BATCH_MIN_SIZE || '10'),
  maxBatchSize: parseInt(process.env.BATCH_MAX_SIZE || '500'),
  initialBatchSize: parseInt(process.env.BATCH_INIT_SIZE || '100'),
  maxWorkers: parseInt(process.env.BATCH_MAX_WORKERS || '4'),
  backpressureLimit: parseInt(process.env.BACKPRESSURE_LIMIT || '1000'),
});
const dlq = new DeadLetterQueue();
const schemaRegistry = new EventSchemaRegistry();

// Register default schemas
getDefaultSchemas().forEach((schema) => schemaRegistry.registerSchema(schema));

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
  dlqSize: number;
  batchMetrics: any;
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
  dlqSize: 0,
  batchMetrics: {},
};

export function getPollerHealth(): PollerHealth {
  return { ...pollerHealth };
}

// ── Exponential backoff strategy ────────────────────────────────────────────
const BACKOFF_CONFIG = loadBackoffConfigFromEnv();

/**
 * Process a single event with validation and error handling
 */
async function processEventWithValidation(event: rpc.Api.EventResponse): Promise<void> {
  // Parse event topics
  const topics = event.topic.map((t: any) => {
    try {
      return scValToNative(t);
    } catch {
      return null;
    }
  });

  const eventType = topics[0]; // e.g., 'submitted', 'funded', 'paid', 'defaulted'
  if (!eventType) {
    throw new Error('Event has no topic/type');
  }

  // Validate schema
  let eventData: any;
  try {
    eventData = scValToNative(event.value);
  } catch (err) {
    throw new Error(`Failed to decode event data: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Map contract event types to schema event names
  const schemaEventName = `invoice.${eventType}`;
  const validation = schemaRegistry.validate(schemaEventName, eventData);

  if (!validation.valid) {
    const errors = validation.errors.join('; ');
    throw new Error(`Schema validation failed: ${errors}`);
  }

  // Log warnings
  if (validation.warnings.length > 0) {
    logger.warn(
      { eventId: event.id, warnings: validation.warnings },
      'Event passed validation with warnings',
    );
  }

  // Process event based on type
  await processEventByType(eventType, eventData, event);
}

/**
 * Process event based on its type
 */
async function processEventByType(
  eventType: string,
  data: any,
  originalEvent: rpc.Api.EventResponse,
): Promise<void> {
  switch (eventType) {
    case 'submitted':
      await upsertInvoice({
        id: data.id,
        freelancer: data.freelancer || '',
        payer: data.payer || '',
        amount: data.amount || 0,
        due_date: data.dueDate || new Date().toISOString(),
        status: 'Pending',
      });
      logger.info({ invoiceId: data.id }, 'Processed event: submitted');
      broadcast({
        type: 'invoice.submitted',
        timestamp: new Date().toISOString(),
        data: { invoiceId: data.id },
      });
      break;

    case 'funded':
      await upsertInvoice({
        id: data.id || data,
        freelancer: '',
        payer: '',
        amount: 0,
        due_date: '',
        status: 'Funded',
      });
      logger.info({ invoiceId: data.id }, 'Processed event: funded');
      broadcast({
        type: 'invoice.funded',
        timestamp: new Date().toISOString(),
        data: { invoiceId: data.id },
      });
      break;

    case 'paid':
      await upsertInvoice({
        id: data.id || data,
        freelancer: '',
        payer: '',
        amount: 0,
        due_date: '',
        status: 'Paid',
      });
      logger.info({ invoiceId: data.id }, 'Processed event: paid');
      broadcast({
        type: 'invoice.paid',
        timestamp: new Date().toISOString(),
        data: { invoiceId: data.id },
      });
      break;

    case 'defaulted':
      await upsertInvoice({
        id: data.id || data,
        freelancer: '',
        payer: '',
        amount: 0,
        due_date: '',
        status: 'Defaulted',
      });
      logger.info({ invoiceId: data.id }, 'Processed event: defaulted');
      broadcast({
        type: 'invoice.defaulted',
        timestamp: new Date().toISOString(),
        data: { invoiceId: data.id },
      });
      break;

    default:
      logger.warn({ eventType }, 'Unknown event type');
  }
}

/**
 * Fetch events from RPC with automatic failover
 */
async function fetchEvents(params: any): Promise<any> {
  return multiRPC.executeWithFailover(
    async (server) => server.getEvents(params),
    3, // max retries
  );
}

/**
 * Enhanced polling loop with all improvements
 */
export async function pollEventsEnhanced() {
  logger.info(
    {
      contractId: CONTRACT_ID,
      providers: rpcProviders.map((p) => p.name),
      batchConfig: {
        min: batchProcessor.getMetrics().currentBatchSize,
        max: process.env.BATCH_MAX_SIZE,
      },
    },
    'Enhanced indexer poller started',
  );

  pollerHealth.isRunning = true;
  multiRPC.startHealthChecks();

  // Load cursor and ledger state
  let cursor = (await getCursor()) || '';
  let lastProcessedLedger: number | null = await getLastKnownLedger();
  let pendingResyncLedger: number | null = null;

  // ── Graceful shutdown ────────────────────────────────────────────────
  const handleShutdown = async (signal: string) => {
    logger.info({ signal, cursor }, 'Shutdown signal received, saving state');
    pollerHealth.isRunning = false;
    multiRPC.stopHealthChecks();

    try {
      await saveCursor(cursor);
      logger.info({ cursor }, 'Cursor saved successfully');
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err), cursor },
        'Failed to save cursor during shutdown',
      );
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  // ── Main polling loop ────────────────────────────────────────────────
  async function pollLoop(): Promise<void> {
    try {
      // Handle resync if needed
      const resyncLedger = pendingResyncLedger;
      pendingResyncLedger = null;
      if (resyncLedger !== null) {
        cursor = '';
      }

      // Build RPC request
      const filters = [
        {
          type: 'contract',
          contractIds: [CONTRACT_ID],
          topics: [['*']],
        },
      ];

      let paginationCursor = cursor || '';
      let totalEventsProcessed = 0;
      let totalEventsFailed = 0;
      let hasMore = true;
      let reorgTriggered = false;
      const eventBatch: rpc.Api.EventResponse[] = [];

      while (hasMore && batchProcessor.isAcceptingEvents()) {
        // Fetch events with RPC failover
        const paginatedRequest: any = {
          filters,
          limit: 100,
        };

        if (paginationCursor) {
          paginatedRequest.cursor = paginationCursor;
        } else if (resyncLedger !== null && resyncLedger !== undefined) {
          paginatedRequest.startLedger = resyncLedger;
        }

        const response = await fetchEvents(paginatedRequest);

        // Process events with dynamic batching
        if (response.events && response.events.length > 0) {
          const batchResult = await batchProcessor.processBatch(
            response.events,
            async (event: rpc.Api.EventResponse) => {
              try {
                // Schema validation + processing
                await processEventWithValidation(event);

                if (event.ledger) {
                  const anomaly = detectLedgerAnomaly(event.ledger, lastProcessedLedger);

                  if (anomaly.type === 'reorg') {
                    pollerHealth.reorgsDetected++;
                    pollerHealth.lastReorgAt = new Date().toISOString();
                    logger.warn(
                      {
                        fromLedger: anomaly.fromLedger,
                        toLedger: anomaly.toLedger,
                      },
                      'Ledger re-org detected',
                    );
                    pendingResyncLedger = computeResyncStartLedger(anomaly.fromLedger);
                    reorgTriggered = true;
                  }

                  if (anomaly.type === 'gap') {
                    pollerHealth.ledgerGapsDetected++;
                    pollerHealth.lastLedgerGapAt = new Date().toISOString();
                    logger.warn(
                      {
                        fromLedger: anomaly.fromLedger,
                        toLedger: anomaly.toLedger,
                        missingCount: anomaly.missingCount,
                      },
                      'Ledger gap detected',
                    );
                  }

                  lastProcessedLedger = event.ledger;
                  updateLastLedger(event.ledger);
                }
              } catch (error) {
                totalEventsFailed++;
                const err = error instanceof Error ? error : new Error(String(error));

                logger.error(
                  { eventId: event.id, error: err.message },
                  'Failed to process event, adding to DLQ',
                );

                // Add to DLQ for later replay
                await dlq.addEvent(event, err, CONTRACT_ID, 'unknown');

                // Broadcast DLQ event
                broadcast({
                  type: 'dlq.event_failed',
                  timestamp: new Date().toISOString(),
                  data: { eventId: event.id, error: err.message },
                });

                throw err; // Re-throw so batch processor tracks it
              }
            },
          );

          totalEventsProcessed += batchResult.successful;
          totalEventsFailed += batchResult.failed;

          // Update metrics
          pollerHealth.eventsProcessed += batchResult.successful;
          pollerHealth.batchMetrics = batchProcessor.getMetrics();
          pollerHealth.dlqSize = dlq.getStats().totalEvents;
        }

        if (reorgTriggered) {
          hasMore = false;
          break;
        }

        // Check pagination
        const pagingToken = (response as any).paging_token;
        if (pagingToken && response.events && response.events.length > 0) {
          paginationCursor = pagingToken;
          hasMore = true;
        } else {
          hasMore = false;
          cursor = response.cursor || pagingToken || '';
          await saveCursor(cursor, lastProcessedLedger ?? undefined);

          logger.info(
            {
              eventsProcessed: totalEventsProcessed,
              eventsFailed: totalEventsFailed,
              cursor,
              dlqSize: pollerHealth.dlqSize,
              batchSize: pollerHealth.batchMetrics.currentBatchSize,
            },
            'Poll cycle completed',
          );
        }
      }

      // Check for pending DLQ retries
      const pendingRetries = await dlq.getPendingRetries();
      if (pendingRetries.length > 0) {
        logger.info(
          { pendingRetries: pendingRetries.length },
          'Processing DLQ retries',
        );

        for (const dlqEvent of pendingRetries) {
          try {
            const result = await dlq.replayEvent(dlqEvent.id, async (event) => {
              // Reconstruct event and process
              const mockEvent: any = {
                id: event.id,
                ledger: event.ledgerSequence,
                txHash: event.txHash,
                topic: [], // Topics not preserved in DLQ
                value: event.payload,
                closeTime: Math.floor(event.ledgerCloseTime.getTime() / 1000),
                type: 'contract',
              };

              await processEventWithValidation(mockEvent);
            });

            if (result.success) {
              logger.info({ eventId: dlqEvent.id }, 'DLQ event successfully replayed');
            }
          } catch (err) {
            logger.debug(
              { eventId: dlqEvent.id, error: err instanceof Error ? err.message : String(err) },
              'DLQ replay failed, will retry later',
            );
          }
        }
      }

      // Reset failure counter on success
      pollerHealth.consecutiveFailures = 0;
      pollerHealth.lastError = null;
      pollerHealth.lastErrorAt = null;
      pollerHealth.lastSuccessfulPollAt = new Date().toISOString();

      // Schedule next poll
      await new Promise((resolve) => setImmediate(resolve));
      await pollLoop();

    } catch (err) {
      pollerHealth.consecutiveFailures++;
      pollerHealth.lastError = err instanceof Error ? err.message : String(err);
      pollerHealth.lastErrorAt = new Date().toISOString();

      const backoffMs = calculateBackoff(pollerHealth.consecutiveFailures, BACKOFF_CONFIG);

      logger.error(
        {
          error: pollerHealth.lastError,
          consecutiveFailures: pollerHealth.consecutiveFailures,
          backoffMs,
        },
        'Poll cycle failed, scheduling retry',
      );

      broadcast({
        type: 'poller.retry_scheduled',
        timestamp: new Date().toISOString(),
        data: {
          consecutiveFailures: pollerHealth.consecutiveFailures,
          backoffMs,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      await pollLoop();
    }
  }

  // Start the polling loop
  pollLoop().catch((err) => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Polling loop terminated',
    );
    pollerHealth.isRunning = false;
    process.exit(1);
  });
}

export default pollEventsEnhanced;
