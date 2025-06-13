/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceSystem, PerformancePlugin } from './performance-system.js';

// Mock OpenTelemetry
vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(() => ({
      createCounter: vi.fn(() => ({ add: vi.fn() })),
      createHistogram: vi.fn(() => ({ record: vi.fn() })),
      createUpDownCounter: vi.fn(() => ({ add: vi.fn() })),
    })),
  },
  ValueType: { INT: 'INT', DOUBLE: 'DOUBLE' },
}));

// Mock telemetry metrics
vi.mock('../../../telemetry/metrics.js', () => ({
  recordToolCallMetrics: vi.fn(),
}));

describe('PerformanceSystem', () => {
  let system: PerformanceSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    system = new PerformanceSystem({
      enableTelemetry: false, // Disable to avoid telemetry noise in tests
      enableDashboard: false, // Disable to avoid dashboard complexity
    });
  });

  afterEach(async () => {
    await system.stop();
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const status = system.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.components.monitor).toBe(true);
      expect(status.components.profiler).toBe(true);
      expect(status.components.memoryAnalyzer).toBe(true);
      expect(status.components.anomalyDetector).toBe(true);
    });

    it('should initialize with custom configuration', () => {
      const customSystem = new PerformanceSystem({
        enableProfiling: false,
        enableMemoryAnalysis: false,
        enableAnomalyDetection: false,
      });

      const status = customSystem.getStatus();
      expect(status.components.profiler).toBe(false);
      expect(status.components.memoryAnalyzer).toBe(false);
      expect(status.components.anomalyDetector).toBe(false);
    });
  });

  describe('operation monitoring', () => {
    beforeEach(async () => {
      await system.start();
    });

    it('should track operation lifecycle', () => {
      const operationId = 'test-op-1';
      const operationType = 'analyze';
      const componentName = 'analyzer';

      // Start operation
      system.startOperation(operationId, operationType, componentName);
      const status = system.getStatus();
      expect(status.activeOperations).toBe(1);

      // End operation
      const metrics = system.endOperation(operationId, operationType, componentName, true);
      expect(metrics).toBeDefined();
      expect(metrics!.operationType).toBe(operationType);
      expect(metrics!.componentName).toBe(componentName);
      expect(metrics!.success).toBe(true);

      const finalStatus = system.getStatus();
      expect(finalStatus.activeOperations).toBe(0);
    });

    it('should handle failed operations', () => {
      const operationId = 'test-op-2';
      const operationType = 'edit';
      const error = 'File not found';

      system.startOperation(operationId, operationType);
      const metrics = system.endOperation(operationId, operationType, 'editor', false, error);

      expect(metrics).toBeDefined();
      expect(metrics!.success).toBe(false);
      expect(metrics!.error).toBe(error);
    });

    it('should handle concurrent operations', () => {
      const operations = [
        { id: 'op1', type: 'analyze' },
        { id: 'op2', type: 'edit' },
        { id: 'op3', type: 'validate' },
      ];

      // Start all operations
      operations.forEach(op => {
        system.startOperation(op.id, op.type);
      });

      const status = system.getStatus();
      expect(status.activeOperations).toBe(3);

      // End operations
      operations.forEach(op => {
        const metrics = system.endOperation(op.id, op.type, undefined, true);
        expect(metrics).toBeDefined();
      });

      const finalStatus = system.getStatus();
      expect(finalStatus.activeOperations).toBe(0);
    });

    it('should handle marks and phases', () => {
      const operationId = 'test-op-phases';
      
      system.startOperation(operationId, 'complex-operation');
      
      // Add marks
      system.mark(operationId, 'start-processing');
      system.mark(operationId, 'halfway-point');
      
      // Add phases
      const phaseId = system.startPhase(operationId, 'processing-phase');
      expect(phaseId).toBeDefined();
      
      if (phaseId) {
        system.endPhase(phaseId);
      }
      
      system.mark(operationId, 'end-processing');
      const metrics = system.endOperation(operationId, 'complex-operation');
      
      expect(metrics).toBeDefined();
    });
  });

  describe('plugin system', () => {
    beforeEach(async () => {
      await system.start();
    });

    it('should register and initialize plugins', async () => {
      const mockPlugin: PerformancePlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        initialize: vi.fn(),
        onOperationStart: vi.fn(),
        onOperationEnd: vi.fn(),
        cleanup: vi.fn(),
      };

      await system.registerPlugin(mockPlugin);
      expect(mockPlugin.initialize).toHaveBeenCalledWith(system);

      const plugins = system.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBe(mockPlugin);
    });

    it('should call plugin hooks during operation', async () => {
      const mockPlugin: PerformancePlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        onOperationStart: vi.fn(),
        onOperationEnd: vi.fn(),
      };

      await system.registerPlugin(mockPlugin);

      const operationId = 'test-op';
      const operationType = 'test';

      system.startOperation(operationId, operationType);
      expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(operationId, operationType, {});

      const metrics = system.endOperation(operationId, operationType);
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(operationId, metrics);
    });

    it('should unregister plugins', async () => {
      const mockPlugin: PerformancePlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        cleanup: vi.fn(),
      };

      await system.registerPlugin(mockPlugin);
      expect(system.getPlugins()).toHaveLength(1);

      await system.unregisterPlugin('test-plugin');
      expect(mockPlugin.cleanup).toHaveBeenCalled();
      expect(system.getPlugins()).toHaveLength(0);
    });

    it('should handle plugin errors gracefully', async () => {
      const mockPlugin: PerformancePlugin = {
        name: 'error-plugin',
        version: '1.0.0',
        description: 'Plugin that throws errors',
        onOperationStart: vi.fn(() => {
          throw new Error('Plugin error');
        }),
      };

      await system.registerPlugin(mockPlugin);

      // Should not throw despite plugin error
      expect(() => {
        system.startOperation('test-op', 'test');
      }).not.toThrow();
    });
  });

  describe('event system', () => {
    beforeEach(async () => {
      await system.start();
    });

    it('should emit and handle events', () => {
      const eventHandler = vi.fn();
      system.on('operation_start', eventHandler);

      system.startOperation('test-op', 'test');
      
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'operation_start',
          timestamp: expect.any(Number),
          data: expect.objectContaining({
            operationId: 'test-op',
            operationType: 'test',
          }),
        })
      );
    });

    it('should remove event handlers', () => {
      const eventHandler = vi.fn();
      system.on('operation_start', eventHandler);
      system.off('operation_start', eventHandler);

      system.startOperation('test-op', 'test');
      
      expect(eventHandler).not.toHaveBeenCalled();
    });

    it('should handle multiple event handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      system.on('operation_start', handler1);
      system.on('operation_start', handler2);

      system.startOperation('test-op', 'test');
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      const newConfig = {
        enableProfiling: false,
        telemetryIntegration: {
          eventSamplingRate: 0.5,
        },
      };

      system.updateConfig(newConfig);
      const config = system.getConfig();
      
      expect(config.enableProfiling).toBe(false);
      expect(config.telemetryIntegration.eventSamplingRate).toBe(0.5);
    });

    it('should get current configuration', () => {
      const config = system.getConfig();
      expect(config).toBeDefined();
      expect(typeof config.enableProfiling).toBe('boolean');
      expect(typeof config.enableMemoryAnalysis).toBe('boolean');
      expect(typeof config.enableAnomalyDetection).toBe('boolean');
    });
  });

  describe('system status', () => {
    it('should provide system status', () => {
      const status = system.getStatus();
      
      expect(status).toEqual({
        enabled: expect.any(Boolean),
        components: expect.objectContaining({
          monitor: expect.any(Boolean),
          profiler: expect.any(Boolean),
          memoryAnalyzer: expect.any(Boolean),
          anomalyDetector: expect.any(Boolean),
          dashboard: expect.any(Boolean),
          telemetry: expect.any(Boolean),
        }),
        plugins: expect.any(Array),
        activeOperations: expect.any(Number),
        totalOperations: expect.any(Number),
        memoryUsage: expect.objectContaining({
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number),
          external: expect.any(Number),
          arrayBuffers: expect.any(Number),
        }),
        uptime: expect.any(Number),
        health: expect.stringMatching(/^(healthy|warning|critical)$/),
      });
    });

    it('should track active operations count', () => {
      const initialStatus = system.getStatus();
      expect(initialStatus.activeOperations).toBe(0);

      system.startOperation('op1', 'test');
      system.startOperation('op2', 'test');
      
      const activeStatus = system.getStatus();
      expect(activeStatus.activeOperations).toBe(2);

      system.endOperation('op1', 'test');
      
      const partialStatus = system.getStatus();
      expect(partialStatus.activeOperations).toBe(1);

      system.endOperation('op2', 'test');
      
      const finalStatus = system.getStatus();
      expect(finalStatus.activeOperations).toBe(0);
    });
  });

  describe('performance summary', () => {
    beforeEach(async () => {
      await system.start();
    });

    it('should provide performance summary', () => {
      // Generate some metrics
      system.startOperation('op1', 'test');
      system.endOperation('op1', 'test', 'component', true);

      const summary = system.getPerformanceSummary();
      
      expect(summary).toBeDefined();
      expect(summary.totalOperations).toBeGreaterThanOrEqual(1);
      expect(summary.averageLatency).toBeGreaterThanOrEqual(0);
      expect(summary.successRate).toBeGreaterThanOrEqual(0);
      expect(summary.successRate).toBeLessThanOrEqual(1);
      expect(summary.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('lifecycle', () => {
    it('should start and stop successfully', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await system.start();
      await system.stop();
      
      expect(consoleSpy).toHaveBeenCalledWith('Starting performance monitoring system...');
      expect(consoleSpy).toHaveBeenCalledWith('Performance monitoring system started');
      expect(consoleSpy).toHaveBeenCalledWith('Stopping performance monitoring system...');
      expect(consoleSpy).toHaveBeenCalledWith('Performance monitoring system stopped');
      
      consoleSpy.mockRestore();
    });

    it('should handle stop without start', async () => {
      // Should not throw
      await expect(system.stop()).resolves.not.toThrow();
    });

    it('should cleanup plugins on stop', async () => {
      const mockPlugin: PerformancePlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        cleanup: vi.fn(),
      };

      await system.registerPlugin(mockPlugin);
      await system.start();
      await system.stop();
      
      expect(mockPlugin.cleanup).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle unknown operation end gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const metrics = system.endOperation('unknown-op', 'test');
      
      expect(metrics).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith('Operation unknown-op was not being monitored');
      
      consoleSpy.mockRestore();
    });

    it('should handle duplicate plugin registration', async () => {
      const plugin: PerformancePlugin = {
        name: 'duplicate-plugin',
        version: '1.0.0',
        description: 'Test plugin',
      };

      await system.registerPlugin(plugin);
      
      await expect(system.registerPlugin(plugin)).rejects.toThrow(
        'Plugin duplicate-plugin is already registered'
      );
    });

    it('should handle unregistering non-existent plugin', async () => {
      await expect(system.unregisterPlugin('non-existent')).rejects.toThrow(
        'Plugin non-existent is not registered'
      );
    });
  });
});