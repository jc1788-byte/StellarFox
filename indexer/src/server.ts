import express, { Request, Response } from 'express';
import cors from 'cors';
import { getInvoices, getInvoiceById, checkDatabaseHealth } from './db';
import { getPollerHealth } from './poller';
import { isLive, isReady, getReadinessDetails, setDatabaseHealth } from './health';
import { getMetricsSnapshot, getPrometheusMetrics } from './metrics';
import { getCheckpointStats, getAllCheckpoints, getRecoveryInfo } from './checkpointRecovery';
import { getEventFilter, getSamplingConfig, getFilteringStats } from './eventFiltering';

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Liveness probe: Is the process alive?
 * Returns 200 if process is running, 503 otherwise.
 * Used by Kubernetes to restart dead containers.
 */
app.get('/healthz/live', (req: Request, res: Response) => {
  try {
    const live = isLive();
    const statusCode = live ? 200 : 503;
    
    res.status(statusCode).json({
      status: live ? 'alive' : 'dead',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ 
      status: 'error',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Readiness probe: Is the service ready to handle traffic?
 * Returns 200 if all dependencies healthy, 503 if not.
 * Checks:
 *  - Database connectivity
 *  - RPC connectivity
 *  - Cursor has advanced (recent activity)
 * Used by Kubernetes to add/remove from load balancer.
 */
app.get('/healthz/ready', async (req: Request, res: Response) => {
  try {
    // Check database health
    const dbHealth = await checkDatabaseHealth();
    setDatabaseHealth(dbHealth.healthy, dbHealth.error);

    const ready = isReady();
    const details = getReadinessDetails();
    const statusCode = ready ? 200 : 503;
    
    res.status(statusCode).json({
      status: ready ? 'ready' : 'not_ready',
      ready,
      lastLedger: details.lastLedger,
      cursorAge: details.cursorAge,
      maxCursorAge: details.maxCursorAge,
      dependencies: details.dependencies,
      reasons: details.reasons,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({ 
      status: 'error',
      ready: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Legacy unified health endpoint (for backwards compatibility)
 * Returns detailed poller health information.
 */
app.get('/health', (req: Request, res: Response) => {
  try {
    const health = getPollerHealth();
    const ready = isReady();
    
    // Return 200 if poller is running and ready, 503 if not
    const statusCode = (health.isRunning && ready) ? 200 : 503;
    
    res.status(statusCode).json({
      success: statusCode === 200,
      status: (health.isRunning && ready) ? 'healthy' : 'unhealthy',
      ready,
      poller: {
        isRunning: health.isRunning,
        consecutiveFailures: health.consecutiveFailures,
        lastError: health.lastError,
        lastErrorAt: health.lastErrorAt,
        lastSuccessfulPollAt: health.lastSuccessfulPollAt,
        eventsProcessed: health.eventsProcessed,
        reorgsDetected: health.reorgsDetected,
        lastReorgAt: health.lastReorgAt,
        ledgerGapsDetected: health.ledgerGapsDetected,
        lastLedgerGapAt: health.lastLedgerGapAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ 
      success: false, 
      status: 'error',
      error: err.message 
    });
  }
});

/**
 * Metrics endpoint: Returns detailed event processing metrics
 * Useful for monitoring and alerting
 */
app.get('/metrics/events', (req: Request, res: Response) => {
  try {
    const metrics = getMetricsSnapshot();
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Prometheus metrics endpoint: Returns metrics in Prometheus format
 * Compatible with Prometheus scraper and Grafana
 */
app.get('/metrics', (req: Request, res: Response) => {
  try {
    const metrics = getPrometheusMetrics();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(metrics);
  } catch (err: any) {
    res.status(500).send(`# Error: ${err.message}`);
  }
});

/**
 * Checkpoint recovery endpoint: Returns checkpoint statistics
 */
app.get('/checkpoints/status', (req: Request, res: Response) => {
  try {
    const stats = getCheckpointStats();
    const recovery = getRecoveryInfo();
    res.json({
      success: true,
      data: {
        stats,
        recovery,
        allCheckpoints: getAllCheckpoints(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Event filtering status endpoint: Returns current filter and sampling config
 */
app.get('/filtering/status', (req: Request, res: Response) => {
  try {
    const filteringStats = getFilteringStats();
    res.json({
      success: true,
      data: {
        filter: getEventFilter(),
        sampling: getSamplingConfig(),
        stats: filteringStats,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.get('/invoices', (req: Request, res: Response) => {
  try {
    const { status, freelancer, payer, funder } = req.query;
    
    // Requirements say "?funder=" but the DB has "payer"
    // We'll treat funder and payer as interchangeable for this query
    const filterPayer = (payer as string) || (funder as string);

    const invoices = getInvoices({
      status: status as string,
      freelancer: freelancer as string,
      payer: filterPayer
    });

    res.json({ success: true, data: invoices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/invoice/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const invoice = getInvoiceById(id as string);
    
    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    res.json({ success: true, data: invoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default app;
