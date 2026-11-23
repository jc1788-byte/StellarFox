import { Request, Response } from 'express';
import queryAnalyzer, { QueryAnalyzer } from '../../services/QueryAnalyzer';
import indexRecommendationService from '../../services/IndexRecommendation';
import { Logger } from '../../utils/logger';
import { ApiResponse } from '../../types/api';

const logger = Logger.getLogger('QueryAnalysisController');

export class QueryAnalysisController {
  /**
   * Analyze a single query
   * POST /api/admin/queries/analyze
   */
  static async analyzeQuery(req: Request, res: Response): Promise<void> {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Query parameter is required and must be a string',
        });
        return;
      }

      const analysis = await queryAnalyzer.analyzeQuery(query);

      const response: ApiResponse = {
        success: true,
        data: {
          analysis,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error analyzing query', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to analyze query',
      });
    }
  }

  /**
   * Get slow queries
   * GET /api/admin/queries/slow-queries?limit=10
   */
  static async getSlowQueries(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
      const slowQueries = await queryAnalyzer.getSlowQueries(limit);

      const response: ApiResponse = {
        success: true,
        data: {
          queries: slowQueries,
          count: slowQueries.length,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error fetching slow queries', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch slow queries',
      });
    }
  }

  /**
   * Get execution plan visualization
   * POST /api/admin/queries/explain
   */
  static async explainQuery(req: Request, res: Response): Promise<void> {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Query parameter is required',
        });
        return;
      }

      const analysis = await queryAnalyzer.analyzeQuery(query);

      const response: ApiResponse = {
        success: true,
        data: {
          execution_plan: analysis.execution_plan,
          metrics: {
            execution_time_ms: analysis.execution_time_ms,
            total_cost: analysis.total_cost,
            rows_affected: analysis.rows_affected,
          },
          recommendations: analysis.recommendations,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error explaining query', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to explain query',
      });
    }
  }

  /**
   * Get index recommendations
   * GET /api/admin/recommendations/indexes
   */
  static async getIndexRecommendations(req: Request, res: Response): Promise<void> {
    try {
      const recommendations = await indexRecommendationService.getRecommendations();

      const grouped = {
        missing: recommendations.filter((r) => r.reason.includes('sequential')),
        redundant: recommendations.filter((r) => r.reason.includes('Redundant')),
        unused: recommendations.filter((r) => r.reason.includes('Unused')),
      };

      const response: ApiResponse = {
        success: true,
        data: {
          recommendations: grouped,
          total_count: recommendations.length,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error fetching index recommendations', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch index recommendations',
      });
    }
  }

  /**
   * Analyze index performance
   * GET /api/admin/indexes/performance
   */
  static async analyzeIndexPerformance(req: Request, res: Response): Promise<void> {
    try {
      const performance = await indexRecommendationService.analyzeIndexPerformance();
      const bloat = await indexRecommendationService.analyzeIndexBloat();

      const response: ApiResponse = {
        success: true,
        data: {
          indexes: performance,
          bloat_alerts: bloat,
          total_indexes: performance.length,
          unused_count: performance.filter((p) => p.unused).length,
          bloated_count: bloat.length,
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error('Error analyzing index performance', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to analyze index performance',
      });
    }
  }

  /**
   * Create recommended index
   * POST /api/admin/indexes/create
   */
  static async createRecommendedIndex(req: Request, res: Response): Promise<void> {
    try {
      const { table_name, column_name, create_statement } = req.body;

      if (!create_statement) {
        res.status(400).json({
          success: false,
          error: 'create_statement is required',
        });
        return;
      }

      const success = await indexRecommendationService.createIndex({
        table_name,
        column_name,
        index_name: `idx_${table_name}_${column_name}`,
        reason: 'Manual creation from recommendation',
        estimated_benefit: 'medium',
        create_statement,
      });

      res.json({
        success,
        message: success
          ? 'Index created successfully'
          : 'Failed to create index',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error creating index', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to create index',
      });
    }
  }

  /**
   * Drop unused index
   * DELETE /api/admin/indexes/:indexName
   */
  static async dropUnusedIndex(req: Request, res: Response): Promise<void> {
    try {
      const { indexName } = req.params;

      const success = await indexRecommendationService.dropUnusedIndex(indexName);

      res.json({
        success,
        message: success
          ? `Index ${indexName} dropped successfully`
          : `Failed to drop index ${indexName}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error dropping index', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to drop index',
      });
    }
  }

  /**
   * Reindex table
   * POST /api/admin/tables/:tableName/reindex
   */
  static async reindexTable(req: Request, res: Response): Promise<void> {
    try {
      const { tableName } = req.params;

      const success = await indexRecommendationService.reindexTable(tableName);

      res.json({
        success,
        message: success
          ? `Table ${tableName} reindexed successfully`
          : `Failed to reindex table ${tableName}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error reindexing table', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to reindex table',
      });
    }
  }

  /**
   * Analyze table statistics
   * POST /api/admin/tables/:tableName/analyze
   */
  static async analyzeTableStats(req: Request, res: Response): Promise<void> {
    try {
      const { tableName } = req.params;

      const success = await indexRecommendationService.analyzeTable(tableName);

      res.json({
        success,
        message: success
          ? `Table ${tableName} analyzed successfully`
          : `Failed to analyze table ${tableName}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error analyzing table', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to analyze table',
      });
    }
  }

  /**
   * Vacuum table
   * POST /api/admin/tables/:tableName/vacuum
   */
  static async vacuumTable(req: Request, res: Response): Promise<void> {
    try {
      const { tableName } = req.params;
      const { full } = req.query;

      const success = await indexRecommendationService.vacuumTable(
        tableName,
        full === 'true',
      );

      res.json({
        success,
        message: success
          ? `Table ${tableName} vacuumed successfully`
          : `Failed to vacuum table ${tableName}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error vacuuming table', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to vacuum table',
      });
    }
  }

  /**
   * Reset query statistics
   * POST /api/admin/queries/reset-stats
   */
  static async resetQueryStats(req: Request, res: Response): Promise<void> {
    try {
      await queryAnalyzer.resetStatistics();

      res.json({
        success: true,
        message: 'Query statistics reset successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error resetting query statistics', { error: String(error) });
      res.status(500).json({
        success: false,
        error: 'Failed to reset query statistics',
      });
    }
  }
}

export default QueryAnalysisController;
