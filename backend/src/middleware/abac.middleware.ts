/**
 * ABAC Middleware
 * Enforces attribute-based access control for protected endpoints
 */

import type { Request, Response, NextFunction } from 'express';
import * as abacService from '../services/abac.service';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export interface ABACRequest extends Request {
  attributes?: Record<string, any>;
}

/**
 * Check authorization using ABAC
 * Can be used as endpoint-specific middleware
 */
export function checkAccess(
  resourceType: string,
  actionName: string,
) {
  return async (req: ABACRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).userId;
      if (!userId) {
        throw new AppError(401, 'Authentication required');
      }

      // Construct subject with user attributes
      const subject: abacService.Subject = {
        id: userId,
        type: 'user',
        attributes: {
          userId,
          role: (req as any).role || 'user',
          email: (req as any).email,
          ...(req.attributes || {}),
        },
      };

      // Construct resource
      const resourceId = req.params.id || req.body.resourceId || 'unknown';
      const resource: abacService.Resource = {
        id: resourceId,
        type: resourceType,
        attributes: {
          type: resourceType,
          owner: (req as any).ownerId,
          ...(req.body?.resourceAttributes || {}),
        },
      };

      // Construct action
      const action: abacService.Action = {
        name: actionName,
      };

      // Evaluate access
      const evaluation = await abacService.evaluateAccess(
        subject,
        action,
        resource,
        req.headers as Record<string, any>,
      );

      if (!evaluation.allowed) {
        logger.warn({
          msg: 'ABAC access denied',
          userId,
          resourceId,
          action: actionName,
          reason: evaluation.reason,
        });
        throw new AppError(403, evaluation.reason || 'Access denied');
      }

      // Store policies that allowed access for audit
      (req as any).allowedPolicies = evaluation.policies;

      next();
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        logger.error({ msg: 'ABAC middleware error', error });
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}

/**
 * Require admin role (shorthand for ABAC)
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = (req as any).role;
  if (role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Require specific roles
 */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req as any).role;
    if (!roles.includes(userRole)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Require resource ownership or admin
 */
export function requireOwnershipOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as any).userId;
  const ownerId = req.params.userId || req.body.userId;
  const role = (req as any).role;

  if (role === 'admin' || userId === ownerId) {
    next();
  } else {
    res.status(403).json({ error: 'Access denied' });
  }
}
