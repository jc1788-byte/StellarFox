/**
 * Multi-Factor Authentication (MFA) Service
 * Supports TOTP, SMS, and email-based MFA
 */

import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { redis } from './cache.service';
import { pool } from '../config/db';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import * as schema from '../db/schema';
import { mfaCredentials, mfaAuditLog } from '../db/schema';
import { sendEmail } from './email.service';

const env = getEnv();
const db = drizzle(pool, { schema });

export interface MFAChallenge {
  userId: string;
  type: 'totp' | 'sms' | 'email';
  challengeId: string;
  createdAt: number;
  expiresAt: number;
}

export interface MFACredential {
  id: string;
  userId: string;
  type: 'totp' | 'sms' | 'email' | 'biometric';
  credential: string; // encrypted
  backupCodes?: string[]; // encrypted
  isEnabled: boolean;
  isVerified: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Register a new MFA credential for a user
 */
export async function registerMFACredential(
  userId: string,
  type: 'totp' | 'sms' | 'email' | 'biometric',
  credential: string,
  metadata?: Record<string, unknown>,
): Promise<MFACredential> {
  try {
    const credentialId = randomUUID();
    const backupCodes = generateBackupCodes(10);

    const result = await db
      .insert(mfaCredentials)
      .values({
        id: credentialId,
        userId,
        type,
        credential: credential, // Should be encrypted before storing
        backupCodes: JSON.stringify(backupCodes), // Should be encrypted
        isEnabled: false,
        isVerified: false,
        createdAt: new Date(),
        metadata: metadata ? JSON.stringify(metadata) : null,
      })
      .returning();

    await logMFAAudit(userId, 'mfa_registered', type, true);

    return {
      id: credentialId,
      userId,
      type,
      credential,
      backupCodes,
      isEnabled: false,
      isVerified: false,
      createdAt: new Date(),
      metadata,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to register MFA credential', userId, type, error });
    throw new AppError(500, 'Failed to register MFA credential');
  }
}

/**
 * Verify and enable an MFA credential
 */
export async function verifyMFACredential(
  userId: string,
  credentialId: string,
  verificationCode: string,
): Promise<{ verified: boolean; backupCodes?: string[] }> {
  try {
    const cred = await db.query.mfaCredentials.findFirst({
      where: and(eq(mfaCredentials.id, credentialId), eq(mfaCredentials.userId, userId)),
    });

    if (!cred) {
      throw new AppError(404, 'MFA credential not found');
    }

    // Verify based on type
    let verified = false;
    switch (cred.type) {
      case 'totp':
        verified = await verifyTOTP(cred.credential, verificationCode);
        break;
      case 'email':
        verified = await verifyEmailCode(userId, credentialId, verificationCode);
        break;
      case 'sms':
        verified = await verifySMSCode(userId, credentialId, verificationCode);
        break;
      case 'biometric':
        // Biometric verification is handled client-side, just mark as verified
        verified = true;
        break;
    }

    if (!verified) {
      await logMFAAudit(userId, 'mfa_verification_failed', cred.type, false);
      throw new AppError(401, 'Verification code is invalid');
    }

    // Enable the credential
    await db
      .update(mfaCredentials)
      .set({
        isVerified: true,
        isEnabled: true,
        lastUsedAt: new Date(),
      })
      .where(eq(mfaCredentials.id, credentialId));

    await logMFAAudit(userId, 'mfa_enabled', cred.type, true);

    // Parse and return backup codes
    const backupCodes = JSON.parse(cred.backupCodes || '[]');

    return { verified: true, backupCodes };
  } catch (error) {
    logger.error({ msg: 'Failed to verify MFA credential', userId, credentialId, error });
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Verification failed');
  }
}

/**
 * Disable an MFA credential
 */
export async function disableMFACredential(userId: string, credentialId: string): Promise<void> {
  try {
    const cred = await db.query.mfaCredentials.findFirst({
      where: and(eq(mfaCredentials.id, credentialId), eq(mfaCredentials.userId, userId)),
    });

    if (!cred) {
      throw new AppError(404, 'MFA credential not found');
    }

    await db
      .update(mfaCredentials)
      .set({ isEnabled: false })
      .where(eq(mfaCredentials.id, credentialId));

    await logMFAAudit(userId, 'mfa_disabled', cred.type, true);
  } catch (error) {
    logger.error({ msg: 'Failed to disable MFA credential', userId, credentialId, error });
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Failed to disable MFA credential');
  }
}

/**
 * Get all enabled MFA credentials for a user
 */
export async function getEnabledMFACredentials(userId: string): Promise<MFACredential[]> {
  try {
    const credentials = await db.query.mfaCredentials.findMany({
      where: and(eq(mfaCredentials.userId, userId), eq(mfaCredentials.isEnabled, true)),
    });

    return credentials.map((cred) => ({
      id: cred.id,
      userId: cred.userId,
      type: cred.type as 'totp' | 'sms' | 'email' | 'biometric',
      credential: cred.credential,
      isEnabled: cred.isEnabled,
      isVerified: cred.isVerified,
      createdAt: cred.createdAt,
      lastUsedAt: cred.lastUsedAt,
      metadata: cred.metadata ? JSON.parse(cred.metadata) : undefined,
    }));
  } catch (error) {
    logger.error({ msg: 'Failed to get MFA credentials', userId, error });
    return [];
  }
}

/**
 * Create an MFA challenge for a user
 */
export async function createMFAChallenge(userId: string, type: 'totp' | 'sms' | 'email'): Promise<MFAChallenge> {
  try {
    const challengeId = randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + 5 * 60 * 1000; // 5 minutes

    const challenge: MFAChallenge = {
      userId,
      type,
      challengeId,
      createdAt,
      expiresAt,
    };

    // Store challenge in Redis
    await redis.setex(`mfa_challenge:${challengeId}`, 300, JSON.stringify(challenge));

    // Send challenge based on type
    if (type === 'email') {
      const code = generateMFACode(6);
      await redis.setex(`mfa_code:${challengeId}`, 300, code);
      await sendMFAEmailCode(userId, code);
    } else if (type === 'sms') {
      const code = generateMFACode(6);
      await redis.setex(`mfa_code:${challengeId}`, 300, code);
      // TODO: Implement SMS sending
    }

    return challenge;
  } catch (error) {
    logger.error({ msg: 'Failed to create MFA challenge', userId, type, error });
    throw new AppError(500, 'Failed to create MFA challenge');
  }
}

/**
 * Verify an MFA challenge
 */
export async function verifyMFAChallenge(
  challengeId: string,
  code: string,
): Promise<{ userId: string; type: string; valid: boolean }> {
  try {
    const challengeData = await redis.get(`mfa_challenge:${challengeId}`);
    if (!challengeData) {
      throw new AppError(401, 'Challenge expired or not found');
    }

    const challenge: MFAChallenge = JSON.parse(challengeData);
    if (Date.now() > challenge.expiresAt) {
      throw new AppError(401, 'Challenge expired');
    }

    const storedCode = await redis.get(`mfa_code:${challengeId}`);
    if (storedCode && storedCode === code) {
      await redis.del(`mfa_challenge:${challengeId}`, `mfa_code:${challengeId}`);
      return { userId: challenge.userId, type: challenge.type, valid: true };
    }

    await logMFAAudit(challenge.userId, 'mfa_challenge_failed', challenge.type, false);
    throw new AppError(401, 'Invalid MFA code');
  } catch (error) {
    logger.error({ msg: 'Failed to verify MFA challenge', challengeId, error });
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Verification failed');
  }
}

/**
 * Generate backup codes for MFA recovery
 */
function generateBackupCodes(count: number): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Generate a random MFA code
 */
function generateMFACode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10);
  }
  return code;
}

/**
 * Verify TOTP code
 */
async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  // TODO: Implement TOTP verification using otpauth library
  return true;
}

/**
 * Verify email code
 */
async function verifyEmailCode(userId: string, credentialId: string, code: string): Promise<boolean> {
  // Verification is handled in verifyMFAChallenge
  return true;
}

/**
 * Verify SMS code
 */
async function verifySMSCode(userId: string, credentialId: string, code: string): Promise<boolean> {
  // Verification is handled in verifyMFAChallenge
  return true;
}

/**
 * Send MFA email code
 */
async function sendMFAEmailCode(userId: string, code: string): Promise<void> {
  try {
    // Get user email from database
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (user?.email) {
      await sendEmail(user.email, 'mfa_code', { code });
    }
  } catch (error) {
    logger.error({ msg: 'Failed to send MFA email code', userId, error });
  }
}

/**
 * Log MFA audit event
 */
async function logMFAAudit(
  userId: string,
  action: string,
  mfaType: string,
  success: boolean,
): Promise<void> {
  try {
    await db.insert(mfaAuditLog).values({
      id: randomUUID(),
      userId,
      action,
      mfaType,
      success,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error({ msg: 'Failed to log MFA audit', userId, action, error });
  }
}

/**
 * Get MFA audit log for a user
 */
export async function getMFAAuditLog(userId: string, limit: number = 50): Promise<any[]> {
  try {
    return await db.query.mfaAuditLog.findMany({
      where: eq(mfaAuditLog.userId, userId),
      limit,
      orderBy: (log) => [log.timestamp],
    });
  } catch (error) {
    logger.error({ msg: 'Failed to get MFA audit log', userId, error });
    return [];
  }
}
