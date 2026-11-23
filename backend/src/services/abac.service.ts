/**
 * Attribute-Based Access Control (ABAC) Service
 * Implements fine-grained authorization with policy-as-code
 */

import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { redis } from './cache.service';
import { pool } from '../config/db';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import * as schema from '../db/schema';
import { abacPolicies, abacAuditLog } from '../db/schema';

const env = getEnv();
const db = drizzle(pool, { schema });

export interface Attribute {
  name: string;
  value: string | number | boolean | string[];
}

export interface Subject {
  id: string;
  type: 'user' | 'service';
  attributes: Record<string, any>;
}

export interface Resource {
  id: string;
  type: string;
  attributes: Record<string, any>;
}

export interface Action {
  name: string;
}

export interface ABACPolicy {
  id: string;
  name: string;
  description?: string;
  effect: 'allow' | 'deny';
  subject: PolicyCondition;
  action: PolicyCondition;
  resource: PolicyCondition;
  condition?: PolicyCondition;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  isEnabled: boolean;
}

export interface PolicyCondition {
  attribute?: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'in' | 'not_in' | 'greater_than' | 'less_than' | 'matches';
  value?: any;
  conditions?: PolicyCondition[];
  logic?: 'and' | 'or';
}

/**
 * Create an ABAC policy
 */
export async function createPolicy(
  name: string,
  effect: 'allow' | 'deny',
  subject: PolicyCondition,
  action: PolicyCondition,
  resource: PolicyCondition,
  createdBy: string,
  description?: string,
  condition?: PolicyCondition,
  priority: number = 0,
): Promise<ABACPolicy> {
  try {
    const policyId = randomUUID();

    const result = await db
      .insert(abacPolicies)
      .values({
        id: policyId,
        name,
        description,
        effect,
        subjectPolicy: JSON.stringify(subject),
        actionPolicy: JSON.stringify(action),
        resourcePolicy: JSON.stringify(resource),
        conditionPolicy: condition ? JSON.stringify(condition) : null,
        priority,
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
        isEnabled: true,
      })
      .returning();

    // Invalidate policy cache
    await redis.del('abac_policies');

    await logABACAudit('policy_created', policyId, createdBy, true);

    return {
      id: policyId,
      name,
      description,
      effect,
      subject,
      action,
      resource,
      condition,
      priority,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy,
      isEnabled: true,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to create policy', name, error });
    throw new AppError(500, 'Failed to create policy');
  }
}

/**
 * Evaluate if a subject can perform an action on a resource
 */
export async function evaluateAccess(
  subject: Subject,
  action: Action,
  resource: Resource,
  context?: Record<string, any>,
): Promise<{ allowed: boolean; reason?: string; policies?: string[] }> {
  try {
    // Get policies from cache or database
    let policies = await getPoliciesFromCache();
    if (!policies) {
      policies = await getAllPolicies();
      await cachePolicies(policies);
    }

    // Sort by priority (higher priority first)
    const sortedPolicies = policies.sort((a, b) => b.priority - a.priority);

    const applicablePolicies: { policy: ABACPolicy; allowed: boolean }[] = [];

    for (const policy of sortedPolicies) {
      if (!policy.isEnabled) continue;

      // Check if policy matches
      const subjectMatch = evaluateCondition(policy.subject, subject.attributes);
      const actionMatch = evaluateCondition(policy.action, action);
      const resourceMatch = evaluateCondition(policy.resource, resource.attributes);
      const contextMatch = policy.condition
        ? evaluateCondition(policy.condition, context || {})
        : true;

      if (subjectMatch && actionMatch && resourceMatch && contextMatch) {
        applicablePolicies.push({
          policy,
          allowed: policy.effect === 'allow',
        });
      }
    }

    // If any deny policy matches, deny access
    const denyPolicies = applicablePolicies.filter((p) => !p.allowed);
    if (denyPolicies.length > 0) {
      await logABACAudit('access_denied', resource.id, subject.id, false);
      return {
        allowed: false,
        reason: `Denied by policy: ${denyPolicies[0].policy.name}`,
        policies: denyPolicies.map((p) => p.policy.id),
      };
    }

    // Check for allow policies
    const allowPolicies = applicablePolicies.filter((p) => p.allowed);
    const allowed = allowPolicies.length > 0;

    await logABACAudit(
      allowed ? 'access_granted' : 'access_denied',
      resource.id,
      subject.id,
      allowed,
    );

    return {
      allowed,
      reason: allowed
        ? `Allowed by policy: ${allowPolicies[0].policy.name}`
        : 'No matching allow policies',
      policies: allowPolicies.map((p) => p.policy.id),
    };
  } catch (error) {
    logger.error({ msg: 'Failed to evaluate access', subject: subject.id, resource: resource.id, error });
    // Fail-secure: deny access on evaluation error
    return { allowed: false, reason: 'Access evaluation failed' };
  }
}

/**
 * Evaluate a policy condition
 */
function evaluateCondition(condition: PolicyCondition, data: any): boolean {
  try {
    // Handle complex conditions with logic (and/or)
    if (condition.conditions) {
      const results = condition.conditions.map((c) => evaluateCondition(c, data));
      if (condition.logic === 'or') {
        return results.some((r) => r === true);
      } else {
        // default to 'and'
        return results.every((r) => r === true);
      }
    }

    // Handle single condition
    if (condition.attribute && data[condition.attribute]) {
      const actualValue = data[condition.attribute];
      const expectedValue = condition.value;

      switch (condition.operator) {
        case 'equals':
          return actualValue === expectedValue;
        case 'not_equals':
          return actualValue !== expectedValue;
        case 'contains':
          return Array.isArray(actualValue)
            ? actualValue.includes(expectedValue)
            : String(actualValue).includes(String(expectedValue));
        case 'in':
          return Array.isArray(expectedValue) && expectedValue.includes(actualValue);
        case 'not_in':
          return Array.isArray(expectedValue) && !expectedValue.includes(actualValue);
        case 'greater_than':
          return actualValue > expectedValue;
        case 'less_than':
          return actualValue < expectedValue;
        case 'matches':
          // Regex matching
          return new RegExp(expectedValue).test(String(actualValue));
        default:
          return false;
      }
    }

    // For action matching
    if (data.name && condition.value) {
      const actionName = data.name;
      switch (condition.operator) {
        case 'equals':
          return actionName === condition.value;
        case 'in':
          return Array.isArray(condition.value) && condition.value.includes(actionName);
        case 'matches':
          return new RegExp(condition.value).test(actionName);
        default:
          return false;
      }
    }

    return false;
  } catch (error) {
    logger.error({ msg: 'Failed to evaluate condition', condition, error });
    return false;
  }
}

/**
 * Update a policy
 */
export async function updatePolicy(
  policyId: string,
  updates: Partial<ABACPolicy>,
  updatedBy: string,
): Promise<ABACPolicy> {
  try {
    const existing = await db.query.abacPolicies.findFirst({
      where: eq(abacPolicies.id, policyId),
    });

    if (!existing) {
      throw new AppError(404, 'Policy not found');
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (updates.name) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.effect) updateData.effect = updates.effect;
    if (updates.subject) updateData.subjectPolicy = JSON.stringify(updates.subject);
    if (updates.action) updateData.actionPolicy = JSON.stringify(updates.action);
    if (updates.resource) updateData.resourcePolicy = JSON.stringify(updates.resource);
    if (updates.condition) updateData.conditionPolicy = JSON.stringify(updates.condition);
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.isEnabled !== undefined) updateData.isEnabled = updates.isEnabled;

    await db.update(abacPolicies).set(updateData).where(eq(abacPolicies.id, policyId));

    // Invalidate cache
    await redis.del('abac_policies');

    await logABACAudit('policy_updated', policyId, updatedBy, true);

    return {
      ...(existing as any),
      ...updates,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to update policy', policyId, error });
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Failed to update policy');
  }
}

/**
 * Delete a policy
 */
export async function deletePolicy(policyId: string, deletedBy: string): Promise<void> {
  try {
    await db
      .update(abacPolicies)
      .set({ isEnabled: false, updatedAt: new Date() })
      .where(eq(abacPolicies.id, policyId));

    await redis.del('abac_policies');
    await logABACAudit('policy_deleted', policyId, deletedBy, true);
  } catch (error) {
    logger.error({ msg: 'Failed to delete policy', policyId, error });
    throw new AppError(500, 'Failed to delete policy');
  }
}

/**
 * Get all policies
 */
async function getAllPolicies(): Promise<ABACPolicy[]> {
  try {
    const policies = await db.query.abacPolicies.findMany();

    return policies.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      effect: p.effect as 'allow' | 'deny',
      subject: JSON.parse(p.subjectPolicy),
      action: JSON.parse(p.actionPolicy),
      resource: JSON.parse(p.resourcePolicy),
      condition: p.conditionPolicy ? JSON.parse(p.conditionPolicy) : undefined,
      priority: p.priority,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      createdBy: p.createdBy,
      isEnabled: p.isEnabled,
    }));
  } catch (error) {
    logger.error({ msg: 'Failed to get all policies', error });
    return [];
  }
}

/**
 * Get policies from cache
 */
async function getPoliciesFromCache(): Promise<ABACPolicy[] | null> {
  try {
    const cached = await redis.get('abac_policies');
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Cache policies
 */
async function cachePolicies(policies: ABACPolicy[]): Promise<void> {
  try {
    // Cache for 1 hour
    await redis.setex('abac_policies', 3600, JSON.stringify(policies));
  } catch (error) {
    logger.error({ msg: 'Failed to cache policies', error });
  }
}

/**
 * Log ABAC audit event
 */
async function logABACAudit(
  action: string,
  resourceId: string,
  userId: string,
  success: boolean,
): Promise<void> {
  try {
    await db.insert(abacAuditLog).values({
      id: randomUUID(),
      action,
      resourceId,
      userId,
      success,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error({ msg: 'Failed to log ABAC audit', action, error });
  }
}

/**
 * Get ABAC audit log
 */
export async function getABACAuditLog(resourceId?: string, limit: number = 50): Promise<any[]> {
  try {
    if (resourceId) {
      return await db.query.abacAuditLog.findMany({
        where: eq(abacAuditLog.resourceId, resourceId),
        limit,
        orderBy: (log) => [log.timestamp],
      });
    }

    return await db.query.abacAuditLog.findMany({
      limit,
      orderBy: (log) => [log.timestamp],
    });
  } catch (error) {
    logger.error({ msg: 'Failed to get ABAC audit log', error });
    return [];
  }
}
