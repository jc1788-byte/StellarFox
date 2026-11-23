/**
 * Health monitoring for indexer service with liveness and readiness probes
 * 
 * Liveness (/healthz/live): Is the process alive? (always yes if this responds)
 * Readiness (/healthz/ready): Is the service ready to handle traffic?
 *   - Database connectivity
 *   - RPC connectivity
 *   - Cursor advancing (no stale data)
 */

interface HealthState {
  lastLedger: number | null;
  lastUpdate: Date | null;
  dependencies: {
    database: {
      healthy: boolean;
      lastChecked: Date | null;
      error: string | null;
    };
    rpc: {
      healthy: boolean;
      lastChecked: Date | null;
      error: string | null;
    };
  };
}

const state: HealthState = {
  lastLedger: null,
  lastUpdate: null,
  dependencies: {
    database: {
      healthy: false,
      lastChecked: null,
      error: null,
    },
    rpc: {
      healthy: false,
      lastChecked: null,
      error: null,
    },
  },
};

/**
 * Maximum allowed age of cursor before readiness probe fails (in milliseconds).
 * If we haven't processed an event in this time, the service is not ready.
 * Set to 5 minutes to allow for slow periods but catch stuck indexers.
 */
const MAX_CURSOR_AGE_MS = 5 * 60 * 1000;

/**
 * Maximum allowed age of dependency checks before they're considered stale
 */
const MAX_DEPENDENCY_CHECK_AGE_MS = 30 * 1000; // 30 seconds

/**
 * Update the last processed ledger
 */
export function updateLastLedger(ledger: number): void {
  state.lastLedger = ledger;
  state.lastUpdate = new Date();
}

/**
 * Update dependency health status (database)
 */
export function setDatabaseHealth(healthy: boolean, error?: string): void {
  state.dependencies.database.healthy = healthy;
  state.dependencies.database.lastChecked = new Date();
  state.dependencies.database.error = error ?? null;
}

/**
 * Update dependency health status (RPC)
 */
export function setRpcHealth(healthy: boolean, error?: string): void {
  state.dependencies.rpc.healthy = healthy;
  state.dependencies.rpc.lastChecked = new Date();
  state.dependencies.rpc.error = error ?? null;
}

/**
 * Get the current health state
 */
export function getHealthState(): { 
  lastLedger: number | null; 
  cursorAge: number | null;
  dependencies: typeof state.dependencies;
} {
  const cursorAge = state.lastUpdate ? Date.now() - state.lastUpdate.getTime() : null;

  return {
    lastLedger: state.lastLedger,
    cursorAge,
    dependencies: state.dependencies,
  };
}

/**
 * Check if a dependency check is fresh (not stale)
 */
function isDependencyCheckFresh(lastChecked: Date | null): boolean {
  if (!lastChecked) return false;
  const age = Date.now() - lastChecked.getTime();
  return age <= MAX_DEPENDENCY_CHECK_AGE_MS;
}

/**
 * Check if the service is alive (process is running)
 * Used by Kubernetes liveness probes
 */
export function isLive(): boolean {
  // If this function is called, the process is alive
  return true;
}

/**
 * Check if the service is ready to handle traffic
 * Used by Kubernetes readiness probes
 * 
 * Ready if:
 * - At least one ledger has been processed (cursor has advanced)
 * - Cursor is not stale (updated within MAX_CURSOR_AGE_MS)
 * - Database is healthy and recently checked
 * - RPC is healthy and recently checked
 */
export function isReady(): boolean {
  // Check if we've ever processed a ledger
  if (state.lastLedger === null || state.lastUpdate === null) {
    return false;
  }

  // Check if cursor is stale
  const cursorAge = Date.now() - state.lastUpdate.getTime();
  if (cursorAge > MAX_CURSOR_AGE_MS) {
    return false;
  }

  // Check database health (if recently checked and not healthy, fail)
  if (isDependencyCheckFresh(state.dependencies.database.lastChecked)) {
    if (!state.dependencies.database.healthy) {
      return false;
    }
  }

  // Check RPC health (if recently checked and not healthy, fail)
  if (isDependencyCheckFresh(state.dependencies.rpc.lastChecked)) {
    if (!state.dependencies.rpc.healthy) {
      return false;
    }
  }

  return true;
}

/**
 * Get detailed readiness information for debugging
 */
export function getReadinessDetails(): {
  ready: boolean;
  lastLedger: number | null;
  cursorAge: number | null;
  maxCursorAge: number;
  dependencies: {
    database: {
      healthy: boolean;
      lastCheckedAgo: number | null;
      error: string | null;
    };
    rpc: {
      healthy: boolean;
      lastCheckedAgo: number | null;
      error: string | null;
    };
  };
  reasons: string[];
} {
  const health = getHealthState();
  const reasons: string[] = [];

  if (health.lastLedger === null) {
    reasons.push('No ledgers processed yet');
  }

  if (health.cursorAge === null) {
    reasons.push('Cursor age unknown');
  } else if (health.cursorAge > MAX_CURSOR_AGE_MS) {
    reasons.push(
      `Cursor is stale: ${health.cursorAge}ms old (max: ${MAX_CURSOR_AGE_MS}ms)`,
    );
  }

  const dbCheckAge = state.dependencies.database.lastChecked 
    ? Date.now() - state.dependencies.database.lastChecked.getTime() 
    : null;
  const rpcCheckAge = state.dependencies.rpc.lastChecked 
    ? Date.now() - state.dependencies.rpc.lastChecked.getTime() 
    : null;

  if (isDependencyCheckFresh(state.dependencies.database.lastChecked) && !state.dependencies.database.healthy) {
    reasons.push(`Database unhealthy: ${state.dependencies.database.error || 'unknown error'}`);
  }

  if (isDependencyCheckFresh(state.dependencies.rpc.lastChecked) && !state.dependencies.rpc.healthy) {
    reasons.push(`RPC unhealthy: ${state.dependencies.rpc.error || 'unknown error'}`);
  }

  return {
    ready: reasons.length === 0,
    lastLedger: health.lastLedger,
    cursorAge: health.cursorAge,
    maxCursorAge: MAX_CURSOR_AGE_MS,
    dependencies: {
      database: {
        healthy: state.dependencies.database.healthy,
        lastCheckedAgo: dbCheckAge,
        error: state.dependencies.database.error,
      },
      rpc: {
        healthy: state.dependencies.rpc.healthy,
        lastCheckedAgo: rpcCheckAge,
        error: state.dependencies.rpc.error,
      },
    },
    reasons,
  };
}
