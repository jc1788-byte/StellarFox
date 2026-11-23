/**
 * PagerDuty Integration Service
 * Handles all interactions with PagerDuty API for incident management
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import {
  PagerDutyConfig,
  PagerDutyEvent,
  PagerDutyEventAction,
  PagerDutyIncident,
} from '../types/alerting.types';

const PAGERDUTY_API_BASE = 'https://api.pagerduty.com';
const PAGERDUTY_EVENTS_API = 'https://events.pagerduty.com/v2/enqueue';

export class PagerDutyService {
  private apiClient: AxiosInstance;
  private eventsClient: AxiosInstance;
  private config: PagerDutyConfig;

  constructor(config: PagerDutyConfig) {
    this.config = config;

    // Main API client for REST endpoints
    this.apiClient = axios.create({
      baseURL: PAGERDUTY_API_BASE,
      headers: {
        Authorization: `Token token=${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.pagerduty+json;version=2',
      },
      timeout: 10000,
    });

    // Events API client for event ingestion
    this.eventsClient = axios.create({
      baseURL: PAGERDUTY_EVENTS_API,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    this.setupErrorHandling();
  }

  /**
   * Setup error handling for API clients
   */
  private setupErrorHandling(): void {
    this.apiClient.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          logger.error('PagerDuty API error', {
            status: error.response.status,
            data: error.response.data,
          });
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * Trigger a new incident in PagerDuty using Events API v2
   */
  async triggerIncident(
    title: string,
    description: string,
    severity: 'critical' | 'error' | 'warning' | 'info',
    dedupKey?: string,
    details?: Record<string, any>,
  ): Promise<{ eventId: string; dedup_key: string }> {
    try {
      if (!this.config.integrationKey) {
        throw new Error('PagerDuty integration key is not configured');
      }

      const event: PagerDutyEvent = {
        routing_key: this.config.integrationKey,
        event_action: PagerDutyEventAction.TRIGGER,
        dedup_key: dedupKey || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        payload: {
          summary: title,
          severity,
          source: 'StellarFox-Monitoring',
          timestamp: new Date().toISOString(),
          custom_details: {
            description,
            ...details,
          },
        },
        client: 'StellarFox',
        client_url: process.env.DASHBOARD_URL || 'https://app.stellarfox.dev',
      };

      const response = await this.eventsClient.post('/', event);

      logger.info('Incident triggered in PagerDuty', {
        eventId: response.data.id,
        dedupKey: response.data.dedup_key,
      });

      return {
        eventId: response.data.id,
        dedup_key: response.data.dedup_key,
      };
    } catch (error) {
      logger.error('Failed to trigger PagerDuty incident', { error });
      throw error;
    }
  }

  /**
   * Acknowledge an incident
   */
  async acknowledgeIncident(
    dedupKey: string,
    acknowlegedBy?: string,
  ): Promise<{ eventId: string; dedup_key: string }> {
    try {
      if (!this.config.integrationKey) {
        throw new Error('PagerDuty integration key is not configured');
      }

      const event: PagerDutyEvent = {
        routing_key: this.config.integrationKey,
        event_action: PagerDutyEventAction.ACKNOWLEDGE,
        dedup_key: dedupKey,
        payload: {
          summary: `Incident acknowledged${acknowlegedBy ? ` by ${acknowlegedBy}` : ''}`,
          severity: 'info',
          source: 'StellarFox-Monitoring',
        },
      };

      const response = await this.eventsClient.post('/', event);

      logger.info('Incident acknowledged in PagerDuty', {
        dedupKey,
        eventId: response.data.id,
      });

      return {
        eventId: response.data.id,
        dedup_key: response.data.dedup_key,
      };
    } catch (error) {
      logger.error('Failed to acknowledge PagerDuty incident', { error, dedupKey });
      throw error;
    }
  }

  /**
   * Resolve an incident
   */
  async resolveIncident(
    dedupKey: string,
    resolvedBy?: string,
  ): Promise<{ eventId: string; dedup_key: string }> {
    try {
      if (!this.config.integrationKey) {
        throw new Error('PagerDuty integration key is not configured');
      }

      const event: PagerDutyEvent = {
        routing_key: this.config.integrationKey,
        event_action: PagerDutyEventAction.RESOLVE,
        dedup_key: dedupKey,
        payload: {
          summary: `Incident resolved${resolvedBy ? ` by ${resolvedBy}` : ''}`,
          severity: 'info',
          source: 'StellarFox-Monitoring',
        },
      };

      const response = await this.eventsClient.post('/', event);

      logger.info('Incident resolved in PagerDuty', {
        dedupKey,
        eventId: response.data.id,
      });

      return {
        eventId: response.data.id,
        dedup_key: response.data.dedup_key,
      };
    } catch (error) {
      logger.error('Failed to resolve PagerDuty incident', { error, dedupKey });
      throw error;
    }
  }

  /**
   * Get incident details from PagerDuty
   */
  async getIncident(incidentId: string): Promise<PagerDutyIncident> {
    try {
      const response = await this.apiClient.get(`/incidents/${incidentId}`);
      return response.data.incident;
    } catch (error) {
      logger.error('Failed to fetch incident from PagerDuty', { error, incidentId });
      throw error;
    }
  }

  /**
   * List incidents with optional filters
   */
  async listIncidents(
    filters?: {
      statuses?: string[];
      serviceIds?: string[];
      teamIds?: string[];
      urgencies?: string[];
      limit?: number;
      offset?: number;
    },
  ): Promise<{ incidents: PagerDutyIncident[]; limit: number; offset: number; total: number }> {
    try {
      const params: Record<string, any> = {
        limit: filters?.limit || 25,
        offset: filters?.offset || 0,
      };

      if (filters?.statuses) {
        params.statuses = filters.statuses.join(',');
      }
      if (filters?.serviceIds) {
        params.service_ids = filters.serviceIds.join(',');
      }
      if (filters?.teamIds) {
        params.team_ids = filters.teamIds.join(',');
      }
      if (filters?.urgencies) {
        params.urgencies = filters.urgencies.join(',');
      }

      const response = await this.apiClient.get('/incidents', { params });

      return {
        incidents: response.data.incidents,
        limit: response.data.limit,
        offset: response.data.offset,
        total: response.data.total,
      };
    } catch (error) {
      logger.error('Failed to list incidents from PagerDuty', { error });
      throw error;
    }
  }

  /**
   * Get on-call users for a service
   */
  async getOnCallUsers(serviceId: string): Promise<Array<{ id: string; email: string; name: string }>> {
    try {
      const response = await this.apiClient.get(`/services/${serviceId}/integrations`, {
        params: {
          include: 'schedule',
        },
      });

      // Get schedule ID from integrations
      const scheduleId = response.data.integrations?.[0]?.schedule?.id;
      if (!scheduleId) {
        logger.warn('No schedule found for service', { serviceId });
        return [];
      }

      // Get on-call users from schedule
      const scheduleResponse = await this.apiClient.get(`/schedules/${scheduleId}/users`, {
        params: {
          'include[]': 'contact_methods',
        },
      });

      return scheduleResponse.data.users.map((user: any) => ({
        id: user.id,
        email: user.email,
        name: user.name,
      }));
    } catch (error) {
      logger.error('Failed to get on-call users', { error, serviceId });
      throw error;
    }
  }

  /**
   * Get escalation policy details
   */
  async getEscalationPolicy(policyId: string): Promise<any> {
    try {
      const response = await this.apiClient.get(`/escalation_policies/${policyId}`, {
        params: {
          'include[]': 'escalation_rules',
        },
      });

      return response.data.escalation_policy;
    } catch (error) {
      logger.error('Failed to fetch escalation policy', { error, policyId });
      throw error;
    }
  }

  /**
   * Update incident with custom details
   */
  async updateIncident(incidentId: string, updates: Record<string, any>): Promise<PagerDutyIncident> {
    try {
      const response = await this.apiClient.put(`/incidents/${incidentId}`, {
        incident: updates,
      });

      return response.data.incident;
    } catch (error) {
      logger.error('Failed to update incident', { error, incidentId });
      throw error;
    }
  }

  /**
   * Create a maintenance window
   */
  async createMaintenanceWindow(
    serviceIds: string[],
    startTime: Date,
    endTime: Date,
    description: string,
  ): Promise<any> {
    try {
      const response = await this.apiClient.post('/maintenance_windows', {
        maintenance_window: {
          type: 'maintenance_window',
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          description,
          services: serviceIds.map((id) => ({
            id,
            type: 'service_reference',
          })),
        },
      });

      logger.info('Maintenance window created', {
        id: response.data.maintenance_window.id,
      });

      return response.data.maintenance_window;
    } catch (error) {
      logger.error('Failed to create maintenance window', { error });
      throw error;
    }
  }

  /**
   * Check if PagerDuty integration is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.config.enabled || !this.config.apiKey) {
        return false;
      }

      await this.apiClient.get('/users', { params: { limit: 1 } });
      return true;
    } catch (error) {
      logger.warn('PagerDuty health check failed', { error });
      return false;
    }
  }
}

// Singleton instance
let pagerDutyService: PagerDutyService | null = null;

/**
 * Get or initialize PagerDuty service
 */
export function getPagerDutyService(config?: PagerDutyConfig): PagerDutyService {
  if (!pagerDutyService && config) {
    pagerDutyService = new PagerDutyService(config);
  } else if (!pagerDutyService) {
    throw new Error('PagerDuty service not initialized');
  }
  return pagerDutyService;
}

/**
 * Initialize PagerDuty service
 */
export function initPagerDutyService(config: PagerDutyConfig): PagerDutyService {
  pagerDutyService = new PagerDutyService(config);
  return pagerDutyService;
}
