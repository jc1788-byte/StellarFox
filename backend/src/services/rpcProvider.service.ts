/**
 * RPC Provider Management Service
 * 
 * Manages multiple RPC providers with:
 * - Automatic health monitoring and failover
 * - Load balancing with weighted distribution
 * - Priority-based provider selection
 * - Detailed health metrics and diagnostics
 */

import { rpc } from '@stellar/stellar-sdk';
import { pool } from '../config/db';
import { logger } from '../utils/logger';

export interface RpcProvider {
  url: string;
  name: string;
  priority: number;
  weight: number;
  isHealthy: boolean;
}

export interface RpcProviderHealth {
  id: number;
  provider_url: string;
  provider_name: string;
  is_healthy: boolean;
  consecutive_failures: number;
  last_check_at: string;
  last_error_at?: string;
  last_error_message?: string;
  response_time_ms?: number;
  total_requests: number;
  failed_requests: number;
  last_healthy_at?: string;
  priority: number;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderMetrics {
  totalProviders: number;
  healthyProviders: number;
  failedProviders: number;
  successRate: number;
  averageResponseTimeMs: number;
  providers: RpcProviderHealth[];
}

const HEALTH_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
const FAILURE_THRESHOLD = 3; // Mark unhealthy after 3 consecutive failures
const RECOVERY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Try to recover every 5 minutes

/**
 * Initialize RPC providers from environment variables
 * Format: RPC_PROVIDERS=url1:name1:priority1:weight1,url2:name2:priority2:weight2
 * Or use individual RPC_PROVIDER_* env vars
 */
export async function initializeProviders(): Promise<void> {
  try {
    // Clear existing providers
    await pool.query('DELETE FROM rpc_provider_health');

    const providerConfigs = parseProviderConfigs();

    for (const config of providerConfigs) {
      await pool.query(
        `INSERT INTO rpc_provider_health
           (provider_url, provider_name, is_healthy, priority, weight)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          config.url,
          config.name,
          true,
          config.priority,
          config.weight,
        ]
      );

      logger.info(
        { url: config.url, name: config.name, priority: config.priority },
        'RPC provider registered'
      );
    }

    // Start health monitoring
    startHealthMonitoring();
  } catch (err) {
    logger.error({ err }, 'Failed to initialize RPC providers');
    throw err;
  }
}

/**
 * Parse provider configurations from environment
 */
function parseProviderConfigs(): RpcProvider[] {
  const providers: RpcProvider[] = [];

  // Try to parse RPC_PROVIDERS env var
  const providersEnv = process.env.RPC_PROVIDERS;
  if (providersEnv) {
    const entries = providersEnv.split(',');
    for (const entry of entries) {
      const [url, name = 'provider', priority = '0', weight = '1'] = entry.split(':');
      if (url) {
        providers.push({
          url: url.trim(),
          name: name.trim(),
          priority: parseInt(priority, 10) || 0,
          weight: parseFloat(weight) || 1,
          isHealthy: true,
        });
      }
    }
  }

  // If no providers configured, fall back to STELLAR_RPC_URL
  if (providers.length === 0) {
    const rpcUrl = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
    providers.push({
      url: rpcUrl,
      name: 'default',
      priority: 0,
      weight: 1,
      isHealthy: true,
    });
  }

  return providers;
}

/**
 * Get the best available RPC provider (considering health and load)
 */
export async function getProvider(): Promise<RpcProvider> {
  try {
    // Get all healthy providers, sorted by priority (ascending) then by weight (descending)
    const { rows } = await pool.query(
      `SELECT provider_url, provider_name, priority, weight, is_healthy
       FROM rpc_provider_health
       WHERE is_healthy = true
       ORDER BY priority ASC, weight DESC
       LIMIT 1`
    );

    if (rows.length > 0) {
      const provider = rows[0];
      return {
        url: provider.provider_url,
        name: provider.provider_name,
        priority: provider.priority,
        weight: provider.weight,
        isHealthy: provider.is_healthy,
      };
    }

    // If no healthy providers, fall back to the one with lowest priority
    logger.warn('No healthy RPC providers available, using fallback');
    const { rows: fallback } = await pool.query(
      `SELECT provider_url, provider_name, priority, weight, is_healthy
       FROM rpc_provider_health
       ORDER BY priority ASC
       LIMIT 1`
    );

    if (fallback.length > 0) {
      const provider = fallback[0];
      return {
        url: provider.provider_url,
        name: provider.provider_name,
        priority: provider.priority,
        weight: provider.weight,
        isHealthy: provider.is_healthy,
      };
    }

    throw new Error('No RPC providers configured');
  } catch (err) {
    logger.error({ err }, 'Failed to get RPC provider');
    throw err;
  }
}

/**
 * Record a successful RPC call
 */
export async function recordSuccess(
  providerUrl: string,
  responseTimeMs: number
): Promise<void> {
  try {
    await pool.query(
      `UPDATE rpc_provider_health
       SET total_requests = total_requests + 1,
           response_time_ms = $1,
           last_check_at = NOW(),
           consecutive_failures = 0,
           last_healthy_at = NOW(),
           is_healthy = true,
           updated_at = NOW()
       WHERE provider_url = $2`,
      [responseTimeMs, providerUrl]
    );
  } catch (err) {
    logger.error({ providerUrl, err }, 'Failed to record RPC success');
  }
}

/**
 * Record a failed RPC call
 */
export async function recordFailure(
  providerUrl: string,
  error: Error | string
): Promise<void> {
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const { rows } = await pool.query(
      `SELECT consecutive_failures FROM rpc_provider_health WHERE provider_url = $1`,
      [providerUrl]
    );

    if (rows.length === 0) {
      logger.warn({ providerUrl }, 'RPC provider not found');
      return;
    }

    const consecutiveFailures = (rows[0].consecutive_failures || 0) + 1;
    const shouldMarkUnhealthy = consecutiveFailures >= FAILURE_THRESHOLD;

    await pool.query(
      `UPDATE rpc_provider_health
       SET total_requests = total_requests + 1,
           failed_requests = failed_requests + 1,
           consecutive_failures = $1,
           last_check_at = NOW(),
           last_error_at = NOW(),
           last_error_message = $2,
           is_healthy = $3,
           updated_at = NOW()
       WHERE provider_url = $4`,
      [consecutiveFailures, errorMessage, !shouldMarkUnhealthy, providerUrl]
    );

    if (shouldMarkUnhealthy) {
      logger.warn(
        { providerUrl, consecutiveFailures, errorMessage },
        'RPC provider marked as unhealthy'
      );
    }
  } catch (err) {
    logger.error({ providerUrl, err }, 'Failed to record RPC failure');
  }
}

/**
 * Get current provider metrics
 */
export async function getMetrics(): Promise<ProviderMetrics> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM rpc_provider_health ORDER BY priority ASC, weight DESC`
    );

    const providers = rows as RpcProviderHealth[];
    const healthyCount = providers.filter((p) => p.is_healthy).length;
    const totalRequests = providers.reduce((sum, p) => sum + Number(p.total_requests), 0);
    const failedRequests = providers.reduce((sum, p) => sum + Number(p.failed_requests), 0);
    const successRate = totalRequests > 0 ? ((totalRequests - failedRequests) / totalRequests) * 100 : 100;
    const avgResponseTime = providers.reduce((sum, p) => sum + (p.response_time_ms || 0), 0) / providers.length;

    return {
      totalProviders: providers.length,
      healthyProviders: healthyCount,
      failedProviders: providers.length - healthyCount,
      successRate: Math.round(successRate * 100) / 100,
      averageResponseTimeMs: Math.round(avgResponseTime),
      providers,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get RPC metrics');
    throw err;
  }
}

/**
 * Start health monitoring loop
 */
let healthMonitoringRunning = false;

function startHealthMonitoring(): void {
  if (healthMonitoringRunning) return;
  healthMonitoringRunning = true;

  const checkInterval = setInterval(async () => {
    try {
      await performHealthCheck();
    } catch (err) {
      logger.error({ err }, 'Health check failed');
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // Cleanup on exit
  process.on('exit', () => clearInterval(checkInterval));
}

/**
 * Perform health check on all providers
 */
export async function performHealthCheck(): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT provider_url, provider_name FROM rpc_provider_health`
    );

    for (const row of rows) {
      const startTime = Date.now();
      try {
        const server = new rpc.Server(row.provider_url);
        await server.getLatestLedger();
        const responseTime = Date.now() - startTime;

        await recordSuccess(row.provider_url, responseTime);
      } catch (err) {
        await recordFailure(row.provider_url, err as Error);
      }
    }
  } catch (err) {
    logger.error({ err }, 'RPC health check error');
  }
}

/**
 * Create a wrapper around RPC calls that handles failover
 */
export async function executeWithFailover<T>(
  operation: (provider: RpcProvider) => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const provider = await getProvider();
      const startTime = Date.now();

      try {
        const result = await operation(provider);
        await recordSuccess(provider.url, Date.now() - startTime);
        return result;
      } catch (err) {
        const responseTime = Date.now() - startTime;
        await recordFailure(provider.url, err as Error);

        // Mark as failed so next attempt uses different provider
        lastError = err as Error;

        // Wait a bit before retry
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError || new Error('All RPC providers failed');
}

/**
 * Get health status of a specific provider
 */
export async function getProviderHealth(providerUrl: string): Promise<RpcProviderHealth | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM rpc_provider_health WHERE provider_url = $1`,
      [providerUrl]
    );
    return rows[0] as RpcProviderHealth | undefined || null;
  } catch (err) {
    logger.error({ providerUrl, err }, 'Failed to get provider health');
    throw err;
  }
}

/**
 * Update provider priority and weight
 */
export async function updateProvider(
  providerUrl: string,
  updates: { priority?: number; weight?: number }
): Promise<void> {
  try {
    const { priority, weight } = updates;
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (priority !== undefined) {
      setClauses.push(`priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }

    if (weight !== undefined) {
      setClauses.push(`weight = $${paramIndex}`);
      params.push(weight);
      paramIndex++;
    }

    setClauses.push('updated_at = NOW()');
    params.push(providerUrl);

    if (setClauses.length > 1) {
      await pool.query(
        `UPDATE rpc_provider_health
         SET ${setClauses.join(', ')}
         WHERE provider_url = $${paramIndex}`,
        params
      );

      logger.info({ providerUrl, updates }, 'RPC provider updated');
    }
  } catch (err) {
    logger.error({ providerUrl, err }, 'Failed to update provider');
    throw err;
  }
}

/**
 * Add a new RPC provider
 */
export async function addProvider(
  url: string,
  name: string,
  priority: number = 0,
  weight: number = 1
): Promise<void> {
  try {
    // Verify the provider is reachable
    const startTime = Date.now();
    const server = new rpc.Server(url);
    await server.getLatestLedger();
    const responseTime = Date.now() - startTime;

    await pool.query(
      `INSERT INTO rpc_provider_health
         (provider_url, provider_name, is_healthy, priority, weight, total_requests, response_time_ms)
       VALUES ($1, $2, true, $3, $4, 1, $5)
       ON CONFLICT (provider_url) DO UPDATE
         SET provider_name = EXCLUDED.provider_name,
             priority = EXCLUDED.priority,
             weight = EXCLUDED.weight,
             is_healthy = true,
             updated_at = NOW()`,
      [url, name, priority, weight, responseTime]
    );

    logger.info({ url, name, priority, weight }, 'RPC provider added');
  } catch (err) {
    logger.error({ url, err }, 'Failed to add RPC provider');
    throw err;
  }
}

/**
 * Remove an RPC provider
 */
export async function removeProvider(providerUrl: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM rpc_provider_health WHERE provider_url = $1`,
      [providerUrl]
    );

    logger.info({ providerUrl }, 'RPC provider removed');
  } catch (err) {
    logger.error({ providerUrl, err }, 'Failed to remove RPC provider');
    throw err;
  }
}
