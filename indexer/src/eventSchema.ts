/**
 * Event schema validation with versioning support and migration capabilities.
 */

import { logger } from './logger';

export interface EventSchema {
  version: number;
  name: string;
  fields: Record<string, FieldSchema>;
}

export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: any[];
  items?: FieldSchema;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  migratedData?: Record<string, any>;
}

/**
 * Event schema registry with versioning
 */
export class EventSchemaRegistry {
  private schemas: Map<string, Map<number, EventSchema>> = new Map();
  private migrations: Map<string, ((data: any, fromVersion: number, toVersion: number) => any)[]> =
    new Map();
  private currentVersions: Map<string, number> = new Map();

  /**
   * Register an event schema
   */
  registerSchema(schema: EventSchema): void {
    if (!this.schemas.has(schema.name)) {
      this.schemas.set(schema.name, new Map());
    }

    this.schemas.get(schema.name)!.set(schema.version, schema);

    // Update current version if this is higher
    const currentVersion = this.currentVersions.get(schema.name) || 0;
    if (schema.version > currentVersion) {
      this.currentVersions.set(schema.name, schema.version);
    }

    logger.debug(
      { eventName: schema.name, version: schema.version },
      'Event schema registered',
    );
  }

  /**
   * Register a migration function
   */
  registerMigration(
    eventName: string,
    migration: (data: any, fromVersion: number, toVersion: number) => any,
  ): void {
    if (!this.migrations.has(eventName)) {
      this.migrations.set(eventName, []);
    }
    this.migrations.get(eventName)!.push(migration);
  }

  /**
   * Validate an event against its schema
   */
  validate(eventName: string, eventData: any, eventVersion?: number): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Get the schema
    const version = eventVersion || this.currentVersions.get(eventName);
    if (!version) {
      errors.push(`Unknown event type: ${eventName}`);
      return { valid: false, errors, warnings };
    }

    const schema = this.schemas.get(eventName)?.get(version);
    if (!schema) {
      errors.push(
        `No schema found for event ${eventName} version ${version}`,
      );
      return { valid: false, errors, warnings };
    }

    // Validate fields
    for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
      const value = eventData[fieldName];

      if (value === undefined || value === null) {
        if (fieldSchema.required) {
          errors.push(`Required field missing: ${fieldName}`);
        }
        continue;
      }

      const fieldErrors = this.validateField(fieldName, value, fieldSchema);
      errors.push(...fieldErrors);
    }

    // Check for unexpected fields
    for (const key of Object.keys(eventData)) {
      if (!(key in schema.fields)) {
        warnings.push(`Unexpected field: ${key}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single field
   */
  private validateField(
    fieldName: string,
    value: any,
    schema: FieldSchema,
  ): string[] {
    const errors: string[] = [];

    // Type validation
    let actualType: string = typeof value;
    if (Array.isArray(value)) {
      actualType = 'array';
    } else if (value === null) {
      actualType = 'null';
    }

    // Handle array type specially
    if (schema.type === 'array' && !Array.isArray(value)) {
      errors.push(
        `Field ${fieldName}: expected array, got ${actualType}`,
      );
      return errors;
    }

    if (schema.type !== 'array' && actualType !== schema.type) {
      if (!(schema.type === 'object' && actualType === 'object')) {
        errors.push(
          `Field ${fieldName}: expected ${schema.type}, got ${actualType}`,
        );
        return errors;
      }
    }

    // String validations
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(
          `Field ${fieldName}: string too short (min: ${schema.minLength})`,
        );
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(
          `Field ${fieldName}: string too long (max: ${schema.maxLength})`,
        );
      }
      if (schema.pattern !== undefined) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push(
            `Field ${fieldName}: does not match pattern ${schema.pattern}`,
          );
        }
      }
      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        errors.push(
          `Field ${fieldName}: value not in enum: ${schema.enum.join(', ')}`,
        );
      }
    }

    // Number validations
    if (schema.type === 'number' && typeof value === 'number') {
      if (!Number.isFinite(value)) {
        errors.push(`Field ${fieldName}: not a valid number`);
      }
    }

    // Array validations
    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const itemErrors = this.validateField(
            `${fieldName}[${i}]`,
            value[i],
            schema.items,
          );
          errors.push(...itemErrors);
        }
      }
    }

    return errors;
  }

  /**
   * Migrate event data to current version
   */
  migrate(
    eventName: string,
    eventData: any,
    fromVersion: number,
  ): { data: any; version: number; errors: string[] } {
    const errors: string[] = [];
    const currentVersion = this.currentVersions.get(eventName);

    if (!currentVersion) {
      errors.push(`Unknown event type: ${eventName}`);
      return { data: eventData, version: fromVersion, errors };
    }

    if (fromVersion === currentVersion) {
      return { data: eventData, version: currentVersion, errors };
    }

    if (fromVersion > currentVersion) {
      errors.push(
        `Cannot migrate from version ${fromVersion} to ${currentVersion}`,
      );
      return { data: eventData, version: fromVersion, errors };
    }

    // Apply migrations in sequence
    let data = eventData;
    let currentVer = fromVersion;

    const migrations = this.migrations.get(eventName);
    if (!migrations || migrations.length === 0) {
      errors.push(
        `No migration path from version ${fromVersion} to ${currentVersion}`,
      );
      return { data: eventData, version: fromVersion, errors };
    }

    for (const migration of migrations) {
      try {
        data = migration(data, currentVer, currentVer + 1);
        currentVer++;

        logger.debug(
          { eventName, fromVersion: currentVer - 1, toVersion: currentVer },
          'Event migrated',
        );
      } catch (error) {
        errors.push(
          `Migration error at version ${currentVer}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        break;
      }
    }

    return { data, version: currentVer, errors };
  }

  /**
   * Get current schema version for an event type
   */
  getCurrentVersion(eventName: string): number | undefined {
    return this.currentVersions.get(eventName);
  }

  /**
   * Get all schema versions for an event type
   */
  getSchemaVersions(eventName: string): number[] {
    const versions = this.schemas.get(eventName);
    return versions ? Array.from(versions.keys()).sort((a, b) => a - b) : [];
  }

  /**
   * Get a specific schema
   */
  getSchema(eventName: string, version?: number): EventSchema | undefined {
    const ver = version || this.currentVersions.get(eventName);
    if (!ver) return undefined;
    return this.schemas.get(eventName)?.get(ver);
  }
}

/**
 * Default invoice event schemas
 */
export function getDefaultSchemas(): EventSchema[] {
  return [
    {
      version: 1,
      name: 'invoice.submitted',
      fields: {
        id: { type: 'string', required: true, description: 'Unique invoice ID' },
        freelancer: { type: 'string', required: true, description: 'Freelancer wallet address' },
        payer: { type: 'string', required: true, description: 'Payer wallet address' },
        amount: { type: 'number', required: true, description: 'Invoice amount in stroops' },
        dueDate: { type: 'string', required: true, description: 'Due date in ISO format' },
      },
    },
    {
      version: 1,
      name: 'invoice.funded',
      fields: {
        id: { type: 'string', required: true, description: 'Invoice ID' },
        escrowAddress: {
          type: 'string',
          required: false,
          description: 'Escrow account address',
        },
      },
    },
    {
      version: 1,
      name: 'invoice.paid',
      fields: {
        id: { type: 'string', required: true, description: 'Invoice ID' },
        paidAt: {
          type: 'string',
          required: false,
          description: 'Payment timestamp in ISO format',
        },
      },
    },
    {
      version: 1,
      name: 'invoice.defaulted',
      fields: {
        id: { type: 'string', required: true, description: 'Invoice ID' },
        defaultedAt: {
          type: 'string',
          required: false,
          description: 'Default timestamp in ISO format',
        },
      },
    },
    {
      version: 1,
      name: 'market.created',
      fields: {
        id: { type: 'string', required: true },
        title: { type: 'string', required: true, maxLength: 256 },
        description: { type: 'string', required: false },
        category: { type: 'string', required: false },
        createdAt: { type: 'string', required: true },
      },
    },
    {
      version: 1,
      name: 'bet.placed',
      fields: {
        marketId: { type: 'string', required: true },
        bettor: { type: 'string', required: true },
        amount: { type: 'number', required: true },
        outcome: { type: 'string', required: true },
      },
    },
  ];
}

export default EventSchemaRegistry;
