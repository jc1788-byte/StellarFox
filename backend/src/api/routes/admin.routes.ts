import { Router } from 'express';
import QueryAnalysisController from '../controllers/QueryAnalysisController';
import DatabaseAdminController from '../controllers/DatabaseAdminController';
import { requireAdmin } from '../../middleware/auth';

const router = Router();

// Apply admin authentication middleware to all routes
router.use(requireAdmin);

// ============ Query Analysis Routes ============

/**
 * Analyze a query execution
 * POST /api/admin/queries/analyze
 */
router.post('/queries/analyze', QueryAnalysisController.analyzeQuery);

/**
 * Get slow queries
 * GET /api/admin/queries/slow-queries?limit=10
 */
router.get('/queries/slow-queries', QueryAnalysisController.getSlowQueries);

/**
 * Get execution plan
 * POST /api/admin/queries/explain
 */
router.post('/queries/explain', QueryAnalysisController.explainQuery);

/**
 * Reset query statistics
 * POST /api/admin/queries/reset-stats
 */
router.post('/queries/reset-stats', QueryAnalysisController.resetQueryStats);

// ============ Index Management Routes ============

/**
 * Get index recommendations
 * GET /api/admin/recommendations/indexes
 */
router.get('/recommendations/indexes', QueryAnalysisController.getIndexRecommendations);

/**
 * Analyze index performance
 * GET /api/admin/indexes/performance
 */
router.get('/indexes/performance', QueryAnalysisController.analyzeIndexPerformance);

/**
 * Create recommended index
 * POST /api/admin/indexes/create
 */
router.post('/indexes/create', QueryAnalysisController.createRecommendedIndex);

/**
 * Drop unused index
 * DELETE /api/admin/indexes/:indexName
 */
router.delete('/indexes/:indexName', QueryAnalysisController.dropUnusedIndex);

/**
 * Reindex table
 * POST /api/admin/tables/:tableName/reindex
 */
router.post('/tables/:tableName/reindex', QueryAnalysisController.reindexTable);

/**
 * Analyze table statistics
 * POST /api/admin/tables/:tableName/analyze
 */
router.post('/tables/:tableName/analyze', QueryAnalysisController.analyzeTableStats);

/**
 * Vacuum table
 * POST /api/admin/tables/:tableName/vacuum?full=true
 */
router.post('/tables/:tableName/vacuum', QueryAnalysisController.vacuumTable);

// ============ Partitioning Routes ============

/**
 * Get partitioning status
 * GET /api/admin/partitions/status?table_name=bets
 */
router.get('/partitions/status', DatabaseAdminController.getPartitioningStatus);

/**
 * Create monthly partitions
 * POST /api/admin/partitions/create-monthly
 */
router.post('/partitions/create-monthly', DatabaseAdminController.createMonthlyPartitions);

/**
 * Rotate partitions
 * POST /api/admin/partitions/rotate
 */
router.post('/partitions/rotate', DatabaseAdminController.rotatePartitions);

// ============ Backup Routes ============

/**
 * Create backup
 * POST /api/admin/backups/create
 */
router.post('/backups/create', DatabaseAdminController.createBackup);

/**
 * List backups
 * GET /api/admin/backups/list
 */
router.get('/backups/list', DatabaseAdminController.listBackups);

/**
 * Restore from backup
 * POST /api/admin/backups/restore
 */
router.post('/backups/restore', DatabaseAdminController.restoreBackup);

/**
 * Test backup integrity
 * POST /api/admin/backups/test-restore
 */
router.post('/backups/test-restore', DatabaseAdminController.testRestore);

/**
 * Clean up old backups
 * POST /api/admin/backups/cleanup
 */
router.post('/backups/cleanup', DatabaseAdminController.cleanupOldBackups);

// ============ Monitoring Routes ============

/**
 * Get database metrics
 * GET /api/admin/monitoring/metrics
 */
router.get('/monitoring/metrics', DatabaseAdminController.getMetrics);

/**
 * Get health status
 * GET /api/admin/monitoring/health
 */
router.get('/monitoring/health', DatabaseAdminController.getHealthStatus);

export default router;
