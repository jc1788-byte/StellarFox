/**
 * Alerting API Routes
 * Endpoints for alert management and on-call scheduling
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { getAlertService } from '../services/alert.service';
import { getOnCallService } from '../services/oncall.service';
import { getPagerDutyService } from '../services/pagerduty.service';
import {
  AlertTriggerRequest,
  AlertSeverity,
  AlertChannel,
  ScheduleType,
} from '../types/alerting.types';

const router = Router();

// Validation schemas
const alertTriggerSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(5000),
  severity: z.enum([
    AlertSeverity.CRITICAL,
    AlertSeverity.HIGH,
    AlertSeverity.MEDIUM,
    AlertSeverity.LOW,
    AlertSeverity.INFO,
  ]),
  source: z.string().min(1).max(255),
  tags: z.record(z.string()).optional(),
  channels: z.array(z.enum(Object.values(AlertChannel))).optional(),
  metadata: z.record(z.any()).optional(),
});

const createScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum([ScheduleType.WEEKLY, ScheduleType.BIWEEKLY, ScheduleType.CUSTOM]),
  timezone: z.string(),
});

const addLayerSchema = z.object({
  name: z.string().min(1).max(255),
  rotationTurnLength: z.number().int().positive(),
  members: z.array(
    z.object({
      name: z.string(),
      email: z.string().email(),
      phone: z.string().optional(),
      slackId: z.string().optional(),
    }),
  ),
});

// Error handler middleware
function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ============================================================================
// ALERT ENDPOINTS
// ============================================================================

/**
 * Trigger a new alert
 * POST /api/alerts/trigger
 */
router.post(
  '/trigger',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const validatedData = alertTriggerSchema.parse(req.body);

      const alertService = getAlertService();
      const alert = await alertService.triggerAlert(validatedData as AlertTriggerRequest);

      res.status(201).json({
        success: true,
        alert,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        });
      } else {
        throw error;
      }
    }
  }),
);

/**
 * Get alert by ID
 * GET /api/alerts/:id
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const alertService = getAlertService();
    const alert = await alertService.getAlert(req.params.id);

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found',
      });
    }

    res.json({
      success: true,
      alert,
    });
  }),
);

/**
 * Get active alerts
 * GET /api/alerts
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const alertService = getAlertService();
    const alerts = await alertService.getActiveAlerts();

    res.json({
      success: true,
      alerts,
      count: alerts.length,
    });
  }),
);

/**
 * Acknowledge alert
 * PUT /api/alerts/:id/acknowledge
 */
router.put(
  '/:id/acknowledge',
  asyncHandler(async (req: Request, res: Response) => {
    const { acknowledgedBy } = req.body;

    if (!acknowledgedBy) {
      return res.status(400).json({
        success: false,
        error: 'acknowledgedBy is required',
      });
    }

    const alertService = getAlertService();
    const alert = await alertService.acknowledgeAlert(req.params.id, acknowledgedBy);

    res.json({
      success: true,
      alert,
    });
  }),
);

/**
 * Resolve alert
 * PUT /api/alerts/:id/resolve
 */
router.put(
  '/:id/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const { resolvedBy } = req.body;

    const alertService = getAlertService();
    const alert = await alertService.resolveAlert(req.params.id, resolvedBy);

    res.json({
      success: true,
      alert,
    });
  }),
);

// ============================================================================
// ON-CALL SCHEDULE ENDPOINTS
// ============================================================================

/**
 * Create on-call schedule
 * POST /api/schedules
 */
router.post(
  '/schedules',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const validatedData = createScheduleSchema.parse(req.body);

      const onCallService = getOnCallService();
      const schedule = await onCallService.createSchedule(
        validatedData.name,
        validatedData.type,
        validatedData.timezone,
      );

      res.status(201).json({
        success: true,
        schedule,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        });
      } else {
        throw error;
      }
    }
  }),
);

/**
 * List on-call schedules
 * GET /api/schedules
 */
router.get(
  '/schedules',
  asyncHandler(async (req: Request, res: Response) => {
    const onCallService = getOnCallService();
    const schedules = await onCallService.listSchedules();

    res.json({
      success: true,
      schedules,
      count: schedules.length,
    });
  }),
);

/**
 * Get specific schedule
 * GET /api/schedules/:id
 */
router.get(
  '/schedules/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const onCallService = getOnCallService();
    const schedule = await onCallService.getSchedule(req.params.id);

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    res.json({
      success: true,
      schedule,
    });
  }),
);

/**
 * Add layer to schedule
 * POST /api/schedules/:id/layers
 */
router.post(
  '/schedules/:id/layers',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const validatedData = addLayerSchema.parse(req.body);

      const onCallService = getOnCallService();
      const layer = await onCallService.addLayer(
        req.params.id,
        validatedData.name,
        new Date(req.body.startDate || Date.now()),
        validatedData.rotationTurnLength,
        validatedData.members.map((m, i) => ({
          id: `${req.params.id}-member-${i}`,
          ...m,
          position: i,
          active: true,
        })),
      );

      res.status(201).json({
        success: true,
        layer,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors,
        });
      } else {
        throw error;
      }
    }
  }),
);

/**
 * Get current on-call person
 * GET /api/schedules/:id/oncall
 */
router.get(
  '/schedules/:id/oncall',
  asyncHandler(async (req: Request, res: Response) => {
    const onCallService = getOnCallService();
    const member = await onCallService.getCurrentOnCall(req.params.id);

    res.json({
      success: true,
      onCallMember: member,
    });
  }),
);

/**
 * Get schedule for date range
 * GET /api/schedules/:id/range
 */
router.get(
  '/schedules/:id/range',
  asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate query parameters are required',
      });
    }

    const onCallService = getOnCallService();
    const assignments = await onCallService.getScheduleForRange(
      req.params.id,
      new Date(startDate as string),
      new Date(endDate as string),
    );

    res.json({
      success: true,
      assignments,
    });
  }),
);

// ============================================================================
// ESCALATION POLICY ENDPOINTS
// ============================================================================

/**
 * Create escalation policy
 * POST /api/escalation-policies
 */
router.post(
  '/escalation-policies',
  asyncHandler(async (req: Request, res: Response) => {
    const { name, levels } = req.body;

    if (!name || !levels || !Array.isArray(levels)) {
      return res.status(400).json({
        success: false,
        error: 'name and levels array are required',
      });
    }

    const onCallService = getOnCallService();
    const policy = await onCallService.createEscalationPolicy(name, levels);

    res.status(201).json({
      success: true,
      policy,
    });
  }),
);

/**
 * Get escalation policy
 * GET /api/escalation-policies/:id
 */
router.get(
  '/escalation-policies/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const onCallService = getOnCallService();
    const policy = await onCallService.getEscalationPolicy(req.params.id);

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: 'Escalation policy not found',
      });
    }

    res.json({
      success: true,
      policy,
    });
  }),
);

/**
 * Test escalation policy
 * POST /api/escalation-policies/:id/test
 */
router.post(
  '/escalation-policies/:id/test',
  asyncHandler(async (req: Request, res: Response) => {
    const onCallService = getOnCallService();
    const result = await onCallService.testEscalationPolicy(req.params.id);

    res.json({
      success: true,
      ...result,
    });
  }),
);

// ============================================================================
// PAGERDUTY INTEGRATION ENDPOINTS
// ============================================================================

/**
 * Get PagerDuty health status
 * GET /api/integrations/pagerduty/health
 */
router.get(
  '/integrations/pagerduty/health',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const pagerDuty = getPagerDutyService();
      const isHealthy = await pagerDuty.healthCheck();

      res.json({
        success: true,
        status: isHealthy ? 'healthy' : 'unhealthy',
        pagerdutyHealthy: isHealthy,
      });
    } catch (error) {
      res.json({
        success: false,
        status: 'error',
        pagerdutyHealthy: false,
        error: 'Failed to check PagerDuty health',
      });
    }
  }),
);

/**
 * List PagerDuty incidents
 * GET /api/integrations/pagerduty/incidents
 */
router.get(
  '/integrations/pagerduty/incidents',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { statuses, limit = '25', offset = '0' } = req.query;

      const pagerDuty = getPagerDutyService();
      const result = await pagerDuty.listIncidents({
        statuses: statuses ? (statuses as string).split(',') : undefined,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });

      res.json({
        success: true,
        incidents: result.incidents,
        pagination: {
          limit: result.limit,
          offset: result.offset,
          total: result.total,
        },
      });
    } catch (error) {
      logger.error('Failed to list PagerDuty incidents', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to list incidents',
      });
    }
  }),
);

/**
 * Get PagerDuty incident
 * GET /api/integrations/pagerduty/incidents/:incidentId
 */
router.get(
  '/integrations/pagerduty/incidents/:incidentId',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const pagerDuty = getPagerDutyService();
      const incident = await pagerDuty.getIncident(req.params.incidentId);

      res.json({
        success: true,
        incident,
      });
    } catch (error) {
      logger.error('Failed to get incident', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get incident',
      });
    }
  }),
);

export default router;
