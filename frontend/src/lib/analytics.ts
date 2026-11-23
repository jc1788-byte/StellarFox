/**
 * Frontend Analytics Library
 * Tracks user interactions, sessions, heatmaps, and custom events for UX optimization
 */

export interface AnalyticsConfig {
  enabled: boolean;
  apiBaseUrl: string;
  sessionDuration?: number; // milliseconds before session expires
  trackPageViews?: boolean;
  trackClicks?: boolean;
  trackScrolls?: boolean;
  trackErrors?: boolean;
  sampleRate?: number; // 0-1, percentage of events to track
  batchSize?: number; // number of events to batch before sending
  batchInterval?: number; // milliseconds between batch sends
}

export interface SessionInfo {
  sessionId: string;
  userId?: string;
  startTime: Date;
  browser?: string;
  os?: string;
  ipAddress?: string;
}

interface PendingEvent {
  timestamp: Date;
  data: any;
}

export class AnalyticsClient {
  private config: AnalyticsConfig;
  private session: SessionInfo | null = null;
  private pendingEvents: PendingEvent[] = [];
  private pendingHeatmapEvents: PendingEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private heatmapTimer: NodeJS.Timeout | null = null;
  private mouseTracker: boolean = false;
  private scrollTracker: boolean = false;

  constructor(config: Partial<AnalyticsConfig> = {}) {
    this.config = {
      enabled: true,
      apiBaseUrl: process.env.REACT_APP_API_URL || '/api',
      sessionDuration: 30 * 60 * 1000, // 30 minutes
      trackPageViews: true,
      trackClicks: true,
      trackScrolls: true,
      trackErrors: true,
      sampleRate: 1,
      batchSize: 10,
      batchInterval: 5000, // 5 seconds
      ...config,
    };
  }

  /**
   * Initialize analytics session
   */
  async initSession(userId?: string): Promise<string> {
    if (!this.config.enabled) {
      return '';
    }

    try {
      const deviceInfo = this.getDeviceInfo();
      const response = await fetch(`${this.config.apiBaseUrl}/analytics/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          ipAddress: deviceInfo.ipAddress,
          deviceInfo,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const data = await response.json();
      this.session = {
        sessionId: data.sessionId,
        userId,
        startTime: new Date(),
        browser: deviceInfo.browser,
        os: deviceInfo.os,
      };

      // Store session in sessionStorage
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('analyticsSessionId', data.sessionId);
      }

      this.setupTracking();
      return data.sessionId;
    } catch (error) {
      console.error('Failed to initialize analytics session:', error);
      return '';
    }
  }

  /**
   * End the current session
   */
  async endSession(): Promise<void> {
    if (!this.session) return;

    try {
      // Flush pending events
      await this.flushEvents();
      await this.flushHeatmapEvents();

      await fetch(`${this.config.apiBaseUrl}/analytics/session/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId: this.session.sessionId }),
      });

      this.session = null;
      this.teardownTracking();

      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('analyticsSessionId');
      }
    } catch (error) {
      console.error('Failed to end analytics session:', error);
    }
  }

  /**
   * Track a user event
   */
  trackEvent(eventType: string, eventName: string, eventData?: any): void {
    if (!this.config.enabled || !this.session) return;

    // Sample events
    if (Math.random() > this.config.sampleRate!) {
      return;
    }

    const event = {
      sessionId: this.session.sessionId,
      eventType,
      eventName,
      pageUrl: typeof window !== 'undefined' ? window.location.pathname : '',
      referrerUrl: typeof window !== 'undefined' ? document.referrer : '',
      eventData,
      timestamp: new Date(),
    };

    this.pendingEvents.push({ timestamp: new Date(), data: event });

    if (this.pendingEvents.length >= this.config.batchSize!) {
      this.flushEvents();
    }
  }

  /**
   * Track page view
   */
  trackPageView(pageName?: string): void {
    if (!this.config.enabled || !this.config.trackPageViews) return;

    const page = pageName || (typeof window !== 'undefined' ? window.location.pathname : '');
    this.trackEvent('pageview', 'page_view', { page });
  }

  /**
   * Track heatmap interaction
   */
  trackHeatmapInteraction(
    interactionType: 'click' | 'scroll' | 'hover' | 'move',
    x: number,
    y: number,
    element?: Element,
  ): void {
    if (!this.config.enabled || !this.session) return;

    // Sample heatmap events more aggressively to reduce data
    if (Math.random() > Math.max(0.1, this.config.sampleRate! * 0.5)) {
      return;
    }

    const elementInfo = element
      ? {
          elementId: element.id,
          elementClass: element.className,
          elementText: (element.textContent || '').substring(0, 100),
        }
      : {};

    const viewport =
      typeof window !== 'undefined'
        ? { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
        : {};

    const heatmapEvent = {
      sessionId: this.session.sessionId,
      pageUrl: typeof window !== 'undefined' ? window.location.pathname : '',
      interactionType,
      x,
      y,
      ...elementInfo,
      ...viewport,
      timestamp: new Date(),
    };

    this.pendingHeatmapEvents.push({ timestamp: new Date(), data: heatmapEvent });
  }

  /**
   * Track custom event (form submission, error, conversion, etc.)
   */
  trackCustomEvent(
    eventCategory: string,
    eventLabel: string,
    eventValue?: number,
    eventMetadata?: any,
  ): void {
    if (!this.config.enabled) return;

    fetch(`${this.config.apiBaseUrl}/analytics/custom-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        eventCategory,
        eventLabel,
        eventValue,
        eventMetadata,
        pageUrl: typeof window !== 'undefined' ? window.location.pathname : '',
        sessionId: this.session?.sessionId,
      }),
    }).catch((error) => console.error('Failed to track custom event:', error));
  }

  /**
   * Track conversion (bet placed, account created, etc.)
   */
  trackConversion(conversionType: string, conversionValue?: number): void {
    this.trackCustomEvent('conversion', conversionType, conversionValue);
  }

  /**
   * Track error
   */
  trackError(errorMessage: string, errorStack?: string, context?: any): void {
    if (!this.config.enabled) return;

    this.trackCustomEvent('error', errorMessage, undefined, {
      errorStack,
      context,
    });
  }

  /**
   * Track form submission
   */
  trackFormSubmission(formName: string, formData?: any): void {
    this.trackCustomEvent('form_submission', formName, undefined, formData);
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    if (typeof window !== 'undefined' && !this.session) {
      const stored = sessionStorage.getItem('analyticsSessionId');
      if (stored) {
        this.session = {
          sessionId: stored,
          startTime: new Date(),
        };
      }
    }
    return this.session?.sessionId || null;
  }

  /**
   * Flush pending events to server
   */
  private async flushEvents(): Promise<void> {
    if (this.pendingEvents.length === 0) return;

    const events = this.pendingEvents.splice(0, this.pendingEvents.length);

    try {
      await Promise.all(
        events.map((event) =>
          fetch(`${this.config.apiBaseUrl}/analytics/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(event.data),
          }),
        ),
      );
    } catch (error) {
      console.error('Failed to flush analytics events:', error);
    }
  }

  /**
   * Flush pending heatmap events
   */
  private async flushHeatmapEvents(): Promise<void> {
    if (this.pendingHeatmapEvents.length === 0) return;

    const events = this.pendingHeatmapEvents.splice(0, this.pendingHeatmapEvents.length);

    try {
      await Promise.all(
        events.map((event) =>
          fetch(`${this.config.apiBaseUrl}/analytics/heatmap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(event.data),
          }),
        ),
      );
    } catch (error) {
      console.error('Failed to flush heatmap events:', error);
    }
  }

  /**
   * Setup tracking listeners
   */
  private setupTracking(): void {
    if (typeof window === 'undefined') return;

    // Track clicks
    if (this.config.trackClicks) {
      window.addEventListener('click', this.handleClick.bind(this), true);
    }

    // Track scrolls
    if (this.config.trackScrolls) {
      window.addEventListener('scroll', this.handleScroll.bind(this), true);
    }

    // Track mouse movements (for heatmap)
    if (this.config.trackClicks) {
      window.addEventListener('mousemove', this.handleMouseMove.bind(this));
    }

    // Track errors
    if (this.config.trackErrors) {
      window.addEventListener('error', this.handleError.bind(this));
    }

    // Setup batch flush interval
    this.batchTimer = setInterval(() => {
      if (this.pendingEvents.length > 0) {
        this.flushEvents();
      }
    }, this.config.batchInterval);

    // Setup heatmap flush interval
    this.heatmapTimer = setInterval(() => {
      if (this.pendingHeatmapEvents.length > 0) {
        this.flushHeatmapEvents();
      }
    }, this.config.batchInterval! * 2);

    // Track page visibility
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.flushEvents();
        this.flushHeatmapEvents();
      }
    });
  }

  /**
   * Teardown tracking listeners
   */
  private teardownTracking(): void {
    if (typeof window === 'undefined') return;

    window.removeEventListener('click', this.handleClick.bind(this), true);
    window.removeEventListener('scroll', this.handleScroll.bind(this), true);
    window.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    window.removeEventListener('error', this.handleError.bind(this));

    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    if (this.heatmapTimer) {
      clearInterval(this.heatmapTimer);
    }
  }

  /**
   * Handle click events
   */
  private handleClick(event: MouseEvent): void {
    const target = event.target as Element;
    this.trackHeatmapInteraction('click', event.clientX, event.clientY, target);
    this.trackEvent('interaction', 'click', {
      element: target.tagName,
      id: target.id,
      class: target.className,
    });
  }

  /**
   * Handle scroll events
   */
  private handleScroll(): void {
    if (!this.scrollTracker) {
      this.scrollTracker = true;
      this.trackEvent('interaction', 'scroll', {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      });
      setTimeout(() => {
        this.scrollTracker = false;
      }, 1000); // Throttle scroll events
    }
  }

  /**
   * Handle mouse move events (throttled for heatmap)
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.mouseTracker) {
      this.mouseTracker = true;
      this.trackHeatmapInteraction('move', event.clientX, event.clientY);
      setTimeout(() => {
        this.mouseTracker = false;
      }, 500); // Throttle mouse move events
    }
  }

  /**
   * Handle error events
   */
  private handleError(event: ErrorEvent): void {
    this.trackError(event.message, event.error?.stack);
  }

  /**
   * Get device info
   */
  private getDeviceInfo(): any {
    if (typeof window === 'undefined') {
      return {};
    }

    const userAgent = navigator.userAgent;

    return {
      userAgent,
      browser: this.getBrowserName(userAgent),
      os: this.getOS(userAgent),
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      colorDepth: window.screen.colorDepth,
    };
  }

  /**
   * Parse browser name from user agent
   */
  private getBrowserName(userAgent: string): string {
    if (/Chrome/.test(userAgent)) return 'Chrome';
    if (/Safari/.test(userAgent)) return 'Safari';
    if (/Firefox/.test(userAgent)) return 'Firefox';
    if (/Edge/.test(userAgent)) return 'Edge';
    return 'Unknown';
  }

  /**
   * Parse OS from user agent
   */
  private getOS(userAgent: string): string {
    if (/Win/.test(userAgent)) return 'Windows';
    if (/Mac/.test(userAgent)) return 'MacOS';
    if (/Linux/.test(userAgent)) return 'Linux';
    if (/Android/.test(userAgent)) return 'Android';
    if (/iPhone|iPad/.test(userAgent)) return 'iOS';
    return 'Unknown';
  }
}

// Global singleton instance
let analyticsInstance: AnalyticsClient | null = null;

export function initializeAnalytics(config?: Partial<AnalyticsConfig>): AnalyticsClient {
  if (!analyticsInstance) {
    analyticsInstance = new AnalyticsClient(config);
  }
  return analyticsInstance;
}

export function getAnalytics(): AnalyticsClient {
  if (!analyticsInstance) {
    analyticsInstance = new AnalyticsClient();
  }
  return analyticsInstance;
}
