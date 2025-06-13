/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import {
  PerformanceMonitor,
  PerformanceConfig,
  PerformanceAlert,
  PerformanceMetrics,
} from './performance-monitor.js';

// Mock the OpenTelemetry metrics
vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(() => ({
      createCounter: vi.fn(() => ({
        add: vi.fn(),
      })),
      createHistogram: vi.fn(() => ({
        record: vi.fn(),
      })),
      createUpDownCounter: vi.fn(() => ({
        add: vi.fn(),
      })),
    })),
  },
  ValueType: {
    INT: 'INT',
    DOUBLE: 'DOUBLE',
  },
}));

// Mock the telemetry metrics
vi.mock('../../../telemetry/metrics.js', () => ({
  recordToolCallMetrics: vi.fn(),
}));

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;
  let alertCallback: MockedFunction<(alert: PerformanceAlert) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    monitor = new PerformanceMonitor();
    alertCallback = vi.fn();
    monitor.onAlert(alertCallback);
  });

  afterEach(() => {
    monitor.clearMetrics();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const newMonitor = new PerformanceMonitor();
      expect(newMonitor).toBeDefined();
    });

    it('should initialize with custom config', () => {
      const config: Partial<PerformanceConfig> = {
        enableDetailedProfiling: false,
        metricsRetentionMs: 1000,
        alertThresholds: {
          maxLatencyMs: 1000,
          minSuccessRate: 0.9,
          maxMemoryUsageMb: 256,
          maxCpuUsagePercent: 90,
          maxConcurrentOperations: 25,
        },
      };
      const newMonitor = new PerformanceMonitor(config);
      expect(newMonitor).toBeDefined();
    });
  });

  describe('operation tracking', () => {
    it('should track a simple operation', () => {
      const operationId = 'test-op-1';
      const operationType = 'analyze';
      
      monitor.startOperation(operationId, operationType);
      
      // Simulate some work
      const result = monitor.endOperation(operationId, operationType, 'analyzer', true);
      
      expect(result).toBeDefined();
      expect(result!.operationId).toBe(operationId);
      expect(result!.operationType).toBe(operationType);
      expect(result!.componentName).toBe('analyzer');
      expect(result!.success).toBe(true);
      expect(result!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track failed operation', () => {
      const operationId = 'test-op-2';
      const operationType = 'edit';
      const error = 'File not found';
      
      monitor.startOperation(operationId, operationType);
      const result = monitor.endOperation(operationId, operationType, 'editor', false, error);
      
      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe(error);
    });

    it('should return undefined for non-existent operation', () => {
      const result = monitor.endOperation('non-existent', 'analyze');
      expect(result).toBeUndefined();
    });

    it('should include operation details', () => {
      const operationId = 'test-op-3';
      const operationType = 'validate';
      const details = { fileCount: 5, linesOfCode: 1000 };
      
      monitor.startOperation(operationId, operationType);
      const result = monitor.endOperation(operationId, operationType, 'validator', true, undefined, details);
      
      expect(result!.operationDetails).toEqual(details);
    });
  });

  describe('metrics collection', () => {
    it('should collect and store metrics', () => {
      const operationId = 'test-op-4';
      
      monitor.startOperation(operationId, 'analyze');
      monitor.endOperation(operationId, 'analyze', 'analyzer', true);
      
      const metrics = monitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operationId).toBe(operationId);
    });

    it('should filter metrics by operation type', () => {
      monitor.startOperation('op1', 'analyze');
      monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      monitor.startOperation('op2', 'edit');
      monitor.endOperation('op2', 'edit', 'editor', true);
      
      const analyzeMetrics = monitor.getMetricsByOperation('analyze');
      const editMetrics = monitor.getMetricsByOperation('edit');
      
      expect(analyzeMetrics).toHaveLength(1);
      expect(editMetrics).toHaveLength(1);
      expect(analyzeMetrics[0].operationType).toBe('analyze');
      expect(editMetrics[0].operationType).toBe('edit');
    });

    it('should filter metrics by component', () => {
      monitor.startOperation('op1', 'analyze');
      monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      monitor.startOperation('op2', 'edit');
      monitor.endOperation('op2', 'edit', 'editor', true);
      
      const analyzerMetrics = monitor.getMetricsByComponent('analyzer');
      const editorMetrics = monitor.getMetricsByComponent('editor');
      
      expect(analyzerMetrics).toHaveLength(1);
      expect(editorMetrics).toHaveLength(1);
      expect(analyzerMetrics[0].componentName).toBe('analyzer');
      expect(editorMetrics[0].componentName).toBe('editor');
    });
  });

  describe('throughput metrics', () => {
    it('should calculate throughput metrics', () => {
      // Add some operations
      for (let i = 0; i < 10; i++) {
        monitor.startOperation(`op${i}`, 'analyze');
        monitor.endOperation(`op${i}`, 'analyze', 'analyzer', i < 9); // 1 failure
      }
      
      const throughput = monitor.getThroughputMetrics();
      
      expect(throughput.totalOperations).toBe(10);
      expect(throughput.failedOperations).toBe(1);
      expect(throughput.successRate).toBe(0.9);
      expect(throughput.operationsPerSecond).toBeGreaterThan(0);
    });

    it('should handle empty metrics', () => {
      const throughput = monitor.getThroughputMetrics();
      
      expect(throughput.totalOperations).toBe(0);
      expect(throughput.failedOperations).toBe(0);
      expect(throughput.successRate).toBe(1);
      expect(throughput.operationsPerSecond).toBe(0);
    });
  });

  describe('component performance', () => {
    it('should calculate component performance statistics', () => {
      // Add operations for different components
      monitor.startOperation('op1', 'analyze');
      monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      monitor.startOperation('op2', 'analyze');
      monitor.endOperation('op2', 'analyze', 'analyzer', true);
      
      monitor.startOperation('op3', 'edit');
      monitor.endOperation('op3', 'edit', 'editor', true);
      
      const componentPerf = monitor.getComponentPerformance();
      
      expect(componentPerf).toHaveLength(2);
      
      const analyzerPerf = componentPerf.find(c => c.componentName === 'analyzer');
      const editorPerf = componentPerf.find(c => c.componentName === 'editor');
      
      expect(analyzerPerf).toBeDefined();
      expect(analyzerPerf!.totalOperations).toBe(2);
      expect(analyzerPerf!.successRate).toBe(1);
      
      expect(editorPerf).toBeDefined();
      expect(editorPerf!.totalOperations).toBe(1);
      expect(editorPerf!.successRate).toBe(1);
    });

    it('should calculate bottleneck scores', () => {
      monitor.startOperation('op1', 'analyze');
      monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      const componentPerf = monitor.getComponentPerformance();
      const analyzerPerf = componentPerf.find(c => c.componentName === 'analyzer');
      
      expect(analyzerPerf!.bottleneckScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('alerting', () => {
    it('should trigger latency alert', () => {
      const config: Partial<PerformanceConfig> = {
        alertThresholds: {
          maxLatencyMs: 10,
          minSuccessRate: 0.95,
          maxMemoryUsageMb: 512,
          maxCpuUsagePercent: 80,
          maxConcurrentOperations: 50,
        },
      };
      
      const alertMonitor = new PerformanceMonitor(config);
      const alertSpy = vi.fn();
      alertMonitor.onAlert(alertSpy);
      
      alertMonitor.startOperation('slow-op', 'analyze');
      
      // Simulate slow operation
      setTimeout(() => {
        alertMonitor.endOperation('slow-op', 'analyze', 'analyzer', true);
      }, 20);
      
      // Wait for the operation to complete
      setTimeout(() => {
        expect(alertSpy).toHaveBeenCalled();
        const alert = alertSpy.mock.calls[0][0] as PerformanceAlert;
        expect(alert.type).toBe('latency');
      }, 30);
    });

    it('should trigger success rate alert', () => {
      const config: Partial<PerformanceConfig> = {
        alertThresholds: {
          maxLatencyMs: 5000,
          minSuccessRate: 0.95,
          maxMemoryUsageMb: 512,
          maxCpuUsagePercent: 80,
          maxConcurrentOperations: 50,
        },
      };
      
      const alertMonitor = new PerformanceMonitor(config);
      const alertSpy = vi.fn();
      alertMonitor.onAlert(alertSpy);
      
      // Add operations with low success rate
      for (let i = 0; i < 10; i++) {
        alertMonitor.startOperation(`op${i}`, 'analyze');
        alertMonitor.endOperation(`op${i}`, 'analyze', 'analyzer', i < 5); // 50% success rate
      }
      
      // The alert should be triggered during the last operation
      expect(alertSpy).toHaveBeenCalled();
      const calls = alertSpy.mock.calls.filter(call => call[0].type === 'success_rate');
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should remove alert callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      
      monitor.onAlert(callback1);
      monitor.onAlert(callback2);
      monitor.removeAlertCallback(callback1);
      
      // This should only trigger callback2
      const config: Partial<PerformanceConfig> = {
        alertThresholds: {
          maxLatencyMs: 1,
          minSuccessRate: 0.95,
          maxMemoryUsageMb: 512,
          maxCpuUsagePercent: 80,
          maxConcurrentOperations: 50,
        },
      };
      
      const alertMonitor = new PerformanceMonitor(config);
      alertMonitor.onAlert(callback2);
      
      alertMonitor.startOperation('op', 'analyze');
      setTimeout(() => {
        alertMonitor.endOperation('op', 'analyze', 'analyzer', true);
      }, 10);
      
      setTimeout(() => {
        expect(callback1).not.toHaveBeenCalled();
        expect(callback2).toHaveBeenCalled();
      }, 20);
    });
  });

  describe('performance summary', () => {
    it('should generate performance summary', () => {
      // Add some operations
      monitor.startOperation('op1', 'analyze');
      monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      monitor.startOperation('op2', 'edit');
      monitor.endOperation('op2', 'edit', 'editor', false, 'Test error');
      
      const summary = monitor.getPerformanceSummary();
      
      expect(summary.totalOperations).toBe(2);
      expect(summary.successRate).toBe(0.5);
      expect(summary.averageLatency).toBeGreaterThanOrEqual(0);
      expect(summary.memoryUsage).toBeDefined();
      expect(summary.throughput).toBeDefined();
      expect(summary.componentPerformance).toHaveLength(2);
      expect(summary.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty summary', () => {
      const summary = monitor.getPerformanceSummary();
      
      expect(summary.totalOperations).toBe(0);
      expect(summary.successRate).toBe(1);
      expect(summary.averageLatency).toBe(0);
      expect(summary.componentPerformance).toHaveLength(0);
    });
  });

  describe('metrics cleanup', () => {
    it('should clean up old metrics', () => {
      const config: Partial<PerformanceConfig> = {
        metricsRetentionMs: 100, // Very short retention
      };
      
      const cleanupMonitor = new PerformanceMonitor(config);
      
      // Add operation
      cleanupMonitor.startOperation('op1', 'analyze');
      cleanupMonitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      expect(cleanupMonitor.getMetrics()).toHaveLength(1);
      
      // Wait for retention period to pass
      setTimeout(() => {
        // Add another operation to trigger cleanup
        cleanupMonitor.startOperation('op2', 'analyze');
        cleanupMonitor.endOperation('op2', 'analyze', 'analyzer', true);
        
        // Only the new operation should remain
        const metrics = cleanupMonitor.getMetrics();
        expect(metrics).toHaveLength(1);
        expect(metrics[0].operationId).toBe('op2');
      }, 150);
    });

    it('should clear all metrics', () => {
      monitor.startOperation('op1', 'analyze');
      monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      expect(monitor.getMetrics()).toHaveLength(1);
      
      monitor.clearMetrics();
      
      expect(monitor.getMetrics()).toHaveLength(0);
    });
  });

  describe('memory tracking', () => {
    it('should track memory usage', () => {
      monitor.startOperation('op1', 'analyze');
      const result = monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      expect(result!.memoryUsage).toBeDefined();
      expect(result!.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(result!.memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(result!.memoryUsage.rss).toBeGreaterThan(0);
    });
  });

  describe('resource utilization', () => {
    it('should track resource utilization', () => {
      monitor.startOperation('op1', 'analyze');
      const result = monitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      expect(result!.resourceUtilization).toBeDefined();
      expect(result!.resourceUtilization.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(result!.resourceUtilization.memoryPressure).toBeGreaterThanOrEqual(0);
      expect(result!.resourceUtilization.concurrentOperations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error categorization', () => {
    it('should categorize different types of errors', () => {
      const errorTypes = [
        'ENOENT: no such file or directory',
        'EACCES: permission denied',
        'timeout occurred',
        'out of memory',
        'syntax error in file',
        'unknown error type',
      ];
      
      errorTypes.forEach((error, index) => {
        monitor.startOperation(`op${index}`, 'analyze');
        monitor.endOperation(`op${index}`, 'analyze', 'analyzer', false, error);
      });
      
      const metrics = monitor.getMetrics();
      expect(metrics).toHaveLength(errorTypes.length);
      
      // All should have errors recorded
      metrics.forEach(metric => {
        expect(metric.success).toBe(false);
        expect(metric.error).toBeDefined();
      });
    });
  });

  describe('profiling modes', () => {
    it('should respect profiling configuration', () => {
      const config: Partial<PerformanceConfig> = {
        enableDetailedProfiling: false,
      };
      
      const nonProfilingMonitor = new PerformanceMonitor(config);
      
      // Operations should not be tracked when profiling is disabled
      nonProfilingMonitor.startOperation('op1', 'analyze');
      const result = nonProfilingMonitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      expect(result).toBeUndefined();
    });

    it('should track when profiling is enabled', () => {
      const config: Partial<PerformanceConfig> = {
        enableDetailedProfiling: true,
      };
      
      const profilingMonitor = new PerformanceMonitor(config);
      
      profilingMonitor.startOperation('op1', 'analyze');
      const result = profilingMonitor.endOperation('op1', 'analyze', 'analyzer', true);
      
      expect(result).toBeDefined();
    });
  });
});