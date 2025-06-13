/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Core performance monitoring components
export {
  PerformanceMonitor,
  type PerformanceMetrics,
  type MemoryUsage,
  type ResourceUtilization,
  type ThroughputMetrics,
  type PerformanceConfig,
  type AlertThresholds,
  type PerformanceAlert,
  type ComponentPerformance,
} from './performance-monitor.js';

// Performance profiling
export {
  PerformanceProfiler,
  type ProfileEntry,
  type Mark,
  type Phase,
  type Bottleneck,
  type CallFrame,
  type ProfileAnalysis,
  type MemoryLeakIndicator,
  type ProfilerConfig,
} from './performance-profiler.js';

// Memory analysis
export {
  MemoryAnalyzer,
  type MemorySnapshot,
  type MemoryTrend,
  type MemoryLeak,
  type GCEvent,
  type AllocationPattern,
  type MemoryPressure,
  type MemoryAnalyzerConfig,
} from './memory-analyzer.js';

// Anomaly detection
export {
  AnomalyDetector,
  type StatisticalBaseline,
  type Anomaly,
  type AnomalyDetectorConfig,
  type Pattern,
  type TrendAnalysis,
} from './anomaly-detector.js';

// Performance dashboard
export {
  PerformanceDashboard,
  type DashboardWidget,
  type DashboardLayout,
  type MetricsDataPoint,
  type TimeSeries,
  type DashboardData,
  type DashboardAlert,
  type SystemHealthStatus,
  type DashboardExport,
} from './performance-dashboard.js';

// Benchmarking
export {
  PerformanceBenchmark,
  type BenchmarkConfig,
  type BenchmarkTestFunction,
  type BenchmarkResult,
  type BenchmarkComparison,
  type LoadTestConfig,
  type LoadTestResult,
} from './performance-benchmark.js';

// Regression testing
export {
  PerformanceRegressionTester,
  type RegressionTestConfig,
  type PerformanceTargets,
  type EnvironmentConfig,
  type ReportConfig,
  type RegressionTestSuite,
  type RegressionTest,
  type RegressionTestResult,
  type RegressionTestSuiteResult,
  type RegressionTestReport,
} from './performance-regression-tests.js';

// Telemetry integration
export {
  TelemetryIntegration,
  type FileOperationPerformanceEvent,
  type FileOperationMemoryEvent,
  type FileOperationAnomalyEvent,
  type FileOperationThroughputEvent,
  type TelemetryIntegrationConfig,
  type FileOperationMetrics,
} from './telemetry-integration.js';

// Main performance system
export {
  PerformanceSystem,
  type PerformanceSystemConfig,
  type CustomMetricDefinition,
  type PerformancePlugin,
  type PerformanceSystemEvent,
  type PerformanceSystemStatus,
} from './performance-system.js';

/**
 * Create a fully configured performance monitoring system
 */
export function createPerformanceSystem(config: Partial<import('./performance-system.js').PerformanceSystemConfig> = {}) {
  return new (require('./performance-system.js').PerformanceSystem)(config);
}

/**
 * Create a lightweight performance monitor (just basic metrics)
 */
export function createBasicPerformanceMonitor(config: Partial<import('./performance-monitor.js').PerformanceConfig> = {}) {
  return new (require('./performance-monitor.js').PerformanceMonitor)(config);
}

/**
 * Create a performance profiler for detailed analysis
 */
export function createPerformanceProfiler(config: Partial<import('./performance-profiler.js').ProfilerConfig> = {}) {
  return new (require('./performance-profiler.js').PerformanceProfiler)(config);
}

/**
 * Create a memory analyzer for leak detection
 */
export function createMemoryAnalyzer(config: Partial<import('./memory-analyzer.js').MemoryAnalyzerConfig> = {}) {
  return new (require('./memory-analyzer.js').MemoryAnalyzer)(config);
}

/**
 * Create an anomaly detector for performance issues
 */
export function createAnomalyDetector(config: Partial<import('./anomaly-detector.js').AnomalyDetectorConfig> = {}) {
  return new (require('./anomaly-detector.js').AnomalyDetector)(config);
}

/**
 * Default performance system configuration for FileOperations
 */
export const DEFAULT_PERFORMANCE_CONFIG: Partial<import('./performance-system.js').PerformanceSystemConfig> = {
  enableProfiling: true,
  enableMemoryAnalysis: true,
  enableAnomalyDetection: true,
  enableDashboard: true,
  enableTelemetry: true,
  enableBenchmarking: false, // Disabled by default for production
  enableRegressionTesting: false, // Disabled by default for production
  
  performanceMonitor: {
    enableDetailedProfiling: true,
    enableMemoryTracking: true,
    enableComponentProfiling: true,
    enableThroughputTracking: true,
    metricsRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
    alertThresholds: {
      maxLatencyMs: 5000, // 5 seconds
      minSuccessRate: 0.95, // 95%
      maxMemoryUsageMb: 512, // 512 MB
      maxCpuUsagePercent: 80, // 80%
      maxConcurrentOperations: 50,
    },
  },
  
  profiler: {
    enableCallStackTracking: true,
    enableMemoryProfiling: true,
    enableGCTracking: true,
    maxProfileEntries: 1000,
    memorySnapshotInterval: 5000, // 5 seconds
    bottleneckThresholds: {
      durationMs: 1000, // 1 second
      memoryGrowthMb: 50, // 50 MB
      cpuUsagePercent: 80, // 80%
    },
  },
  
  memoryAnalyzer: {
    snapshotInterval: 10000, // 10 seconds
    maxSnapshots: 1000,
    leakDetectionThreshold: 1024 * 1024, // 1 MB per second
    gcTrackingEnabled: true,
    heapDumpEnabled: false, // Disabled by default
    allocationTrackingEnabled: true,
    pressureMonitoringEnabled: true,
    analysisWindow: 300000, // 5 minutes
  },
  
  anomalyDetector: {
    statisticalThreshold: 2.5, // 2.5 standard deviations
    trendWindowSize: 20,
    spikeThreshold: 3.0,
    patternWindowSize: 50,
    baselineMinSamples: 30,
    anomalyRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
    enableAutoResolution: true,
    enableTrendAnalysis: true,
    enablePatternDetection: true,
    metricThresholds: {
      latency: { max: 5000 }, // 5 seconds
      memoryUsage: { max: 1024 * 1024 * 1024 }, // 1 GB
      errorRate: { max: 0.05 }, // 5%
      cpuUsage: { max: 0.9 }, // 90%
    },
  },
  
  telemetryIntegration: {
    enableDetailedMetrics: true,
    enableMemoryTracking: true,
    enableAnomalyTracking: true,
    enableThroughputTracking: true,
    enableProfileTracking: false, // Disabled by default due to overhead
    metricsPrefix: 'file_operations',
    eventSamplingRate: 1.0, // 100% sampling in development
    batchSize: 100,
    flushInterval: 30000, // 30 seconds
    retentionPeriod: 3600000, // 1 hour
  },
  
  customMetrics: [
    {
      name: 'file_operations_custom_latency',
      type: 'histogram',
      description: 'Custom latency metric for file operations',
      unit: 'ms',
      labels: ['operation_type', 'component_name'],
    },
    {
      name: 'file_operations_cache_efficiency',
      type: 'gauge',
      description: 'Cache hit ratio for file operations',
      unit: 'ratio',
      labels: ['cache_type'],
    },
  ],
};

/**
 * Performance monitoring utility functions
 */
export const PerformanceUtils = {
  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  },

  /**
   * Format milliseconds to human readable string
   */
  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`;
    return `${(ms / 3600000).toFixed(2)}h`;
  },

  /**
   * Calculate percentile from sorted array
   */
  percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  },

  /**
   * Calculate moving average
   */
  movingAverage(values: number[], windowSize: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const window = values.slice(start, i + 1);
      const avg = window.reduce((sum, val) => sum + val, 0) / window.length;
      result.push(avg);
    }
    return result;
  },

  /**
   * Calculate exponential moving average
   */
  exponentialMovingAverage(values: number[], alpha: number = 0.1): number[] {
    const result: number[] = [];
    let ema = values[0] || 0;
    
    for (const value of values) {
      ema = alpha * value + (1 - alpha) * ema;
      result.push(ema);
    }
    
    return result;
  },

  /**
   * Detect outliers using IQR method
   */
  detectOutliers(values: number[]): { outliers: number[]; indices: number[] } {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = this.percentile(sorted, 25);
    const q3 = this.percentile(sorted, 75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    const outliers: number[] = [];
    const indices: number[] = [];
    
    values.forEach((value, index) => {
      if (value < lowerBound || value > upperBound) {
        outliers.push(value);
        indices.push(index);
      }
    });
    
    return { outliers, indices };
  },
};