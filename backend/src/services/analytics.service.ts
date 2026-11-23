import { db } from '../db';
import {
  analyticsUserSessions,
  analyticsUserEvents,
  heatmapData,
  sessionRecordings,
  pageAnalytics,
  heatmapAggregates,
  userAnalyticsSummary,
  analyticsCustomEvents,
} from '../db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import crypto from 'crypto';
import pino from 'pino';

const logger = pino();

export interface CreateSessionRequest {
  userId: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  deviceInfo?: Record<string, unknown>;
}

export interface TrackEventRequest {
  userId: string;
  sessionId: string;
  eventType: string;
  eventName: string;
  pageUrl?: string;
  referrerUrl?: string;
  eventData?: Record<string, unknown>;
  durationMs?: number;
}

export interface TrackHeatmapRequest {
  userId: string;
  sessionId: string;
  pageUrl: string;
  interactionType: 'click' | 'scroll' | 'hover' | 'move';
  x: number;
  y: number;
  elementId?: string;
  elementClass?: string;
  elementText?: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface TrackCustomEventRequest {
  userId?: string;
  eventCategory: string;
  eventLabel: string;
  eventValue?: number;
  eventMetadata?: Record<string, unknown>;
  pageUrl?: string;
  sessionId?: string;
}

export class AnalyticsService {
  /**
   * Create a new user session
   */
  async createSession(request: CreateSessionRequest) {
    const sessionId = crypto.randomUUID();

    const session = await db.insert(analyticsUserSessions).values({
      user_id: request.userId,
      session_id: sessionId,
      browser: request.browser,
      os: request.os,
      ip_address: request.ipAddress,
      device_info: request.deviceInfo || null,
      started_at: new Date(),
      page_views: 0,
      events_count: 0,
    });

    logger.info({ userId: request.userId, sessionId }, 'User session created');
    return { sessionId };
  }

  /**
   * End a user session
   */
  async endSession(sessionId: string) {
    const session = await db
      .select()
      .from(analyticsUserSessions)
      .where(eq(analyticsUserSessions.session_id, sessionId))
      .limit(1);

    if (!session || session.length === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startedAt = session[0].started_at;
    const durationSeconds = Math.floor(
      (new Date().getTime() - startedAt.getTime()) / 1000,
    );

    await db
      .update(analyticsUserSessions)
      .set({
        ended_at: new Date(),
        duration_seconds: durationSeconds,
        updated_at: new Date(),
      })
      .where(eq(analyticsUserSessions.session_id, sessionId));

    return { durationSeconds };
  }

  /**
   * Track a user event
   */
  async trackEvent(request: TrackEventRequest) {
    const event = await db.insert(analyticsUserEvents).values({
      user_id: request.userId,
      session_id: request.sessionId,
      event_type: request.eventType,
      event_name: request.eventName,
      page_url: request.pageUrl,
      referrer_url: request.referrerUrl,
      event_data: request.eventData || null,
      duration_ms: request.durationMs || null,
      timestamp: new Date(),
    });

    // Increment event count in session
    await db
      .update(analyticsUserSessions)
      .set({
        events_count: sql`${analyticsUserSessions.events_count} + 1`,
      })
      .where(eq(analyticsUserSessions.session_id, request.sessionId));

    return event;
  }

  /**
   * Track heatmap interaction
   */
  async trackHeatmapInteraction(request: TrackHeatmapRequest) {
    const heatmap = await db.insert(heatmapData).values({
      user_id: request.userId,
      session_id: request.sessionId,
      page_url: request.pageUrl,
      interaction_type: request.interactionType,
      x_coordinate: request.x,
      y_coordinate: request.y,
      element_id: request.elementId,
      element_class: request.elementClass,
      element_text: request.elementText,
      viewport_width: request.viewportWidth,
      viewport_height: request.viewportHeight,
      timestamp: new Date(),
    });

    return heatmap;
  }

  /**
   * Track custom event
   */
  async trackCustomEvent(request: TrackCustomEventRequest) {
    const event = await db.insert(analyticsCustomEvents).values({
      user_id: request.userId,
      event_category: request.eventCategory,
      event_label: request.eventLabel,
      event_value: request.eventValue,
      event_metadata: request.eventMetadata || null,
      page_url: request.pageUrl,
      session_id: request.sessionId,
      timestamp: new Date(),
    });

    return event;
  }

  /**
   * Get page analytics for a specific date range
   */
  async getPageAnalytics(pageUrl: string, startDate: Date, endDate: Date) {
    const analytics = await db
      .select()
      .from(pageAnalytics)
      .where(
        and(
          eq(pageAnalytics.page_url, pageUrl),
          gte(pageAnalytics.date, sql`${startDate}::date`),
          lte(pageAnalytics.date, sql`${endDate}::date`),
        ),
      )
      .orderBy(pageAnalytics.date);

    return analytics;
  }

  /**
   * Get user analytics summary for a specific date
   */
  async getUserAnalyticsSummary(userId: string, date: Date) {
    const summary = await db
      .select()
      .from(userAnalyticsSummary)
      .where(
        and(
          eq(userAnalyticsSummary.user_id, userId),
          eq(userAnalyticsSummary.date, sql`${date}::date`),
        ),
      )
      .limit(1);

    return summary[0] || null;
  }

  /**
   * Get events for a session
   */
  async getSessionEvents(sessionId: string) {
    const events = await db
      .select()
      .from(analyticsUserEvents)
      .where(eq(analyticsUserEvents.session_id, sessionId))
      .orderBy(analyticsUserEvents.timestamp);

    return events;
  }

  /**
   * Get heatmap data for a page
   */
  async getHeatmapData(
    pageUrl: string,
    interactionType?: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    let query = db
      .select()
      .from(heatmapData)
      .where(eq(heatmapData.page_url, pageUrl));

    if (interactionType) {
      query = query.where(eq(heatmapData.interaction_type, interactionType));
    }

    if (startDate && endDate) {
      query = query.where(
        and(
          gte(heatmapData.timestamp, startDate),
          lte(heatmapData.timestamp, endDate),
        ),
      );
    }

    const data = await query;
    return data;
  }

  /**
   * Generate heatmap aggregates for a page
   */
  async generateHeatmapAggregate(
    pageUrl: string,
    date: Date,
    interactionType: string,
    gridSize: number = 50,
  ) {
    // Get all heatmap data for the page on the date
    const data = await db
      .select()
      .from(heatmapData)
      .where(
        and(
          eq(heatmapData.page_url, pageUrl),
          eq(heatmapData.interaction_type, interactionType),
          sql`DATE(${heatmapData.timestamp}) = ${date}::date`,
        ),
      );

    if (data.length === 0) {
      return null;
    }

    // Create grid-based heatmap
    const heatmapGrid: Record<string, number> = {};

    for (const point of data) {
      const gridX = Math.floor(point.x_coordinate / gridSize);
      const gridY = Math.floor(point.y_coordinate / gridSize);
      const key = `${gridX},${gridY}`;
      heatmapGrid[key] = (heatmapGrid[key] || 0) + 1;
    }

    // Save aggregate
    const existing = await db
      .select()
      .from(heatmapAggregates)
      .where(
        and(
          eq(heatmapAggregates.page_url, pageUrl),
          eq(heatmapAggregates.date, sql`${date}::date`),
          eq(heatmapAggregates.interaction_type, interactionType),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(heatmapAggregates)
        .set({
          heatmap_json: heatmapGrid,
          sample_count: data.length,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(heatmapAggregates.page_url, pageUrl),
            eq(heatmapAggregates.date, sql`${date}::date`),
            eq(heatmapAggregates.interaction_type, interactionType),
          ),
        );
    } else {
      await db.insert(heatmapAggregates).values({
        page_url: pageUrl,
        date: new Date(date),
        interaction_type: interactionType,
        heatmap_json: heatmapGrid,
        sample_count: data.length,
        grid_size: gridSize,
      });
    }

    return {
      pageUrl,
      date,
      interactionType,
      heatmapGrid,
      sampleCount: data.length,
    };
  }

  /**
   * Get custom events by category
   */
  async getCustomEventsByCategory(
    eventCategory: string,
    startDate: Date,
    endDate: Date,
    limit: number = 100,
  ) {
    const events = await db
      .select()
      .from(analyticsCustomEvents)
      .where(
        and(
          eq(analyticsCustomEvents.event_category, eventCategory),
          gte(analyticsCustomEvents.timestamp, startDate),
          lte(analyticsCustomEvents.timestamp, endDate),
        ),
      )
      .orderBy(analyticsCustomEvents.timestamp)
      .limit(limit);

    return events;
  }

  /**
   * Create a session recording entry
   */
  async createSessionRecording(
    userId: string,
    sessionId: string,
    startedAt: Date,
  ) {
    const recording = await db.insert(sessionRecordings).values({
      user_id: userId,
      session_id: sessionId,
      status: 'processing',
      started_at: startedAt,
    });

    return recording;
  }

  /**
   * Update session recording after processing
   */
  async updateSessionRecording(
    sessionId: string,
    data: {
      recordingUrl?: string;
      storageKey?: string;
      durationSeconds?: number;
      eventCount?: number;
      fileSizeBytes?: number;
      status?: string;
      endedAt?: Date;
    },
  ) {
    const updateData: any = {
      updated_at: new Date(),
    };

    if (data.recordingUrl) updateData.recording_url = data.recordingUrl;
    if (data.storageKey) updateData.storage_key = data.storageKey;
    if (data.durationSeconds) updateData.duration_seconds = data.durationSeconds;
    if (data.eventCount) updateData.event_count = data.eventCount;
    if (data.fileSizeBytes) updateData.file_size_bytes = data.fileSizeBytes;
    if (data.status) updateData.status = data.status;
    if (data.endedAt) updateData.ended_at = data.endedAt;

    await db
      .update(sessionRecordings)
      .set(updateData)
      .where(eq(sessionRecordings.session_id, sessionId));
  }

  /**
   * Get heatmap aggregate data
   */
  async getHeatmapAggregate(
    pageUrl: string,
    date: Date,
    interactionType: string,
  ) {
    const aggregate = await db
      .select()
      .from(heatmapAggregates)
      .where(
        and(
          eq(heatmapAggregates.page_url, pageUrl),
          eq(heatmapAggregates.date, sql`${date}::date`),
          eq(heatmapAggregates.interaction_type, interactionType),
        ),
      )
      .limit(1);

    return aggregate[0] || null;
  }

  /**
   * Get trending pages
   */
  async getTrendingPages(limit: number = 10, daysBack: number = 7) {
    const days = Math.max(1, daysBack);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const pages = await db
      .select({
        page_url: pageAnalytics.page_url,
        page_name: pageAnalytics.page_name,
        total_views: sql<number>`SUM(${pageAnalytics.page_views})`,
        avg_bounce_rate: sql<number>`AVG(${pageAnalytics.bounce_rate})`,
        avg_time_on_page: sql<number>`AVG(${pageAnalytics.avg_time_on_page_seconds})`,
      })
      .from(pageAnalytics)
      .where(gte(pageAnalytics.date, sql`${startDate}::date`))
      .groupBy(pageAnalytics.page_url, pageAnalytics.page_name)
      .orderBy(sql`SUM(${pageAnalytics.page_views}) DESC`)
      .limit(limit);

    return pages;
  }
}

export const analyticsService = new AnalyticsService();
