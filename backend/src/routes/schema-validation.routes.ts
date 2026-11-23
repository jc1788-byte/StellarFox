/**
 * Event Schema Validation Routes
 * 
 * Endpoints for:
 * - Viewing validation statistics
 * - Reviewing invalid events
 * - Managing schema versions
 * - Schema validation diagnostics
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  getValidationStats,
  getInvalidEvents,
  getSchemaVersions,
  createSchemaVersion,
  activateSchemaVersion,
  exportValidationResults,
} from '../services/schemaValidator.service';

const router = Router();

/**
 * GET /schema-validation/stats
 * Get event validation statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getValidationStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to get validation stats');
    res.status(500).json({ error: 'Failed to get validation stats' });
  }
});

/**
 * GET /schema-validation/invalid-events
 * List invalid events
 * 
 * Query params:
 * - limit: page size (default 50)
 * - offset: page offset (default 0)
 */
router.get('/invalid-events', async (req: Request, res: Response) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const result = await getInvalidEvents(
      Math.min(Number(limit) || 50, 1000),
      Number(offset) || 0
    );

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to get invalid events');
    res.status(500).json({ error: 'Failed to get invalid events' });
  }
});

/**
 * GET /schema-validation/schemas/:eventType
 * Get all schema versions for an event type
 */
router.get('/schemas/:eventType', async (req: Request, res: Response) => {
  try {
    const { eventType } = req.params;

    const versions = await getSchemaVersions(eventType);

    res.json({
      eventType,
      versions,
    });
  } catch (err) {
    logger.error({ eventType: req.params.eventType, err }, 'Failed to get schema versions');
    res.status(500).json({ error: 'Failed to get schema versions' });
  }
});

/**
 * POST /schema-validation/schemas/:eventType/versions
 * Create a new schema version
 * 
 * Body:
 * - version: version number (required)
 * - schema: JSON schema definition (required)
 * - description: optional description
 */
router.post('/schemas/:eventType/versions', async (req: Request, res: Response) => {
  try {
    const { eventType } = req.params;
    const { version, schema, description } = req.body;

    if (!version || !schema) {
      return res.status(400).json({
        error: 'version and schema are required',
      });
    }

    await createSchemaVersion(eventType, version, schema, description);

    res.json({
      success: true,
      message: 'Schema version created',
      eventType,
      version,
    });
  } catch (err) {
    logger.error({ eventType: req.params.eventType, err }, 'Failed to create schema version');
    res.status(500).json({ error: 'Failed to create schema version' });
  }
});

/**
 * POST /schema-validation/schemas/:eventType/versions/:version/activate
 * Activate a specific schema version
 */
router.post('/schemas/:eventType/versions/:version/activate', async (req: Request, res: Response) => {
  try {
    const { eventType, version } = req.params;

    await activateSchemaVersion(eventType, Number(version));

    res.json({
      success: true,
      message: 'Schema version activated',
      eventType,
      version: Number(version),
    });
  } catch (err) {
    logger.error(
      { eventType: req.params.eventType, version: req.params.version, err },
      'Failed to activate schema version'
    );
    res.status(500).json({ error: 'Failed to activate schema version' });
  }
});

/**
 * GET /schema-validation/export
 * Export validation results as CSV
 * 
 * Query params:
 * - limit: max results to export (default 10000)
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const { limit = 10000 } = req.query;

    const csv = await exportValidationResults(Math.min(Number(limit) || 10000, 100000));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="validation-export-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err }, 'Failed to export validation results');
    res.status(500).json({ error: 'Failed to export validation results' });
  }
});

export default router;
