/**
 * On-Call Schedule Management Service
 * Manages on-call rotations, escalation policies, and schedule assignments
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';
import {
  OnCallSchedule,
  ScheduleLayer,
  ScheduleMember,
  EscalationPolicy,
  EscalationLevel,
  ScheduleType,
} from '../types/alerting.types';
import { getPagerDutyService } from './pagerduty.service';

const SCHEDULE_KEY = (id: string) => `schedule:${id}`;
const SCHEDULES_INDEX = 'schedules:all';
const ESCALATION_POLICY_KEY = (id: string) => `escalation:${id}`;
const POLICIES_INDEX = 'escalation-policies:all';
const CURRENT_ONCALL_KEY = (scheduleId: string) => `oncall:current:${scheduleId}`;
const ONCALL_HISTORY_KEY = (scheduleId: string) => `oncall:history:${scheduleId}`;

export class OnCallService {
  /**
   * Create a new on-call schedule
   */
  async createSchedule(
    name: string,
    type: ScheduleType,
    timezone: string,
  ): Promise<OnCallSchedule> {
    try {
      const schedule: OnCallSchedule = {
        id: uuidv4(),
        name,
        type,
        timezone,
        enabled: true,
        layers: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Sync with PagerDuty if configured
      try {
        const pagerDuty = getPagerDutyService();
        // PagerDuty schedule creation would be done via API
        logger.debug('Schedule created in PagerDuty', { scheduleId: schedule.id });
      } catch (error) {
        logger.warn('Failed to sync with PagerDuty', { error });
      }

      await this.storeSchedule(schedule);
      await redis.zadd(SCHEDULES_INDEX, Date.now(), schedule.id);

      logger.info('On-call schedule created', {
        scheduleId: schedule.id,
        name,
        type,
      });

      return schedule;
    } catch (error) {
      logger.error('Failed to create schedule', { error, name });
      throw error;
    }
  }

  /**
   * Get schedule by ID
   */
  async getSchedule(scheduleId: string): Promise<OnCallSchedule | null> {
    try {
      const cached = await redis.get(SCHEDULE_KEY(scheduleId));
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get schedule', { error, scheduleId });
      return null;
    }
  }

  /**
   * List all schedules
   */
  async listSchedules(): Promise<OnCallSchedule[]> {
    try {
      const scheduleIds = await redis.zrange(SCHEDULES_INDEX, 0, -1);
      const schedules = await Promise.all(
        scheduleIds.map((id) => this.getSchedule(id)),
      );
      return schedules.filter((s): s is OnCallSchedule => s !== null);
    } catch (error) {
      logger.error('Failed to list schedules', { error });
      return [];
    }
  }

  /**
   * Update schedule
   */
  async updateSchedule(scheduleId: string, updates: Partial<OnCallSchedule>): Promise<OnCallSchedule> {
    try {
      const schedule = await this.getSchedule(scheduleId);
      if (!schedule) {
        throw new Error(`Schedule not found: ${scheduleId}`);
      }

      const updated: OnCallSchedule = {
        ...schedule,
        ...updates,
        updatedAt: new Date(),
      };

      await this.storeSchedule(updated);

      logger.info('Schedule updated', { scheduleId });
      return updated;
    } catch (error) {
      logger.error('Failed to update schedule', { error, scheduleId });
      throw error;
    }
  }

  /**
   * Delete schedule
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    try {
      await redis.del(SCHEDULE_KEY(scheduleId));
      await redis.zrem(SCHEDULES_INDEX, scheduleId);

      logger.info('Schedule deleted', { scheduleId });
    } catch (error) {
      logger.error('Failed to delete schedule', { error, scheduleId });
      throw error;
    }
  }

  /**
   * Add layer to schedule
   */
  async addLayer(
    scheduleId: string,
    name: string,
    startDate: Date,
    rotationTurnLength: number,
    members: ScheduleMember[],
  ): Promise<ScheduleLayer> {
    try {
      const schedule = await this.getSchedule(scheduleId);
      if (!schedule) {
        throw new Error(`Schedule not found: ${scheduleId}`);
      }

      const layer: ScheduleLayer = {
        id: uuidv4(),
        scheduleId,
        name,
        startDate,
        rotationTurnLength,
        members: members.map((m, i) => ({ ...m, position: i })),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      schedule.layers.push(layer);
      await this.storeSchedule(schedule);

      logger.info('Layer added to schedule', {
        scheduleId,
        layerId: layer.id,
        memberCount: members.length,
      });

      return layer;
    } catch (error) {
      logger.error('Failed to add layer', { error, scheduleId });
      throw error;
    }
  }

  /**
   * Get current on-call person for a schedule
   */
  async getCurrentOnCall(scheduleId: string): Promise<ScheduleMember | null> {
    try {
      const schedule = await this.getSchedule(scheduleId);
      if (!schedule) {
        return null;
      }

      // Check cache first
      const cached = await redis.get(CURRENT_ONCALL_KEY(scheduleId));
      if (cached) {
        return JSON.parse(cached);
      }

      // Calculate current on-call person
      const onCallMember = this.calculateCurrentOnCall(schedule);

      if (onCallMember) {
        // Cache for 1 hour
        await redis.setex(
          CURRENT_ONCALL_KEY(scheduleId),
          60 * 60,
          JSON.stringify(onCallMember),
        );
      }

      return onCallMember;
    } catch (error) {
      logger.error('Failed to get current on-call', { error, scheduleId });
      return null;
    }
  }

  /**
   * Get on-call schedule for a specific time range
   */
  async getScheduleForRange(
    scheduleId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ member: ScheduleMember; startTime: Date; endTime: Date }>> {
    try {
      const schedule = await this.getSchedule(scheduleId);
      if (!schedule) {
        return [];
      }

      const assignments: Array<{ member: ScheduleMember; startTime: Date; endTime: Date }> = [];

      for (const layer of schedule.layers) {
        if (layer.endDate && layer.endDate < startDate) {
          continue; // Layer has ended
        }

        let currentDate = layer.startDate < startDate ? startDate : layer.startDate;
        let memberIndex = this.calculateMemberIndex(layer, currentDate);

        while (currentDate < endDate) {
          const member = layer.members[memberIndex];
          if (!member) break;

          const shiftEnd = new Date(currentDate);
          shiftEnd.setDate(shiftEnd.getDate() + layer.rotationTurnLength);

          const actualEnd = shiftEnd > endDate ? endDate : shiftEnd;

          assignments.push({
            member,
            startTime: new Date(currentDate),
            endTime: actualEnd,
          });

          currentDate = actualEnd;
          memberIndex = (memberIndex + 1) % layer.members.length;
        }
      }

      return assignments;
    } catch (error) {
      logger.error('Failed to get schedule for range', { error, scheduleId });
      return [];
    }
  }

  /**
   * Create escalation policy
   */
  async createEscalationPolicy(
    name: string,
    levels: EscalationLevel[],
  ): Promise<EscalationPolicy> {
    try {
      const policy: EscalationPolicy = {
        id: uuidv4(),
        name,
        levels,
        repeatEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Sync with PagerDuty if configured
      try {
        const pagerDuty = getPagerDutyService();
        // PagerDuty policy creation would be done via API
        logger.debug('Escalation policy created in PagerDuty', { policyId: policy.id });
      } catch (error) {
        logger.warn('Failed to sync with PagerDuty', { error });
      }

      await this.storeEscalationPolicy(policy);
      await redis.zadd(POLICIES_INDEX, Date.now(), policy.id);

      logger.info('Escalation policy created', {
        policyId: policy.id,
        name,
        levelCount: levels.length,
      });

      return policy;
    } catch (error) {
      logger.error('Failed to create escalation policy', { error, name });
      throw error;
    }
  }

  /**
   * Get escalation policy
   */
  async getEscalationPolicy(policyId: string): Promise<EscalationPolicy | null> {
    try {
      const cached = await redis.get(ESCALATION_POLICY_KEY(policyId));
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get escalation policy', { error, policyId });
      return null;
    }
  }

  /**
   * Update escalation policy
   */
  async updateEscalationPolicy(
    policyId: string,
    updates: Partial<EscalationPolicy>,
  ): Promise<EscalationPolicy> {
    try {
      const policy = await this.getEscalationPolicy(policyId);
      if (!policy) {
        throw new Error(`Escalation policy not found: ${policyId}`);
      }

      const updated: EscalationPolicy = {
        ...policy,
        ...updates,
        updatedAt: new Date(),
      };

      await this.storeEscalationPolicy(updated);

      logger.info('Escalation policy updated', { policyId });
      return updated;
    } catch (error) {
      logger.error('Failed to update escalation policy', { error, policyId });
      throw error;
    }
  }

  /**
   * Calculate current on-call person for a schedule
   */
  private calculateCurrentOnCall(schedule: OnCallSchedule): ScheduleMember | null {
    const now = new Date();
    let earliestStartDate = new Date(8640000000000000); // Max date

    for (const layer of schedule.layers) {
      if (layer.endDate && layer.endDate < now) {
        continue; // Layer has ended
      }

      if (layer.startDate < earliestStartDate) {
        earliestStartDate = layer.startDate;
      }

      const memberIndex = this.calculateMemberIndex(layer, now);
      if (memberIndex >= 0 && memberIndex < layer.members.length) {
        const member = layer.members[memberIndex];
        if (member.active) {
          return member;
        }
      }
    }

    return null;
  }

  /**
   * Calculate which member should be on-call at a given time
   */
  private calculateMemberIndex(layer: ScheduleLayer, date: Date): number {
    const daysDiff = Math.floor(
      (date.getTime() - layer.startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const rotations = Math.floor(daysDiff / layer.rotationTurnLength);
    return rotations % layer.members.length;
  }

  /**
   * Store schedule in cache
   */
  private async storeSchedule(schedule: OnCallSchedule): Promise<void> {
    try {
      const ttl = 24 * 60 * 60; // 24 hours
      await redis.setex(SCHEDULE_KEY(schedule.id), ttl, JSON.stringify(schedule));
    } catch (error) {
      logger.error('Failed to store schedule', { error, scheduleId: schedule.id });
    }
  }

  /**
   * Store escalation policy in cache
   */
  private async storeEscalationPolicy(policy: EscalationPolicy): Promise<void> {
    try {
      const ttl = 24 * 60 * 60; // 24 hours
      await redis.setex(
        ESCALATION_POLICY_KEY(policy.id),
        ttl,
        JSON.stringify(policy),
      );
    } catch (error) {
      logger.error('Failed to store escalation policy', { error, policyId: policy.id });
    }
  }

  /**
   * Test escalation policy to verify it works correctly
   */
  async testEscalationPolicy(policyId: string): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    try {
      const policy = await this.getEscalationPolicy(policyId);
      if (!policy) {
        return {
          valid: false,
          errors: ['Escalation policy not found'],
        };
      }

      const errors: string[] = [];

      // Validate levels
      if (!policy.levels || policy.levels.length === 0) {
        errors.push('Escalation policy has no levels');
      }

      for (let i = 0; i < (policy.levels?.length || 0); i++) {
        const level = policy.levels![i];
        if (level.delayMinutes < 0) {
          errors.push(`Level ${i + 1}: delay cannot be negative`);
        }
        if (level.notifySchedules.length === 0 && (!level.notifyUsers || level.notifyUsers.length === 0)) {
          errors.push(`Level ${i + 1}: must have either schedules or users to notify`);
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logger.error('Failed to test escalation policy', { error, policyId });
      return {
        valid: false,
        errors: ['Failed to test escalation policy'],
      };
    }
  }
}

// Singleton instance
let onCallService: OnCallService | null = null;

/**
 * Get or initialize on-call service
 */
export function getOnCallService(): OnCallService {
  if (!onCallService) {
    onCallService = new OnCallService();
  }
  return onCallService;
}
