import {
  setEventFilter,
  getEventFilter,
  clearEventFilter,
  createEventTypeFilter,
  createContractFilter,
  createCombinedFilter,
  setSamplingConfig,
  getSamplingConfig,
  disableSampling,
  enableRandomSampling,
  enableSystematicSampling,
  enableAdaptiveSampling,
  passesFilter,
  shouldSampleEvent,
  filterAndSampleEvents,
  getFilteringStats,
  getFilterPreset,
  applyFilterPreset,
} from '../eventFiltering';

// Mock event for testing
const createMockEvent = (overrides: any = {}): any => ({
  id: 'event-123',
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  ledger: 12345,
  topic: [],
  value: {},
  ...overrides,
});

describe('Event Filtering Module', () => {
  beforeEach(() => {
    clearEventFilter();
    disableSampling();
  });

  describe('Filter Configuration', () => {
    it('should set and get event filter', () => {
      const filter = { eventTypes: ['submitted', 'paid'] };
      setEventFilter(filter);

      const retrieved = getEventFilter();
      expect(retrieved.eventTypes).toEqual(['submitted', 'paid']);
    });

    it('should create event type filter', () => {
      const filter = createEventTypeFilter(['submitted', 'funded']);
      setEventFilter(filter);

      const retrieved = getEventFilter();
      expect(retrieved.eventTypes).toEqual(['submitted', 'funded']);
    });

    it('should create contract filter', () => {
      const filter = createContractFilter(['CONTRACT1', 'CONTRACT2']);
      setEventFilter(filter);

      const retrieved = getEventFilter();
      expect(retrieved.contractIds).toEqual(['CONTRACT1', 'CONTRACT2']);
    });

    it('should create combined filter', () => {
      const filter = createCombinedFilter(
        ['submitted'],
        ['CONTRACT1'],
        ['topic1'],
      );
      setEventFilter(filter);

      const retrieved = getEventFilter();
      expect(retrieved.eventTypes).toEqual(['submitted']);
      expect(retrieved.contractIds).toEqual(['CONTRACT1']);
      expect(retrieved.topics).toEqual(['topic1']);
    });

    it('should clear event filter', () => {
      setEventFilter({ eventTypes: ['test'] });
      clearEventFilter();

      const filter = getEventFilter();
      expect(Object.keys(filter).length).toBe(0);
    });
  });

  describe('Sampling Configuration', () => {
    it('should set and get sampling config', () => {
      setSamplingConfig({ strategy: 'random', sampleRate: 0.5 });

      const config = getSamplingConfig();
      expect(config.strategy).toBe('random');
      expect(config.sampleRate).toBe(0.5);
    });

    it('should enable random sampling', () => {
      enableRandomSampling(0.2);

      const config = getSamplingConfig();
      expect(config.strategy).toBe('random');
      expect(config.sampleRate).toBe(0.2);
    });

    it('should enable systematic sampling', () => {
      enableSystematicSampling(10);

      const config = getSamplingConfig();
      expect(config.strategy).toBe('systematic');
      expect(config.sampleEveryN).toBe(10);
    });

    it('should enable adaptive sampling', () => {
      enableAdaptiveSampling(1000, 0.5);

      const config = getSamplingConfig();
      expect(config.strategy).toBe('adaptive');
      expect(config.adaptiveThreshold).toBe(1000);
      expect(config.adaptiveRate).toBe(0.5);
    });

    it('should disable sampling', () => {
      enableRandomSampling(0.5);
      disableSampling();

      const config = getSamplingConfig();
      expect(config.strategy).toBe('none');
    });
  });

  describe('Filter Logic', () => {
    it('should pass events with no filter', () => {
      const event = createMockEvent();
      expect(passesFilter(event)).toBe(true);
    });

    it('should filter by contract ID', () => {
      const filter = createContractFilter(['CONTRACT1']);
      setEventFilter(filter);

      const passingEvent = createMockEvent({ contractId: 'CONTRACT1' });
      const failingEvent = createMockEvent({ contractId: 'CONTRACT2' });

      expect(passesFilter(passingEvent)).toBe(true);
      expect(passesFilter(failingEvent)).toBe(false);
    });

    it('should filter by ledger range', () => {
      setEventFilter({ minLedger: 100, maxLedger: 200 });

      const lowEvent = createMockEvent({ ledger: 50 });
      const validEvent = createMockEvent({ ledger: 150 });
      const highEvent = createMockEvent({ ledger: 250 });

      expect(passesFilter(lowEvent)).toBe(false);
      expect(passesFilter(validEvent)).toBe(true);
      expect(passesFilter(highEvent)).toBe(false);
    });

    it('should exclude contract IDs', () => {
      setEventFilter({ excludeContractIds: ['SPAM_CONTRACT'] });

      const goodEvent = createMockEvent({ contractId: 'GOOD_CONTRACT' });
      const badEvent = createMockEvent({ contractId: 'SPAM_CONTRACT' });

      expect(passesFilter(goodEvent)).toBe(true);
      expect(passesFilter(badEvent)).toBe(false);
    });
  });

  describe('Sampling Logic', () => {
    it('should keep all events with no sampling', () => {
      disableSampling();

      expect(shouldSampleEvent()).toBe(true);
      expect(shouldSampleEvent()).toBe(true);
      expect(shouldSampleEvent()).toBe(true);
    });

    it('should apply systematic sampling', () => {
      enableSystematicSampling(3); // Keep every 3rd event

      expect(shouldSampleEvent()).toBe(true); // 1st
      expect(shouldSampleEvent()).toBe(false); // 2nd
      expect(shouldSampleEvent()).toBe(false); // 3rd
      expect(shouldSampleEvent()).toBe(true); // 4th (1st of next cycle)
    });

    it('should apply adaptive sampling based on queue depth', () => {
      enableAdaptiveSampling(100, 0.5); // Sample at 50% when queue > 100

      // Below threshold - keep all
      expect(shouldSampleEvent(50)).toBe(true);

      // Above threshold - random sampling applied
      // (We can't assert exact values due to randomness, but we can verify it works)
      const sampledResults = [];
      for (let i = 0; i < 100; i++) {
        sampledResults.push(shouldSampleEvent(200));
      }

      // With 50% sample rate at high queue depth, roughly half should be true
      const trueCount = sampledResults.filter((x) => x).length;
      expect(trueCount).toBeGreaterThan(20); // At least 20%
      expect(trueCount).toBeLessThan(80); // At most 80%
    });
  });

  describe('Combined Filtering and Sampling', () => {
    it('should apply both filter and sampling', () => {
      const filter = createContractFilter(['CONTRACT1']);
      setEventFilter(filter);
      enableSystematicSampling(2);

      const events = [
        createMockEvent({ contractId: 'CONTRACT1' }),
        createMockEvent({ contractId: 'CONTRACT2' }), // filtered out
        createMockEvent({ contractId: 'CONTRACT1' }),
        createMockEvent({ contractId: 'CONTRACT1' }),
      ];

      const result = filterAndSampleEvents(events);

      // Only CONTRACT1 events should pass filter, then sampling reduces further
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result.every((e) => e.contractId === 'CONTRACT1')).toBe(true);
    });

    it('should calculate filtering stats', () => {
      setEventFilter({ eventTypes: ['submitted'] });
      enableRandomSampling(0.1);

      const stats = getFilteringStats();

      expect(stats.filter.eventTypes).toEqual(['submitted']);
      expect(stats.sampling.strategy).toBe('random');
      expect(stats.estimatedReductionPercent).toBeGreaterThan(0);
      expect(stats.estimatedReductionPercent).toBeLessThanOrEqual(95);
    });
  });

  describe('Filter Presets', () => {
    it('should provide invoices preset', () => {
      const preset = getFilterPreset('invoices');

      expect(preset.eventTypes).toContain('submitted');
      expect(preset.eventTypes).toContain('paid');
      expect(preset.eventTypes).toContain('funded');
      expect(preset.eventTypes).toContain('defaulted');
    });

    it('should provide markets preset', () => {
      const preset = getFilterPreset('markets');

      expect(preset.eventTypes).toContain('market_created');
      expect(preset.eventTypes).toContain('market_resolved');
    });

    it('should provide trades preset', () => {
      const preset = getFilterPreset('trades');

      expect(preset.eventTypes).toContain('bet_placed');
      expect(preset.eventTypes).toContain('liquidity_added');
    });

    it('should apply filter preset', () => {
      applyFilterPreset('invoices');

      const filter = getEventFilter();
      expect(filter.eventTypes).toContain('submitted');
    });
  });
});
