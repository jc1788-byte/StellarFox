/**
 * Multi-RPC provider support with automatic failover, load balancing,
 * and provider health monitoring.
 */

import { rpc } from '@stellar/stellar-sdk';
import { logger } from './logger';

export interface RPCProvider {
  url: string;
  name: string;
  priority: number; // Lower is higher priority
  weight: number; // For weighted load balancing (0-1)
}

export interface ProviderHealth {
  url: string;
  name: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastCheckAt: Date;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
  responseTimeMs: number;
  totalRequests: number;
  failedRequests: number;
  lastHealthyAt?: Date;
}

export interface HealthCheckResult {
  url: string;
  isHealthy: boolean;
  responseTimeMs: number;
  error?: Error;
}

/**
 * Health check interval (5 seconds)
 */
const HEALTH_CHECK_INTERVAL_MS = 5 * 1000;

/**
 * Consecutive failures threshold for marking unhealthy (3 failures)
 */
const FAILURE_THRESHOLD = 3;

/**
 * Maximum response time considered healthy (5 seconds)
 */
const MAX_RESPONSE_TIME_MS = 5 * 1000;

export class MultiRPCProvider {
  private providers: Map<string, RPCProvider> = new Map();
  private health: Map<string, ProviderHealth> = new Map();
  private servers: Map<string, rpc.Server> = new Map();
  private lastChecked: Map<string, number> = new Map();
  private currentProviderIndex = 0;
  private healthCheckIntervalId?: NodeJS.Timeout;

  constructor(providers: RPCProvider[]) {
    // Initialize providers sorted by priority
    const sorted = [...providers].sort((a, b) => a.priority - b.priority);

    sorted.forEach((provider) => {
      this.providers.set(provider.url, provider);
      this.health.set(provider.url, {
        url: provider.url,
        name: provider.name,
        isHealthy: true,
        consecutiveFailures: 0,
        lastCheckAt: new Date(),
        responseTimeMs: 0,
        totalRequests: 0,
        failedRequests: 0,
      });
      this.servers.set(provider.url, new rpc.Server(provider.url));
    });

    logger.info(
      { providerCount: providers.length, providers: providers.map((p) => p.name) },
      'Multi-RPC provider initialized',
    );
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(): void {
    if (this.healthCheckIntervalId) {
      return;
    }

    this.healthCheckIntervalId = setInterval(
      () => this.runHealthChecks(),
      HEALTH_CHECK_INTERVAL_MS,
    );

    logger.info(
      { intervalMs: HEALTH_CHECK_INTERVAL_MS },
      'Health checks started',
    );

    // Run initial check immediately
    this.runHealthChecks();
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = undefined;
    }
    logger.info('Health checks stopped');
  }

  /**
   * Run health checks for all providers
   */
  private async runHealthChecks(): Promise<void> {
    const results = await Promise.all(
      Array.from(this.providers.values()).map((provider) =>
        this.checkProviderHealth(provider.url),
      ),
    );

    results.forEach((result) => {
      this.updateProviderHealth(result);
    });

    // Log summary
    const healthy = Array.from(this.health.values()).filter((h) => h.isHealthy).length;
    const total = this.health.size;

    logger.debug(
      { healthyProviders: healthy, totalProviders: total },
      'Health check completed',
    );
  }

  /**
   * Check health of a single provider
   */
  private async checkProviderHealth(url: string): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const server = this.servers.get(url);
      if (!server) {
        throw new Error('Server instance not found');
      }

      // Simple health check: get latest ledger
      await server.getLatestLedger();

      const responseTimeMs = Date.now() - startTime;

      return {
        url,
        isHealthy: responseTimeMs < MAX_RESPONSE_TIME_MS,
        responseTimeMs,
      };
    } catch (error) {
      return {
        url,
        isHealthy: false,
        responseTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Update provider health status
   */
  private updateProviderHealth(result: HealthCheckResult): void {
    const health = this.health.get(result.url);
    if (!health) return;

    const wasHealthy = health.isHealthy;

    if (result.isHealthy) {
      health.consecutiveFailures = 0;
      health.isHealthy = true;
      health.lastHealthyAt = new Date();
      health.responseTimeMs = result.responseTimeMs;
      health.totalRequests++;

      if (!wasHealthy) {
        logger.info(
          { provider: health.name, responseTimeMs: result.responseTimeMs },
          'Provider recovered',
        );
      }
    } else {
      health.consecutiveFailures++;
      health.lastErrorAt = new Date();
      health.lastErrorMessage = result.error?.message;
      health.failedRequests++;
      health.totalRequests++;

      if (health.consecutiveFailures >= FAILURE_THRESHOLD) {
        health.isHealthy = false;
        logger.warn(
          {
            provider: health.name,
            failures: health.consecutiveFailures,
            error: result.error?.message,
          },
          'Provider marked as unhealthy',
        );
      }
    }

    health.lastCheckAt = new Date();
  }

  /**
   * Get the next server using weighted round-robin load balancing
   */
  getServer(): rpc.Server {
    const healthyProviders = Array.from(this.providers.values())
      .filter((p) => this.health.get(p.url)?.isHealthy)
      .sort((a, b) => a.priority - b.priority);

    if (healthyProviders.length === 0) {
      logger.warn('No healthy providers, using primary provider');
      const primary = Array.from(this.providers.values())[0];
      return this.servers.get(primary.url)!;
    }

    // Weighted round-robin
    const totalWeight = healthyProviders.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;

    for (const provider of healthyProviders) {
      random -= provider.weight;
      if (random <= 0) {
        return this.servers.get(provider.url)!;
      }
    }

    // Fallback to first healthy provider
    return this.servers.get(healthyProviders[0].url)!;
  }

  /**
   * Execute a request with automatic failover and retry logic
   */
  async executeWithFailover<T>(
    request: (server: rpc.Server) => Promise<T>,
    maxRetries: number = 3,
  ): Promise<T> {
    let lastError: Error | null = null;
    const attemptedProviders = new Set<string>();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const server = this.getServer();
        const result = await request(server);

        // Find which provider was used (hacky but functional)
        const provider = Array.from(this.providers.values()).find(
          (p) => this.servers.get(p.url) === server,
        );

        if (provider && !attemptedProviders.has(provider.url)) {
          attemptedProviders.add(provider.url);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        logger.warn(
          {
            attempt,
            maxRetries,
            error: lastError.message,
          },
          'RPC request failed, retrying...',
        );

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt - 1) * 1000),
          );
        }
      }
    }

    throw lastError || new Error('All RPC providers failed');
  }

  /**
   * Manually mark a provider as healthy/unhealthy
   */
  setProviderHealth(url: string, isHealthy: boolean): void {
    const health = this.health.get(url);
    if (health) {
      health.isHealthy = isHealthy;
      health.consecutiveFailures = isHealthy ? 0 : FAILURE_THRESHOLD;
      health.lastCheckAt = new Date();

      logger.info(
        { provider: health.name, isHealthy },
        'Provider health status updated manually',
      );
    }
  }

  /**
   * Get health status of all providers
   */
  getAllHealth(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  /**
   * Get health status of a specific provider
   */
  getProviderHealth(url: string): ProviderHealth | undefined {
    return this.health.get(url);
  }

  /**
   * Get provider statistics
   */
  getStats(): {
    totalProviders: number;
    healthyProviders: number;
    failureRate: number;
    averageResponseTimeMs: number;
  } {
    const health = Array.from(this.health.values());
    const healthy = health.filter((h) => h.isHealthy).length;
    const totalRequests = health.reduce((sum, h) => sum + h.totalRequests, 0);
    const failedRequests = health.reduce((sum, h) => sum + h.failedRequests, 0);
    const avgResponseTime =
      health.reduce((sum, h) => sum + h.responseTimeMs, 0) / health.length;

    return {
      totalProviders: health.length,
      healthyProviders: healthy,
      failureRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
      averageResponseTimeMs: avgResponseTime,
    };
  }
}

export default MultiRPCProvider;
