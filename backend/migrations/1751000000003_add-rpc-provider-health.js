/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // RPC Provider health tracking
  pgm.createTable('rpc_provider_health', {
    id: { type: 'serial', primaryKey: true },
    provider_url: { type: 'text', notNull: true, unique: true },
    provider_name: { type: 'text', notNull: true },
    is_healthy: { type: 'boolean', notNull: true, default: true },
    consecutive_failures: { type: 'integer', notNull: true, default: 0 },
    last_check_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    last_error_at: { type: 'timestamptz' },
    last_error_message: { type: 'text' },
    response_time_ms: { type: 'integer' },
    total_requests: { type: 'bigint', notNull: true, default: 0 },
    failed_requests: { type: 'bigint', notNull: true, default: 0 },
    last_healthy_at: { type: 'timestamptz' },
    priority: { type: 'integer', notNull: true, default: 0 },
    weight: { type: 'numeric', notNull: true, default: 1.0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  
  pgm.createIndex('rpc_provider_health', 'is_healthy');
  pgm.createIndex('rpc_provider_health', 'provider_url');
};

exports.down = (pgm) => {
  pgm.dropTable('rpc_provider_health');
};
