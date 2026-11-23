/**
 * Capacity Planning Migration
 * Creates tables for tracking resource metrics, trends, and forecasts
 */

exports.up = async function(db) {
  // Resource metrics table - stores current resource usage metrics
  await db.schema.createTable('resource_metrics').ifNotExists()
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('timestamp', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .addColumn('resource_type', 'text', col => col.notNull()) // cpu, memory, disk, connections, etc.
    .addColumn('metric_name', 'text', col => col.notNull()) // specific metric within resource_type
    .addColumn('value', 'numeric', col => col.notNull()) // current metric value
    .addColumn('unit', 'text', col => col.notNull()) // percentage, bytes, count, etc.
    .addColumn('host_id', 'text') // server/container identifier
    .addColumn('service_name', 'text') // service generating the metric
    .addColumn('metadata', 'jsonb') // additional context
    .execute();

  // Capacity trends table - stores aggregated trends over time
  await db.schema.createTable('capacity_trends').ifNotExists()
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('resource_type', 'text', col => col.notNull())
    .addColumn('metric_name', 'text', col => col.notNull())
    .addColumn('period_start', 'timestamp with time zone', col => col.notNull()) // hourly, daily, weekly
    .addColumn('period_end', 'timestamp with time zone', col => col.notNull())
    .addColumn('period_type', 'text', col => col.notNull()) // 'hourly', 'daily', 'weekly', 'monthly'
    .addColumn('avg_value', 'numeric', col => col.notNull()) // average value over period
    .addColumn('min_value', 'numeric', col => col.notNull()) // minimum value
    .addColumn('max_value', 'numeric', col => col.notNull()) // maximum value
    .addColumn('p95_value', 'numeric') // 95th percentile
    .addColumn('p99_value', 'numeric') // 99th percentile
    .addColumn('sample_count', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('trend_direction', 'text') // 'increasing', 'decreasing', 'stable'
    .addColumn('trend_rate', 'numeric') // rate of change (units per day)
    .addColumn('volatility', 'numeric') // standard deviation as percent of mean
    .addColumn('created_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Capacity forecasts table - stores predictive forecasts
  await db.schema.createTable('capacity_forecasts').ifNotExists()
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('resource_type', 'text', col => col.notNull())
    .addColumn('metric_name', 'text', col => col.notNull())
    .addColumn('forecast_date', 'date', col => col.notNull()) // date being forecasted
    .addColumn('forecast_timestamp', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now())) // when forecast was generated
    .addColumn('forecast_method', 'text', col => col.notNull()) // 'linear_regression', 'exponential_smoothing', 'arima', etc.
    .addColumn('forecast_value', 'numeric', col => col.notNull()) // predicted value
    .addColumn('confidence_interval_lower', 'numeric') // 95% CI lower bound
    .addColumn('confidence_interval_upper', 'numeric') // 95% CI upper bound
    .addColumn('confidence_level', 'numeric') // 0-1 representing confidence
    .addColumn('model_r_squared', 'numeric') // R² value for model fit
    .addColumn('mape', 'numeric') // Mean Absolute Percentage Error
    .addColumn('actual_value', 'numeric') // actual value when known
    .addColumn('prediction_error', 'numeric') // error when actual is known
    .addColumn('notes', 'text') // any additional notes
    .addColumn('created_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Capacity alerts and thresholds table
  await db.schema.createTable('capacity_thresholds').ifNotExists()
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('resource_type', 'text', col => col.notNull())
    .addColumn('metric_name', 'text', col => col.notNull())
    .addColumn('warning_threshold', 'numeric', col => col.notNull()) // when to warn
    .addColumn('critical_threshold', 'numeric', col => col.notNull()) // when to alert
    .addColumn('forecast_warning_days', 'integer', col => col.notNull().defaultTo(7)) // alert if forecast exceeds critical in N days
    .addColumn('enabled', 'boolean', col => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Capacity alerts log table - tracks when thresholds are exceeded
  await db.schema.createTable('capacity_alerts').ifNotExists()
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('threshold_id', 'integer', col => col.references('capacity_thresholds.id'))
    .addColumn('resource_type', 'text', col => col.notNull())
    .addColumn('metric_name', 'text', col => col.notNull())
    .addColumn('alert_level', 'text', col => col.notNull()) // 'warning', 'critical'
    .addColumn('current_value', 'numeric', col => col.notNull())
    .addColumn('threshold_value', 'numeric', col => col.notNull())
    .addColumn('alert_type', 'text') // 'current_value', 'forecast_based'
    .addColumn('resolved_at', 'timestamp with time zone')
    .addColumn('created_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Capacity recommendations table - stores actionable recommendations
  await db.schema.createTable('capacity_recommendations').ifNotExists()
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('resource_type', 'text', col => col.notNull())
    .addColumn('metric_name', 'text', col => col.notNull())
    .addColumn('recommendation', 'text', col => col.notNull())
    .addColumn('urgency', 'text', col => col.notNull()) // 'low', 'medium', 'high'
    .addColumn('recommended_action', 'text') // specific action to take
    .addColumn('estimated_impact', 'text') // what happens if action is taken
    .addColumn('implementation_effort', 'text') // 'easy', 'moderate', 'difficult'
    .addColumn('forecast_date', 'date') // when issue is predicted to occur
    .addColumn('implemented', 'boolean', col => col.defaultTo(false))
    .addColumn('implemented_at', 'timestamp with time zone')
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamp with time zone', col => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Create indexes for better query performance
  await db.schema.createIndex('idx_resource_metrics_timestamp')
    .on('resource_metrics', 'timestamp').execute();
  
  await db.schema.createIndex('idx_resource_metrics_type_name')
    .on('resource_metrics', ['resource_type', 'metric_name']).execute();
  
  await db.schema.createIndex('idx_capacity_trends_resource_period')
    .on('capacity_trends', ['resource_type', 'metric_name', 'period_type', 'period_start']).execute();
  
  await db.schema.createIndex('idx_capacity_forecasts_resource_date')
    .on('capacity_forecasts', ['resource_type', 'metric_name', 'forecast_date']).execute();
  
  await db.schema.createIndex('idx_capacity_alerts_resolved')
    .on('capacity_alerts', 'resolved_at').execute();
  
  await db.schema.createIndex('idx_capacity_recommendations_urgency')
    .on('capacity_recommendations', 'urgency').execute();
};

exports.down = async function(db) {
  await db.schema.dropTable('capacity_recommendations').ifExists().execute();
  await db.schema.dropTable('capacity_alerts').ifExists().execute();
  await db.schema.dropTable('capacity_thresholds').ifExists().execute();
  await db.schema.dropTable('capacity_forecasts').ifExists().execute();
  await db.schema.dropTable('capacity_trends').ifExists().execute();
  await db.schema.dropTable('resource_metrics').ifExists().execute();
};
