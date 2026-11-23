/* eslint-disable */
exports.up = (pgm) => {
  // User Sessions table - tracks individual user sessions
  pgm.createTable(
    'user_sessions',
    {
      id: { type: 'serial', primaryKey: true },
      user_id: {
        type: 'text',
        notNull: true,
        references: '"users"(id)',
        onDelete: 'CASCADE',
      },
      session_id: { type: 'text', notNull: true, unique: true },
      device_info: { type: 'jsonb' },
      browser: { type: 'varchar(255)' },
      os: { type: 'varchar(255)' },
      ip_address: { type: 'inet' },
      started_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      ended_at: { type: 'timestamp' },
      duration_seconds: { type: 'integer' },
      page_views: { type: 'integer', default: 0 },
      events_count: { type: 'integer', default: 0 },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('user_sessions', 'user_id');
  pgm.createIndex('user_sessions', 'session_id');
  pgm.createIndex('user_sessions', 'started_at');
  pgm.createIndex('user_sessions', ['user_id', 'started_at']);

  // User Events table - tracks individual user actions
  pgm.createTable(
    'user_events',
    {
      id: { type: 'bigserial', primaryKey: true },
      user_id: {
        type: 'text',
        notNull: true,
        references: '"users"(id)',
        onDelete: 'CASCADE',
      },
      session_id: {
        type: 'text',
        notNull: true,
        references: '"user_sessions"(session_id)',
        onDelete: 'CASCADE',
      },
      event_type: {
        type: 'varchar(100)',
        notNull: true,
      },
      event_name: { type: 'varchar(255)', notNull: true },
      page_url: { type: 'text' },
      referrer_url: { type: 'text' },
      event_data: { type: 'jsonb' },
      duration_ms: { type: 'integer' },
      timestamp: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('user_events', 'user_id');
  pgm.createIndex('user_events', 'session_id');
  pgm.createIndex('user_events', 'event_type');
  pgm.createIndex('user_events', 'event_name');
  pgm.createIndex('user_events', ['user_id', 'timestamp']);
  pgm.createIndex('user_events', 'timestamp');

  // Page Analytics table - aggregated page view metrics
  pgm.createTable(
    'page_analytics',
    {
      id: { type: 'serial', primaryKey: true },
      page_url: { type: 'text', notNull: true },
      page_name: { type: 'varchar(255)', notNull: true },
      date: { type: 'date', notNull: true },
      unique_visitors: { type: 'integer', default: 0 },
      page_views: { type: 'integer', default: 0 },
      avg_time_on_page_seconds: { type: 'numeric', default: 0 },
      bounce_rate: { type: 'numeric(5,2)', default: 0 },
      scroll_depth_avg: { type: 'numeric(5,2)', default: 0 },
      ctr: { type: 'numeric(5,2)', default: 0 },
      conversion_rate: { type: 'numeric(5,2)', default: 0 },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('page_analytics', ['page_url', 'date']);
  pgm.createIndex('page_analytics', 'date');

  // Heatmap Data table - tracks clicks, mouse movements, and interactions
  pgm.createTable(
    'heatmap_data',
    {
      id: { type: 'bigserial', primaryKey: true },
      user_id: {
        type: 'text',
        notNull: true,
        references: '"users"(id)',
        onDelete: 'CASCADE',
      },
      session_id: {
        type: 'text',
        notNull: true,
        references: '"user_sessions"(session_id)',
        onDelete: 'CASCADE',
      },
      page_url: { type: 'text', notNull: true },
      interaction_type: {
        type: 'varchar(50)',
        notNull: true,
      },
      x_coordinate: { type: 'integer', notNull: true },
      y_coordinate: { type: 'integer', notNull: true },
      element_id: { type: 'varchar(255)' },
      element_class: { type: 'varchar(255)' },
      element_text: { type: 'varchar(500)' },
      viewport_width: { type: 'integer' },
      viewport_height: { type: 'integer' },
      timestamp: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('heatmap_data', 'user_id');
  pgm.createIndex('heatmap_data', 'session_id');
  pgm.createIndex('heatmap_data', 'page_url');
  pgm.createIndex('heatmap_data', 'interaction_type');
  pgm.createIndex('heatmap_data', ['page_url', 'interaction_type']);

  // Session Recordings metadata table
  pgm.createTable(
    'session_recordings',
    {
      id: { type: 'serial', primaryKey: true },
      user_id: {
        type: 'text',
        notNull: true,
        references: '"users"(id)',
        onDelete: 'CASCADE',
      },
      session_id: {
        type: 'text',
        notNull: true,
        references: '"user_sessions"(session_id)',
        onDelete: 'CASCADE',
      },
      recording_url: { type: 'text' },
      storage_key: { type: 'text' },
      duration_seconds: { type: 'integer' },
      event_count: { type: 'integer', default: 0 },
      file_size_bytes: { type: 'bigint' },
      status: {
        type: 'varchar(50)',
        default: 'processing',
      },
      started_at: { type: 'timestamp', notNull: true },
      ended_at: { type: 'timestamp' },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('session_recordings', 'user_id');
  pgm.createIndex('session_recordings', 'session_id');
  pgm.createIndex('session_recordings', 'status');

  // Heatmap Aggregates - pre-computed heatmap data for performance
  pgm.createTable(
    'heatmap_aggregates',
    {
      id: { type: 'serial', primaryKey: true },
      page_url: { type: 'text', notNull: true },
      date: { type: 'date', notNull: true },
      interaction_type: {
        type: 'varchar(50)',
        notNull: true,
      },
      heatmap_json: { type: 'jsonb', notNull: true },
      sample_count: { type: 'integer', default: 0 },
      grid_size: { type: 'integer', default: 50 },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('heatmap_aggregates', ['page_url', 'date', 'interaction_type']);
  pgm.createIndex('heatmap_aggregates', ['page_url', 'interaction_type']);

  // User Analytics Summary - daily summary of user interactions
  pgm.createTable(
    'user_analytics_summary',
    {
      id: { type: 'serial', primaryKey: true },
      user_id: {
        type: 'text',
        notNull: true,
        references: '"users"(id)',
        onDelete: 'CASCADE',
      },
      date: { type: 'date', notNull: true },
      sessions_count: { type: 'integer', default: 0 },
      page_views: { type: 'integer', default: 0 },
      events_count: { type: 'integer', default: 0 },
      total_time_seconds: { type: 'integer', default: 0 },
      unique_pages_visited: { type: 'integer', default: 0 },
      conversions: { type: 'integer', default: 0 },
      conversion_value: { type: 'numeric(15,2)', default: 0 },
      goals_completed: { type: 'jsonb' },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('user_analytics_summary', ['user_id', 'date']);
  pgm.createIndex('user_analytics_summary', 'date');

  // Analytics Events Tracking - for custom events like form submissions, errors, etc
  pgm.createTable(
    'analytics_custom_events',
    {
      id: { type: 'bigserial', primaryKey: true },
      user_id: { type: 'text' },
      event_category: { type: 'varchar(100)', notNull: true },
      event_label: { type: 'varchar(255)', notNull: true },
      event_value: { type: 'integer' },
      event_metadata: { type: 'jsonb' },
      page_url: { type: 'text' },
      session_id: { type: 'text' },
      timestamp: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
      created_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createIndex('analytics_custom_events', 'user_id');
  pgm.createIndex('analytics_custom_events', 'event_category');
  pgm.createIndex('analytics_custom_events', ['event_category', 'timestamp']);
  pgm.createIndex('analytics_custom_events', 'timestamp');
};

exports.down = (pgm) => {
  pgm.dropTable('analytics_custom_events', { ifExists: true, cascade: true });
  pgm.dropTable('user_analytics_summary', { ifExists: true, cascade: true });
  pgm.dropTable('heatmap_aggregates', { ifExists: true, cascade: true });
  pgm.dropTable('session_recordings', { ifExists: true, cascade: true });
  pgm.dropTable('heatmap_data', { ifExists: true, cascade: true });
  pgm.dropTable('page_analytics', { ifExists: true, cascade: true });
  pgm.dropTable('user_events', { ifExists: true, cascade: true });
  pgm.dropTable('user_sessions', { ifExists: true, cascade: true });
};
