/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformanceMonitor, PerformanceConfig, PerformanceMetrics, PerformanceAlert } from './performance-monitor.js';
import { PerformanceProfiler, ProfilerConfig, ProfileAnalysis } from './performance-profiler.js';
import { MemoryAnalyzer, MemoryAnalyzerConfig, MemoryLeak } from './memory-analyzer.js';
import { AnomalyDetector, AnomalyDetectorConfig, Anomaly } from './anomaly-detector.js';
import { PerformanceDashboard, DashboardLayout } from './performance-dashboard.js';
import { PerformanceBenchmark, BenchmarkResult } from './performance-benchmark.js';
import { PerformanceRegressionTester, RegressionTestConfig } from './performance-regression-tests.js';
import { TelemetryIntegration, TelemetryIntegrationConfig } from './telemetry-integration.js';

/**
 * Performance monitoring system configuration
 */
export interface PerformanceSystemConfig {
  enableProfiling: boolean;
  enableMemoryAnalysis: boolean;
  enableAnomalyDetection: boolean;
  enableDashboard: boolean;
  enableTelemetry: boolean;
  enableBenchmarking: boolean;
  enableRegressionTesting: boolean;
  
  // Component configurations
  performanceMonitor: Partial<PerformanceConfig>;
  profiler: Partial<ProfilerConfig>;
  memoryAnalyzer: Partial<MemoryAnalyzerConfig>;
  anomalyDetector: Partial<AnomalyDetectorConfig>;
  telemetryIntegration: Partial<TelemetryIntegrationConfig>;
  
  // Plugin configuration
  enablePlugins: boolean;
  pluginDirectory?: string;
  customMetrics: CustomMetricDefinition[];
}

/**
 * Custom metric definition for extensibility
 */
export interface CustomMetricDefinition {
  name: string;
  type: 'counter' | 'histogram' | 'gauge' | 'summary';
  description: string;
  unit?: string;
  labels?: string[];
  aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count';
}

/**
 * Performance plugin interface
 */
export interface PerformancePlugin {
  name: string;
  version: string;
  description: string;
  
  // Lifecycle hooks
  initialize?(system: PerformanceSystem): Promise<void>;
  onOperationStart?(operationId: string, operationType: string, metadata?: Record<string, unknown>): void;
  onOperationEnd?(operationId: string, metrics: PerformanceMetrics): void;
  onAnomaly?(anomaly: Anomaly): void;
  onMemoryLeak?(leak: MemoryLeak): void;
  onAlert?(alert: PerformanceAlert): void;
  cleanup?(): Promise<void>;
  
  // Custom metrics
  getCustomMetrics?(): Record<string, number>;
  
  // Configuration
  configure?(config: Record<string, unknown>): void;
}

/**
 * Performance system event
 */
export interface PerformanceSystemEvent {
  type: 'operation_start' | 'operation_end' | 'anomaly' | 'alert' | 'memory_leak' | 'profile_complete';
  timestamp: number;
  data: any;
  metadata?: Record<string, unknown>;
}

/**
 * Performance system status
 */
export interface PerformanceSystemStatus {
  enabled: boolean;
  components: {
    monitor: boolean;
    profiler: boolean;
    memoryAnalyzer: boolean;
    anomalyDetector: boolean;
    dashboard: boolean;
    telemetry: boolean;
  };
  plugins: string[];
  activeOperations: number;
  totalOperations: number;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  health: 'healthy' | 'warning' | 'critical';
}

/**
 * Comprehensive performance monitoring system
 */
export class PerformanceSystem {
  private config: PerformanceSystemConfig;
  private monitor!: PerformanceMonitor;
  private profiler?: PerformanceProfiler;
  private memoryAnalyzer?: MemoryAnalyzer;
  private anomalyDetector?: AnomalyDetector;
  private dashboard?: PerformanceDashboard;
  private benchmark?: PerformanceBenchmark;
  private regressionTester?: PerformanceRegressionTester;
  private telemetryIntegration?: TelemetryIntegration;
  
  private plugins = new Map<string, PerformancePlugin>();
  private eventHandlers = new Map<string, Array<(event: PerformanceSystemEvent) => void>>();
  private activeOperations = new Set<string>();
  private operationMetadata = new Map<string, Record<string, unknown>>();
  private startTime = Date.now();
  private isInitialized = false;

  constructor(config: Partial<PerformanceSystemConfig> = {}) {
    this.config = {
      enableProfiling: true,
      enableMemoryAnalysis: true,
      enableAnomalyDetection: true,
      enableDashboard: true,
      enableTelemetry: true,
      enableBenchmarking: false, // Disabled by default
      enableRegressionTesting: false, // Disabled by default
      enablePlugins: true,
      performanceMonitor: {},
      profiler: {},
      memoryAnalyzer: {},
      anomalyDetector: {},
      telemetryIntegration: {},
      customMetrics: [],
      ...config,
    };

    this.initializeComponents();
  }

  /**
   * Initialize all performance monitoring components
   */
  private initializeComponents(): void {
    // Core performance monitor (always enabled)
    this.monitor = new PerformanceMonitor(this.config.performanceMonitor);

    // Optional components
    if (this.config.enableProfiling) {
      this.profiler = new PerformanceProfiler(this.config.profiler);
    }

    if (this.config.enableMemoryAnalysis) {
      this.memoryAnalyzer = new MemoryAnalyzer(this.config.memoryAnalyzer);
    }

    if (this.config.enableAnomalyDetection) {
      this.anomalyDetector = new AnomalyDetector(this.config.anomalyDetector);
    }

    if (this.config.enableDashboard) {
      this.dashboard = new PerformanceDashboard(
        this.monitor,
        this.profiler,
        this.memoryAnalyzer
      );
    }

    if (this.config.enableBenchmarking) {
      this.benchmark = new PerformanceBenchmark(this.monitor);
    }

    if (this.config.enableRegressionTesting) {
      this.regressionTester = new PerformanceRegressionTester();
    }

    if (this.config.enableTelemetry) {
      this.telemetryIntegration = new TelemetryIntegration(
        this.monitor,
        this.memoryAnalyzer,
        this.anomalyDetector,
        this.profiler,
        this.config.telemetryIntegration
      );
    }

    this.setupEventHandlers();
    this.isInitialized = true;
  }

  /**
   * Setup event handlers between components
   */
  private setupEventHandlers(): void {
    // Performance monitor alerts
    this.monitor.onAlert((alert: PerformanceAlert) => {
      this.emitEvent('alert', alert);
      this.notifyPlugins('onAlert', alert);
    });

    // Anomaly detection
    if (this.anomalyDetector) {
      this.anomalyDetector.onAnomaly('*', (anomaly: Anomaly) => {
        this.emitEvent('anomaly', anomaly);
        this.notifyPlugins('onAnomaly', anomaly);
      });
    }

    // Memory leak detection
    if (this.memoryAnalyzer) {
      // Note: In a real implementation, MemoryAnalyzer would emit events
      // For now, we'll check periodically
      setInterval(() => {
        const leaks = this.memoryAnalyzer!.getDetectedLeaks();
        for (const leak of leaks) {
          this.emitEvent('memory_leak', leak);
          this.notifyPlugins('onMemoryLeak', leak);
        }
      }, 30000); // Every 30 seconds
    }
  }

  /**
   * Start performance monitoring
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Performance system not initialized');
    }

    console.log('Starting performance monitoring system...');

    // Start components
    if (this.memoryAnalyzer) {
      this.memoryAnalyzer.startMonitoring();
    }

    if (this.dashboard) {
      this.dashboard.start();
    }

    if (this.telemetryIntegration) {
      this.telemetryIntegration.startThroughputTracking();
    }

    // Initialize plugins
    if (this.config.enablePlugins) {
      await this.loadPlugins();
    }

    console.log('Performance monitoring system started');
  }

  /**
   * Stop performance monitoring
   */
  async stop(): Promise<void> {
    console.log('Stopping performance monitoring system...');

    // Stop components
    if (this.memoryAnalyzer) {
      this.memoryAnalyzer.stopMonitoring();
    }

    if (this.dashboard) {
      this.dashboard.stop();
    }

    if (this.telemetryIntegration) {
      this.telemetryIntegration.stop();
    }

    // Cleanup plugins
    for (const plugin of this.plugins.values()) {
      if (plugin.cleanup) {
        await plugin.cleanup();
      }
    }

    console.log('Performance monitoring system stopped');
  }

  /**
   * Start monitoring an operation
   */
  startOperation(
    operationId: string,
    operationType: string,
    componentName?: string,
    metadata: Record<string, unknown> = {}
  ): void {
    this.activeOperations.add(operationId);
    this.operationMetadata.set(operationId, metadata);

    // Start monitoring in all components
    this.monitor.startOperation(operationId, operationType, componentName);
    
    if (this.profiler) {
      this.profiler.startProfile(operationId, operationType, undefined, metadata);
    }

    if (this.memoryAnalyzer) {
      this.memoryAnalyzer.takeSnapshot(`operation_start_${operationId}`, operationId, operationType);
    }

    // Emit event
    this.emitEvent('operation_start', {
      operationId,
      operationType,
      componentName,
      metadata,
    });

    // Notify plugins
    this.notifyPlugins('onOperationStart', operationId, operationType, metadata);
  }

  /**
   * End monitoring an operation
   */
  endOperation(
    operationId: string,
    operationType: string,
    componentName?: string,
    success: boolean = true,
    error?: string,
    operationDetails: Record<string, unknown> = {}
  ): PerformanceMetrics | undefined {
    if (!this.activeOperations.has(operationId)) {
      console.warn(`Operation ${operationId} was not being monitored`);
      return undefined;
    }

    this.activeOperations.delete(operationId);
    const metadata = this.operationMetadata.get(operationId) || {};
    this.operationMetadata.delete(operationId);

    // End monitoring in all components
    const metrics = this.monitor.endOperation(
      operationId,
      operationType,
      componentName,
      success,
      error,
      { ...operationDetails, ...metadata }
    );

    if (this.profiler) {
      const profileEntry = this.profiler.endProfile(operationId, operationDetails);
      if (profileEntry) {
        const analysis = this.profiler.analyzeProfile(operationId);
        if (analysis) {
          this.emitEvent('profile_complete', { operationId, analysis });
          
          if (this.telemetryIntegration) {
            this.telemetryIntegration.recordProfileAnalysis(operationId, analysis);
          }
        }
      }
    }

    if (this.memoryAnalyzer) {
      this.memoryAnalyzer.takeSnapshot(`operation_end_${operationId}`, operationId, operationType);
    }

    if (this.anomalyDetector && metrics) {
      this.anomalyDetector.addPerformanceMetrics(metrics);
    }

    if (this.telemetryIntegration && metrics) {
      this.telemetryIntegration.recordOperationMetrics(metrics);
    }

    // Emit event
    if (metrics) {
      this.emitEvent('operation_end', { operationId, metrics });
      this.notifyPlugins('onOperationEnd', operationId, metrics);
    }

    return metrics;
  }

  /**
   * Add a performance mark within an operation
   */
  mark(operationId: string, markName: string, metadata: Record<string, unknown> = {}): void {
    if (this.profiler) {
      this.profiler.mark(operationId, markName, metadata);
    }
  }

  /**
   * Start a performance phase within an operation
   */
  startPhase(operationId: string, phaseName: string, metadata: Record<string, unknown> = {}): string | undefined {
    if (this.profiler) {
      return this.profiler.startPhase(operationId, phaseName, metadata);
    }
    return undefined;
  }

  /**
   * End a performance phase within an operation
   */
  endPhase(phaseId: string, metadata: Record<string, unknown> = {}): void {
    if (this.profiler) {
      this.profiler.endPhase(phaseId, metadata);
    }
  }

  /**
   * Register a performance plugin
   */
  async registerPlugin(plugin: PerformancePlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already registered`);
    }

    this.plugins.set(plugin.name, plugin);

    if (plugin.initialize) {
      await plugin.initialize(this);
    }

    console.log(`Performance plugin registered: ${plugin.name} v${plugin.version}`);
  }

  /**
   * Unregister a performance plugin
   */
  async unregisterPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} is not registered`);
    }

    if (plugin.cleanup) {
      await plugin.cleanup();
    }

    this.plugins.delete(pluginName);
    console.log(`Performance plugin unregistered: ${pluginName}`);
  }

  /**
   * Get registered plugins
   */
  getPlugins(): PerformancePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Subscribe to performance events
   */
  on(eventType: string, handler: (event: PerformanceSystemEvent) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Unsubscribe from performance events
   */
  off(eventType: string, handler: (event: PerformanceSystemEvent) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Get performance dashboard
   */
  getDashboard(): PerformanceDashboard | undefined {
    return this.dashboard;
  }

  /**
   * Get benchmark system
   */
  getBenchmark(): PerformanceBenchmark | undefined {
    return this.benchmark;
  }

  /**
   * Get regression tester
   */
  getRegressionTester(): PerformanceRegressionTester | undefined {
    return this.regressionTester;
  }

  /**
   * Run regression tests
   */
  async runRegressionTests(config: RegressionTestConfig): Promise<void> {
    if (!this.regressionTester) {
      throw new Error('Regression testing is not enabled');
    }

    const report = await this.regressionTester.runRegressionTests(config);
    
    // Emit regression test results
    this.emitEvent('regression_test_complete', report);
    
    return;
  }

  /**
   * Get system status
   */
  getStatus(): PerformanceSystemStatus {
    const memoryUsage = process.memoryUsage();
    const totalOperations = this.monitor.getMetrics().length;
    
    // Determine health based on current metrics
    let health: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (this.anomalyDetector) {
      const anomalies = this.anomalyDetector.getAnomalies();
      const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
      const highAnomalies = anomalies.filter(a => a.severity === 'high');
      
      if (criticalAnomalies.length > 0) {
        health = 'critical';
      } else if (highAnomalies.length > 0) {
        health = 'warning';
      }
    }

    return {
      enabled: this.isInitialized,
      components: {
        monitor: true,
        profiler: !!this.profiler,
        memoryAnalyzer: !!this.memoryAnalyzer,
        anomalyDetector: !!this.anomalyDetector,
        dashboard: !!this.dashboard,
        telemetry: !!this.telemetryIntegration,
      },
      plugins: Array.from(this.plugins.keys()),
      activeOperations: this.activeOperations.size,
      totalOperations,
      memoryUsage,
      uptime: Date.now() - this.startTime,
      health,
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): any {
    return this.monitor.getPerformanceSummary();
  }

  /**
   * Update system configuration
   */
  updateConfig(updates: Partial<PerformanceSystemConfig>): void {
    Object.assign(this.config, updates);
    
    // Update component configurations
    if (this.telemetryIntegration && updates.telemetryIntegration) {
      this.telemetryIntegration.updateConfig(updates.telemetryIntegration);
    }
  }

  /**
   * Emit a system event
   */
  private emitEvent(type: string, data: any): void {
    const event: PerformanceSystemEvent = {
      type: type as any,
      timestamp: Date.now(),
      data,
    };

    const handlers = this.eventHandlers.get(type) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${type}:`, error);
      }
    }
  }

  /**
   * Notify plugins of events
   */
  private notifyPlugins(method: string, ...args: any[]): void {
    for (const plugin of this.plugins.values()) {
      try {
        const pluginMethod = (plugin as any)[method];
        if (typeof pluginMethod === 'function') {
          pluginMethod.apply(plugin, args);
        }
      } catch (error) {
        console.error(`Error in plugin ${plugin.name} method ${method}:`, error);
      }
    }
  }

  /**
   * Load plugins from directory
   */
  private async loadPlugins(): Promise<void> {
    if (!this.config.pluginDirectory) return;

    // In a real implementation, you would scan the plugin directory
    // and dynamically load plugin modules
    console.log(`Loading plugins from ${this.config.pluginDirectory}`);
  }

  /**
   * Get configuration
   */
  getConfig(): PerformanceSystemConfig {
    return { ...this.config };
  }
}