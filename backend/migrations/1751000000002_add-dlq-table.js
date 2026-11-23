/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Dead Letter Queue for failed events
  pgm.createTable('dead_letter_queue', {
    id: { type: 'serial', primaryKey: true },
    event_type: { type: 'text', notNull: true },
    contract_address: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    ledger_sequence: { type: 'integer', notNull: true },
    ledger_close_time: { type: 'timestamptz', notNull: true },
    tx_hash: { type: 'text', notNull: true, unique: true },
    error_message: { type: 'text', notNull: true },
    error_stack: { type: 'text' },
    failure_count: { type: 'integer', notNull: true, default: 1 },
    last_error_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    next_retry_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'pending' }, // pending, failed, resolved
    resolved_at: { type: 'timestamptz' },
    resolved_by: { type: 'text' }, // admin user or 'auto'
    resolution_notes: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  
  pgm.createIndex('dead_letter_queue', 'status');
  pgm.createIndex('dead_letter_queue', 'next_retry_at');
  pgm.createIndex('dead_letter_queue', 'created_at');
  pgm.createIndex('dead_letter_queue', 'tx_hash');
};

exports.down = (pgm) => {
  pgm.dropTable('dead_letter_queue');
};
