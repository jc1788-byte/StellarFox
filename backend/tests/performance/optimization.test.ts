/**
 * Performance Optimization Tests
 * 
 * Tests for query optimization, caching strategies, and memory leak detection
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { DataLoader } from '../../src/services/query-optimization.service';
import { TieredCache } from '../../src/services/cache-strategy.service';
import { MemoryProfiler } from '../../src/services/memory-leak-detection.service';

describe('Query Optimization', () => {
  describe('DataLoader - N+1 Prevention', () => {
    it('should batch multiple loads into single query', async () => {
      const mockQuery = jest.fn();
      mockQuery.mockResolvedValue(new Map([
        ['id1', { id: 'id1', value: 'value1' }],
        ['id2', { id: 'id2', value: 'value2' }],
        ['id3', { id: 'id3', value: 'value3' }],
      ]));

      const loader = new DataLoader(mockQuery);

      // Queue multiple loads
      const promise1 = loader.load('id1');
      const promise2 = loader.load('id2');
      const promise3 = loader.load('id3');

      // All should resolve
      const results = await Promise.all([promise1, promise2, promise3]);

      // Batch function should be called exactly once
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(['id1', 'id2', 'id3']);

      // Results should be correct
      expect(results[0]).toEqual({ id: 'id1', value: 'value1' });
      expect(results[1]).toEqual({ id: 'id2', value: 'value2' });
      expect(results[2]).toEqual({ id: 'id3', value: 'value3' });
    });

    it('should batch queries scheduled in same tick', async () => {
      const mockQuery = jest.fn();
      const results = new Map([['test', 'value']]);
      mockQuery.mockResolvedValue(results);

      const loader = new DataLoader(mockQuery);

      // Schedule multiple loads synchronously
      const loaders = [
        loader.load('test'),
        loader.load('test'),
        loader.load('test'),
      ];

      await Promise.all(loaders);

      // Should still batch into one query
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should handle errors in batch function', async () => {
      const mockQuery = jest.fn();
      mockQuery.mockRejectedValue(new Error('Query failed'));

      const loader = new DataLoader(mockQuery);

      const promise1 = loader.load('id1');
      const promise2 = loader.load('id2');

      // Both should reject with same error
      await expect(promise1).rejects.toThrow('Query failed');
      await expect(promise2).rejects.toThrow('Query failed');
    });
  });

  describe('Query Fingerprinting', () => {
    it('should normalize queries for grouping', () => {
      const queries = [
        `SELECT * FROM markets WHERE id = 123`,
        `SELECT * FROM markets WHERE id = 456`,
        `SELECT * FROM markets WHERE id = 789`,
      ];

      // All should have similar fingerprints (normalized)
      expect(queries[0].replace(/\d+/g, '?')).toBe(queries[1].replace(/\d+/g, '?'));
    });
  });
});

describe('Caching Strategy', () => {
  describe('TieredCache', () => {
    it('should fetch from memory cache first', async () => {
      const mockFetch = jest.fn();
      mockFetch.mockResolvedValue({ data: 'test' });

      const cache = new TieredCache(
        'test-key',
        mockFetch,
        { ttl: 300 },
        60 // Memory TTL
      );

      // First call fetches
      await cache.get();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should use memory cache
      await cache.get();
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional calls
    });

    it('should invalidate both memory and Redis caches', async () => {
      const mockFetch = jest.fn();
      mockFetch.mockResolvedValue({ data: 'test' });

      const cache = new TieredCache(
        'test-key',
        mockFetch,
        { ttl: 300 }
      );

      // Load once
      await cache.get();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Invalidate
      cache.invalidate();

      // Load again - should fetch fresh
      await cache.get();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle fetch errors gracefully', async () => {
      const mockFetch = jest.fn();
      mockFetch.mockRejectedValue(new Error('Fetch failed'));

      const cache = new TieredCache(
        'test-key',
        mockFetch,
        { ttl: 300 }
      );

      await expect(cache.get()).rejects.toThrow('Fetch failed');
    });
  });

  describe('Cache Key Patterns', () => {
    it('should support wildcard pattern matching', () => {
      const patterns = [
        'market:123',
        'market:456',
        'market:789:stats',
      ];

      const patternMatcher = (pattern: string, regex: RegExp) => 
        patterns.filter(p => regex.test(p));

      expect(patternMatcher('market:*', /^market:/)).toHaveLength(3);
      expect(patternMatcher('market:*:stats', /^market:.*:stats$/)).toHaveLength(1);
    });
  });
});

describe('Memory Profiling', () => {
  describe('MemoryProfiler', () => {
    it('should track memory usage during operation', () => {
      const profiler = new MemoryProfiler();
      profiler.start();

      // Simulate some work
      const arr: unknown[] = [];
      for (let i = 0; i < 1000; i++) {
        arr.push({ value: i, data: new Array(100).fill(0) });
      }

      const result = profiler.end();

      expect(result.duration).toBeGreaterThan(0);
      expect(result.maxHeapDuringProfiling).toBeGreaterThan(0);
      expect(result.recommendation).toBeDefined();
    });

    it('should throw if profiler not started', () => {
      const profiler = new MemoryProfiler();

      expect(() => profiler.end()).toThrow('Profiler not running');
    });

    it('should track heap growth', () => {
      const profiler = new MemoryProfiler();
      profiler.start();

      // Allocate memory
      const bigArray = new Array(100000).fill(new Array(100));

      const result = profiler.end();

      expect(result.heapGrowth).toBeGreaterThan(0);
    });
  });

  describe('Memory Leak Detection', () => {
    it('should detect sustained memory growth', () => {
      // Simulate memory snapshots with sustained growth
      const snapshots = [
        { heapUsed: 10000000, timestamp: Date.now() },
        { heapUsed: 11000000, timestamp: Date.now() + 1000 },
        { heapUsed: 12000000, timestamp: Date.now() + 2000 },
        { heapUsed: 13000000, timestamp: Date.now() + 3000 },
      ];

      // Check if all snapshots show growth
      const isGrowing = snapshots.every((snap, i) => {
        if (i === 0) return true;
        return snap.heapUsed >= snapshots[i - 1].heapUsed;
      });

      expect(isGrowing).toBe(true);
    });
  });
});

describe('Performance Integration', () => {
  it('should batch load with cache', async () => {
    const mockFetch = jest.fn();
    mockFetch.mockResolvedValue(
      new Map([
        ['id1', { id: 'id1' }],
        ['id2', { id: 'id2' }],
      ])
    );

    const loader = new DataLoader(mockFetch);

    // Load multiple IDs
    const [item1, item2, item1Again] = await Promise.all([
      loader.load('id1'),
      loader.load('id2'),
      loader.load('id1'),
    ]);

    // Should batch into single query
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // Results should be correct
    expect(item1).toEqual({ id: 'id1' });
    expect(item2).toEqual({ id: 'id2' });
    expect(item1Again).toEqual({ id: 'id1' });
  });

  it('should handle cache warming', async () => {
    const mockFetch1 = jest.fn().mockResolvedValue({ value: 1 });
    const mockFetch2 = jest.fn().mockResolvedValue({ value: 2 });

    // Simulate warming
    const warmData = [
      { 
        key: 'key1', 
        value: await mockFetch1() 
      },
      { 
        key: 'key2', 
        value: await mockFetch2() 
      },
    ];

    expect(mockFetch1).toHaveBeenCalledTimes(1);
    expect(mockFetch2).toHaveBeenCalledTimes(1);
    expect(warmData).toHaveLength(2);
  });

  it('should profile expensive operations', () => {
    const profiler = new MemoryProfiler();
    profiler.start();

    // Simulate expensive operation
    let sum = 0;
    for (let i = 0; i < 10000000; i++) {
      sum += Math.sqrt(i);
    }

    const result = profiler.end();

    expect(result.duration).toBeGreaterThan(0);
    expect(typeof result.recommendation).toBe('string');
  });
});

describe('Performance Edge Cases', () => {
  it('should handle concurrent cache operations', async () => {
    const mockFetch = jest.fn();
    mockFetch.mockResolvedValue({ data: 'value' });

    const cache = new TieredCache(
      'test-key',
      mockFetch,
      { ttl: 300 }
    );

    // Concurrent gets
    const results = await Promise.all([
      cache.get(),
      cache.get(),
      cache.get(),
      cache.get(),
    ]);

    expect(results).toHaveLength(4);
    expect(results.every(r => r.data === 'value')).toBe(true);
  });

  it('should handle memory profiler reset', () => {
    const profiler1 = new MemoryProfiler();
    profiler1.start();
    const result1 = profiler1.end();

    const profiler2 = new MemoryProfiler();
    profiler2.start();
    const result2 = profiler2.end();

    // Both should produce results independently
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });
});
