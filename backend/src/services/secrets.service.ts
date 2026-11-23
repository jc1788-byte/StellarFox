/**
 * Secure Secrets Management Service
 * Implements encryption, rotation, and audit logging
 */

import { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, gt } from 'drizzle-orm';
import { redis } from './cache.service';
import { pool } from '../config/db';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import * as schema from '../db/schema';
import { encryptedSecrets, secretRotationLog, secretAuditLog } from '../db/schema';

const env = getEnv();
const db = drizzle(pool, { schema });

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_SALT_ROUNDS = 100000;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface Secret {
  id: string;
  name: string;
  type: 'api_key' | 'database_url' | 'token' | 'custom';
  value: string; // This will only be available on creation
  isRotated: boolean;
  rotationInterval?: number; // days
  nextRotationAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  expiresAt?: Date;
}

export interface SecretRotation {
  id: string;
  secretId: string;
  oldValue: string; // encrypted
  newValue: string; // encrypted
  rotatedAt: Date;
  rotatedBy: string;
  reason: string;
  status: 'pending' | 'completed' | 'failed';
}

/**
 * Encrypt a value using AES-256-GCM
 */
export function encryptSecret(plaintext: string, masterKey?: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  try {
    const key = deriveKey(masterKey || env.SECRETS_ENCRYPTION_KEY || env.JWT_SECRET);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  } catch (error) {
    logger.error({ msg: 'Failed to encrypt secret', error });
    throw new AppError(500, 'Failed to encrypt secret');
  }
}

/**
 * Decrypt a value using AES-256-GCM
 */
export function decryptSecret(
  encryptedData: string,
  iv: string,
  authTag: string,
  masterKey?: string,
): string {
  try {
    const key = deriveKey(masterKey || env.SECRETS_ENCRYPTION_KEY || env.JWT_SECRET);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error({ msg: 'Failed to decrypt secret', error });
    throw new AppError(500, 'Failed to decrypt secret');
  }
}

/**
 * Derive a key from master key using PBKDF2
 */
function deriveKey(masterKey: string): Buffer {
  return createHash('sha256').update(masterKey).digest();
}

/**
 * Create and store a new secret
 */
export async function createSecret(
  name: string,
  type: 'api_key' | 'database_url' | 'token' | 'custom',
  value: string,
  createdBy: string,
  rotationInterval?: number,
  expiresAt?: Date,
): Promise<Secret> {
  try {
    const secretId = randomUUID();
    const { encrypted, iv, authTag } = encryptSecret(value);

    const nextRotationAt = rotationInterval
      ? new Date(Date.now() + rotationInterval * 24 * 60 * 60 * 1000)
      : undefined;

    const result = await db
      .insert(encryptedSecrets)
      .values({
        id: secretId,
        name,
        type,
        encryptedValue: encrypted,
        iv,
        authTag,
        rotationInterval,
        nextRotationAt,
        expiresAt,
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await logSecretAudit(secretId, 'secret_created', createdBy, true);

    return {
      id: secretId,
      name,
      type,
      value, // Only returned on creation
      isRotated: false,
      rotationInterval,
      nextRotationAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy,
      expiresAt,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to create secret', name, type, error });
    throw new AppError(500, 'Failed to create secret');
  }
}

/**
 * Retrieve a secret by ID or name
 */
export async function getSecret(
  identifierOrId: string,
  userId?: string,
): Promise<Secret | null> {
  try {
    const secret = await db.query.encryptedSecrets.findFirst({
      where: (table) =>
        eq(table.id, identifierOrId) || eq(table.name, identifierOrId),
    });

    if (!secret) {
      return null;
    }

    // Log access
    if (userId) {
      await logSecretAudit(secret.id, 'secret_accessed', userId, true);
    }

    // Check expiration
    if (secret.expiresAt && secret.expiresAt < new Date()) {
      logger.warn({ msg: 'Secret has expired', secretId: secret.id });
    }

    const decrypted = decryptSecret(
      secret.encryptedValue,
      secret.iv,
      secret.authTag,
    );

    return {
      id: secret.id,
      name: secret.name,
      type: secret.type as any,
      value: decrypted,
      isRotated: secret.isRotated,
      rotationInterval: secret.rotationInterval || undefined,
      nextRotationAt: secret.nextRotationAt || undefined,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      createdBy: secret.createdBy,
      expiresAt: secret.expiresAt || undefined,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to retrieve secret', identifierOrId, error });
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Failed to retrieve secret');
  }
}

/**
 * Rotate a secret
 */
export async function rotateSecret(
  secretId: string,
  newValue: string,
  rotatedBy: string,
  reason: string = 'scheduled',
): Promise<SecretRotation> {
  try {
    const secret = await db.query.encryptedSecrets.findFirst({
      where: eq(encryptedSecrets.id, secretId),
    });

    if (!secret) {
      throw new AppError(404, 'Secret not found');
    }

    // Decrypt old value for audit trail
    const oldValue = decryptSecret(
      secret.encryptedValue,
      secret.iv,
      secret.authTag,
    );

    // Encrypt new value
    const { encrypted, iv, authTag } = encryptSecret(newValue);

    // Create rotation record
    const rotationId = randomUUID();
    const oldEncrypted = secret.encryptedValue;

    await db.insert(secretRotationLog).values({
      id: rotationId,
      secretId,
      oldEncryptedValue: oldEncrypted,
      newEncryptedValue: encrypted,
      oldIv: secret.iv,
      newIv: iv,
      oldAuthTag: secret.authTag,
      newAuthTag: authTag,
      rotatedAt: new Date(),
      rotatedBy,
      reason,
      status: 'completed',
    });

    // Update secret with new value
    const nextRotationAt = secret.rotationInterval
      ? new Date(Date.now() + secret.rotationInterval * 24 * 60 * 60 * 1000)
      : undefined;

    await db
      .update(encryptedSecrets)
      .set({
        encryptedValue: encrypted,
        iv,
        authTag,
        isRotated: true,
        nextRotationAt,
        updatedAt: new Date(),
      })
      .where(eq(encryptedSecrets.id, secretId));

    await logSecretAudit(secretId, 'secret_rotated', rotatedBy, true, reason);

    return {
      id: rotationId,
      secretId,
      oldValue: oldEncrypted,
      newValue: encrypted,
      rotatedAt: new Date(),
      rotatedBy,
      reason,
      status: 'completed',
    };
  } catch (error) {
    logger.error({ msg: 'Failed to rotate secret', secretId, error });
    await logSecretAudit(secretId, 'secret_rotation_failed', rotatedBy, false, reason);
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Failed to rotate secret');
  }
}

/**
 * Delete a secret
 */
export async function deleteSecret(secretId: string, deletedBy: string): Promise<void> {
  try {
    await db
      .update(encryptedSecrets)
      .set({ deletedAt: new Date(), deletedBy })
      .where(eq(encryptedSecrets.id, secretId));

    await logSecretAudit(secretId, 'secret_deleted', deletedBy, true);
  } catch (error) {
    logger.error({ msg: 'Failed to delete secret', secretId, error });
    throw new AppError(500, 'Failed to delete secret');
  }
}

/**
 * Get rotation schedule for secrets needing rotation
 */
export async function getSecretsNeedingRotation(): Promise<Secret[]> {
  try {
    const secrets = await db.query.encryptedSecrets.findMany({
      where: (table) =>
        and(
          table.rotationInterval != null,
          table.nextRotationAt != null,
          gt(table.nextRotationAt, new Date()),
          table.deletedAt == null,
        ),
    });

    return secrets.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as any,
      value: '', // Don't return value in list
      isRotated: s.isRotated,
      rotationInterval: s.rotationInterval || undefined,
      nextRotationAt: s.nextRotationAt || undefined,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      createdBy: s.createdBy,
      expiresAt: s.expiresAt || undefined,
    }));
  } catch (error) {
    logger.error({ msg: 'Failed to get secrets needing rotation', error });
    return [];
  }
}

/**
 * Log secret audit event
 */
async function logSecretAudit(
  secretId: string,
  action: string,
  userId: string,
  success: boolean,
  details?: string,
): Promise<void> {
  try {
    await db.insert(secretAuditLog).values({
      id: randomUUID(),
      secretId,
      action,
      userId,
      success,
      details,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error({ msg: 'Failed to log secret audit', secretId, action, error });
  }
}

/**
 * Get audit log for a secret
 */
export async function getSecretAuditLog(secretId: string, limit: number = 50): Promise<any[]> {
  try {
    return await db.query.secretAuditLog.findMany({
      where: eq(secretAuditLog.secretId, secretId),
      limit,
      orderBy: (log) => [log.timestamp],
    });
  } catch (error) {
    logger.error({ msg: 'Failed to get secret audit log', secretId, error });
    return [];
  }
}

/**
 * Get all secrets for a user (without values)
 */
export async function listSecrets(userId?: string): Promise<Array<Omit<Secret, 'value'>>> {
  try {
    const secrets = await db.query.encryptedSecrets.findMany({
      where: (table) => table.deletedAt == null,
    });

    if (userId) {
      await logSecretAudit('*', 'secrets_listed', userId, true);
    }

    return secrets.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as any,
      isRotated: s.isRotated,
      rotationInterval: s.rotationInterval || undefined,
      nextRotationAt: s.nextRotationAt || undefined,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      createdBy: s.createdBy,
      expiresAt: s.expiresAt || undefined,
    }));
  } catch (error) {
    logger.error({ msg: 'Failed to list secrets', error });
    return [];
  }
}
