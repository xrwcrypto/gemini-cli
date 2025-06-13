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
} from '@opentelemetry/api';
import { recordToolCallMetrics } from '../../../telemetry/metrics.js';

/**
 * Performance metrics collected for file operations
 */
export interface PerformanceMetrics {
  operationId: string;
  operationType: string;
  componentName?: string;
  durationMs: number;
  startTime: number;
  endTime: number;
  success: boolean;
  error?: string;
  memoryUsage: MemoryUsage;
  resourceUtilization: ResourceUtilization;
  operationDetails: Record<string, unknown>;
}

/**
 * Memory usage statistics
 */
export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

/**
 * Resource utilization metrics
 */
export interface ResourceUtilization {
  cpuUsagePercent: number;
  memoryPressure: number;
  concurrentOperations: number;
  queueLength: number;
}

/**
 * Throughput statistics
 */
export interface ThroughputMetrics {
  operationsPerSecond: number;
  successRate: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  totalOperations: number;
  failedOperations: number;
}

/**
 * Performance tracking configuration
 */
export interface PerformanceConfig {
  enableDetailedProfiling: boolean;
  enableMemoryTracking: boolean;
  enableComponentProfiling: boolean;
  enableThroughputTracking: boolean;
  metricsRetentionMs: number;
  alertThresholds: AlertThresholds;
}

/**
 * Alert threshold configuration
 */
export interface AlertThresholds {
  maxLatencyMs: number;
  minSuccessRate: number;
  maxMemoryUsageMb: number;
  maxCpuUsagePercent: number;
  maxConcurrentOperations: number;
}

/**
 * Performance alert information
 */
export interface PerformanceAlert {
  id: string;
  type: 'latency' | 'success_rate' | 'memory' | 'cpu' | 'concurrency';
  severity: 'warning' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: number;
  operationType?: string;
  componentName?: string;
}

/**
 * Component performance statistics
 */
export interface ComponentPerformance {
  componentName: string;
  totalOperations: number;
  averageLatency: number;
  successRate: number;
  memoryUsage: number;
  bottleneckScore: number;
  hotspotCount: number;
}

/**
 * Performance monitoring system for FileOperations tool
 */
export class PerformanceMonitor {
  private meter: Meter;
  private config: PerformanceConfig;
  private metrics: PerformanceMetrics[] = [];
  private activeOperations = new Map<string, { startTime: number; memoryStart: MemoryUsage }>();
  private alertCallbacks: ((alert: PerformanceAlert) => void)[] = [];
  
  // OpenTelemetry metrics
  private operationCounter!: Counter;
  private operationLatencyHistogram!: Histogram;
  private memoryGauge!: UpDownCounter;
  private throughputGauge!: UpDownCounter;
  private resourceUtilizationGauge!: UpDownCounter;
  private errorCounter!: Counter;

  private startTime = Date.now();
  private isInitialized = false;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      enableDetailedProfiling: true,
      enableMemoryTracking: true,
      enableComponentProfiling: true,
      enableThroughputTracking: true,
      metricsRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
      alertThresholds: {
        maxLatencyMs: 5000,
        minSuccessRate: 0.95,
        maxMemoryUsageMb: 512,
        maxCpuUsagePercent: 80,
        maxConcurrentOperations: 50,
      },
      ...config,
    };

    this.meter = metrics.getMeter('file-operations-performance');
    this.initializeMetrics();
  }

  /**
   * Initialize OpenTelemetry metrics
   */
  private initializeMetrics(): void {
    if (this.isInitialized) return;

    this.operationCounter = this.meter.createCounter('file_operations.operation.count', {
      description: 'Total number of file operations',
      valueType: ValueType.INT,
    });

    this.operationLatencyHistogram = this.meter.createHistogram('file_operations.operation.latency', {
      description: 'Latency of file operations in milliseconds',
      unit: 'ms',
      valueType: ValueType.INT,
    });

    this.memoryGauge = this.meter.createUpDownCounter('file_operations.memory.usage', {
      description: 'Memory usage in bytes',
      unit: 'bytes',
      valueType: ValueType.INT,
    });

    this.throughputGauge = this.meter.createUpDownCounter('file_operations.throughput.ops_per_second', {
      description: 'Operations per second',
      valueType: ValueType.DOUBLE,
    });

    this.resourceUtilizationGauge = this.meter.createUpDownCounter('file_operations.resource.utilization', {
      description: 'Resource utilization percentage',
      unit: 'percent',
      valueType: ValueType.DOUBLE,
    });

    this.errorCounter = this.meter.createCounter('file_operations.error.count', {
      description: 'Number of operation errors',
      valueType: ValueType.INT,
    });

    this.isInitialized = true;
  }

  /**
   * Start tracking a file operation
   */
  startOperation(operationId: string, operationType: string, componentName?: string): void {
    if (!this.config.enableDetailedProfiling) return;

    this.activeOperations.set(operationId, {
      startTime: Date.now(),
      memoryStart: this.getCurrentMemoryUsage(),
    });
  }

  /**
   * End tracking a file operation and record metrics
   */
  endOperation(
    operationId: string,
    operationType: string,
    componentName?: string,
    success: boolean = true,
    error?: string,
    operationDetails: Record<string, unknown> = {},
  ): PerformanceMetrics | undefined {
    const operationData = this.activeOperations.get(operationId);
    if (!operationData) return undefined;

    this.activeOperations.delete(operationId);

    const endTime = Date.now();
    const durationMs = endTime - operationData.startTime;
    const memoryUsage = this.getCurrentMemoryUsage();
    const resourceUtilization = this.getCurrentResourceUtilization();

    const metrics: PerformanceMetrics = {
      operationId,
      operationType,
      componentName,
      durationMs,
      startTime: operationData.startTime,
      endTime,
      success,
      error,
      memoryUsage,
      resourceUtilization,
      operationDetails,
    };

    // Store metrics
    this.metrics.push(metrics);
    this.cleanupOldMetrics();

    // Record OpenTelemetry metrics
    this.recordOpenTelemetryMetrics(metrics);

    // Record in existing telemetry system
    recordToolCallMetrics(`file_operations.${operationType}`, durationMs, success);

    // Check for alerts
    this.checkAlerts(metrics);

    return metrics;
  }

  /**
   * Record metrics in OpenTelemetry
   */
  private recordOpenTelemetryMetrics(metrics: PerformanceMetrics): void {
    const attributes: Attributes = {
      operation_type: metrics.operationType,
      component_name: metrics.componentName || 'unknown',
      success: metrics.success,
    };

    this.operationCounter.add(1, attributes);
    this.operationLatencyHistogram.record(metrics.durationMs, attributes);

    if (this.config.enableMemoryTracking) {
      this.memoryGauge.add(metrics.memoryUsage.heapUsed, {
        memory_type: 'heap_used',
        ...attributes,
      });
      this.memoryGauge.add(metrics.memoryUsage.rss, {
        memory_type: 'rss',
        ...attributes,
      });
    }

    if (this.config.enableThroughputTracking) {
      const throughput = this.getThroughputMetrics();
      this.throughputGauge.add(throughput.operationsPerSecond, {
        metric_type: 'ops_per_second',
      });
    }

    this.resourceUtilizationGauge.add(metrics.resourceUtilization.cpuUsagePercent, {
      resource_type: 'cpu',
      ...attributes,
    });

    if (!metrics.success && metrics.error) {
      this.errorCounter.add(1, {
        error_type: this.categorizeError(metrics.error),
        ...attributes,
      });
    }
  }

  /**
   * Get current memory usage
   */
  private getCurrentMemoryUsage(): MemoryUsage {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      rss: memUsage.rss,
    };
  }

  /**
   * Get current resource utilization
   */
  private getCurrentResourceUtilization(): ResourceUtilization {
    const memUsage = process.memoryUsage();
    
    return {
      cpuUsagePercent: this.getCpuUsage(),
      memoryPressure: memUsage.heapUsed / memUsage.heapTotal,
      concurrentOperations: this.activeOperations.size,
      queueLength: 0, // Would be provided by calling code
    };
  }

  /**
   * Estimate CPU usage (simplified implementation)
   */
  private getCpuUsage(): number {
    // This is a simplified implementation
    // In a real system, you might use more sophisticated CPU monitoring
    const cpuUsage = process.cpuUsage();
    return (cpuUsage.user + cpuUsage.system) / 1000 / 1000; // Convert to percentage
  }

  /**
   * Get throughput metrics
   */
  getThroughputMetrics(): ThroughputMetrics {
    const now = Date.now();
    const timeWindowMs = 60 * 1000; // 1 minute window
    const recentMetrics = this.metrics.filter(m => now - m.endTime <= timeWindowMs);

    if (recentMetrics.length === 0) {
      return {
        operationsPerSecond: 0,
        successRate: 1,
        averageLatency: 0,
        p95Latency: 0,
        p99Latency: 0,
        totalOperations: 0,
        failedOperations: 0,
      };
    }

    const totalOperations = recentMetrics.length;
    const failedOperations = recentMetrics.filter(m => !m.success).length;
    const successRate = (totalOperations - failedOperations) / totalOperations;
    const operationsPerSecond = totalOperations / (timeWindowMs / 1000);

    const latencies = recentMetrics.map(m => m.durationMs).sort((a, b) => a - b);
    const averageLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);

    return {
      operationsPerSecond,
      successRate,
      averageLatency,
      p95Latency: latencies[p95Index] || 0,
      p99Latency: latencies[p99Index] || 0,
      totalOperations,
      failedOperations,
    };
  }

  /**
   * Get component performance statistics
   */
  getComponentPerformance(): ComponentPerformance[] {
    const componentStats = new Map<string, {
      operations: PerformanceMetrics[];
      totalLatency: number;
      successCount: number;
      memoryUsage: number;
    }>();

    // Group metrics by component
    for (const metric of this.metrics) {
      const componentName = metric.componentName || 'unknown';
      if (!componentStats.has(componentName)) {
        componentStats.set(componentName, {
          operations: [],
          totalLatency: 0,
          successCount: 0,
          memoryUsage: 0,
        });
      }

      const stats = componentStats.get(componentName)!;
      stats.operations.push(metric);
      stats.totalLatency += metric.durationMs;
      if (metric.success) stats.successCount++;
      stats.memoryUsage += metric.memoryUsage.heapUsed;
    }

    // Calculate performance statistics
    return Array.from(componentStats.entries()).map(([componentName, stats]) => {
      const totalOperations = stats.operations.length;
      const averageLatency = stats.totalLatency / totalOperations;
      const successRate = stats.successCount / totalOperations;
      const averageMemoryUsage = stats.memoryUsage / totalOperations;

      // Calculate bottleneck score (higher = more of a bottleneck)
      const bottleneckScore = this.calculateBottleneckScore(stats.operations);
      
      // Count performance hotspots
      const hotspotCount = this.countHotspots(stats.operations);

      return {
        componentName,
        totalOperations,
        averageLatency,
        successRate,
        memoryUsage: averageMemoryUsage,
        bottleneckScore,
        hotspotCount,
      };
    });
  }

  /**
   * Calculate bottleneck score for a component
   */
  private calculateBottleneckScore(operations: PerformanceMetrics[]): number {
    if (operations.length === 0) return 0;

    const latencies = operations.map(op => op.durationMs).sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    
    // Higher score for components with high latency variance
    return p95 / (median + 1);
  }

  /**
   * Count performance hotspots (operations significantly slower than average)
   */
  private countHotspots(operations: PerformanceMetrics[]): number {
    if (operations.length === 0) return 0;

    const averageLatency = operations.reduce((sum, op) => sum + op.durationMs, 0) / operations.length;
    const threshold = averageLatency * 2; // Consider operations 2x slower as hotspots
    
    return operations.filter(op => op.durationMs > threshold).length;
  }

  /**
   * Check for performance alerts
   */
  private checkAlerts(metrics: PerformanceMetrics): void {
    const alerts: PerformanceAlert[] = [];

    // Latency alert
    if (metrics.durationMs > this.config.alertThresholds.maxLatencyMs) {
      alerts.push({
        id: `latency-${metrics.operationId}`,
        type: 'latency',
        severity: metrics.durationMs > this.config.alertThresholds.maxLatencyMs * 2 ? 'critical' : 'warning',
        message: `Operation latency exceeded threshold: ${metrics.durationMs}ms > ${this.config.alertThresholds.maxLatencyMs}ms`,
        threshold: this.config.alertThresholds.maxLatencyMs,
        currentValue: metrics.durationMs,
        timestamp: Date.now(),
        operationType: metrics.operationType,
        componentName: metrics.componentName,
      });
    }

    // Memory alert
    const memoryUsageMb = metrics.memoryUsage.heapUsed / (1024 * 1024);
    if (memoryUsageMb > this.config.alertThresholds.maxMemoryUsageMb) {
      alerts.push({
        id: `memory-${metrics.operationId}`,
        type: 'memory',
        severity: memoryUsageMb > this.config.alertThresholds.maxMemoryUsageMb * 1.5 ? 'critical' : 'warning',
        message: `Memory usage exceeded threshold: ${memoryUsageMb.toFixed(2)}MB > ${this.config.alertThresholds.maxMemoryUsageMb}MB`,
        threshold: this.config.alertThresholds.maxMemoryUsageMb,
        currentValue: memoryUsageMb,
        timestamp: Date.now(),
        operationType: metrics.operationType,
        componentName: metrics.componentName,
      });
    }

    // CPU alert
    if (metrics.resourceUtilization.cpuUsagePercent > this.config.alertThresholds.maxCpuUsagePercent) {
      alerts.push({
        id: `cpu-${metrics.operationId}`,
        type: 'cpu',
        severity: metrics.resourceUtilization.cpuUsagePercent > this.config.alertThresholds.maxCpuUsagePercent * 1.2 ? 'critical' : 'warning',
        message: `CPU usage exceeded threshold: ${metrics.resourceUtilization.cpuUsagePercent.toFixed(2)}% > ${this.config.alertThresholds.maxCpuUsagePercent}%`,
        threshold: this.config.alertThresholds.maxCpuUsagePercent,
        currentValue: metrics.resourceUtilization.cpuUsagePercent,
        timestamp: Date.now(),
        operationType: metrics.operationType,
        componentName: metrics.componentName,
      });
    }

    // Concurrency alert
    if (metrics.resourceUtilization.concurrentOperations > this.config.alertThresholds.maxConcurrentOperations) {
      alerts.push({
        id: `concurrency-${metrics.operationId}`,
        type: 'concurrency',
        severity: 'warning',
        message: `Concurrent operations exceeded threshold: ${metrics.resourceUtilization.concurrentOperations} > ${this.config.alertThresholds.maxConcurrentOperations}`,
        threshold: this.config.alertThresholds.maxConcurrentOperations,
        currentValue: metrics.resourceUtilization.concurrentOperations,
        timestamp: Date.now(),
        operationType: metrics.operationType,
        componentName: metrics.componentName,
      });
    }

    // Success rate alert (check recent metrics)
    const throughput = this.getThroughputMetrics();
    if (throughput.successRate < this.config.alertThresholds.minSuccessRate) {
      alerts.push({
        id: `success-rate-${Date.now()}`,
        type: 'success_rate',
        severity: throughput.successRate < this.config.alertThresholds.minSuccessRate * 0.8 ? 'critical' : 'warning',
        message: `Success rate below threshold: ${(throughput.successRate * 100).toFixed(2)}% < ${(this.config.alertThresholds.minSuccessRate * 100).toFixed(2)}%`,
        threshold: this.config.alertThresholds.minSuccessRate,
        currentValue: throughput.successRate,
        timestamp: Date.now(),
      });
    }

    // Emit alerts
    for (const alert of alerts) {
      this.emitAlert(alert);
    }
  }

  /**
   * Emit a performance alert
   */
  private emitAlert(alert: PerformanceAlert): void {
    for (const callback of this.alertCallbacks) {
      try {
        callback(alert);
      } catch (error) {
        console.error('Error in alert callback:', error);
      }
    }
  }

  /**
   * Register an alert callback
   */
  onAlert(callback: (alert: PerformanceAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Remove an alert callback
   */
  removeAlertCallback(callback: (alert: PerformanceAlert) => void): void {
    const index = this.alertCallbacks.indexOf(callback);
    if (index >= 0) {
      this.alertCallbacks.splice(index, 1);
    }
  }

  /**
   * Get all performance metrics
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get metrics for a specific operation type
   */
  getMetricsByOperation(operationType: string): PerformanceMetrics[] {
    return this.metrics.filter(m => m.operationType === operationType);
  }

  /**
   * Get metrics for a specific component
   */
  getMetricsByComponent(componentName: string): PerformanceMetrics[] {
    return this.metrics.filter(m => m.componentName === componentName);
  }

  /**
   * Clear all stored metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Clean up old metrics based on retention policy
   */
  private cleanupOldMetrics(): void {
    const now = Date.now();
    const cutoff = now - this.config.metricsRetentionMs;
    this.metrics = this.metrics.filter(m => m.endTime > cutoff);
  }

  /**
   * Categorize error for metrics
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
    return 'unknown';
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalOperations: number;
    averageLatency: number;
    successRate: number;
    memoryUsage: MemoryUsage;
    throughput: ThroughputMetrics;
    componentPerformance: ComponentPerformance[];
    uptime: number;
  } {
    const throughput = this.getThroughputMetrics();
    const componentPerformance = this.getComponentPerformance();
    const currentMemoryUsage = this.getCurrentMemoryUsage();

    const totalOperations = this.metrics.length;
    const averageLatency = totalOperations > 0 
      ? this.metrics.reduce((sum, m) => sum + m.durationMs, 0) / totalOperations 
      : 0;
    const successfulOperations = this.metrics.filter(m => m.success).length;
    const successRate = totalOperations > 0 ? successfulOperations / totalOperations : 1;

    return {
      totalOperations,
      averageLatency,
      successRate,
      memoryUsage: currentMemoryUsage,
      throughput,
      componentPerformance,
      uptime: Date.now() - this.startTime,
    };
  }
}