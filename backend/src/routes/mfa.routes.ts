/**
 * MFA Routes
 * Endpoints for managing multi-factor authentication
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as mfaService from '../services/mfa.service';
import { AppError } from '../utils/AppError';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../api/middleware/validate';
import { logger } from '../utils/logger';

const router = Router();

// Schemas
const registerMFASchema = z.object({
  type: z.enum(['totp', 'sms', 'email', 'biometric']),
  metadata: z.record(z.any()).optional(),
});

const verifyMFASchema = z.object({
  credentialId: z.string().min(1),
  code: z.string().min(4).max(10),
});

const disableMFASchema = z.object({
  credentialId: z.string().min(1),
});

/**
 * @swagger
 * tags:
 *   name: MFA
 *   description: Multi-Factor Authentication
 */

/**
 * POST /mfa/register
 * Register a new MFA credential
 */
router.post(
  '/register',
  requireAuth,
  validateBody(registerMFASchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { type, metadata } = req.body;

      let credential = '';
      if (type === 'totp') {
        // Generate TOTP secret
        const { secret, qrCode } = await generateTOTPSecret();
        credential = secret;
        res.json({ credentialId: '', secret, qrCode });
        return;
      } else if (type === 'email') {
        // Email verification is implicit
        credential = (req as any).email;
      } else if (type === 'sms') {
        // SMS requires phone number from request or user profile
        credential = req.body.phoneNumber || '';
      }

      const mfaCred = await mfaService.registerMFACredential(userId, type, credential, metadata);

      res.json({
        credentialId: mfaCred.id,
        type,
        message: 'MFA credential registered. Complete verification to enable.',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /mfa/verify
 * Verify and enable an MFA credential
 */
router.post(
  '/verify',
  requireAuth,
  validateBody(verifyMFASchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { credentialId, code } = req.body;

      const result = await mfaService.verifyMFACredential(userId, credentialId, code);

      res.json({
        verified: result.verified,
        backupCodes: result.backupCodes,
        message: 'MFA credential verified and enabled',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /mfa/disable
 * Disable an MFA credential
 */
router.post(
  '/disable',
  requireAuth,
  validateBody(disableMFASchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const { credentialId } = req.body;

      await mfaService.disableMFACredential(userId, credentialId);

      res.json({ message: 'MFA credential disabled' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /mfa/credentials
 * Get all enabled MFA credentials for current user
 */
router.get(
  '/credentials',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;

      const credentials = await mfaService.getEnabledMFACredentials(userId);

      res.json({
        credentials: credentials.map((c) => ({
          id: c.id,
          type: c.type,
          isVerified: c.isVerified,
          isEnabled: c.isEnabled,
          createdAt: c.createdAt,
          lastUsedAt: c.lastUsedAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /mfa/audit-log
 * Get MFA audit log for current user
 */
router.get(
  '/audit-log',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId;
      const limit = parseInt((req.query.limit as string) || '50');

      const auditLog = await mfaService.getMFAAuditLog(userId, Math.min(limit, 500));

      res.json({ auditLog });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Generate TOTP secret (helper)
 * In production, use otpauth library
 */
async function generateTOTPSecret(): Promise<{ secret: string; qrCode: string }> {
  // This is a placeholder - in production use otpauth.TOTP
  const secret = Math.random().toString(36).substring(2, 15);
  const qrCode = `data:image/svg+xml,%3Csvg%3E%3C/svg%3E`; // Placeholder

  return { secret, qrCode };
}

export default router;
