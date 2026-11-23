/**
 * Security Routes
 * Endpoints for security scanning and ABAC policies
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as scanService from '../services/security-scanning.service';
import * as abacService from '../services/abac.service';
import { AppError } from '../utils/AppError';
import { requireAuth } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/abac.middleware';
import { validateBody } from '../api/middleware/validate';
import { logger } from '../utils/logger';

const router = Router();

// Schemas
const scanSchema = z.object({
  type: z.enum(['sast', 'dast', 'dependency', 'container']),
  target: z.string().optional(),
});

const createPolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  subject: z.object({
    operator: z.string(),
    value: z.any().optional(),
  }),
  action: z.object({
    operator: z.string(),
    value: z.any().optional(),
  }),
  resource: z.object({
    operator: z.string(),
    value: z.any().optional(),
  }),
  priority: z.number().int().optional(),
});

/**
 * @swagger
 * tags:
 *   name: Security
 *   description: Security Scanning and ABAC Management
 */

/**
 * POST /security/scan
 * Trigger a security scan (admin only)
 */
router.post(
  '/scan',
  requireAuth,
  requireAdmin,
  validateBody(scanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type, target } = req.body;

      let scan;
      switch (type) {
        case 'sast':
          scan = await scanService.runSAST(target || process.cwd());
          break;
        case 'dast':
          if (!target) throw new AppError(400, 'Target URL required for DAST');
          scan = await scanService.runDAST(target);
          break;
        case 'dependency':
          scan = await scanService.runDependencyScan(target || process.cwd());
          break;
        case 'container':
          if (!target) throw new AppError(400, 'Image ID required for container scan');
          scan = await scanService.runContainerScan(target);
          break;
        default:
          throw new AppError(400, 'Invalid scan type');
      }

      res.status(202).json({
        scanId: scan.id,
        type: scan.type,
        status: scan.status,
        startedAt: scan.startedAt,
        message: 'Security scan started',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /security/scan/:scanId
 * Get scan results
 */
router.get(
  '/scan/:scanId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { scanId } = req.params;

      const scan = await scanService.getScanResults(scanId);

      if (!scan) {
        throw new AppError(404, 'Scan not found');
      }

      const vulnerabilities = await scanService.getScanVulnerabilities(scanId);

      res.json({
        scan,
        vulnerabilities,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /security/policies
 * Create an ABAC policy (admin only)
 */
router.post(
  '/policies',
  requireAuth,
  requireAdmin,
  validateBody(createPolicySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { name, description, effect, subject, action, resource, priority } = req.body;

      const policy = await abacService.createPolicy(
        name,
        effect,
        subject,
        action,
        resource,
        userId,
        description,
        undefined,
        priority || 0,
      );

      res.status(201).json({
        id: policy.id,
        name: policy.name,
        effect: policy.effect,
        priority: policy.priority,
        message: 'Policy created successfully',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /security/policies
 * List all ABAC policies (admin only)
 */
router.get(
  '/policies',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // TODO: Implement fetching all policies
      const policies = [];

      res.json({ policies });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /security/policies/:policyId
 * Update an ABAC policy (admin only)
 */
router.put(
  '/policies/:policyId',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { policyId } = req.params;

      const policy = await abacService.updatePolicy(policyId, req.body, userId);

      res.json({
        id: policy.id,
        message: 'Policy updated successfully',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /security/policies/:policyId
 * Delete an ABAC policy (admin only)
 */
router.delete(
  '/policies/:policyId',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { policyId } = req.params;

      await abacService.deletePolicy(policyId, userId);

      res.json({ message: 'Policy deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /security/audit-log
 * Get security audit log (admin only)
 */
router.get(
  '/audit-log',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resourceId = req.query.resourceId as string;
      const limit = parseInt((req.query.limit as string) || '50');

      const auditLog = await abacService.getABACAuditLog(
        resourceId,
        Math.min(limit, 500),
      );

      res.json({ auditLog });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
