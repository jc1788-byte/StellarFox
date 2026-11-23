import EventSchemaRegistry, { getDefaultSchemas, EventSchema } from '../eventSchema';

describe('EventSchemaRegistry', () => {
  let registry: EventSchemaRegistry;

  beforeEach(() => {
    registry = new EventSchemaRegistry();
  });

  describe('schema registration', () => {
    it('should register a schema', () => {
      const schema: EventSchema = {
        version: 1,
        name: 'test.event',
        fields: {
          id: { type: 'string', required: true },
          value: { type: 'number', required: true },
        },
      };

      registry.registerSchema(schema);

      expect(registry.getCurrentVersion('test.event')).toBe(1);
      expect(registry.getSchema('test.event', 1)).toBeDefined();
    });

    it('should track multiple versions', () => {
      const schema1: EventSchema = {
        version: 1,
        name: 'test.event',
        fields: { id: { type: 'string', required: true } },
      };

      const schema2: EventSchema = {
        version: 2,
        name: 'test.event',
        fields: {
          id: { type: 'string', required: true },
          newField: { type: 'string', required: false },
        },
      };

      registry.registerSchema(schema1);
      registry.registerSchema(schema2);

      const versions = registry.getSchemaVersions('test.event');
      expect(versions).toContain(1);
      expect(versions).toContain(2);
      expect(registry.getCurrentVersion('test.event')).toBe(2);
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      const schema: EventSchema = {
        version: 1,
        name: 'invoice.submitted',
        fields: {
          id: { type: 'string', required: true, minLength: 1, maxLength: 256 },
          amount: { type: 'number', required: true },
          status: {
            type: 'string',
            required: true,
            enum: ['pending', 'paid', 'failed'],
          },
          metadata: { type: 'object', required: false },
        },
      };

      registry.registerSchema(schema);
    });

    it('should validate correct event', () => {
      const event = {
        id: 'inv-123',
        amount: 1000,
        status: 'pending',
      };

      const result = registry.validate('invoice.submitted', event);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject missing required fields', () => {
      const event = {
        id: 'inv-123',
        // missing amount and status
      };

      const result = registry.validate('invoice.submitted', event);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate string length constraints', () => {
      const event = {
        id: '', // Empty string, violates minLength: 1
        amount: 1000,
        status: 'pending',
      };

      const result = registry.validate('invoice.submitted', event);
      expect(result.valid).toBe(false);
    });

    it('should validate enum constraints', () => {
      const event = {
        id: 'inv-123',
        amount: 1000,
        status: 'invalid-status',
      };

      const result = registry.validate('invoice.submitted', event);
      expect(result.valid).toBe(false);
    });

    it('should detect unexpected fields', () => {
      const event = {
        id: 'inv-123',
        amount: 1000,
        status: 'pending',
        unexpectedField: 'value',
      };

      const result = registry.validate('invoice.submitted', event);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should validate type mismatches', () => {
      const event = {
        id: 'inv-123',
        amount: 'not-a-number', // Should be number
        status: 'pending',
      };

      const result = registry.validate('invoice.submitted', event);
      expect(result.valid).toBe(false);
    });
  });

  describe('migration', () => {
    beforeEach(() => {
      const schema1: EventSchema = {
        version: 1,
        name: 'invoice.event',
        fields: {
          id: { type: 'string', required: true },
          amount: { type: 'number', required: true },
        },
      };

      const schema2: EventSchema = {
        version: 2,
        name: 'invoice.event',
        fields: {
          id: { type: 'string', required: true },
          amount: { type: 'number', required: true },
          currency: { type: 'string', required: false, enum: ['USD', 'EUR', 'XLM'] },
        },
      };

      registry.registerSchema(schema1);
      registry.registerSchema(schema2);

      registry.registerMigration('invoice.event', (data, fromVersion, toVersion) => {
        if (fromVersion === 1 && toVersion === 2) {
          return { ...data, currency: 'USD' };
        }
        return data;
      });
    });

    it('should migrate data to new version', () => {
      const data = { id: 'inv-123', amount: 1000 };

      const result = registry.migrate('invoice.event', data, 1);

      expect(result.version).toBe(2);
      expect(result.errors.length).toBe(0);
      expect(result.migratedData?.currency).toBe('USD');
    });

    it('should handle no migration needed', () => {
      const data = { id: 'inv-123', amount: 1000 };

      const result = registry.migrate('invoice.event', data, 2);

      expect(result.version).toBe(2);
      expect(result.errors.length).toBe(0);
    });

    it('should return errors for invalid migrations', () => {
      const data = { id: 'inv-123', amount: 1000 };

      const result = registry.migrate('invoice.event', data, 5); // Invalid version

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('default schemas', () => {
    it('should provide default invoice schemas', () => {
      const schemas = getDefaultSchemas();

      expect(schemas.length).toBeGreaterThan(0);
      expect(schemas.some((s) => s.name === 'invoice.submitted')).toBe(true);
      expect(schemas.some((s) => s.name === 'invoice.funded')).toBe(true);
      expect(schemas.some((s) => s.name === 'invoice.paid')).toBe(true);
    });

    it('should register default schemas', () => {
      const schemas = getDefaultSchemas();
      schemas.forEach((schema) => registry.registerSchema(schema));

      expect(registry.getCurrentVersion('invoice.submitted')).toBe(1);
      expect(registry.getSchema('invoice.submitted')).toBeDefined();
    });
  });

  describe('field validation', () => {
    beforeEach(() => {
      const schema: EventSchema = {
        version: 1,
        name: 'test.event',
        fields: {
          tags: {
            type: 'array',
            required: false,
            items: { type: 'string', required: true },
          },
          pattern: {
            type: 'string',
            required: false,
            pattern: '^[A-Z]{3}[0-9]{3}$',
          },
        },
      };

      registry.registerSchema(schema);
    });

    it('should validate array items', () => {
      const event = {
        tags: ['tag1', 'tag2', 123], // Invalid: 123 is not a string
      };

      const result = registry.validate('test.event', event);
      expect(result.valid).toBe(false);
    });

    it('should validate regex patterns', () => {
      const validEvent = { pattern: 'ABC123' };
      const invalidEvent = { pattern: 'ABCD123' };

      const validResult = registry.validate('test.event', validEvent);
      const invalidResult = registry.validate('test.event', invalidEvent);

      expect(validResult.valid).toBe(true);
      expect(invalidResult.valid).toBe(false);
    });
  });
});
