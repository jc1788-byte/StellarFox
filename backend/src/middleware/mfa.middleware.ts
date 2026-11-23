/**
 * MFA Middleware
 * Enforces multi-factor authentication for protected endpoints
 */

import type { Request, Response, NextFunction } from 'express';
import * as mfaService from '../services/mfa.service';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export interface MFARequest extends Request {
  mfaVerified?: boolean;
  mfaChallenge?: mfaService.MFAChallenge;
}

/**
 * Require MFA verification
 * Checks if user has MFA enabled and verified
 */
export async function requireMFA(
  req: MFARequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      throw new AppError(401, 'Authentication required');
    }

    // Get enabled MFA credentials
    const credentials = await mfaService.getEnabledMFACredentials(userId);

    if (credentials.length === 0) {
      // No MFA enabled, proceed
      next();
      return;
    }

    // Check if MFA challenge is already verified in session
    if (req.mfaVerified) {
      next();
      return;
    }

    // Check for MFA challenge in progress
    const challengeId = req.headers['x-mfa-challenge'] as string;
    if (challengeId) {
      // Verify challenge code
      const code = req.headers['x-mfa-code'] as string;
      if (!code) {
        throw new AppError(400, 'MFA code required');
      }

      try {
        await mfaService.verifyMFAChallenge(challengeId, code);
        req.mfaVerified = true;
        next();
        return;
      } catch (error) {
        logger.warn({ msg: 'MFA verification failed', userId, error });
        throw error;
      }
    }

    // Create new MFA challenge
    // Prefer TOTP if available, otherwise email
    const type = credentials.some((c) => c.type === 'totp') ? 'totp' : 'email';
    const challenge = await mfaService.createMFAChallenge(userId, type);

    res.status(403).json({
      error: 'MFA_REQUIRED',
      message: 'Multi-factor authentication required',
      challengeId: challenge.challengeId,
      type,
      expiresIn: challenge.expiresAt - Date.now(),
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      logger.error({ msg: 'MFA middleware error', error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * Optional MFA verification
 * Allows requests with or without MFA, but marks MFA status
 */
export async function optionalMFA(
  req: MFARequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      next();
      return;
    }

    // Check if user has MFA enabled
    const credentials = await mfaService.getEnabledMFACredentials(userId);
    req.mfaVerified = credentials.length === 0 || !!(req as any).mfaVerified;

    next();
  } catch (error) {
    logger.error({ msg: 'Optional MFA middleware error', error });
    next();
  }
}
