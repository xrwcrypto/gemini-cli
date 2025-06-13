/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  metrics,
  Attributes,
  ValueType,
  Meter,
  Counter,
  Histogram,
  UpDownCounter,
  Gauge,
} from '@opentelemetry/api';
import { recordToolCallMetrics } from '../../../telemetry/metrics.js';
import { PerformanceMonitor, PerformanceMetrics, PerformanceAlert } from './performance-monitor.js';
import { MemoryAnalyzer, MemoryLeak, MemorySnapshot } from './memory-analyzer.js';
import { AnomalyDetector, Anomaly } from './anomaly-detector.js';
import { PerformanceProfiler, ProfileAnalysis } from './performance-profiler.js';

/**
 * Extended telemetry event types for file operations
 */
export interface FileOperationPerformanceEvent {
  'event.name': 'file_operation_performance';
  'event.timestamp': string;
  operation_type: string;
  component_name?: string;
  duration_ms: number;
  success: boolean;
  memory_usage_mb: number;
  cpu_usage_percent: number;
  file_count?: number;
  bytes_processed?: number;
  cache_hit_ratio?: number;
  parallel_operations?: number;
  error_type?: string;
}

export interface FileOperationMemoryEvent {
  'event.name': 'file_operation_memory';
  'event.timestamp': string;
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
  rss_mb: number;
  gc_events_count: number;
  memory_leak_detected: boolean;
  leak_type?: string;
  leak_severity?: string;
}

export interface FileOperationAnomalyEvent {
  'event.name': 'file_operation_anomaly';
  'event.timestamp': string;
  anomaly_type: string;
  metric: string;
  severity: string;
  confidence: number;
  deviation_score: number;
  value: number;
  expected_min: number;
  expected_max: number;
  operation_type?: string;
  component_name?: string;
}

export interface FileOperationThroughputEvent {
  'event.name': 'file_operation_throughput';
  'event.timestamp': string;
  operations_per_second: number;
  success_rate: number;
  average_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  concurrent_operations: number;
  queue_length: number;
}

/**
 * Configuration for telemetry integration
 */
export interface TelemetryIntegrationConfig {
  enableDetailedMetrics: boolean;
  enableMemoryTracking: boolean;
  enableAnomalyTracking: boolean;
  enableThroughputTracking: boolean;
  enableProfileTracking: boolean;
  metricsPrefix: string;
  eventSamplingRate: number; // 0-1, for reducing telemetry volume
  batchSize: number;
  flushInterval: number; // milliseconds
  retentionPeriod: number; // milliseconds
}

/**
 * Metric definitions for OpenTelemetry
 */
export interface FileOperationMetrics {
  // Counters
  operationCount: Counter;
  errorCount: Counter;
  anomalyCount: Counter;
  memoryLeakCount: Counter;
  
  // Histograms
  operationLatency: Histogram;
  memoryUsage: Histogram;
  throughput: Histogram;
  
  // Gauges
  activeOperations: UpDownCounter;
  memoryPressure: UpDownCounter;
  cacheHitRatio: UpDownCounter;
  queueLength: UpDownCounter;
}

/**
 * Telemetry integration for FileOperations performance monitoring
 */
export class TelemetryIntegration {
  private config: TelemetryIntegrationConfig;
  private meter: Meter;
  private metrics!: FileOperationMetrics;
  private eventBuffer: any[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private isInitialized = false;

  constructor(
    private performanceMonitor: PerformanceMonitor,
    private memoryAnalyzer?: MemoryAnalyzer,
    private anomalyDetector?: AnomalyDetector,
    private profiler?: PerformanceProfiler,
    config: Partial<TelemetryIntegrationConfig> = {}
  ) {
    this.config = {
      enableDetailedMetrics: true,
      enableMemoryTracking: true,
      enableAnomalyTracking: true,
      enableThroughputTracking: true,
      enableProfileTracking: false, // Disabled by default due to overhead
      metricsPrefix: 'file_operations',
      eventSamplingRate: 1.0,
      batchSize: 100,
      flushInterval: 30000, // 30 seconds
      retentionPeriod: 3600000, // 1 hour
      ...config,
    };

    this.meter = metrics.getMeter('file-operations-telemetry');
    this.initializeMetrics();
    this.setupEventHandlers();
    this.startPeriodicFlush();
  }

  /**
   * Initialize OpenTelemetry metrics
   */
  private initializeMetrics(): void {
    if (this.isInitialized) return;

    const prefix = this.config.metricsPrefix;

    this.metrics = {
      // Counters
      operationCount: this.meter.createCounter(`${prefix}.operation.count`, {
        description: 'Total number of file operations',
        valueType: ValueType.INT,
      }),
      
      errorCount: this.meter.createCounter(`${prefix}.error.count`, {
        description: 'Number of operation errors',
        valueType: ValueType.INT,
      }),
      
      anomalyCount: this.meter.createCounter(`${prefix}.anomaly.count`, {
        description: 'Number of detected anomalies',
        valueType: ValueType.INT,
      }),
      
      memoryLeakCount: this.meter.createCounter(`${prefix}.memory.leak.count`, {
        description: 'Number of detected memory leaks',
        valueType: ValueType.INT,
      }),

      // Histograms
      operationLatency: this.meter.createHistogram(`${prefix}.operation.latency`, {
        description: 'Operation latency distribution',
        unit: 'ms',
        valueType: ValueType.INT,
      }),
      
      memoryUsage: this.meter.createHistogram(`${prefix}.memory.usage`, {
        description: 'Memory usage distribution',
        unit: 'bytes',
        valueType: ValueType.INT,
      }),
      
      throughput: this.meter.createHistogram(`${prefix}.throughput`, {
        description: 'Operations per second distribution',
        valueType: ValueType.DOUBLE,
      }),

      // Gauges (using UpDownCounter as approximation)
      activeOperations: this.meter.createUpDownCounter(`${prefix}.operations.active`, {
        description: 'Number of currently active operations',
        valueType: ValueType.INT,
      }),
      
      memoryPressure: this.meter.createUpDownCounter(`${prefix}.memory.pressure`, {
        description: 'Memory pressure level (0-1)',
        valueType: ValueType.DOUBLE,
      }),
      
      cacheHitRatio: this.meter.createUpDownCounter(`${prefix}.cache.hit_ratio`, {
        description: 'Cache hit ratio (0-1)',
        valueType: ValueType.DOUBLE,
      }),
      
      queueLength: this.meter.createUpDownCounter(`${prefix}.queue.length`, {
        description: 'Operation queue length',
        valueType: ValueType.INT,
      }),
    };

    this.isInitialized = true;
  }

  /**
   * Setup event handlers for monitoring components
   */
  private setupEventHandlers(): void {
    // Performance monitoring events
    this.performanceMonitor.onAlert((alert: PerformanceAlert) => {
      this.recordPerformanceAlert(alert);
    });

    // Memory analysis events
    if (this.memoryAnalyzer) {
      // Note: In a real implementation, MemoryAnalyzer would emit events
      // For now, we'll poll periodically
      setInterval(() => {
        this.recordMemoryMetrics();
      }, 10000); // Every 10 seconds
    }

    // Anomaly detection events
    if (this.anomalyDetector) {
      this.anomalyDetector.onAnomaly('*', (anomaly: Anomaly) => {
        this.recordAnomaly(anomaly);
      });
    }
  }

  /**
   * Record performance metrics from a completed operation
   */
  recordOperationMetrics(metrics: PerformanceMetrics): void {
    if (!this.shouldSample()) return;

    const attributes: Attributes = {
      operation_type: metrics.operationType,
      component_name: metrics.componentName || 'unknown',
      success: metrics.success,
    };

    // Record in OpenTelemetry
    this.metrics.operationCount.add(1, attributes);
    this.metrics.operationLatency.record(metrics.durationMs, attributes);
    this.metrics.memoryUsage.record(metrics.memoryUsage.heapUsed, attributes);

    if (!metrics.success && metrics.error) {
      this.metrics.errorCount.add(1, {
        ...attributes,
        error_type: this.categorizeError(metrics.error),
      });
    }

    // Record in legacy telemetry system
    recordToolCallMetrics(
      `file_operations.${metrics.operationType}`,
      metrics.durationMs,
      metrics.success
    );

    // Create detailed event
    if (this.config.enableDetailedMetrics) {
      const event: FileOperationPerformanceEvent = {
        'event.name': 'file_operation_performance',
        'event.timestamp': new Date(metrics.endTime).toISOString(),
        operation_type: metrics.operationType,
        component_name: metrics.componentName,
        duration_ms: metrics.durationMs,
        success: metrics.success,
        memory_usage_mb: metrics.memoryUsage.heapUsed / (1024 * 1024),
        cpu_usage_percent: metrics.resourceUtilization.cpuUsagePercent,
        parallel_operations: metrics.resourceUtilization.concurrentOperations,
        error_type: metrics.error ? this.categorizeError(metrics.error) : undefined,
      };

      // Add operation-specific metrics
      if (metrics.operationDetails.fileCount) {
        event.file_count = metrics.operationDetails.fileCount as number;
      }
      if (metrics.operationDetails.bytesProcessed) {
        event.bytes_processed = metrics.operationDetails.bytesProcessed as number;
      }
      if (metrics.operationDetails.cacheHitRatio) {
        event.cache_hit_ratio = metrics.operationDetails.cacheHitRatio as number;
      }

      this.bufferEvent(event);
    }
  }

  /**
   * Record throughput metrics
   */
  recordThroughputMetrics(): void {
    if (!this.config.enableThroughputTracking || !this.shouldSample()) return;

    const throughputMetrics = this.performanceMonitor.getThroughputMetrics();
    
    // Record in OpenTelemetry
    this.metrics.throughput.record(throughputMetrics.operationsPerSecond);
    this.metrics.activeOperations.add(0); // Reset and set current value
    this.metrics.queueLength.add(0); // Would need actual queue length

    // Create event
    const event: FileOperationThroughputEvent = {
      'event.name': 'file_operation_throughput',
      'event.timestamp': new Date().toISOString(),
      operations_per_second: throughputMetrics.operationsPerSecond,
      success_rate: throughputMetrics.successRate,
      average_latency_ms: throughputMetrics.averageLatency,
      p95_latency_ms: throughputMetrics.p95Latency,
      p99_latency_ms: throughputMetrics.p99Latency,
      concurrent_operations: 0, // Would need actual value
      queue_length: 0, // Would need actual value
    };

    this.bufferEvent(event);
  }

  /**
   * Record memory metrics
   */
  private recordMemoryMetrics(): void {
    if (!this.config.enableMemoryTracking || !this.memoryAnalyzer) return;

    const memoryReport = this.memoryAnalyzer.generateReport();
    const currentUsage = memoryReport.summary.currentUsage;
    const leaks = memoryReport.leaks;

    // Record in OpenTelemetry
    this.metrics.memoryUsage.record(currentUsage.heapUsed);
    this.metrics.memoryPressure.add(memoryReport.summary.pressure.heapUtilization / 100);

    if (leaks.length > 0) {
      for (const leak of leaks) {
        this.metrics.memoryLeakCount.add(1, {
          leak_type: leak.type,
          severity: leak.severity,
        });
      }
    }

    // Create event
    if (this.shouldSample()) {
      const event: FileOperationMemoryEvent = {
        'event.name': 'file_operation_memory',
        'event.timestamp': new Date().toISOString(),
        heap_used_mb: currentUsage.heapUsed / (1024 * 1024),
        heap_total_mb: currentUsage.heapTotal / (1024 * 1024),
        external_mb: currentUsage.external / (1024 * 1024),
        rss_mb: currentUsage.rss / (1024 * 1024),
        gc_events_count: memoryReport.summary.pressure.gcFrequency,
        memory_leak_detected: leaks.length > 0,
        leak_type: leaks.length > 0 ? leaks[0].type : undefined,
        leak_severity: leaks.length > 0 ? leaks[0].severity : undefined,
      };

      this.bufferEvent(event);
    }
  }

  /**
   * Record performance alert
   */
  private recordPerformanceAlert(alert: PerformanceAlert): void {
    if (!this.shouldSample()) return;

    // This could be recorded as a special anomaly event
    const anomaly: Anomaly = {
      id: alert.id,
      type: 'threshold',
      metric: alert.type,
      severity: alert.severity === 'critical' ? 'critical' : 'medium',
      confidence: 1.0,
      description: alert.message,
      detectedAt: alert.timestamp,
      value: alert.currentValue,
      expectedRange: { min: 0, max: alert.threshold },
      deviationScore: alert.currentValue / alert.threshold,
      context: {
        operationType: alert.operationType,
        componentName: alert.componentName,
        timeWindow: 0,
        previousValues: [],
      },
      recommendations: [],
    };

    this.recordAnomaly(anomaly);
  }

  /**
   * Record anomaly detection
   */
  private recordAnomaly(anomaly: Anomaly): void {
    if (!this.config.enableAnomalyTracking || !this.shouldSample()) return;

    // Record in OpenTelemetry
    this.metrics.anomalyCount.add(1, {
      anomaly_type: anomaly.type,
      metric: anomaly.metric,
      severity: anomaly.severity,
      operation_type: anomaly.context.operationType || 'unknown',
      component_name: anomaly.context.componentName || 'unknown',
    });

    // Create event
    const event: FileOperationAnomalyEvent = {
      'event.name': 'file_operation_anomaly',
      'event.timestamp': new Date(anomaly.detectedAt).toISOString(),
      anomaly_type: anomaly.type,
      metric: anomaly.metric,
      severity: anomaly.severity,
      confidence: anomaly.confidence,
      deviation_score: anomaly.deviationScore,
      value: anomaly.value,
      expected_min: anomaly.expectedRange.min,
      expected_max: anomaly.expectedRange.max,
      operation_type: anomaly.context.operationType,
      component_name: anomaly.context.componentName,
    };

    this.bufferEvent(event);
  }

  /**
   * Record profile analysis results
   */
  recordProfileAnalysis(profileId: string, analysis: ProfileAnalysis): void {
    if (!this.config.enableProfileTracking || !this.shouldSample()) return;

    // Record bottlenecks as metrics
    for (const bottleneck of analysis.bottlenecks) {
      this.metrics.operationLatency.record(bottleneck.metrics.duration, {
        operation_type: 'bottleneck',
        component_name: bottleneck.operationName,
        severity: bottleneck.severity,
      });
    }

    // Record memory leaks
    for (const leak of analysis.memoryUsage.leakIndicators) {
      this.metrics.memoryLeakCount.add(1, {
        leak_type: leak.type,
        severity: leak.severity,
      });
    }

    // Could create detailed profiling events here if needed
  }

  /**
   * Record cache performance metrics
   */
  recordCacheMetrics(hitRatio: number, size: number, evictions: number): void {
    if (!this.shouldSample()) return;

    this.metrics.cacheHitRatio.add(hitRatio);
    
    // Could create cache-specific events
  }

  /**
   * Start periodic throughput recording
   */
  startThroughputTracking(interval: number = 60000): void {
    setInterval(() => {
      this.recordThroughputMetrics();
    }, interval);
  }

  /**
   * Buffer event for batch processing
   */
  private bufferEvent(event: any): void {
    this.eventBuffer.push(event);
    
    if (this.eventBuffer.length >= this.config.batchSize) {
      this.flushEvents();
    }
  }

  /**
   * Start periodic flush timer
   */
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flushEvents();
    }, this.config.flushInterval);
  }

  /**
   * Flush buffered events
   */
  private flushEvents(): void {
    if (this.eventBuffer.length === 0) return;

    // In a real implementation, you would send these to your telemetry backend
    // For now, we'll just log them
    console.log(`Flushing ${this.eventBuffer.length} telemetry events`);
    
    // Clear buffer
    this.eventBuffer = [];
  }

  /**
   * Check if event should be sampled
   */
  private shouldSample(): boolean {
    return Math.random() < this.config.eventSamplingRate;
  }

  /**
   * Categorize error for telemetry
   */
  private categorizeError(error: string): string {
    if (error.includes('ENOENT') || error.includes('not found')) {
      return 'file_not_found';
    }
    if (error.includes('EACCES') || error.includes('permission')) {
      return 'permission_denied';
    }
    if (error.includes('timeout')) {
      return 'timeout';
    }
    if (error.includes('memory') || error.includes('out of memory')) {
      return 'out_of_memory';
    }
    if (error.includes('syntax') || error.includes('parse')) {
      return 'syntax_error';
    }
    if (error.includes('network') || error.includes('connection')) {
      return 'network_error';
    }
    return 'unknown';
  }

  /**
   * Get telemetry statistics
   */
  getStatistics(): {
    eventsBuffered: number;
    eventsFlushed: number;
    samplingRate: number;
    metricsInitialized: boolean;
  } {
    return {
      eventsBuffered: this.eventBuffer.length,
      eventsFlushed: 0, // Would track this in real implementation
      samplingRate: this.config.eventSamplingRate,
      metricsInitialized: this.isInitialized,
    };
  }

  /**
   * Update sampling rate dynamically
   */
  setSamplingRate(rate: number): void {
    if (rate >= 0 && rate <= 1) {
      this.config.eventSamplingRate = rate;
    }
  }

  /**
   * Enable/disable specific tracking features
   */
  updateConfig(updates: Partial<TelemetryIntegrationConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * Stop telemetry integration
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    // Flush remaining events
    this.flushEvents();
  }

  /**
   * Export configuration for debugging
   */
  getConfig(): TelemetryIntegrationConfig {
    return { ...this.config };
  }
}