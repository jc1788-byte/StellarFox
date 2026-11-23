import { useEffect, useCallback } from 'react';
import { getAnalytics } from '../lib/analytics';

/**
 * Hook to use analytics in React components
 */
export function useAnalytics() {
  const analytics = getAnalytics();

  const trackEvent = useCallback(
    (eventType: string, eventName: string, eventData?: any) => {
      analytics.trackEvent(eventType, eventName, eventData);
    },
    [analytics],
  );

  const trackPageView = useCallback(
    (pageName?: string) => {
      analytics.trackPageView(pageName);
    },
    [analytics],
  );

  const trackConversion = useCallback(
    (conversionType: string, conversionValue?: number) => {
      analytics.trackConversion(conversionType, conversionValue);
    },
    [analytics],
  );

  const trackError = useCallback(
    (errorMessage: string, errorStack?: string, context?: any) => {
      analytics.trackError(errorMessage, errorStack, context);
    },
    [analytics],
  );

  const trackFormSubmission = useCallback(
    (formName: string, formData?: any) => {
      analytics.trackFormSubmission(formName, formData);
    },
    [analytics],
  );

  const trackCustomEvent = useCallback(
    (eventCategory: string, eventLabel: string, eventValue?: number, eventMetadata?: any) => {
      analytics.trackCustomEvent(eventCategory, eventLabel, eventValue, eventMetadata);
    },
    [analytics],
  );

  return {
    trackEvent,
    trackPageView,
    trackConversion,
    trackError,
    trackFormSubmission,
    trackCustomEvent,
  };
}

/**
 * Hook to track page views on component mount
 */
export function useTrackPageView(pageName?: string) {
  const { trackPageView } = useAnalytics();

  useEffect(() => {
    trackPageView(pageName);
  }, [pageName, trackPageView]);
}

/**
 * Hook to track element clicks
 */
export function useTrackClick(elementName: string, onTrack?: () => void) {
  const { trackEvent } = useAnalytics();

  return useCallback(
    (e?: React.MouseEvent) => {
      trackEvent('interaction', 'element_click', { element: elementName });
      onTrack?.();
    },
    [trackEvent, elementName, onTrack],
  );
}

/**
 * Hook to track form submission
 */
export function useTrackFormSubmission(formName: string) {
  const { trackFormSubmission } = useAnalytics();

  return useCallback(
    (formData?: any) => {
      trackFormSubmission(formName, formData);
    },
    [trackFormSubmission, formName],
  );
}

/**
 * Hook to track time spent on page
 */
export function useTrackTimeSpent(eventName?: string) {
  const { trackEvent } = useAnalytics();

  useEffect(() => {
    const startTime = Date.now();

    return () => {
      const timeSpent = (Date.now() - startTime) / 1000; // Convert to seconds
      trackEvent('interaction', eventName || 'time_spent', { seconds: timeSpent });
    };
  }, [trackEvent, eventName]);
}

/**
 * Hook to track scroll depth
 */
export function useTrackScrollDepth() {
  const { trackCustomEvent } = useAnalytics();

  useEffect(() => {
    let maxScrollDepth = 0;
    let hasTracked25 = false;
    let hasTracked50 = false;
    let hasTracked75 = false;
    let hasTracked100 = false;

    const handleScroll = () => {
      if (typeof window === 'undefined') return;

      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent =
        docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;

      maxScrollDepth = Math.max(maxScrollDepth, scrollPercent);

      if (scrollPercent >= 25 && !hasTracked25) {
        hasTracked25 = true;
        trackCustomEvent('scroll_depth', 'reached_25_percent');
      }
      if (scrollPercent >= 50 && !hasTracked50) {
        hasTracked50 = true;
        trackCustomEvent('scroll_depth', 'reached_50_percent');
      }
      if (scrollPercent >= 75 && !hasTracked75) {
        hasTracked75 = true;
        trackCustomEvent('scroll_depth', 'reached_75_percent');
      }
      if (scrollPercent >= 100 && !hasTracked100) {
        hasTracked100 = true;
        trackCustomEvent('scroll_depth', 'reached_100_percent');
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [trackCustomEvent]);
}

/**
 * Hook to track session duration
 */
export function useTrackSessionDuration() {
  const { trackCustomEvent } = useAnalytics();

  useEffect(() => {
    const startTime = Date.now();

    return () => {
      const sessionDuration = (Date.now() - startTime) / 1000; // Convert to seconds
      trackCustomEvent('session', 'session_duration', sessionDuration);
    };
  }, [trackCustomEvent]);
}

/**
 * Hook to track element visibility (when element comes into view)
 */
export function useTrackElementVisibility(
  ref: React.RefObject<HTMLElement>,
  eventLabel: string,
) {
  const { trackCustomEvent } = useAnalytics();

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            trackCustomEvent('visibility', eventLabel);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 },
    );

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, [ref, eventLabel, trackCustomEvent]);
}
