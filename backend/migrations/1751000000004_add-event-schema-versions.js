/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Event schema versions and validation tracking
  pgm.createTable('event_schema_versions', {
    id: { type: 'serial', primaryKey: true },
    event_type: { type: 'text', notNull: true },
    version: { type: 'integer', notNull: true },
    schema: { type: 'jsonb', notNull: true },
    description: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  
  pgm.addConstraint('event_schema_versions', 'unique_event_type_version', {
    unique: ['event_type', 'version'],
  });
  
  pgm.createIndex('event_schema_versions', 'event_type');
  pgm.createIndex('event_schema_versions', 'is_active');

  // Event validation results for audit
  pgm.createTable('event_validation_results', {
    id: { type: 'serial', primaryKey: true },
    tx_hash: { type: 'text', notNull: true, unique: true },
    event_type: { type: 'text', notNull: true },
    schema_version: { type: 'integer', notNull: true },
    is_valid: { type: 'boolean', notNull: true, default: true },
    validation_errors: { type: 'jsonb' },
    payload_received: { type: 'jsonb' },
    ledger_sequence: { type: 'integer', notNull: true },
    checked_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  
  pgm.createIndex('event_validation_results', 'is_valid');
  pgm.createIndex('event_validation_results', 'event_type');
  pgm.createIndex('event_validation_results', 'checked_at');
};

exports.down = (pgm) => {
  pgm.dropTable('event_validation_results');
  pgm.dropTable('event_schema_versions');
};
