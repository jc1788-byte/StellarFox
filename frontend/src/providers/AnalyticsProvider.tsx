import React, { useEffect } from 'react';
import { initializeAnalytics, getAnalytics } from '../lib/analytics';
import { useAuth } from './AuthContext'; // Assuming you have an auth context

/**
 * Provider to initialize and manage analytics for the entire app
 */
export const AnalyticsProvider: React.FC<{
  children: React.ReactNode;
  apiBaseUrl?: string;
  trackErrors?: boolean;
  trackPageViews?: boolean;
}> = ({
  children,
  apiBaseUrl = process.env.REACT_APP_API_URL || '/api',
  trackErrors = true,
  trackPageViews = true,
}) => {
  useEffect(() => {
    // Initialize analytics
    const analytics = initializeAnalytics({
      enabled: true,
      apiBaseUrl,
      trackErrors,
      trackPageViews,
      sampleRate: process.env.NODE_ENV === 'production' ? 0.5 : 1.0,
    });

    // Start session - you might want to get user ID from auth context
    analytics.initSession();

    // End session on page unload
    const handleBeforeUnload = () => {
      analytics.endSession();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Optionally end session on component unmount (though beforeunload should handle it)
    };
  }, [apiBaseUrl, trackErrors, trackPageViews]);

  return <>{children}</>;
};

/**
 * Hook to get analytics instance (for use within components)
 */
export function useAnalyticsInstance() {
  return getAnalytics();
}

export default AnalyticsProvider;
