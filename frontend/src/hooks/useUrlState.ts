// ============================================================
// BANKERCHANGER — useUrlState Hook
// Synchronizes application state with URL for deep linking and browser history
// ============================================================

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export interface UrlStateOptions {
  debounceMs?: number;
  replaceHistory?: boolean;
}

interface UrlStateConfig {
  key: string;
  encode?: (value: any) => string;
  decode?: (value: string) => any;
}

/**
 * Synchronizes component state with URL query parameters for:
 * - Deep linking: Users can share URLs with filters/search preserved
 * - Browser history: Back/forward buttons restore previous filter state
 * - Bookmarking: Bookmarked URLs restore the exact app state
 *
 * Usage:
 * const [search, setSearch] = useUrlState('q', { decode: (v) => v, encode: (v) => v });
 * const [filters, setFilters] = useUrlState('filters', {
 *   encode: (obj) => JSON.stringify(obj),
 *   decode: (str) => JSON.parse(str),
 * });
 */
export function useUrlState<T>(
  paramName: string,
  config?: UrlStateConfig & UrlStateOptions,
): [T | undefined, (value: T | undefined) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState<T | undefined>(undefined);
  const [isClient, setIsClient] = useState(false);

  const encode = config?.encode ?? ((v) => String(v ?? ''));
  const decode = config?.decode ?? ((v) => v as T);
  const debounceMs = config?.debounceMs ?? 300;
  const replaceHistory = config?.replaceHistory ?? false;

  // Initialize from URL on client side
  useEffect(() => {
    setIsClient(true);
    const urlValue = searchParams.get(config?.key || paramName);
    if (urlValue) {
      try {
        setValue(decode(urlValue));
      } catch (e) {
        console.error(`Failed to decode ${paramName}:`, e);
      }
    }
  }, [paramName, searchParams, config?.key, decode]);

  // Debounce timer for URL updates
  useEffect(() => {
    if (!isClient || value === undefined) return;

    const timer = setTimeout(() => {
      updateUrl(value);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [value, debounceMs, isClient]);

  const updateUrl = useCallback(
    (newValue: T | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      const key = config?.key || paramName;

      if (newValue === undefined || newValue === null) {
        params.delete(key);
      } else {
        try {
          params.set(key, encode(newValue));
        } catch (e) {
          console.error(`Failed to encode ${paramName}:`, e);
          return;
        }
      }

      const newUrl = `${window.location.pathname}?${params.toString()}`;
      
      if (replaceHistory) {
        router.replace(newUrl);
      } else {
        // Use browser history API directly to avoid Next.js scroll reset
        window.history.pushState(null, '', newUrl);
      }
    },
    [searchParams, paramName, config?.key, encode, replaceHistory, router],
  );

  const handleSetValue = useCallback(
    (newValue: T | undefined) => {
      setValue(newValue);
    },
    [],
  );

  return [value, handleSetValue];
}

/**
 * Synchronizes multiple URL parameters as an object
 */
export function useUrlStateObject<T extends Record<string, any>>(
  config?: UrlStateOptions,
): [T, (updates: Partial<T>) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<T>({} as T);
  const [isClient, setIsClient] = useState(false);

  const debounceMs = config?.debounceMs ?? 300;
  const replaceHistory = config?.replaceHistory ?? false;

  // Initialize from URL on client
  useEffect(() => {
    setIsClient(true);
    const newState: any = {};
    searchParams.forEach((value, key) => {
      // Try to parse as JSON for objects/arrays, otherwise keep as string
      try {
        newState[key] = JSON.parse(value);
      } catch {
        newState[key] = value;
      }
    });
    setState(newState);
  }, [searchParams]);

  // Debounce URL updates
  useEffect(() => {
    if (!isClient) return;

    const timer = setTimeout(() => {
      updateUrl(state);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [state, debounceMs, isClient]);

  const updateUrl = useCallback(
    (newState: T) => {
      const params = new URLSearchParams();
      
      Object.entries(newState).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          params.delete(key);
        } else if (typeof value === 'object') {
          params.set(key, JSON.stringify(value));
        } else {
          params.set(key, String(value));
        }
      });

      const newUrl = `${window.location.pathname}?${params.toString()}`;
      
      if (replaceHistory) {
        router.replace(newUrl);
      } else {
        window.history.pushState(null, '', newUrl);
      }
    },
    [replaceHistory, router],
  );

  const handleUpdate = useCallback(
    (updates: Partial<T>) => {
      setState((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  return [state, handleUpdate];
}

/**
 * Hook for managing search and filter state synced with URL
 */
export function useSearchState() {
  const [search, setSearch] = useUrlState('q', {
    key: 'q',
    encode: (v) => v as string,
    decode: (v) => v as string,
  });

  const [filters, setFilters] = useUrlState('filters', {
    key: 'filters',
    encode: (obj) => JSON.stringify(obj),
    decode: (str) => JSON.parse(str),
  });

  const [page, setPage] = useUrlState('page', {
    key: 'page',
    encode: (v) => String(v),
    decode: (v) => parseInt(v, 10),
  });

  const [limit, setLimit] = useUrlState('limit', {
    key: 'limit',
    encode: (v) => String(v),
    decode: (v) => parseInt(v, 10),
  });

  return {
    search: search || '',
    setSearch,
    filters: filters || {},
    setFilters,
    page: page || 1,
    setPage,
    limit: limit || 20,
    setLimit,
  };
}

/**
 * Clears all URL parameters
 */
export function useClearUrlState() {
  const router = useRouter();

  return useCallback(() => {
    const newUrl = window.location.pathname;
    window.history.pushState(null, '', newUrl);
    router.push(newUrl);
  }, [router]);
}

/**
 * Gets current URL state as an object
 */
export function useGetUrlState(): Record<string, string> {
  const searchParams = useSearchParams();
  const [state, setState] = useState<Record<string, string>>({});

  useEffect(() => {
    const newState: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      newState[key] = value;
    });
    setState(newState);
  }, [searchParams]);

  return state;
}
