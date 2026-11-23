/**
 * Dead Letter Queue (DLQ) Management Routes
 * 
 * Endpoints for:
 * - Viewing failed events
 * - Retrying events
 * - Resolving failures
 * - Export and diagnostics
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  getDLQStats,
  getDLQEntries,
  getDLQEntry,
  resolveDLQEntry,
  failDLQEntry,
  replayDLQEntry,
  cleanupResolvedEntries,
  exportDLQToCSV,
} from '../services/dlq.service';
import { processEvent } from '../indexer/StellarIndexer';

const router = Router();

/**
 * GET /dlq/stats
 * Get DLQ statistics and metrics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getDLQStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to get DLQ stats');
    res.status(500).json({ error: 'Failed to get DLQ stats' });
  }
});

/**
 * GET /dlq/entries
 * List DLQ entries with filtering and pagination
 * 
 * Query params:
 * - status: 'pending', 'failed', or 'resolved'
 * - eventType: filter by event type
 * - limit: page size (default 50)
 * - offset: page offset (default 0)
 */
router.get('/entries', async (req: Request, res: Response) => {
  try {
    const { status, eventType, limit = 50, offset = 0 } = req.query;

    const entries = await getDLQEntries({
      status: status as any,
      eventType: eventType as string,
      limit: Math.min(Number(limit) || 50, 1000),
      offset: Number(offset) || 0,
    });

    res.json(entries);
  } catch (err) {
    logger.error({ err }, 'Failed to list DLQ entries');
    res.status(500).json({ error: 'Failed to list DLQ entries' });
  }
});

/**
 * GET /dlq/entries/:id
 * Get a specific DLQ entry
 */
router.get('/entries/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const entry = await getDLQEntry(Number(id));

    if (!entry) {
      return res.status(404).json({ error: 'DLQ entry not found' });
    }

    res.json(entry);
  } catch (err) {
    logger.error({ err }, 'Failed to get DLQ entry');
    res.status(500).json({ error: 'Failed to get DLQ entry' });
  }
});

/**
 * POST /dlq/entries/:id/retry
 * Replay a DLQ event for reprocessing
 */
router.post('/entries/:id/retry', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dlqId = Number(id);

    const event = await replayDLQEntry(dlqId);
    if (!event) {
      return res.status(404).json({ error: 'DLQ entry not found' });
    }

    // Re-process the event
    await processEvent(event);

    // Mark as resolved
    await resolveDLQEntry(dlqId, 'admin', 'Manually replayed and processed');

    res.json({ success: true, message: 'Event replayed and reprocessed' });
  } catch (err) {
    logger.error({ dlqId: Number(id), err }, 'Failed to retry DLQ entry');
    res.status(500).json({ error: 'Failed to retry DLQ entry' });
  }
});

/**
 * POST /dlq/entries/:id/resolve
 * Mark a DLQ entry as resolved
 * 
 * Body:
 * - notes: optional resolution notes
 */
router.post('/entries/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const dlqId = Number(id);

    await resolveDLQEntry(dlqId, 'admin', notes);

    res.json({ success: true, message: 'DLQ entry marked as resolved' });
  } catch (err) {
    logger.error({ dlqId: Number(id), err }, 'Failed to resolve DLQ entry');
    res.status(500).json({ error: 'Failed to resolve DLQ entry' });
  }
});

/**
 * POST /dlq/entries/:id/fail
 * Permanently mark a DLQ entry as failed
 * 
 * Body:
 * - reason: reason for marking as failed
 */
router.post('/entries/:id/fail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const dlqId = Number(id);

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    await failDLQEntry(dlqId, reason);

    res.json({ success: true, message: 'DLQ entry marked as failed' });
  } catch (err) {
    logger.error({ dlqId: Number(id), err }, 'Failed to mark DLQ entry as failed');
    res.status(500).json({ error: 'Failed to mark DLQ entry as failed' });
  }
});

/**
 * POST /dlq/retry-all
 * Retry all pending DLQ entries
 * 
 * Query params:
 * - limit: max entries to retry (default 100)
 */
router.post('/retry-all', async (req: Request, res: Response) => {
  try {
    const { limit = 100 } = req.query;
    const entries = await getDLQEntries({
      status: 'pending',
      limit: Math.min(Number(limit) || 100, 1000),
    });

    let successCount = 0;
    let failureCount = 0;

    for (const entry of entries.entries) {
      try {
        const event = await replayDLQEntry(entry.id);
        if (event) {
          await processEvent(event);
          await resolveDLQEntry(entry.id, 'auto', 'Auto-retry succeeded');
          successCount++;
        }
      } catch (err) {
        logger.warn({ dlqId: entry.id, err }, 'Auto-retry failed');
        failureCount++;
      }
    }

    res.json({
      success: true,
      retried: entries.entries.length,
      successCount,
      failureCount,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to retry all DLQ entries');
    res.status(500).json({ error: 'Failed to retry all DLQ entries' });
  }
});

/**
 * GET /dlq/export
 * Export DLQ entries as CSV
 * 
 * Query params:
 * - status: filter by status
 * - eventType: filter by event type
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const { status, eventType } = req.query;

    const csv = await exportDLQToCSV({
      status: status as any,
      eventType: eventType as string,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="dlq-export-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err }, 'Failed to export DLQ');
    res.status(500).json({ error: 'Failed to export DLQ' });
  }
});

/**
 * POST /dlq/cleanup
 * Clean up old resolved entries
 * 
 * Body:
 * - daysToKeep: keep entries newer than this (default 30)
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const { daysToKeep = 30 } = req.body;

    const deletedCount = await cleanupResolvedEntries(daysToKeep);

    res.json({
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} old DLQ entries`,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to cleanup DLQ');
    res.status(500).json({ error: 'Failed to cleanup DLQ' });
  }
});

export default router;
