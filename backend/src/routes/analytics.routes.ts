import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { analyticsService } from '../services/analytics.service';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import pino from 'pino';

const logger = pino();
const router = Router();

// Request validation schemas
const createSessionSchema = z.object({
  browser: z.string().optional(),
  os: z.string().optional(),
  ipAddress: z.string().optional(),
  deviceInfo: z.record(z.unknown()).optional(),
});

const trackEventSchema = z.object({
  sessionId: z.string().uuid(),
  eventType: z.string(),
  eventName: z.string(),
  pageUrl: z.string().optional(),
  referrerUrl: z.string().optional(),
  eventData: z.record(z.unknown()).optional(),
  durationMs: z.number().optional(),
});

const trackHeatmapSchema = z.object({
  sessionId: z.string().uuid(),
  pageUrl: z.string(),
  interactionType: z.enum(['click', 'scroll', 'hover', 'move']),
  x: z.number(),
  y: z.number(),
  elementId: z.string().optional(),
  elementClass: z.string().optional(),
  elementText: z.string().optional(),
  viewportWidth: z.number().optional(),
  viewportHeight: z.number().optional(),
});

const trackCustomEventSchema = z.object({
  eventCategory: z.string(),
  eventLabel: z.string(),
  eventValue: z.number().optional(),
  eventMetadata: z.record(z.unknown()).optional(),
  pageUrl: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

/**
 * POST /api/analytics/session/start
 * Create a new analytics session
 */
router.post(
  '/session/start',
  requireAuth,
  validateRequest('body', createSessionSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { browser, os, ipAddress, deviceInfo } = req.body;

      const result = await analyticsService.createSession({
        userId,
        browser,
        os,
        ipAddress,
        deviceInfo,
      });

      res.json(result);
    } catch (error) {
      logger.error(error, 'Error creating analytics session');
      res.status(500).json({ error: 'Failed to create session' });
    }
  },
);

/**
 * POST /api/analytics/session/end
 * End an analytics session
 */
router.post('/session/end', requireAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await analyticsService.endSession(sessionId);
    res.json(result);
  } catch (error) {
    logger.error(error, 'Error ending analytics session');
    res.status(500).json({ error: 'Failed to end session' });
  }
});

/**
 * POST /api/analytics/event
 * Track a user event
 */
router.post(
  '/event',
  requireAuth,
  validateRequest('body', trackEventSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { sessionId, eventType, eventName, pageUrl, referrerUrl, eventData, durationMs } = req.body;

      const result = await analyticsService.trackEvent({
        userId,
        sessionId,
        eventType,
        eventName,
        pageUrl,
        referrerUrl,
        eventData,
        durationMs,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error(error, 'Error tracking event');
      res.status(500).json({ error: 'Failed to track event' });
    }
  },
);

/**
 * POST /api/analytics/heatmap
 * Track heatmap interaction
 */
router.post(
  '/heatmap',
  requireAuth,
  validateRequest('body', trackHeatmapSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const {
        sessionId,
        pageUrl,
        interactionType,
        x,
        y,
        elementId,
        elementClass,
        elementText,
        viewportWidth,
        viewportHeight,
      } = req.body;

      await analyticsService.trackHeatmapInteraction({
        userId,
        sessionId,
        pageUrl,
        interactionType,
        x,
        y,
        elementId,
        elementClass,
        elementText,
        viewportWidth,
        viewportHeight,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error(error, 'Error tracking heatmap');
      res.status(500).json({ error: 'Failed to track heatmap' });
    }
  },
);

/**
 * POST /api/analytics/custom-event
 * Track custom event
 */
router.post(
  '/custom-event',
  validateRequest('body', trackCustomEventSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any)?.userId;
      const {
        eventCategory,
        eventLabel,
        eventValue,
        eventMetadata,
        pageUrl,
        sessionId,
      } = req.body;

      await analyticsService.trackCustomEvent({
        userId,
        eventCategory,
        eventLabel,
        eventValue,
        eventMetadata,
        pageUrl,
        sessionId,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error(error, 'Error tracking custom event');
      res.status(500).json({ error: 'Failed to track custom event' });
    }
  },
);

/**
 * GET /api/analytics/page/:pageUrl
 * Get page analytics
 */
router.get('/page/:pageUrl', async (req: Request, res: Response) => {
  try {
    const { pageUrl } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'startDate and endDate query parameters are required',
      });
    }

    const analytics = await analyticsService.getPageAnalytics(
      pageUrl,
      new Date(startDate as string),
      new Date(endDate as string),
    );

    res.json(analytics);
  } catch (error) {
    logger.error(error, 'Error fetching page analytics');
    res.status(500).json({ error: 'Failed to fetch page analytics' });
  }
});

/**
 * GET /api/analytics/session/:sessionId/events
 * Get events for a session
 */
router.get(
  '/session/:sessionId/events',
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const events = await analyticsService.getSessionEvents(sessionId);
      res.json(events);
    } catch (error) {
      logger.error(error, 'Error fetching session events');
      res.status(500).json({ error: 'Failed to fetch session events' });
    }
  },
);

/**
 * GET /api/analytics/heatmap/:pageUrl
 * Get heatmap data for a page
 */
router.get('/heatmap/:pageUrl', async (req: Request, res: Response) => {
  try {
    const { pageUrl } = req.params;
    const { interactionType, startDate, endDate } = req.query;

    const heatmapData = await analyticsService.getHeatmapData(
      pageUrl,
      interactionType as string,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined,
    );

    res.json(heatmapData);
  } catch (error) {
    logger.error(error, 'Error fetching heatmap data');
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

/**
 * POST /api/analytics/heatmap/aggregate
 * Generate heatmap aggregate for a page
 */
router.post('/heatmap/aggregate', async (req: Request, res: Response) => {
  try {
    const { pageUrl, date, interactionType, gridSize } = req.body;

    if (!pageUrl || !date || !interactionType) {
      return res.status(400).json({
        error: 'pageUrl, date, and interactionType are required',
      });
    }

    const result = await analyticsService.generateHeatmapAggregate(
      pageUrl,
      new Date(date),
      interactionType,
      gridSize || 50,
    );

    if (!result) {
      return res.json({ error: 'No heatmap data found' });
    }

    res.json(result);
  } catch (error) {
    logger.error(error, 'Error generating heatmap aggregate');
    res.status(500).json({ error: 'Failed to generate heatmap aggregate' });
  }
});

/**
 * GET /api/analytics/heatmap/aggregate/:pageUrl
 * Get heatmap aggregate for a page
 */
router.get(
  '/heatmap/aggregate/:pageUrl',
  async (req: Request, res: Response) => {
    try {
      const { pageUrl } = req.params;
      const { date, interactionType } = req.query;

      if (!date || !interactionType) {
        return res.status(400).json({
          error: 'date and interactionType query parameters are required',
        });
      }

      const aggregate = await analyticsService.getHeatmapAggregate(
        pageUrl,
        new Date(date as string),
        interactionType as string,
      );

      if (!aggregate) {
        return res.json({ error: 'No heatmap aggregate found' });
      }

      res.json(aggregate);
    } catch (error) {
      logger.error(error, 'Error fetching heatmap aggregate');
      res.status(500).json({ error: 'Failed to fetch heatmap aggregate' });
    }
  },
);

/**
 * GET /api/analytics/trending
 * Get trending pages
 */
router.get('/trending', async (req: Request, res: Response) => {
  try {
    const { limit, daysBack } = req.query;

    const pages = await analyticsService.getTrendingPages(
      parseInt(limit as string) || 10,
      parseInt(daysBack as string) || 7,
    );

    res.json(pages);
  } catch (error) {
    logger.error(error, 'Error fetching trending pages');
    res.status(500).json({ error: 'Failed to fetch trending pages' });
  }
});

/**
 * GET /api/analytics/custom-events
 * Get custom events by category
 */
router.get('/custom-events', async (req: Request, res: Response) => {
  try {
    const { eventCategory, startDate, endDate, limit } = req.query;

    if (!eventCategory || !startDate || !endDate) {
      return res.status(400).json({
        error: 'eventCategory, startDate, and endDate query parameters are required',
      });
    }

    const events = await analyticsService.getCustomEventsByCategory(
      eventCategory as string,
      new Date(startDate as string),
      new Date(endDate as string),
      parseInt(limit as string) || 100,
    );

    res.json(events);
  } catch (error) {
    logger.error(error, 'Error fetching custom events');
    res.status(500).json({ error: 'Failed to fetch custom events' });
  }
});

export default router;
