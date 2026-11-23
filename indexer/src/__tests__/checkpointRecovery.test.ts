import {
  initializeCheckpoints,
  createCheckpoint,
  shouldCreateCheckpoint,
  getLatestCheckpoint,
  getAllCheckpoints,
  recoverToCheckpoint,
  getRecoveryInfo,
  getCheckpointStats,
  resetEventCounter,
  clearAllCheckpoints,
} from '../checkpointRecovery';

describe('Checkpoint Recovery Module', () => {
  beforeEach(async () => {
    // Initialize checkpoints before each test
    await initializeCheckpoints();
    await clearAllCheckpoints();
    resetEventCounter();
  });

  describe('Checkpoint Creation', () => {
    it('should create a checkpoint', async () => {
      const checkpoint = await createCheckpoint(12345, 'token123', 1, 100);

      expect(checkpoint.ledgerSequence).toBe(12345);
      expect(checkpoint.pagingToken).toBe('token123');
      expect(checkpoint.batchId).toBe(1);
      expect(checkpoint.eventsInBatch).toBe(100);
      expect(checkpoint.checkpointId).toBeDefined();
      expect(checkpoint.processedAt).toBeDefined();
    });

    it('should track event counts for checkpointing', () => {
      expect(shouldCreateCheckpoint(500)).toBe(false);
      expect(shouldCreateCheckpoint(300)).toBe(false);
      expect(shouldCreateCheckpoint(200)).toBe(true); // Should trigger at 1000 (default interval)
    });

    it('should reset event counter after checkpoint', () => {
      shouldCreateCheckpoint(1000);
      resetEventCounter();
      const willTrigger = shouldCreateCheckpoint(100);
      expect(willTrigger).toBe(false);
    });
  });

  describe('Checkpoint Retrieval', () => {
    it('should get the latest checkpoint', async () => {
      const checkpoint1 = await createCheckpoint(100, 'token1', 1, 50);
      const checkpoint2 = await createCheckpoint(200, 'token2', 2, 100);

      const latest = getLatestCheckpoint();
      expect(latest?.checkpointId).toBe(checkpoint2.checkpointId);
      expect(latest?.ledgerSequence).toBe(200);
    });

    it('should get all checkpoints', async () => {
      await createCheckpoint(100, 'token1', 1, 50);
      await createCheckpoint(200, 'token2', 2, 100);

      const all = getAllCheckpoints();
      expect(all).toHaveLength(2);
      expect(all[0].ledgerSequence).toBe(100);
      expect(all[1].ledgerSequence).toBe(200);
    });

    it('should return null when no checkpoints exist', () => {
      const latest = getLatestCheckpoint();
      expect(latest).toBeNull();
    });
  });

  describe('Checkpoint Recovery', () => {
    it('should recover to a specific checkpoint', async () => {
      const checkpoint = await createCheckpoint(12345, 'token123', 1, 100);

      const result = await recoverToCheckpoint(checkpoint.checkpointId);

      expect(result.success).toBe(true);
      expect(result.ledgerSequence).toBe(12345);
      expect(result.pagingToken).toBe('token123');
    });

    it('should fail when recovering to non-existent checkpoint', async () => {
      const result = await recoverToCheckpoint('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should get recovery info', async () => {
      const checkpoint = await createCheckpoint(12345, 'token123', 1, 100);

      const info = getRecoveryInfo();

      expect(info.hasCheckpoint).toBe(true);
      expect(info.checkpointId).toBe(checkpoint.checkpointId);
      expect(info.ledgerSequence).toBe(12345);
      expect(info.pagingToken).toBe('token123');
    });

    it('should return no checkpoint when none exist', () => {
      const info = getRecoveryInfo();

      expect(info.hasCheckpoint).toBe(false);
      expect(info.checkpointId).toBeNull();
    });
  });

  describe('Checkpoint Statistics', () => {
    it('should provide checkpoint statistics', async () => {
      await createCheckpoint(100, 'token1', 1, 50);
      await createCheckpoint(200, 'token2', 2, 100);

      const stats = getCheckpointStats();

      expect(stats.totalCheckpoints).toBe(2);
      expect(stats.oldestCheckpoint).toBeDefined();
      expect(stats.newestCheckpoint).toBeDefined();
      expect(stats.diskUsageEstimate).toBeGreaterThan(0);
    });

    it('should handle empty checkpoint list in statistics', () => {
      const stats = getCheckpointStats();

      expect(stats.totalCheckpoints).toBe(0);
      expect(stats.oldestCheckpoint).toBeNull();
      expect(stats.newestCheckpoint).toBeNull();
    });
  });

  describe('Checkpoint Cleanup', () => {
    it('should maintain max checkpoint limit', async () => {
      // Create more checkpoints than MAX_CHECKPOINTS_TO_KEEP (default 10)
      for (let i = 1; i <= 15; i++) {
        await createCheckpoint(i * 1000, `token${i}`, i, 50);
      }

      const all = getAllCheckpoints();
      // Should keep only the last 10
      expect(all.length).toBeLessThanOrEqual(10);
      expect(all[0].ledgerSequence).toBeGreaterThan(5000);
    });

    it('should clear all checkpoints', async () => {
      await createCheckpoint(100, 'token1', 1, 50);
      await createCheckpoint(200, 'token2', 2, 100);

      await clearAllCheckpoints();

      const all = getAllCheckpoints();
      expect(all).toHaveLength(0);
      expect(getLatestCheckpoint()).toBeNull();
    });
  });
});
