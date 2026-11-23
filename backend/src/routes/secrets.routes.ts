/**
 * Secrets Management Routes
 * Endpoints for managing encrypted secrets
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as secretsService from '../services/secrets.service';
import { AppError } from '../utils/AppError';
import { requireAuth } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/abac.middleware';
import { validateBody } from '../api/middleware/validate';
import { logger } from '../utils/logger';

const router = Router();

// Schemas
const createSecretSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['api_key', 'database_url', 'token', 'custom']),
  value: z.string().min(1),
  rotationInterval: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

const rotateSecretSchema = z.object({
  secretId: z.string().min(1),
  newValue: z.string().min(1),
  reason: z.string().optional(),
});

const deleteSecretSchema = z.object({
  secretId: z.string().min(1),
});

/**
 * @swagger
 * tags:
 *   name: Secrets
 *   description: Encrypted Secrets Management
 */

/**
 * POST /secrets/create
 * Create a new encrypted secret (admin only)
 */
router.post(
  '/create',
  requireAuth,
  requireAdmin,
  validateBody(createSecretSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { name, type, value, rotationInterval, expiresAt } = req.body;

      const secret = await secretsService.createSecret(
        name,
        type,
        value,
        userId,
        rotationInterval,
        expiresAt ? new Date(expiresAt) : undefined,
      );

      res.status(201).json({
        id: secret.id,
        name: secret.name,
        type: secret.type,
        rotationInterval: secret.rotationInterval,
        nextRotationAt: secret.nextRotationAt,
        expiresAt: secret.expiresAt,
        message: 'Secret created successfully',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /secrets/:identifier
 * Retrieve a secret by ID or name (admin only)
 */
router.get(
  '/:identifier',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { identifier } = req.params;

      const secret = await secretsService.getSecret(identifier, userId);

      if (!secret) {
        throw new AppError(404, 'Secret not found');
      }

      res.json({
        id: secret.id,
        name: secret.name,
        type: secret.type,
        value: secret.value,
        rotationInterval: secret.rotationInterval,
        nextRotationAt: secret.nextRotationAt,
        expiresAt: secret.expiresAt,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /secrets/rotate
 * Rotate a secret (admin only)
 */
router.post(
  '/rotate',
  requireAuth,
  requireAdmin,
  validateBody(rotateSecretSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { secretId, newValue, reason } = req.body;

      const rotation = await secretsService.rotateSecret(
        secretId,
        newValue,
        userId,
        reason || 'manual_rotation',
      );

      res.json({
        rotationId: rotation.id,
        secretId: rotation.secretId,
        rotatedAt: rotation.rotatedAt,
        status: rotation.status,
        message: 'Secret rotated successfully',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /secrets/delete
 * Delete/archive a secret (admin only)
 */
router.post(
  '/delete',
  requireAuth,
  requireAdmin,
  validateBody(deleteSecretSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { secretId } = req.body;

      await secretsService.deleteSecret(secretId, userId);

      res.json({ message: 'Secret deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /secrets
 * List all secrets (admin only, without values)
 */
router.get(
  '/',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;

      const secrets = await secretsService.listSecrets(userId);

      res.json({ secrets });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /secrets/:secretId/audit-log
 * Get audit log for a secret (admin only)
 */
router.get(
  '/:secretId/audit-log',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { secretId } = req.params;
      const limit = parseInt((req.query.limit as string) || '50');

      const auditLog = await secretsService.getSecretAuditLog(secretId, Math.min(limit, 500));

      res.json({ auditLog });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
