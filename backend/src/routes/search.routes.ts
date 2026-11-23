// ============================================================
// BANKERCHANGER — Search Routes
// Advanced search endpoints with full-text search and facets
// ============================================================

import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { advancedSearch, getSearchFacets } from '../controllers/SearchController';
import { cacheMiddleware } from '../middleware/cache.middleware';

const router = Router();

/**
 * @swagger
 * /api/markets/search/advanced:
 *   get:
 *     summary: Advanced full-text search with filters, facets, and highlighting
 *     tags: [Markets]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 200
 *         description: Full-text search query
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 200
 *       - in: query
 *         name: categories
 *         schema:
 *           type: string
 *         description: Comma-separated category filters
 *       - in: query
 *         name: statuses
 *         schema:
 *           type: string
 *           enum: [open, locked, resolved, cancelled, disputed]
 *         description: Comma-separated status filters
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: minPool
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPool
 *         schema:
 *           type: number
 *       - in: query
 *         name: weightClasses
 *         schema:
 *           type: string
 *         description: Comma-separated weight class filters
 *     responses:
 *       200:
 *         description: Search results with facets and highlights
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           market:
 *                             $ref: '#/components/schemas/Market'
 *                           highlights:
 *                             type: array
 *                           score:
 *                             type: number
 *                     facets:
 *                       type: object
 *                       properties:
 *                         categories:
 *                           type: array
 *                         statuses:
 *                           type: array
 *                         dateRanges:
 *                           type: array
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       400:
 *         description: Missing or invalid search query
 */
router.get('/advanced', cacheMiddleware((req) => `search:${req.query.q}:${req.query.page}`, 60), advancedSearch);

/**
 * @swagger
 * /api/markets/search/facets:
 *   get:
 *     summary: Get available search facets for filtering
 *     tags: [Markets]
 *     responses:
 *       200:
 *         description: Available facets for search filters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     categories:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           value:
 *                             type: string
 *                           count:
 *                             type: integer
 *                     statuses:
 *                       type: array
 *                       items:
 *                         type: object
 *                     dateRanges:
 *                       type: array
 *                       items:
 *                         type: object
 */
router.get('/facets', cacheMiddleware(() => 'search:facets', 300), getSearchFacets);

export default router;
