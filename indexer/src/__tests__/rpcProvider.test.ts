import { MultiRPCProvider, RPCProvider } from '../rpcProvider';

describe('MultiRPCProvider', () => {
  let provider: MultiRPCProvider;
  const mockProviders: RPCProvider[] = [
    {
      url: 'https://soroban-testnet.stellar.org',
      name: 'primary',
      priority: 1,
      weight: 1.0,
    },
    {
      url: 'https://soroban-testnet-backup.stellar.org',
      name: 'backup',
      priority: 2,
      weight: 0.5,
    },
  ];

  beforeEach(() => {
    provider = new MultiRPCProvider(mockProviders);
  });

  afterEach(() => {
    provider.stopHealthChecks();
  });

  describe('initialization', () => {
    it('should initialize with multiple providers', () => {
      const stats = provider.getStats();
      expect(stats.totalProviders).toBe(2);
      expect(stats.healthyProviders).toBe(2);
    });

    it('should sort providers by priority', () => {
      const health = provider.getAllHealth();
      expect(health[0].name).toBe('primary');
      expect(health[1].name).toBe('backup');
    });
  });

  describe('getServer', () => {
    it('should return a server instance', () => {
      const server = provider.getServer();
      expect(server).toBeDefined();
    });

    it('should prefer healthy providers', () => {
      const health = provider.getAllHealth();
      expect(health[0].isHealthy).toBe(true);
    });
  });

  describe('executeWithFailover', () => {
    it('should execute request with first provider', async () => {
      let executedCount = 0;

      const result = await provider.executeWithFailover(async (server) => {
        executedCount++;
        return 'success';
      });

      expect(result).toBe('success');
      expect(executedCount).toBeGreaterThan(0);
    });

    it('should retry on failure', async () => {
      let attempts = 0;

      const result = await provider.executeWithFailover(
        async (server) => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Temporary failure');
          }
          return 'recovered';
        },
        3,
      );

      expect(result).toBe('recovered');
      expect(attempts).toBe(2);
    });

    it('should throw after max retries', async () => {
      await expect(
        provider.executeWithFailover(
          async () => {
            throw new Error('Permanent failure');
          },
          2,
        ),
      ).rejects.toThrow();
    });
  });

  describe('health monitoring', () => {
    it('should start and stop health checks', (done) => {
      provider.startHealthChecks();
      expect(provider.getStats().totalProviders).toBeGreaterThan(0);

      setTimeout(() => {
        provider.stopHealthChecks();
        done();
      }, 100);
    });

    it('should track provider health', () => {
      const health = provider.getProviderHealth(mockProviders[0].url);
      expect(health).toBeDefined();
      expect(health?.isHealthy).toBe(true);
      expect(health?.totalRequests).toBeGreaterThanOrEqual(0);
    });

    it('should get all provider health', () => {
      const allHealth = provider.getAllHealth();
      expect(allHealth.length).toBe(2);
      allHealth.forEach((h) => {
        expect(h.url).toBeDefined();
        expect(h.name).toBeDefined();
        expect(typeof h.isHealthy).toBe('boolean');
      });
    });
  });

  describe('manual health control', () => {
    it('should allow manual health status update', () => {
      const providerUrl = mockProviders[0].url;
      provider.setProviderHealth(providerUrl, false);

      const health = provider.getProviderHealth(providerUrl);
      expect(health?.isHealthy).toBe(false);
    });

    it('should recover from manual unhealthy status', () => {
      const providerUrl = mockProviders[0].url;
      provider.setProviderHealth(providerUrl, false);

      provider.setProviderHealth(providerUrl, true);

      const health = provider.getProviderHealth(providerUrl);
      expect(health?.isHealthy).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', () => {
      const stats = provider.getStats();

      expect(stats.totalProviders).toBe(2);
      expect(stats.healthyProviders).toBeGreaterThanOrEqual(0);
      expect(stats.healthyProviders).toBeLessThanOrEqual(stats.totalProviders);
      expect(typeof stats.failureRate).toBe('number');
      expect(typeof stats.averageResponseTimeMs).toBe('number');
    });

    it('should calculate failure rate', () => {
      const stats = provider.getStats();
      expect(stats.failureRate).toBeGreaterThanOrEqual(0);
      expect(stats.failureRate).toBeLessThanOrEqual(1);
    });
  });

  describe('load balancing', () => {
    it('should use weighted round-robin load balancing', async () => {
      const servers = new Set<any>();

      for (let i = 0; i < 10; i++) {
        const server = provider.getServer();
        servers.add(server);
      }

      // With 2 healthy providers, should get at most 2 different servers
      expect(servers.size).toBeLessThanOrEqual(2);
    });

    it('should handle all providers becoming unhealthy', () => {
      const providerUrl1 = mockProviders[0].url;
      const providerUrl2 = mockProviders[1].url;

      provider.setProviderHealth(providerUrl1, false);
      provider.setProviderHealth(providerUrl2, false);

      const stats = provider.getStats();
      expect(stats.healthyProviders).toBe(0);

      // Should still return a server (fallback to primary)
      const server = provider.getServer();
      expect(server).toBeDefined();
    });
  });
});
