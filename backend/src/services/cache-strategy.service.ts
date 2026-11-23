/**
 * Comprehensive Caching Strategy Service
 * 
 * Implements multiple caching patterns:
 * - Cache-aside (lazy loading)
 * - Write-through (synchronous updates)
 * - Write-behind (async updates with durability)
 * - Cache warming (preloading hot data)
 * - Intelligent invalidation with patterns
 */

import { redis } from '../config/redis';
import { pool } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Cache entry metadata for tracking age and usage
 */
interface CacheEntry<T> {
  data: T;
  createdAt: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * Caching configuration
 */
interface CacheConfig {
  ttl: number; // Time-to-live in seconds
  maxAge?: number; // Maximum age in seconds before forced refresh
  refreshThreshold?: number; // Access count threshold to trigger proactive refresh
}

/**
 * Cache-Aside Pattern: Lazy loading with fallback to source
 * Try cache first, fetch from source if miss, cache the result
 */
export async function cacheAside<T>(
  key: string,
  fetchFn: () => Promise<T>,
  config: CacheConfig,
): Promise<T> {
  try {
    // Try to get from cache
    const cached = await redis.get(key);
    if (cached) {
      logger.debug({ key }, 'Cache-aside HIT');
      
      // Track access and update stats
      const entry: CacheEntry<T> = JSON.parse(cached);
      entry.accessCount += 1;
      entry.lastAccessed = Date.now();
      
      // Proactive refresh if threshold exceeded
      if (config.refreshThreshold && entry.accessCount >= config.refreshThreshold) {
        logger.debug({ key }, 'Proactive cache refresh triggered');
        fetchFromSourceAndCache(key, fetchFn, config).catch(err => {
          logger.warn({ key, err }, 'Proactive refresh failed');
        });
      }
      
      return entry.data;
    }
  } catch (err) {
    logger.warn({ key, err }, 'Cache-aside GET failed, falling through to source');
  }

  // Cache miss - fetch from source
  logger.debug({ key }, 'Cache-aside MISS');
  const data = await fetchFn();
  
  // Update cache
  await fetchFromSourceAndCache(key, () => Promise.resolve(data), config).catch(err => {
    logger.warn({ key, err }, 'Cache-aside SET failed');
  });

  return data;
}

/**
 * Write-Through Pattern: Update source first, then cache
 * Ensures cache is always consistent with source
 */
export async function writeThrough<T>(
  key: string,
  updateFn: () => Promise<T>,
  config: CacheConfig,
): Promise<T> {
  try {
    // Update source first
    const result = await updateFn();
    
    // Then update cache
    const entry: CacheEntry<T> = {
      data: result,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };
    
    await redis.set(key, JSON.stringify(entry), 'EX', config.ttl);
    logger.debug({ key }, 'Write-through completed');
    
    return result;
  } catch (err) {
    logger.error({ key, err }, 'Write-through failed');
    throw err;
  }
}

/**
 * Write-Behind Pattern: Cache update first, queue source update
 * Fast writes with async durability - risky but high-performance
 */
export async function writeBehind<T>(
  key: string,
  data: T,
  updateFn: (data: T) => Promise<void>,
  config: CacheConfig,
): Promise<void> {
  try {
    // Update cache immediately
    const entry: CacheEntry<T> = {
      data,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };
    
    await redis.set(key, JSON.stringify(entry), 'EX', config.ttl);
    
    // Queue source update asynchronously
    const queueKey = `queue:${key}`;
    await redis.lpush(queueKey, JSON.stringify({ data, timestamp: Date.now() }));
    
    logger.debug({ key }, 'Write-behind queued');
    
    // Fire-and-forget the actual update
    updateFn(data).catch(err => {
      logger.error({ key, err }, 'Write-behind source update failed');
    });
  } catch (err) {
    logger.error({ key, err }, 'Write-behind cache update failed');
    throw err;
  }
}

/**
 * Cache Warming: Preload hot data into cache
 * Reduces cold-start latency by proactively loading frequently accessed data
 */
export async function warmCache(
  patterns: Array<{
    key: string;
    fetchFn: () => Promise<unknown>;
    ttl: number;
  }>,
): Promise<void> {
  logger.info(`Cache warming started for ${patterns.length} patterns`);
  
  const results = await Promise.allSettled(
    patterns.map(async (pattern) => {
      try {
        const data = await pattern.fetchFn();
        await redis.set(pattern.key, JSON.stringify(data), 'EX', pattern.ttl);
        logger.debug({ key: pattern.key }, 'Cache warmed');
      } catch (err) {
        logger.warn({ key: pattern.key, err }, 'Cache warming failed');
      }
    }),
  );
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  logger.info(`Cache warming completed: ${successful}/${patterns.length} successful`);
}

/**
 * Intelligent Cache Invalidation
 * Invalidate related cache entries when source data changes
 */
export async function invalidateWithPattern(pattern: string): Promise<number> {
  try {
    const keys: string[] = [];
    let cursor = '0';
    
    // Scan for matching keys
    do {
      const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) {
      logger.debug({ pattern }, 'No cache entries to invalidate');
      return 0;
    }

    // Batch delete
    await redis.del(...keys);
    logger.info({ pattern, count: keys.length }, 'Cache invalidated');
    
    return keys.length;
  } catch (err) {
    logger.error({ pattern, err }, 'Cache invalidation failed');
    return 0;
  }
}

/**
 * Smart invalidation triggered by data changes
 * Call this when updating data to cascade invalidation
 */
export async function smartInvalidate(
  namespace: string,
  id?: string,
  relatedPatterns: string[] = [],
): Promise<void> {
  const patterns = id 
    ? [`${namespace}:${id}:*`, `${namespace}:list:*`, ...relatedPatterns]
    : [`${namespace}:*`, ...relatedPatterns];
  
  for (const pattern of patterns) {
    await invalidateWithPattern(pattern);
  }
}

/**
 * Distributed Cache Lock for preventing thundering herd
 * Ensures only one process updates cache for expensive operations
 */
export async function withCacheLock<T>(
  key: string,
  lockTtl: number,
  computeFn: () => Promise<T>,
): Promise<T> {
  const lockKey = `lock:${key}`;
  const lockValue = `${Date.now()}-${Math.random()}`;
  
  try {
    // Try to acquire lock (atomic operation)
    const acquired = await redis.set(
      lockKey,
      lockValue,
      'NX', // Only set if not exists
      'EX',
      lockTtl,
    );

    if (!acquired) {
      logger.debug({ key }, 'Cache lock not acquired, waiting...');
      
      // Wait for other process to update cache
      let retries = 0;
      while (retries < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const result = await redis.get(key);
        if (result) {
          return JSON.parse(result) as T;
        }
        retries++;
      }
      
      throw new Error(`Cache lock timeout for ${key}`);
    }

    // Lock acquired - compute value
    logger.debug({ key }, 'Cache lock acquired');
    const result = await computeFn();
    
    return result;
  } finally {
    // Always release lock
    const currentValue = await redis.get(lockKey);
    if (currentValue === lockValue) {
      await redis.del(lockKey);
      logger.debug({ key }, 'Cache lock released');
    }
  }
}

/**
 * Multi-tier caching: Check memory cache first, then Redis, then source
 */
export class TieredCache<T> {
  private memoryCache = new Map<string, T>();
  private memoryTtl: number;

  constructor(
    private redisKey: string,
    private fetchFn: () => Promise<T>,
    private config: CacheConfig,
    memoryTtl: number = 60, // Memory cache for 60 seconds
  ) {
    this.memoryTtl = memoryTtl;
  }

  async get(): Promise<T> {
    // Level 1: Memory cache
    if (this.memoryCache.has(this.redisKey)) {
      logger.debug({ key: this.redisKey }, 'Memory cache HIT');
      return this.memoryCache.get(this.redisKey)!;
    }

    // Level 2: Redis cache
    try {
      const cached = await redis.get(this.redisKey);
      if (cached) {
        const data = JSON.parse(cached) as T;
        this.memoryCache.set(this.redisKey, data);
        logger.debug({ key: this.redisKey }, 'Redis cache HIT');
        return data;
      }
    } catch (err) {
      logger.warn({ key: this.redisKey, err }, 'Redis cache miss');
    }

    // Level 3: Source
    logger.debug({ key: this.redisKey }, 'Cache MISS, fetching from source');
    const data = await this.fetchFn();
    
    // Populate caches
    this.memoryCache.set(this.redisKey, data);
    await redis.set(this.redisKey, JSON.stringify(data), 'EX', this.config.ttl).catch(err => {
      logger.warn({ key: this.redisKey, err }, 'Redis set failed');
    });

    return data;
  }

  invalidate(): void {
    this.memoryCache.delete(this.redisKey);
    redis.del(this.redisKey).catch(err => {
      logger.warn({ key: this.redisKey, err }, 'Redis invalidation failed');
    });
  }
}

/**
 * Helper to fetch and cache in single operation
 */
async function fetchFromSourceAndCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  config: CacheConfig,
): Promise<T> {
  const data = await fetchFn();
  const entry: CacheEntry<T> = {
    data,
    createdAt: Date.now(),
    accessCount: 0,
    lastAccessed: Date.now(),
  };
  
  await redis.set(key, JSON.stringify(entry), 'EX', config.ttl);
  return data;
}

/**
 * Cache Statistics and Monitoring
 */
export async function getCacheStats(): Promise<{
  memoryUsage: string;
  keyCount: number;
  hitRate: number;
}> {
  try {
    const info = await redis.info('memory');
    const stats = await redis.info('stats');
    
    const memoryUsage = info.split('\r\n').find(l => l.startsWith('used_memory_human'))?.split(':')[1] || 'unknown';
    const dbSize = await redis.dbsize();
    
    const hits = parseInt(
      stats.split('\r\n').find(l => l.startsWith('keyspace_hits'))?.split(':')[1] || '0',
    );
    const misses = parseInt(
      stats.split('\r\n').find(l => l.startsWith('keyspace_misses'))?.split(':')[1] || '0',
    );
    
    const hitRate = hits + misses > 0 ? hits / (hits + misses) : 0;

    return {
      memoryUsage,
      keyCount: dbSize,
      hitRate,
    };
  } catch (err) {
    logger.warn({ err }, 'Could not get cache stats');
    return { memoryUsage: 'unknown', keyCount: 0, hitRate: 0 };
  }
}
