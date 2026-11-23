/**
 * Bundle Analysis and Code Splitting Utilities
 * 
 * Provides tools for:
 * - Dynamic import tracking
 * - Chunk size monitoring
 * - Code splitting recommendations
 * - Performance budgeting
 */

/**
 * Dynamic import wrapper with chunk naming for better analysis
 * Usage: const Component = useDynamicImport(() => import('./MyComponent'), 'MyComponent')
 */
export function createDynamicImport<T extends Record<string, unknown>>(
  importFn: () => Promise<T>,
  chunkName: string,
): () => Promise<T> {
  return async () => {
    const startTime = performance.now();
    const module = await importFn();
    const duration = performance.now() - startTime;

    // Report chunk load time
    reportChunkLoad(chunkName, duration);

    return module;
  };
}

/**
 * Track chunk loading metrics
 */
const chunkMetrics = new Map<string, {
  loadTime: number[];
  size?: number;
  cached: boolean;
}>();

function reportChunkLoad(chunkName: string, duration: number): void {
  const metrics = chunkMetrics.get(chunkName) || {
    loadTime: [],
    cached: duration < 50, // Assume cached if < 50ms
  };

  metrics.loadTime.push(duration);
  chunkMetrics.set(chunkName, metrics);

  if (duration > 1000) {
    console.warn(`[Bundle] Slow chunk load: ${chunkName} took ${duration.toFixed(0)}ms`);
  }
}

/**
 * Performance budget configuration
 */
interface PerformanceBudget {
  maxBundleSize: number; // bytes
  maxChunkSize: number; // bytes
  maxChunkLoadTime: number; // ms
  maxInitialLoadTime: number; // ms
}

const DEFAULT_BUDGET: PerformanceBudget = {
  maxBundleSize: 500 * 1024, // 500KB
  maxChunkSize: 200 * 1024, // 200KB
  maxChunkLoadTime: 2000, // 2 seconds
  maxInitialLoadTime: 5000, // 5 seconds
};

/**
 * Track performance metrics against budget
 */
class BudgetTracker {
  private violations: Array<{
    metric: string;
    actual: number;
    budget: number;
    timestamp: Date;
  }> = [];

  constructor(private budget: PerformanceBudget = DEFAULT_BUDGET) {}

  checkChunkSize(chunkName: string, size: number): boolean {
    if (size > this.budget.maxChunkSize) {
      this.violations.push({
        metric: `chunk_size:${chunkName}`,
        actual: size,
        budget: this.budget.maxChunkSize,
        timestamp: new Date(),
      });
      console.warn(
        `[Performance Budget] Chunk "${chunkName}" exceeds budget: ${(size / 1024).toFixed(0)}KB > ${(this.budget.maxChunkSize / 1024).toFixed(0)}KB`,
      );
      return false;
    }
    return true;
  }

  checkInitialLoad(duration: number): boolean {
    if (duration > this.budget.maxInitialLoadTime) {
      this.violations.push({
        metric: 'initial_load_time',
        actual: duration,
        budget: this.budget.maxInitialLoadTime,
        timestamp: new Date(),
      });
      console.warn(
        `[Performance Budget] Initial load time exceeds budget: ${duration.toFixed(0)}ms > ${this.budget.maxInitialLoadTime}ms`,
      );
      return false;
    }
    return true;
  }

  getViolations() {
    return this.violations;
  }

  reset() {
    this.violations = [];
  }
}

const budgetTracker = new BudgetTracker();

/**
 * Module concatenation indicator
 * Check if modules should be combined to reduce chunk count
 */
interface ModuleInfo {
  name: string;
  size: number;
  importedBy: string[];
  imports: string[];
}

export class BundleAnalyzer {
  private modules: ModuleInfo[] = [];

  /**
   * Register module for analysis
   */
  registerModule(info: ModuleInfo): void {
    this.modules.push(info);
  }

  /**
   * Find modules that should be split
   */
  findLargeModules(sizeThreshold: number = 100 * 1024): ModuleInfo[] {
    return this.modules.filter(m => m.size > sizeThreshold).sort((a, b) => b.size - a.size);
  }

  /**
   * Find circular dependencies that prevent optimal tree-shaking
   */
  findCircularDependencies(): string[][] {
    const circular: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const module = this.modules.find(m => m.name === node);
      if (!module) return;

      for (const dep of module.imports) {
        if (!visited.has(dep)) {
          dfs(dep, [...path]);
        } else if (recursionStack.has(dep)) {
          circular.push([...path, dep]);
        }
      }

      recursionStack.delete(node);
    };

    for (const module of this.modules) {
      if (!visited.has(module.name)) {
        dfs(module.name, []);
      }
    }

    return circular;
  }

  /**
   * Recommend code splitting opportunities
   */
  getCodeSplittingRecommendations(): string[] {
    const recommendations: string[] = [];
    const largeModules = this.findLargeModules();

    if (largeModules.length > 0) {
      recommendations.push(
        `Large modules found (${largeModules.length}): Consider code splitting - ${largeModules.map(m => m.name).join(', ')}`,
      );
    }

    const circular = this.findCircularDependencies();
    if (circular.length > 0) {
      recommendations.push(
        `Circular dependencies found (${circular.length}): Break circular imports to improve tree-shaking`,
      );
    }

    // Check for duplicate dependencies
    const depFrequency = new Map<string, number>();
    for (const module of this.modules) {
      for (const dep of module.imports) {
        depFrequency.set(dep, (depFrequency.get(dep) || 0) + 1);
      }
    }

    const duplicates = Array.from(depFrequency.entries())
      .filter(([, count]) => count > 5)
      .map(([dep]) => dep);

    if (duplicates.length > 0) {
      recommendations.push(
        `High-frequency dependencies (${duplicates.length}): Consider extracting to shared chunks - ${duplicates.join(', ')}`,
      );
    }

    return recommendations;
  }

  /**
   * Generate bundle report
   */
  generateReport() {
    const totalSize = this.modules.reduce((sum, m) => sum + m.size, 0);
    const avgSize = totalSize / this.modules.length;
    const largeModules = this.findLargeModules();

    return {
      totalModules: this.modules.length,
      totalSize,
      averageSize: avgSize,
      largestModules: largeModules.slice(0, 10),
      recommendations: this.getCodeSplittingRecommendations(),
      circularDependencies: this.findCircularDependencies(),
    };
  }
}

const bundleAnalyzer = new BundleAnalyzer();

/**
 * Code splitting strategy for common patterns
 */
export const codeSplittingStrategies = {
  /**
   * Route-based splitting (recommended for most apps)
   */
  routeBased: {
    description: 'Split code at route boundaries',
    benefits: ['Easy to implement', 'Reduces initial bundle', 'Good caching'],
    example: `
      const Dashboard = dynamic(() => import('./pages/Dashboard'), { loading: () => <Spinner /> });
      const Analytics = dynamic(() => import('./pages/Analytics'), { loading: () => <Spinner /> });
    `,
  },

  /**
   * Component-based splitting for heavy components
   */
  componentBased: {
    description: 'Split heavy components and libraries',
    benefits: ['Fine-grained control', 'Better parallelization', 'Faster initial load'],
    example: `
      const Editor = dynamic(() => import('./components/Editor'), { ssr: false });
      const Chart = dynamic(() => import('./components/Chart'));
    `,
  },

  /**
   * Library-based splitting
   */
  libraryBased: {
    description: 'Extract third-party libraries to separate chunks',
    benefits: ['Better caching', 'Smaller core bundle', 'Faster updates'],
    dependencies: ['@tanstack/react-query', '@stellar/stellar-sdk'],
  },

  /**
   * Lazy load vendor code
   */
  vendorLazyLoad: {
    description: 'Delay loading non-critical vendor code',
    benefits: ['Faster initial load', 'Lower time to interactive', 'Better FCP'],
    candidates: ['Charts', 'Maps', 'Analytics'],
  },
};

/**
 * Next.js specific optimizations
 */
export const nextOptimizations = {
  /**
   * Image optimization best practices
   */
  imageOptimization: {
    useNextImage: true,
    formats: ['avif', 'webp'],
    sizes: 'responsive',
    priority: 'critical images only',
  },

  /**
   * Font optimization
   */
  fontOptimization: {
    useNextFont: true,
    preload: 'critical fonts only',
    subsetFonts: true,
    fallback: 'system fonts',
  },

  /**
   * Script optimization
   */
  scriptOptimization: {
    strategy: 'lazyOnload for analytics',
    defer: 'third-party scripts',
    async: 'non-critical features',
  },
};

/**
 * Export utilities for use in application
 */
export {
  budgetTracker,
  bundleAnalyzer,
  BudgetTracker,
  BundleAnalyzer,
  DEFAULT_BUDGET,
};

/**
 * Get current chunk metrics
 */
export function getChunkMetrics() {
  return Object.fromEntries(
    Array.from(chunkMetrics.entries()).map(([name, metrics]) => [
      name,
      {
        avgLoadTime: metrics.loadTime.length > 0
          ? metrics.loadTime.reduce((a, b) => a + b, 0) / metrics.loadTime.length
          : 0,
        maxLoadTime: Math.max(...metrics.loadTime),
        minLoadTime: Math.min(...metrics.loadTime),
        loadCount: metrics.loadTime.length,
        cached: metrics.cached,
      },
    ]),
  );
}

/**
 * Report bundle analytics (useful for sending to monitoring service)
 */
export function reportBundleAnalytics() {
  const metrics = getChunkMetrics();
  const violations = budgetTracker.getViolations();
  const report = bundleAnalyzer.generateReport();

  return {
    timestamp: new Date().toISOString(),
    chunkMetrics: metrics,
    budgetViolations: violations,
    bundleReport: report,
  };
}
