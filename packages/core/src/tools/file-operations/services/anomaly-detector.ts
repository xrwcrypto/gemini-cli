/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformanceMetrics } from './performance-monitor.js';
import { MemorySnapshot } from './memory-analyzer.js';

/**
 * Statistical baseline for anomaly detection
 */
export interface StatisticalBaseline {
  metric: string;
  mean: number;
  standardDeviation: number;
  min: number;
  max: number;
  p95: number;
  p99: number;
  sampleCount: number;
  lastUpdated: number;
}

/**
 * Anomaly detection result
 */
export interface Anomaly {
  id: string;
  type: 'statistical' | 'trend' | 'spike' | 'pattern' | 'threshold';
  metric: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1
  description: string;
  detectedAt: number;
  value: number;
  expectedRange: { min: number; max: number };
  deviationScore: number; // How many standard deviations from mean
  context: {
    operationType?: string;
    componentName?: string;
    timeWindow: number;
    previousValues: number[];
  };
  recommendations: string[];
  autoResolution?: {
    possible: boolean;
    action: string;
    confidence: number;
  };
}

/**
 * Anomaly detection configuration
 */
export interface AnomalyDetectorConfig {
  statisticalThreshold: number; // Standard deviations for statistical anomalies
  trendWindowSize: number; // Number of data points for trend analysis
  spikeThreshold: number; // Multiplier for spike detection
  patternWindowSize: number; // Data points for pattern analysis
  baselineMinSamples: number; // Minimum samples to establish baseline
  anomalyRetentionMs: number; // How long to keep anomaly records
  enableAutoResolution: boolean;
  enableTrendAnalysis: boolean;
  enablePatternDetection: boolean;
  metricThresholds: { [metric: string]: { min?: number; max?: number } };
}

/**
 * Time series pattern
 */
export interface Pattern {
  id: string;
  type: 'seasonal' | 'cyclical' | 'trending' | 'noise';
  period: number; // milliseconds
  amplitude: number;
  confidence: number;
  detectedAt: number;
  lastSeen: number;
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  direction: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  correlation: number; // R-squared value
  confidence: number;
  projectedValue: number; // Value projected forward by one period
  timeToThreshold?: number; // Milliseconds until threshold breach
}

/**
 * Advanced anomaly detection system for performance monitoring
 */
export class AnomalyDetector {
  private config: AnomalyDetectorConfig;
  private baselines = new Map<string, StatisticalBaseline>();
  private detectedAnomalies: Anomaly[] = [];
  private patterns = new Map<string, Pattern[]>();
  private dataBuffer = new Map<string, Array<{ timestamp: number; value: number }>>();
  private callbacks = new Map<string, Array<(anomaly: Anomaly) => void>>();

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = {
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
        memoryUsage: { max: 1024 * 1024 * 1024 }, // 1GB
        errorRate: { max: 0.05 }, // 5%
        cpuUsage: { max: 0.9 }, // 90%
      },
      ...config,
    };
  }

  /**
   * Add a data point for anomaly detection
   */
  addDataPoint(metric: string, value: number, context?: Partial<Anomaly['context']>): void {
    const timestamp = Date.now();
    
    // Store in buffer
    if (!this.dataBuffer.has(metric)) {
      this.dataBuffer.set(metric, []);
    }
    
    const buffer = this.dataBuffer.get(metric)!;
    buffer.push({ timestamp, value });
    
    // Limit buffer size
    if (buffer.length > this.config.patternWindowSize * 2) {
      buffer.splice(0, buffer.length - this.config.patternWindowSize);
    }

    // Update baseline
    this.updateBaseline(metric, value);

    // Detect anomalies
    const anomalies = this.detectAnomalies(metric, value, timestamp, context);
    
    // Process detected anomalies
    for (const anomaly of anomalies) {
      this.processAnomaly(anomaly);
    }
  }

  /**
   * Add performance metrics for analysis
   */
  addPerformanceMetrics(metrics: PerformanceMetrics): void {
    const context = {
      operationType: metrics.operationType,
      componentName: metrics.componentName,
      timeWindow: this.config.trendWindowSize,
      previousValues: [],
    };

    this.addDataPoint('latency', metrics.durationMs, context);
    this.addDataPoint('memoryUsage', metrics.memoryUsage.heapUsed, context);
    this.addDataPoint('cpuUsage', metrics.resourceUtilization.cpuUsagePercent / 100, context);
    
    if (!metrics.success) {
      this.addDataPoint('errorRate', 1, context);
    } else {
      this.addDataPoint('errorRate', 0, context);
    }
  }

  /**
   * Add memory snapshot for analysis
   */
  addMemorySnapshot(snapshot: MemorySnapshot): void {
    const context = {
      operationType: snapshot.operationType,
      timeWindow: this.config.trendWindowSize,
      previousValues: [],
    };

    this.addDataPoint('memoryHeapUsed', snapshot.usage.heapUsed, context);
    this.addDataPoint('memoryHeapTotal', snapshot.usage.heapTotal, context);
    this.addDataPoint('memoryExternal', snapshot.usage.external, context);
    this.addDataPoint('memoryRSS', snapshot.usage.rss, context);
  }

  /**
   * Detect anomalies for a specific metric and value
   */
  private detectAnomalies(
    metric: string,
    value: number,
    timestamp: number,
    context?: Partial<Anomaly['context']>
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const buffer = this.dataBuffer.get(metric) || [];
    const baseline = this.baselines.get(metric);

    // Get previous values for context
    const previousValues = buffer.slice(-this.config.trendWindowSize).map(d => d.value);
    const fullContext: Anomaly['context'] = {
      timeWindow: this.config.trendWindowSize,
      previousValues,
      ...context,
    };

    // Statistical anomaly detection
    if (baseline && baseline.sampleCount >= this.config.baselineMinSamples) {
      const statisticalAnomaly = this.detectStatisticalAnomaly(metric, value, baseline, timestamp, fullContext);
      if (statisticalAnomaly) anomalies.push(statisticalAnomaly);
    }

    // Threshold-based detection
    const thresholdAnomaly = this.detectThresholdAnomaly(metric, value, timestamp, fullContext);
    if (thresholdAnomaly) anomalies.push(thresholdAnomaly);

    // Spike detection
    if (previousValues.length >= 3) {
      const spikeAnomaly = this.detectSpike(metric, value, previousValues, timestamp, fullContext);
      if (spikeAnomaly) anomalies.push(spikeAnomaly);
    }

    // Trend anomaly detection
    if (this.config.enableTrendAnalysis && previousValues.length >= this.config.trendWindowSize) {
      const trendAnomaly = this.detectTrendAnomaly(metric, value, previousValues, timestamp, fullContext);
      if (trendAnomaly) anomalies.push(trendAnomaly);
    }

    // Pattern anomaly detection
    if (this.config.enablePatternDetection && buffer.length >= this.config.patternWindowSize) {
      const patternAnomaly = this.detectPatternAnomaly(metric, value, buffer, timestamp, fullContext);
      if (patternAnomaly) anomalies.push(patternAnomaly);
    }

    return anomalies;
  }

  /**
   * Detect statistical anomalies using baseline
   */
  private detectStatisticalAnomaly(
    metric: string,
    value: number,
    baseline: StatisticalBaseline,
    timestamp: number,
    context: Anomaly['context']
  ): Anomaly | undefined {
    const deviationScore = Math.abs(value - baseline.mean) / baseline.standardDeviation;
    
    if (deviationScore < this.config.statisticalThreshold) {
      return undefined;
    }

    const severity = this.calculateSeverity(deviationScore, this.config.statisticalThreshold);
    const confidence = Math.min(1, deviationScore / (this.config.statisticalThreshold * 2));

    return {
      id: `stat-${metric}-${timestamp}`,
      type: 'statistical',
      metric,
      severity,
      confidence,
      description: `${metric} value ${value.toFixed(2)} is ${deviationScore.toFixed(2)} standard deviations from mean ${baseline.mean.toFixed(2)}`,
      detectedAt: timestamp,
      value,
      expectedRange: {
        min: baseline.mean - this.config.statisticalThreshold * baseline.standardDeviation,
        max: baseline.mean + this.config.statisticalThreshold * baseline.standardDeviation,
      },
      deviationScore,
      context,
      recommendations: this.generateRecommendations('statistical', metric, value, baseline.mean),
      autoResolution: this.generateAutoResolution('statistical', metric, value),
    };
  }

  /**
   * Detect threshold-based anomalies
   */
  private detectThresholdAnomaly(
    metric: string,
    value: number,
    timestamp: number,
    context: Anomaly['context']
  ): Anomaly | undefined {
    const threshold = this.config.metricThresholds[metric];
    if (!threshold) return undefined;

    let violated = false;
    let description = '';
    let expectedRange = { min: -Infinity, max: Infinity };

    if (threshold.min !== undefined && value < threshold.min) {
      violated = true;
      description = `${metric} value ${value.toFixed(2)} is below minimum threshold ${threshold.min}`;
      expectedRange.min = threshold.min;
    }

    if (threshold.max !== undefined && value > threshold.max) {
      violated = true;
      description = `${metric} value ${value.toFixed(2)} exceeds maximum threshold ${threshold.max}`;
      expectedRange.max = threshold.max;
    }

    if (!violated) return undefined;

    const severity = this.calculateThresholdSeverity(metric, value, threshold);

    return {
      id: `thresh-${metric}-${timestamp}`,
      type: 'threshold',
      metric,
      severity,
      confidence: 1.0,
      description,
      detectedAt: timestamp,
      value,
      expectedRange,
      deviationScore: 0,
      context,
      recommendations: this.generateRecommendations('threshold', metric, value),
      autoResolution: this.generateAutoResolution('threshold', metric, value),
    };
  }

  /**
   * Detect spikes in data
   */
  private detectSpike(
    metric: string,
    value: number,
    previousValues: number[],
    timestamp: number,
    context: Anomaly['context']
  ): Anomaly | undefined {
    const recentAverage = previousValues.slice(-5).reduce((sum, v) => sum + v, 0) / Math.min(5, previousValues.length);
    const ratio = value / recentAverage;

    if (ratio < this.config.spikeThreshold && ratio > 1 / this.config.spikeThreshold) {
      return undefined;
    }

    const severity = this.calculateSpikeSeverity(ratio);
    const confidence = Math.min(1, Math.abs(Math.log(ratio)) / Math.log(this.config.spikeThreshold));

    return {
      id: `spike-${metric}-${timestamp}`,
      type: 'spike',
      metric,
      severity,
      confidence,
      description: `${metric} spike detected: ${value.toFixed(2)} is ${ratio.toFixed(2)}x the recent average ${recentAverage.toFixed(2)}`,
      detectedAt: timestamp,
      value,
      expectedRange: {
        min: recentAverage / this.config.spikeThreshold,
        max: recentAverage * this.config.spikeThreshold,
      },
      deviationScore: Math.abs(Math.log(ratio)),
      context,
      recommendations: this.generateRecommendations('spike', metric, value, recentAverage),
      autoResolution: this.generateAutoResolution('spike', metric, value),
    };
  }

  /**
   * Detect trend anomalies
   */
  private detectTrendAnomaly(
    metric: string,
    value: number,
    previousValues: number[],
    timestamp: number,
    context: Anomaly['context']
  ): Anomaly | undefined {
    const trendAnalysis = this.analyzeTrend(previousValues);
    
    // Check if trend is concerning
    const threshold = this.config.metricThresholds[metric];
    if (!threshold || !trendAnalysis.timeToThreshold) return undefined;

    // If trend will breach threshold soon, it's anomalous
    const hoursToThreshold = trendAnalysis.timeToThreshold / (1000 * 60 * 60);
    if (hoursToThreshold > 24) return undefined; // Not concerning if more than 24 hours

    const severity = hoursToThreshold < 1 ? 'critical' : hoursToThreshold < 4 ? 'high' : 'medium';

    return {
      id: `trend-${metric}-${timestamp}`,
      type: 'trend',
      metric,
      severity: severity as 'medium' | 'high' | 'critical',
      confidence: trendAnalysis.confidence,
      description: `${metric} trend suggests threshold breach in ${hoursToThreshold.toFixed(1)} hours`,
      detectedAt: timestamp,
      value,
      expectedRange: { min: -Infinity, max: Infinity },
      deviationScore: 0,
      context: {
        ...context,
        previousValues: [...previousValues, value],
      },
      recommendations: this.generateRecommendations('trend', metric, value),
      autoResolution: this.generateAutoResolution('trend', metric, value),
    };
  }

  /**
   * Detect pattern anomalies
   */
  private detectPatternAnomaly(
    metric: string,
    value: number,
    buffer: Array<{ timestamp: number; value: number }>,
    timestamp: number,
    context: Anomaly['context']
  ): Anomaly | undefined {
    const patterns = this.detectPatterns(metric, buffer);
    if (patterns.length === 0) return undefined;

    // Check if current value fits the patterns
    for (const pattern of patterns) {
      const expectedValue = this.predictValueFromPattern(pattern, timestamp, buffer);
      const deviation = Math.abs(value - expectedValue) / expectedValue;
      
      if (deviation > 0.5) { // 50% deviation from pattern
        return {
          id: `pattern-${metric}-${timestamp}`,
          type: 'pattern',
          metric,
          severity: deviation > 1 ? 'high' : 'medium',
          confidence: pattern.confidence * (1 - Math.min(1, deviation)),
          description: `${metric} deviates from ${pattern.type} pattern by ${(deviation * 100).toFixed(1)}%`,
          detectedAt: timestamp,
          value,
          expectedRange: {
            min: expectedValue * 0.8,
            max: expectedValue * 1.2,
          },
          deviationScore: deviation,
          context,
          recommendations: this.generateRecommendations('pattern', metric, value, expectedValue),
          autoResolution: this.generateAutoResolution('pattern', metric, value),
        };
      }
    }

    return undefined;
  }

  /**
   * Analyze trend in data
   */
  private analyzeTrend(values: number[]): TrendAnalysis {
    if (values.length < 2) {
      return {
        direction: 'stable',
        slope: 0,
        correlation: 0,
        confidence: 0,
        projectedValue: values[values.length - 1] || 0,
      };
    }

    // Simple linear regression
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const sumX = x.reduce((sum, xi) => sum + xi, 0);
    const sumY = y.reduce((sum, yi) => sum + yi, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate correlation coefficient
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    const correlation = Math.abs(numerator / denominator);

    const direction = slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable';
    const projectedValue = slope * n + intercept;

    return {
      direction,
      slope,
      correlation,
      confidence: correlation,
      projectedValue,
    };
  }

  /**
   * Detect patterns in time series data
   */
  private detectPatterns(metric: string, buffer: Array<{ timestamp: number; value: number }>): Pattern[] {
    // Simplified pattern detection - in practice, this would use more sophisticated algorithms
    const patterns: Pattern[] = [];
    
    if (buffer.length < this.config.patternWindowSize) return patterns;

    // Look for cyclical patterns
    const values = buffer.map(b => b.value);
    const cyclicalPattern = this.detectCyclicalPattern(values);
    if (cyclicalPattern) {
      patterns.push({
        id: `cyclical-${metric}-${Date.now()}`,
        type: 'cyclical',
        period: cyclicalPattern.period,
        amplitude: cyclicalPattern.amplitude,
        confidence: cyclicalPattern.confidence,
        detectedAt: Date.now(),
        lastSeen: Date.now(),
      });
    }

    return patterns;
  }

  /**
   * Detect cyclical patterns (simplified)
   */
  private detectCyclicalPattern(values: number[]): { period: number; amplitude: number; confidence: number } | undefined {
    // This is a simplified autocorrelation-based approach
    // In practice, you'd use FFT or more sophisticated algorithms
    
    const n = values.length;
    if (n < 10) return undefined;

    let bestPeriod = 0;
    let bestCorrelation = 0;

    // Test different periods
    for (let period = 3; period <= n / 3; period++) {
      let correlation = 0;
      let count = 0;

      for (let i = 0; i < n - period; i++) {
        correlation += values[i] * values[i + period];
        count++;
      }

      correlation = correlation / count;
      
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }

    if (bestCorrelation < 0.7) return undefined; // Not enough correlation

    const amplitude = Math.max(...values) - Math.min(...values);

    return {
      period: bestPeriod,
      amplitude,
      confidence: bestCorrelation,
    };
  }

  /**
   * Predict value from pattern
   */
  private predictValueFromPattern(
    pattern: Pattern,
    timestamp: number,
    buffer: Array<{ timestamp: number; value: number }>
  ): number {
    // Simplified prediction - get value from same phase in the pattern
    const recentValues = buffer.slice(-pattern.period).map(b => b.value);
    const average = recentValues.reduce((sum, v) => sum + v, 0) / recentValues.length;
    return average;
  }

  /**
   * Update statistical baseline for a metric
   */
  private updateBaseline(metric: string, value: number): void {
    const existing = this.baselines.get(metric);
    
    if (!existing) {
      this.baselines.set(metric, {
        metric,
        mean: value,
        standardDeviation: 0,
        min: value,
        max: value,
        p95: value,
        p99: value,
        sampleCount: 1,
        lastUpdated: Date.now(),
      });
      return;
    }

    // Update running statistics
    const newCount = existing.sampleCount + 1;
    const newMean = (existing.mean * existing.sampleCount + value) / newCount;
    
    // Update variance (using Welford's online algorithm for numerical stability)
    const delta = value - existing.mean;
    const delta2 = value - newMean;
    const newVariance = ((existing.standardDeviation ** 2) * (existing.sampleCount - 1) + delta * delta2) / (newCount - 1);
    
    this.baselines.set(metric, {
      metric,
      mean: newMean,
      standardDeviation: Math.sqrt(Math.max(0, newVariance)),
      min: Math.min(existing.min, value),
      max: Math.max(existing.max, value),
      p95: existing.p95, // Would need sorted array to update properly
      p99: existing.p99, // Would need sorted array to update properly
      sampleCount: newCount,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Calculate severity based on deviation score
   */
  private calculateSeverity(deviationScore: number, threshold: number): 'low' | 'medium' | 'high' | 'critical' {
    if (deviationScore >= threshold * 2) return 'critical';
    if (deviationScore >= threshold * 1.5) return 'high';
    if (deviationScore >= threshold * 1.2) return 'medium';
    return 'low';
  }

  /**
   * Calculate threshold violation severity
   */
  private calculateThresholdSeverity(
    metric: string,
    value: number,
    threshold: { min?: number; max?: number }
  ): 'low' | 'medium' | 'high' | 'critical' {
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';

    if (threshold.max !== undefined && value > threshold.max) {
      const ratio = value / threshold.max;
      if (ratio > 2) severity = 'critical';
      else if (ratio > 1.5) severity = 'high';
      else severity = 'medium';
    }

    if (threshold.min !== undefined && value < threshold.min) {
      const ratio = threshold.min / value;
      if (ratio > 2) severity = 'critical';
      else if (ratio > 1.5) severity = 'high';
      else severity = 'medium';
    }

    return severity;
  }

  /**
   * Calculate spike severity
   */
  private calculateSpikeSeverity(ratio: number): 'low' | 'medium' | 'high' | 'critical' {
    const absRatio = Math.max(ratio, 1 / ratio);
    if (absRatio >= 10) return 'critical';
    if (absRatio >= 5) return 'high';
    if (absRatio >= 3) return 'medium';
    return 'low';
  }

  /**
   * Generate recommendations for anomaly
   */
  private generateRecommendations(
    type: string,
    metric: string,
    value: number,
    expectedValue?: number
  ): string[] {
    const recommendations: string[] = [];

    switch (type) {
      case 'statistical':
        recommendations.push(`Review recent changes that might affect ${metric}`);
        recommendations.push('Check for system resource constraints');
        recommendations.push('Analyze correlation with other metrics');
        break;
      case 'threshold':
        recommendations.push(`Immediate attention required for ${metric} threshold violation`);
        recommendations.push('Consider scaling resources or optimizing performance');
        break;
      case 'spike':
        recommendations.push(`Investigate cause of ${metric} spike`);
        recommendations.push('Check for batch operations or external factors');
        break;
      case 'trend':
        recommendations.push(`Monitor ${metric} trend closely`);
        recommendations.push('Plan capacity increases or optimizations');
        break;
      case 'pattern':
        recommendations.push(`Analyze pattern deviation in ${metric}`);
        recommendations.push('Check for changes in usage patterns or system behavior');
        break;
    }

    // Metric-specific recommendations
    switch (metric) {
      case 'latency':
        recommendations.push('Profile slow operations to identify bottlenecks');
        recommendations.push('Consider implementing caching strategies');
        break;
      case 'memoryUsage':
        recommendations.push('Check for memory leaks or excessive allocations');
        recommendations.push('Consider garbage collection tuning');
        break;
      case 'errorRate':
        recommendations.push('Review error logs for common failure patterns');
        recommendations.push('Implement circuit breakers for failing operations');
        break;
    }

    return recommendations;
  }

  /**
   * Generate auto-resolution suggestions
   */
  private generateAutoResolution(
    type: string,
    metric: string,
    value: number
  ): Anomaly['autoResolution'] {
    if (!this.config.enableAutoResolution) {
      return { possible: false, action: 'Manual intervention required', confidence: 0 };
    }

    switch (metric) {
      case 'memoryUsage':
        if (type === 'threshold' || type === 'spike') {
          return {
            possible: true,
            action: 'Force garbage collection and clear caches',
            confidence: 0.7,
          };
        }
        break;
      case 'errorRate':
        if (type === 'spike') {
          return {
            possible: true,
            action: 'Restart failing components or enable circuit breaker',
            confidence: 0.6,
          };
        }
        break;
    }

    return { possible: false, action: 'Manual analysis required', confidence: 0 };
  }

  /**
   * Process detected anomaly
   */
  private processAnomaly(anomaly: Anomaly): void {
    // Store anomaly
    this.detectedAnomalies.push(anomaly);
    
    // Clean up old anomalies
    const cutoff = Date.now() - this.config.anomalyRetentionMs;
    this.detectedAnomalies = this.detectedAnomalies.filter(a => a.detectedAt > cutoff);

    // Notify callbacks
    const callbacks = this.callbacks.get(anomaly.metric) || [];
    const globalCallbacks = this.callbacks.get('*') || [];
    
    for (const callback of [...callbacks, ...globalCallbacks]) {
      try {
        callback(anomaly);
      } catch (error) {
        console.error('Error in anomaly callback:', error);
      }
    }
  }

  /**
   * Subscribe to anomaly notifications
   */
  onAnomaly(metric: string | '*', callback: (anomaly: Anomaly) => void): void {
    if (!this.callbacks.has(metric)) {
      this.callbacks.set(metric, []);
    }
    this.callbacks.get(metric)!.push(callback);
  }

  /**
   * Unsubscribe from anomaly notifications
   */
  removeAnomalyCallback(metric: string | '*', callback: (anomaly: Anomaly) => void): void {
    const callbacks = this.callbacks.get(metric);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index >= 0) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Get all detected anomalies
   */
  getAnomalies(metric?: string): Anomaly[] {
    if (metric) {
      return this.detectedAnomalies.filter(a => a.metric === metric);
    }
    return [...this.detectedAnomalies];
  }

  /**
   * Get statistical baselines
   */
  getBaselines(): StatisticalBaseline[] {
    return Array.from(this.baselines.values());
  }

  /**
   * Get baseline for specific metric
   */
  getBaseline(metric: string): StatisticalBaseline | undefined {
    return this.baselines.get(metric);
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.baselines.clear();
    this.detectedAnomalies = [];
    this.patterns.clear();
    this.dataBuffer.clear();
  }

  /**
   * Get anomaly statistics
   */
  getStatistics(): {
    totalAnomalies: number;
    anomaliesByType: { [type: string]: number };
    anomaliesBySeverity: { [severity: string]: number };
    anomaliesByMetric: { [metric: string]: number };
    averageConfidence: number;
  } {
    const totalAnomalies = this.detectedAnomalies.length;
    const anomaliesByType: { [type: string]: number } = {};
    const anomaliesBySeverity: { [severity: string]: number } = {};
    const anomaliesByMetric: { [metric: string]: number } = {};
    
    let totalConfidence = 0;

    for (const anomaly of this.detectedAnomalies) {
      anomaliesByType[anomaly.type] = (anomaliesByType[anomaly.type] || 0) + 1;
      anomaliesBySeverity[anomaly.severity] = (anomaliesBySeverity[anomaly.severity] || 0) + 1;
      anomaliesByMetric[anomaly.metric] = (anomaliesByMetric[anomaly.metric] || 0) + 1;
      totalConfidence += anomaly.confidence;
    }

    return {
      totalAnomalies,
      anomaliesByType,
      anomaliesBySeverity,
      anomaliesByMetric,
      averageConfidence: totalAnomalies > 0 ? totalConfidence / totalAnomalies : 0,
    };
  }
}