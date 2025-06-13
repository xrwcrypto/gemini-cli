/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformanceMonitor, PerformanceMetrics, ThroughputMetrics, ComponentPerformance } from './performance-monitor.js';
import { PerformanceProfiler, ProfileAnalysis } from './performance-profiler.js';
import { MemoryAnalyzer, MemoryTrend, MemoryPressure, MemoryLeak } from './memory-analyzer.js';

/**
 * Dashboard widget configuration
 */
export interface DashboardWidget {
  id: string;
  type: 'line_chart' | 'bar_chart' | 'gauge' | 'table' | 'alert_list' | 'heatmap' | 'timeline';
  title: string;
  description?: string;
  position: { x: number; y: number; width: number; height: number };
  config: Record<string, unknown>;
  dataSource: string;
  refreshInterval: number; // milliseconds
  visible: boolean;
}

/**
 * Dashboard layout configuration
 */
export interface DashboardLayout {
  id: string;
  name: string;
  description?: string;
  widgets: DashboardWidget[];
  autoRefresh: boolean;
  refreshInterval: number;
  theme: 'light' | 'dark';
}

/**
 * Real-time metrics data point
 */
export interface MetricsDataPoint {
  timestamp: number;
  value: number;
  label?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Time series data for charts
 */
export interface TimeSeries {
  id: string;
  name: string;
  data: MetricsDataPoint[];
  color?: string;
  unit?: string;
}

/**
 * Dashboard data aggregation
 */
export interface DashboardData {
  realTimeMetrics: {
    throughput: ThroughputMetrics;
    memoryPressure: MemoryPressure;
    activeOperations: number;
    errorRate: number;
    averageLatency: number;
  };
  historicalData: {
    latencyTrend: TimeSeries;
    memoryTrend: TimeSeries;
    throughputTrend: TimeSeries;
    errorTrend: TimeSeries;
  };
  componentMetrics: ComponentPerformance[];
  memoryLeaks: MemoryLeak[];
  alerts: DashboardAlert[];
  systemHealth: SystemHealthStatus;
}

/**
 * Dashboard alert
 */
export interface DashboardAlert {
  id: string;
  type: 'performance' | 'memory' | 'error' | 'system';
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  sourceComponent?: string;
  actionRequired?: string;
  metadata?: Record<string, unknown>;
}

/**
 * System health status
 */
export interface SystemHealthStatus {
  overall: 'healthy' | 'warning' | 'critical' | 'degraded';
  components: {
    [componentName: string]: {
      status: 'healthy' | 'warning' | 'critical' | 'degraded';
      metrics: Record<string, number>;
      lastUpdate: number;
    };
  };
  uptime: number;
  version: string;
}

/**
 * Dashboard export configuration
 */
export interface DashboardExport {
  format: 'json' | 'csv' | 'html' | 'pdf';
  timeRange: { start: number; end: number };
  includeMetrics: boolean;
  includeAlerts: boolean;
  includeCharts: boolean;
}

/**
 * Performance dashboard for real-time monitoring and historical analysis
 */
export class PerformanceDashboard {
  private monitor: PerformanceMonitor;
  private profiler: PerformanceProfiler;
  private memoryAnalyzer: MemoryAnalyzer;
  private layouts = new Map<string, DashboardLayout>();
  private alerts: DashboardAlert[] = [];
  private dataHistory = new Map<string, MetricsDataPoint[]>();
  private updateCallbacks = new Set<(data: DashboardData) => void>();
  private updateInterval: NodeJS.Timeout | undefined;
  private isRunning = false;

  constructor(
    monitor?: PerformanceMonitor,
    profiler?: PerformanceProfiler,
    memoryAnalyzer?: MemoryAnalyzer
  ) {
    this.monitor = monitor || new PerformanceMonitor();
    this.profiler = profiler || new PerformanceProfiler();
    this.memoryAnalyzer = memoryAnalyzer || new MemoryAnalyzer();

    this.initializeDefaultLayouts();
    this.setupAlertHandlers();
  }

  /**
   * Start the dashboard
   */
  start(refreshInterval: number = 5000): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.memoryAnalyzer.startMonitoring();

    this.updateInterval = setInterval(() => {
      this.updateDashboard();
    }, refreshInterval);

    // Initial update
    this.updateDashboard();
  }

  /**
   * Stop the dashboard
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.memoryAnalyzer.stopMonitoring();

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }

  /**
   * Get current dashboard data
   */
  getDashboardData(): DashboardData {
    const throughput = this.monitor.getThroughputMetrics();
    const memoryPressure = this.memoryAnalyzer.assessMemoryPressure();
    const componentMetrics = this.monitor.getComponentPerformance();
    const memoryLeaks = this.memoryAnalyzer.getDetectedLeaks();
    const performanceSummary = this.monitor.getPerformanceSummary();

    // Calculate real-time metrics
    const activeOperations = this.getActiveOperationsCount();
    const errorRate = 1 - throughput.successRate;
    const averageLatency = performanceSummary.averageLatency;

    // Get historical data
    const historicalData = {
      latencyTrend: this.getTimeSeries('latency'),
      memoryTrend: this.getTimeSeries('memory'),
      throughputTrend: this.getTimeSeries('throughput'),
      errorTrend: this.getTimeSeries('errors'),
    };

    // Get system health
    const systemHealth = this.calculateSystemHealth();

    return {
      realTimeMetrics: {
        throughput,
        memoryPressure,
        activeOperations,
        errorRate,
        averageLatency,
      },
      historicalData,
      componentMetrics,
      memoryLeaks,
      alerts: [...this.alerts],
      systemHealth,
    };
  }

  /**
   * Add a custom dashboard layout
   */
  addLayout(layout: DashboardLayout): void {
    this.layouts.set(layout.id, layout);
  }

  /**
   * Get a dashboard layout
   */
  getLayout(id: string): DashboardLayout | undefined {
    return this.layouts.get(id);
  }

  /**
   * Get all available layouts
   */
  getLayouts(): DashboardLayout[] {
    return Array.from(this.layouts.values());
  }

  /**
   * Subscribe to dashboard updates
   */
  onUpdate(callback: (data: DashboardData) => void): void {
    this.updateCallbacks.add(callback);
  }

  /**
   * Unsubscribe from dashboard updates
   */
  removeUpdateCallback(callback: (data: DashboardData) => void): void {
    this.updateCallbacks.delete(callback);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  /**
   * Clear acknowledged alerts
   */
  clearAcknowledgedAlerts(): void {
    this.alerts = this.alerts.filter(alert => !alert.acknowledged);
  }

  /**
   * Export dashboard data
   */
  async exportData(config: DashboardExport): Promise<string> {
    const data = this.getDashboardData();
    const timeRangeData = this.filterDataByTimeRange(data, config.timeRange);

    switch (config.format) {
      case 'json':
        return this.exportAsJSON(timeRangeData, config);
      case 'csv':
        return this.exportAsCSV(timeRangeData, config);
      case 'html':
        return this.exportAsHTML(timeRangeData, config);
      case 'pdf':
        return this.exportAsPDF(timeRangeData, config);
      default:
        throw new Error(`Unsupported export format: ${config.format}`);
    }
  }

  /**
   * Initialize default dashboard layouts
   */
  private initializeDefaultLayouts(): void {
    // Overview layout
    const overviewLayout: DashboardLayout = {
      id: 'overview',
      name: 'Performance Overview',
      description: 'High-level performance metrics and system health',
      autoRefresh: true,
      refreshInterval: 5000,
      theme: 'light',
      widgets: [
        {
          id: 'throughput-gauge',
          type: 'gauge',
          title: 'Operations/Second',
          position: { x: 0, y: 0, width: 4, height: 3 },
          config: { max: 100, thresholds: [50, 80] },
          dataSource: 'throughput.operationsPerSecond',
          refreshInterval: 1000,
          visible: true,
        },
        {
          id: 'latency-chart',
          type: 'line_chart',
          title: 'Average Latency',
          position: { x: 4, y: 0, width: 8, height: 3 },
          config: { timeWindow: 300000, unit: 'ms' },
          dataSource: 'historicalData.latencyTrend',
          refreshInterval: 5000,
          visible: true,
        },
        {
          id: 'memory-chart',
          type: 'line_chart',
          title: 'Memory Usage',
          position: { x: 0, y: 3, width: 6, height: 4 },
          config: { timeWindow: 300000, unit: 'MB' },
          dataSource: 'historicalData.memoryTrend',
          refreshInterval: 5000,
          visible: true,
        },
        {
          id: 'component-table',
          type: 'table',
          title: 'Component Performance',
          position: { x: 6, y: 3, width: 6, height: 4 },
          config: { sortBy: 'averageLatency', sortOrder: 'desc' },
          dataSource: 'componentMetrics',
          refreshInterval: 10000,
          visible: true,
        },
        {
          id: 'alerts-list',
          type: 'alert_list',
          title: 'Active Alerts',
          position: { x: 0, y: 7, width: 12, height: 3 },
          config: { maxItems: 10 },
          dataSource: 'alerts',
          refreshInterval: 2000,
          visible: true,
        },
      ],
    };

    // Detailed metrics layout
    const detailedLayout: DashboardLayout = {
      id: 'detailed',
      name: 'Detailed Metrics',
      description: 'Comprehensive performance and memory analysis',
      autoRefresh: true,
      refreshInterval: 10000,
      theme: 'light',
      widgets: [
        {
          id: 'memory-heatmap',
          type: 'heatmap',
          title: 'Memory Usage Heatmap',
          position: { x: 0, y: 0, width: 6, height: 4 },
          config: { timeWindow: 3600000 },
          dataSource: 'memoryAnalysis',
          refreshInterval: 30000,
          visible: true,
        },
        {
          id: 'operation-timeline',
          type: 'timeline',
          title: 'Operation Timeline',
          position: { x: 6, y: 0, width: 6, height: 4 },
          config: { timeWindow: 300000 },
          dataSource: 'operationHistory',
          refreshInterval: 5000,
          visible: true,
        },
        {
          id: 'bottleneck-chart',
          type: 'bar_chart',
          title: 'Performance Bottlenecks',
          position: { x: 0, y: 4, width: 12, height: 4 },
          config: { sortBy: 'impactScore' },
          dataSource: 'bottlenecks',
          refreshInterval: 15000,
          visible: true,
        },
      ],
    };

    this.layouts.set(overviewLayout.id, overviewLayout);
    this.layouts.set(detailedLayout.id, detailedLayout);
  }

  /**
   * Setup alert handlers
   */
  private setupAlertHandlers(): void {
    this.monitor.onAlert((alert) => {
      this.addAlert({
        id: `perf-${Date.now()}`,
        type: 'performance',
        severity: alert.severity === 'critical' ? 'critical' : 'warning',
        title: `Performance Alert: ${alert.type}`,
        message: alert.message,
        timestamp: alert.timestamp,
        acknowledged: false,
        sourceComponent: alert.componentName,
        metadata: { alert },
      });
    });
  }

  /**
   * Update dashboard data and notify subscribers
   */
  private updateDashboard(): void {
    const data = this.getDashboardData();
    
    // Store historical data
    this.storeHistoricalData(data);
    
    // Check for new alerts
    this.checkForAlerts(data);
    
    // Notify subscribers
    for (const callback of this.updateCallbacks) {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in dashboard update callback:', error);
      }
    }
  }

  /**
   * Store historical data for trending
   */
  private storeHistoricalData(data: DashboardData): void {
    const timestamp = Date.now();
    
    // Store latency data
    this.addDataPoint('latency', {
      timestamp,
      value: data.realTimeMetrics.averageLatency,
      label: 'Average Latency',
    });

    // Store memory data
    const currentMemory = process.memoryUsage();
    this.addDataPoint('memory', {
      timestamp,
      value: currentMemory.heapUsed / (1024 * 1024), // Convert to MB
      label: 'Heap Used',
    });

    // Store throughput data
    this.addDataPoint('throughput', {
      timestamp,
      value: data.realTimeMetrics.throughput.operationsPerSecond,
      label: 'Operations/Second',
    });

    // Store error rate data
    this.addDataPoint('errors', {
      timestamp,
      value: data.realTimeMetrics.errorRate * 100, // Convert to percentage
      label: 'Error Rate',
    });
  }

  /**
   * Add data point to historical data
   */
  private addDataPoint(series: string, point: MetricsDataPoint): void {
    if (!this.dataHistory.has(series)) {
      this.dataHistory.set(series, []);
    }

    const data = this.dataHistory.get(series)!;
    data.push(point);

    // Limit historical data (keep last 1000 points)
    if (data.length > 1000) {
      data.splice(0, data.length - 1000);
    }
  }

  /**
   * Get time series data for a metric
   */
  private getTimeSeries(series: string): TimeSeries {
    const data = this.dataHistory.get(series) || [];
    return {
      id: series,
      name: series.charAt(0).toUpperCase() + series.slice(1),
      data: [...data],
    };
  }

  /**
   * Get count of active operations
   */
  private getActiveOperationsCount(): number {
    // This would be provided by the performance monitor
    // For now, return a placeholder
    return 0;
  }

  /**
   * Calculate overall system health
   */
  private calculateSystemHealth(): SystemHealthStatus {
    const data = this.getDashboardData();
    const components: SystemHealthStatus['components'] = {};

    // Analyze component health
    for (const component of data.componentMetrics) {
      let status: 'healthy' | 'warning' | 'critical' | 'degraded' = 'healthy';
      
      if (component.successRate < 0.95) {
        status = 'critical';
      } else if (component.successRate < 0.98) {
        status = 'warning';
      } else if (component.averageLatency > 1000) {
        status = 'degraded';
      }

      components[component.componentName] = {
        status,
        metrics: {
          averageLatency: component.averageLatency,
          successRate: component.successRate,
          totalOperations: component.totalOperations,
        },
        lastUpdate: Date.now(),
      };
    }

    // Calculate overall health
    let overall: SystemHealthStatus['overall'] = 'healthy';
    const statuses = Object.values(components).map(c => c.status);
    
    if (statuses.includes('critical') || data.realTimeMetrics.memoryPressure.level === 'critical') {
      overall = 'critical';
    } else if (statuses.includes('warning') || data.realTimeMetrics.memoryPressure.level === 'high') {
      overall = 'warning';
    } else if (statuses.includes('degraded') || data.realTimeMetrics.memoryPressure.level === 'medium') {
      overall = 'degraded';
    }

    return {
      overall,
      components,
      uptime: Date.now() - this.getStartTime(),
      version: '1.0.0', // Would be from package.json
    };
  }

  /**
   * Check for new alerts based on current data
   */
  private checkForAlerts(data: DashboardData): void {
    // Check memory pressure
    if (data.realTimeMetrics.memoryPressure && data.realTimeMetrics.memoryPressure.level === 'critical') {
      this.addAlert({
        id: `memory-critical-${Date.now()}`,
        type: 'memory',
        severity: 'critical',
        title: 'Critical Memory Pressure',
        message: data.realTimeMetrics.memoryPressure.recommendation,
        timestamp: Date.now(),
        acknowledged: false,
        actionRequired: data.realTimeMetrics.memoryPressure.immediateAction,
      });
    }

    // Check for memory leaks
    for (const leak of data.memoryLeaks) {
      if (leak.severity === 'critical' || leak.severity === 'high') {
        this.addAlert({
          id: `memory-leak-${leak.id}`,
          type: 'memory',
          severity: leak.severity === 'critical' ? 'critical' : 'error',
          title: `Memory Leak Detected: ${leak.type}`,
          message: leak.description,
          timestamp: leak.detectionTime,
          acknowledged: false,
          metadata: { leak },
        });
      }
    }

    // Check error rate
    if (data.realTimeMetrics.errorRate > 0.1) { // 10% error rate
      this.addAlert({
        id: `error-rate-${Date.now()}`,
        type: 'error',
        severity: data.realTimeMetrics.errorRate > 0.2 ? 'critical' : 'warning',
        title: 'High Error Rate',
        message: `Error rate is ${(data.realTimeMetrics.errorRate * 100).toFixed(1)}%`,
        timestamp: Date.now(),
        acknowledged: false,
      });
    }
  }

  /**
   * Add an alert to the dashboard
   */
  private addAlert(alert: DashboardAlert): void {
    // Check if similar alert already exists
    const existing = this.alerts.find(a => 
      a.type === alert.type && 
      a.title === alert.title && 
      !a.acknowledged
    );

    if (!existing) {
      this.alerts.push(alert);
      
      // Limit number of alerts
      if (this.alerts.length > 100) {
        this.alerts = this.alerts.slice(-50);
      }
    }
  }

  /**
   * Get dashboard start time
   */
  private getStartTime(): number {
    // This would be tracked when the dashboard starts
    return Date.now() - 3600000; // Placeholder: 1 hour ago
  }

  /**
   * Filter data by time range
   */
  private filterDataByTimeRange(data: DashboardData, timeRange: { start: number; end: number }): DashboardData {
    // This would filter all time-based data by the specified range
    // Implementation would depend on specific requirements
    return data;
  }

  /**
   * Export data as JSON
   */
  private exportAsJSON(data: DashboardData, config: DashboardExport): string {
    const exportData: any = {};
    
    if (config.includeMetrics) {
      exportData.metrics = data.realTimeMetrics;
      exportData.historicalData = data.historicalData;
      exportData.componentMetrics = data.componentMetrics;
    }
    
    if (config.includeAlerts) {
      exportData.alerts = data.alerts;
      exportData.memoryLeaks = data.memoryLeaks;
    }
    
    exportData.systemHealth = data.systemHealth;
    exportData.exportTime = Date.now();
    exportData.timeRange = config.timeRange;
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export data as CSV
   */
  private exportAsCSV(data: DashboardData, config: DashboardExport): string {
    const lines: string[] = [];
    
    // Add headers
    lines.push('timestamp,metric,value,unit,component');
    
    // Add metrics data
    if (config.includeMetrics) {
      for (const [seriesName, series] of Object.entries(data.historicalData)) {
        for (const point of series.data) {
          lines.push(`${point.timestamp},${seriesName},${point.value},${series.unit || ''},${point.label || ''}`);
        }
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Export data as HTML
   */
  private exportAsHTML(data: DashboardData, config: DashboardExport): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Performance Dashboard Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric { margin: 10px 0; }
        .alert { padding: 10px; margin: 5px 0; border-radius: 4px; }
        .alert.warning { background-color: #fff3cd; border: 1px solid #ffeaa7; }
        .alert.error { background-color: #f8d7da; border: 1px solid #f5c6cb; }
        .alert.critical { background-color: #d1ecf1; border: 1px solid #bee5eb; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Performance Dashboard Report</h1>
    <p>Generated: ${new Date().toISOString()}</p>
    
    <h2>System Health: ${data.systemHealth.overall}</h2>
    <div class="metric">Uptime: ${Math.floor(data.systemHealth.uptime / 1000 / 60)} minutes</div>
    
    <h2>Current Metrics</h2>
    <div class="metric">Operations/Second: ${data.realTimeMetrics.throughput.operationsPerSecond.toFixed(2)}</div>
    <div class="metric">Average Latency: ${data.realTimeMetrics.averageLatency.toFixed(2)}ms</div>
    <div class="metric">Error Rate: ${(data.realTimeMetrics.errorRate * 100).toFixed(2)}%</div>
    <div class="metric">Memory Pressure: ${data.realTimeMetrics.memoryPressure.level}</div>
    
    ${config.includeAlerts ? `
    <h2>Alerts</h2>
    ${data.alerts.map(alert => `
        <div class="alert ${alert.severity}">
            <strong>${alert.title}</strong><br>
            ${alert.message}<br>
            <small>${new Date(alert.timestamp).toISOString()}</small>
        </div>
    `).join('')}
    ` : ''}
    
    <h2>Component Performance</h2>
    <table>
        <tr>
            <th>Component</th>
            <th>Operations</th>
            <th>Avg Latency (ms)</th>
            <th>Success Rate</th>
        </tr>
        ${data.componentMetrics.map(comp => `
            <tr>
                <td>${comp.componentName}</td>
                <td>${comp.totalOperations}</td>
                <td>${comp.averageLatency.toFixed(2)}</td>
                <td>${(comp.successRate * 100).toFixed(2)}%</td>
            </tr>
        `).join('')}
    </table>
</body>
</html>
    `;
  }

  /**
   * Export data as PDF (placeholder)
   */
  private exportAsPDF(data: DashboardData, config: DashboardExport): string {
    // In a real implementation, you would use a PDF generation library
    // For now, return the HTML version as a placeholder
    return this.exportAsHTML(data, config);
  }
}