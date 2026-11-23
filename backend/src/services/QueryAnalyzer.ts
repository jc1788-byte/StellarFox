import { db } from '../db';
import { sql } from 'drizzle-orm';
import { Logger } from '../utils/logger';

export interface ExecutionPlan {
  node_type: string;
  startup_cost: number;
  total_cost: number;
  rows: number;
  relation_name?: string;
  index_name?: string;
  filter?: string;
  sort_key?: string[];
  plans?: ExecutionPlan[];
}

export interface QueryAnalysis {
  query: string;
  execution_time_ms: number;
  total_cost: number;
  rows_affected: number;
  uses_seq_scan: boolean;
  uses_index: boolean;
  missing_indexes: string[];
  recommendations: string[];
  execution_plan: ExecutionPlan;
}

export interface SlowQuery {
  query_hash: string;
  query_text: string;
  avg_execution_time_ms: number;
  execution_count: number;
  total_time_ms: number;
  last_executed: Date;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

const logger = Logger.getLogger('QueryAnalyzer');

export class QueryAnalyzer {
  private slowQueryThresholdMs: number;

  constructor(slowQueryThresholdMs: number = 1000) {
    this.slowQueryThresholdMs = slowQueryThresholdMs;
  }

  /**
   * Analyze a query's execution plan and provide recommendations
   */
  async analyzeQuery(query: string): Promise<QueryAnalysis> {
    try {
      const startTime = Date.now();

      // Get execution plan
      const planResult = await db.execute(
        sql.raw(`EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${query}`),
      );

      const executionTime = Date.now() - startTime;

      if (!planResult[0]) {
        throw new Error('No execution plan returned');
      }

      const plan = Array.isArray(planResult[0]) ? planResult[0][0] : planResult[0];
      const parsedPlan = JSON.parse(JSON.stringify(plan));

      const analysis = this.parseExecutionPlan(parsedPlan, query, executionTime);

      return analysis;
    } catch (error) {
      logger.error('Error analyzing query', { query, error: String(error) });
      throw error;
    }
  }

  /**
   * Parse execution plan and extract metrics
   */
  private parseExecutionPlan(
    planData: any,
    query: string,
    executionTime: number,
  ): QueryAnalysis {
    const plan = planData[0]?.Plan || planData.Plan;
    const planningTime = planData[0]?.['Planning Time'] || planData['Planning Time'] || 0;
    const executionTimeFromPlan =
      planData[0]?.['Execution Time'] || planData['Execution Time'] || executionTime;

    const analysis: QueryAnalysis = {
      query,
      execution_time_ms: executionTimeFromPlan,
      total_cost: plan['Total Cost'],
      rows_affected: plan['Actual Rows'] || plan['Rows'],
      uses_seq_scan: this.hasSequentialScans(plan),
      uses_index: this.hasIndexScans(plan),
      missing_indexes: [],
      recommendations: [],
      execution_plan: this.normalizeExecutionPlan(plan),
    };

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(
      plan,
      query,
      analysis.execution_time_ms,
    );

    // Detect missing indexes
    if (analysis.uses_seq_scan && analysis.total_cost > 1000) {
      const tableNames = this.extractTableNames(query);
      analysis.missing_indexes = this.recommendIndexes(tableNames, query);
    }

    return analysis;
  }

  /**
   * Check if execution plan contains sequential scans
   */
  private hasSequentialScans(plan: any): boolean {
    if (plan['Node Type']?.includes('Seq Scan')) {
      return true;
    }

    if (plan.Plans && Array.isArray(plan.Plans)) {
      return plan.Plans.some((subplan: any) => this.hasSequentialScans(subplan));
    }

    return false;
  }

  /**
   * Check if execution plan uses indexes
   */
  private hasIndexScans(plan: any): boolean {
    const indexNodeTypes = [
      'Index Scan',
      'Index Only Scan',
      'Bitmap Index Scan',
      'Hash',
    ];

    if (indexNodeTypes.some((type) => plan['Node Type']?.includes(type))) {
      return true;
    }

    if (plan.Plans && Array.isArray(plan.Plans)) {
      return plan.Plans.some((subplan: any) => this.hasIndexScans(subplan));
    }

    return false;
  }

  /**
   * Normalize execution plan to simplified structure
   */
  private normalizeExecutionPlan(plan: any): ExecutionPlan {
    return {
      node_type: plan['Node Type'],
      startup_cost: plan['Startup Cost'],
      total_cost: plan['Total Cost'],
      rows: plan['Actual Rows'] || plan['Rows'],
      relation_name: plan['Relation Name'],
      index_name: plan['Index Name'],
      filter: plan['Filter'],
      sort_key: plan['Sort Key'],
      plans: plan.Plans?.map((p: any) => this.normalizeExecutionPlan(p)),
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    plan: any,
    query: string,
    executionTime: number,
  ): string[] {
    const recommendations: string[] = [];

    // Check for sequential scans
    if (this.hasSequentialScans(plan)) {
      recommendations.push('High sequential scan detected. Consider adding indexes on filter columns.');
    }

    // Check for high cost
    if (plan['Total Cost'] > 10000) {
      recommendations.push('Very high query cost detected. Consider query restructuring or adding indexes.');
    }

    // Check for slow execution
    if (executionTime > this.slowQueryThresholdMs) {
      recommendations.push(
        `Query execution exceeded threshold (${executionTime}ms > ${this.slowQueryThresholdMs}ms). Optimize query or add indexes.`,
      );
    }

    // Check for full table scans
    if (plan['Node Type'] === 'Seq Scan' && plan['Actual Rows'] > 100000) {
      recommendations.push('Full table scan on large table detected. Consider adding indexes.');
    }

    // Check for nested loops
    if (plan['Node Type']?.includes('Nested Loop') && plan['Total Cost'] > 5000) {
      recommendations.push('Expensive nested loop join detected. Consider JOIN optimization.');
    }

    // Check for hash aggregation
    if (plan['Node Type']?.includes('HashAggregate') && plan['Total Cost'] > 1000) {
      recommendations.push('Consider adding index on GROUP BY columns.');
    }

    return recommendations;
  }

  /**
   * Extract table names from query
   */
  private extractTableNames(query: string): string[] {
    const fromMatch = query.match(/FROM\s+(\w+)/gi) || [];
    const joinMatch = query.match(/JOIN\s+(\w+)/gi) || [];

    const tableNames = [
      ...fromMatch.map((m) => m.replace(/FROM\s+/i, '').toLowerCase()),
      ...joinMatch.map((m) => m.replace(/JOIN\s+/i, '').toLowerCase()),
    ];

    return [...new Set(tableNames)];
  }

  /**
   * Recommend indexes based on query pattern
   */
  private recommendIndexes(tableNames: string[], query: string): string[] {
    const recommendations: string[] = [];

    // Extract WHERE clause columns
    const whereMatch = query.match(/WHERE\s+([^GROUP|ORDER|HAVING]+)/i);
    if (whereMatch) {
      const conditions = whereMatch[1].split(/\s+AND\s+/i);
      conditions.forEach((condition) => {
        const columnMatch = condition.match(/(\w+)\s*[=<>]/);
        if (columnMatch) {
          const column = columnMatch[1].toLowerCase();
          tableNames.forEach((table) => {
            recommendations.push(`CREATE INDEX idx_${table}_${column} ON ${table}(${column});`);
          });
        }
      });
    }

    // Extract ORDER BY columns
    const orderMatch = query.match(/ORDER BY\s+([^;]+)/i);
    if (orderMatch) {
      const columns = orderMatch[1].split(',').map((c) => c.trim().split(/\s+/)[0]);
      tableNames.forEach((table) => {
        const indexColumns = columns.join(', ');
        recommendations.push(
          `CREATE INDEX idx_${table}_order ON ${table}(${indexColumns});`,
        );
      });
    }

    return [...new Set(recommendations)];
  }

  /**
   * Get slow queries from pg_stat_statements
   */
  async getSlowQueries(limit: number = 10): Promise<SlowQuery[]> {
    try {
      const result = await db.execute(
        sql.raw(`
          SELECT 
            query,
            calls,
            total_time,
            mean_time,
            max_time,
            query_hash
          FROM pg_stat_statements
          WHERE mean_time > ${this.slowQueryThresholdMs}
          ORDER BY total_time DESC
          LIMIT ${limit};
        `),
      );

      return result.map((row: any) => ({
        query_hash: row.query_hash || row.query?.substring(0, 32),
        query_text: row.query,
        avg_execution_time_ms: parseFloat(row.mean_time),
        execution_count: row.calls,
        total_time_ms: parseFloat(row.total_time),
        last_executed: new Date(),
        severity: this.determineSeverity(parseFloat(row.mean_time)),
      }));
    } catch (error) {
      logger.error('Error fetching slow queries', { error: String(error) });
      return [];
    }
  }

  /**
   * Determine query severity based on execution time
   */
  private determineSeverity(executionTimeMs: number): 'critical' | 'high' | 'medium' | 'low' {
    if (executionTimeMs > 5000) return 'critical';
    if (executionTimeMs > 2000) return 'high';
    if (executionTimeMs > 1000) return 'medium';
    return 'low';
  }

  /**
   * Reset query statistics
   */
  async resetStatistics(): Promise<void> {
    try {
      await db.execute(sql.raw('SELECT pg_stat_statements_reset();'));
      logger.info('Query statistics reset');
    } catch (error) {
      logger.error('Error resetting statistics', { error: String(error) });
    }
  }
}

export default new QueryAnalyzer(parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '1000'));
