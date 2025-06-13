/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { performance } from 'perf_hooks';

/**
 * Memory snapshot at a specific point in time
 */
export interface MemorySnapshot {
  timestamp: number;
  usage: NodeJS.MemoryUsage;
  operationId?: string;
  operationType?: string;
  gcTriggered?: boolean;
  label?: string;
}

/**
 * Memory trend analysis over time
 */
export interface MemoryTrend {
  timeWindow: number; // milliseconds
  snapshots: MemorySnapshot[];
  growthRate: {
    heapUsed: number; // bytes per second
    heapTotal: number;
    external: number;
    rss: number;
  };
  averageUsage: NodeJS.MemoryUsage;
  peakUsage: NodeJS.MemoryUsage;
  variance: NodeJS.MemoryUsage;
}

/**
 * Memory leak detection result
 */
export interface MemoryLeak {
  id: string;
  type: 'heap_growth' | 'external_growth' | 'gc_ineffective' | 'retained_objects' | 'event_listener_leak';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1
  description: string;
  detectionTime: number;
  growthRate: number; // bytes per second
  totalGrowth: number; // bytes
  duration: number; // milliseconds
  recommendations: string[];
  affectedOperations: string[];
  evidence: {
    beforeSnapshot: MemorySnapshot;
    afterSnapshot: MemorySnapshot;
    gcEvents: GCEvent[];
    suspiciousGrowth: boolean;
    retentionPattern: boolean;
  };
}

/**
 * Garbage collection event
 */
export interface GCEvent {
  timestamp: number;
  type: 'scavenge' | 'mark-sweep' | 'incremental' | 'weak-callback' | 'unknown';
  duration: number;
  memoryBefore: NodeJS.MemoryUsage;
  memoryAfter: NodeJS.MemoryUsage;
  freedMemory: number;
  trigger: 'allocation_limit' | 'memory_pressure' | 'idle' | 'explicit' | 'unknown';
}

/**
 * Memory allocation pattern
 */
export interface AllocationPattern {
  operationType: string;
  averageAllocation: number;
  peakAllocation: number;
  allocationCount: number;
  deallocationCount: number;
  retentionRate: number; // percentage of allocations not deallocated
  typicalLifetime: number; // milliseconds
}

/**
 * Memory pressure indicator
 */
export interface MemoryPressure {
  level: 'low' | 'medium' | 'high' | 'critical';
  heapUtilization: number; // percentage
  gcFrequency: number; // events per minute
  allocationRate: number; // bytes per second
  retentionRate: number; // percentage
  recommendation: string;
  immediateAction?: string;
}

/**
 * Memory analyzer configuration
 */
export interface MemoryAnalyzerConfig {
  snapshotInterval: number; // milliseconds
  maxSnapshots: number;
  leakDetectionThreshold: number; // bytes per second growth
  gcTrackingEnabled: boolean;
  heapDumpEnabled: boolean;
  allocationTrackingEnabled: boolean;
  pressureMonitoringEnabled: boolean;
  analysisWindow: number; // milliseconds for trend analysis
}

/**
 * Advanced memory analyzer for leak detection and optimization
 */
export class MemoryAnalyzer {
  private config: MemoryAnalyzerConfig;
  private snapshots: MemorySnapshot[] = [];
  private gcEvents: GCEvent[] = [];
  private detectedLeaks: MemoryLeak[] = [];
  private allocationPatterns = new Map<string, AllocationPattern>();
  private snapshotTimer: NodeJS.Timeout | undefined;
  private isMonitoring = false;
  private baselineSnapshot: MemorySnapshot | undefined;

  constructor(config: Partial<MemoryAnalyzerConfig> = {}) {
    this.config = {
      snapshotInterval: 5000, // 5 seconds
      maxSnapshots: 1000,
      leakDetectionThreshold: 1024 * 1024, // 1MB per second
      gcTrackingEnabled: true,
      heapDumpEnabled: false, // Disabled by default due to performance impact
      allocationTrackingEnabled: true,
      pressureMonitoringEnabled: true,
      analysisWindow: 300000, // 5 minutes
      ...config,
    };

    this.initializeGCTracking();
  }

  /**
   * Start memory monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.takeSnapshot('monitoring_start');
    this.baselineSnapshot = this.snapshots[this.snapshots.length - 1];

    if (this.config.snapshotInterval > 0) {
      this.snapshotTimer = setInterval(() => {
        this.takeSnapshot('periodic');
      }, this.config.snapshotInterval);
    }
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }

    this.takeSnapshot('monitoring_stop');
  }

  /**
   * Take a memory snapshot
   */
  takeSnapshot(label?: string, operationId?: string, operationType?: string): MemorySnapshot {
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      usage: process.memoryUsage(),
      operationId,
      operationType,
      label,
    };

    this.snapshots.push(snapshot);
    this.cleanupSnapshots();

    // Check for memory leaks after each snapshot
    if (this.snapshots.length > 10) {
      this.detectMemoryLeaks();
    }

    return snapshot;
  }

  /**
   * Analyze memory trends over a time window
   */
  analyzeTrend(timeWindow: number = this.config.analysisWindow): MemoryTrend {
    const now = Date.now();
    const cutoffTime = now - timeWindow;
    const windowSnapshots = this.snapshots.filter(s => s.timestamp >= cutoffTime);

    if (windowSnapshots.length < 2) {
      const latest = this.snapshots[this.snapshots.length - 1];
      const usage = latest?.usage || process.memoryUsage();
      return {
        timeWindow,
        snapshots: windowSnapshots,
        growthRate: { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 },
        averageUsage: usage,
        peakUsage: usage,
        variance: { heapUsed: 0, heapTotal: 0, external: 0, rss: 0, arrayBuffers: 0 },
      };
    }

    const first = windowSnapshots[0];
    const last = windowSnapshots[windowSnapshots.length - 1];
    const duration = (last.timestamp - first.timestamp) / 1000; // seconds

    // Calculate growth rates
    const growthRate = {
      heapUsed: (last.usage.heapUsed - first.usage.heapUsed) / duration,
      heapTotal: (last.usage.heapTotal - first.usage.heapTotal) / duration,
      external: (last.usage.external - first.usage.external) / duration,
      rss: (last.usage.rss - first.usage.rss) / duration,
    };

    // Calculate averages
    const averageUsage = {
      heapUsed: windowSnapshots.reduce((sum, s) => sum + s.usage.heapUsed, 0) / windowSnapshots.length,
      heapTotal: windowSnapshots.reduce((sum, s) => sum + s.usage.heapTotal, 0) / windowSnapshots.length,
      external: windowSnapshots.reduce((sum, s) => sum + s.usage.external, 0) / windowSnapshots.length,
      rss: windowSnapshots.reduce((sum, s) => sum + s.usage.rss, 0) / windowSnapshots.length,
      arrayBuffers: windowSnapshots.reduce((sum, s) => sum + s.usage.arrayBuffers, 0) / windowSnapshots.length,
    };

    // Find peak usage
    const peakUsage = windowSnapshots.reduce((peak, snapshot) => ({
      heapUsed: Math.max(peak.heapUsed, snapshot.usage.heapUsed),
      heapTotal: Math.max(peak.heapTotal, snapshot.usage.heapTotal),
      external: Math.max(peak.external, snapshot.usage.external),
      rss: Math.max(peak.rss, snapshot.usage.rss),
      arrayBuffers: Math.max(peak.arrayBuffers, snapshot.usage.arrayBuffers),
    }), { heapUsed: 0, heapTotal: 0, external: 0, rss: 0, arrayBuffers: 0 });

    // Calculate variance
    const variance = {
      heapUsed: this.calculateVariance(windowSnapshots.map(s => s.usage.heapUsed)),
      heapTotal: this.calculateVariance(windowSnapshots.map(s => s.usage.heapTotal)),
      external: this.calculateVariance(windowSnapshots.map(s => s.usage.external)),
      rss: this.calculateVariance(windowSnapshots.map(s => s.usage.rss)),
      arrayBuffers: this.calculateVariance(windowSnapshots.map(s => s.usage.arrayBuffers)),
    };

    return {
      timeWindow,
      snapshots: windowSnapshots,
      growthRate,
      averageUsage,
      peakUsage,
      variance,
    };
  }

  /**
   * Detect memory leaks using multiple heuristics
   */
  private detectMemoryLeaks(): void {
    const trend = this.analyzeTrend();
    if (trend.snapshots.length < 10) return;

    const leaks: MemoryLeak[] = [];

    // Detect heap growth leaks
    const heapGrowthLeak = this.detectHeapGrowthLeak(trend);
    if (heapGrowthLeak) leaks.push(heapGrowthLeak);

    // Detect external memory leaks
    const externalLeak = this.detectExternalMemoryLeak(trend);
    if (externalLeak) leaks.push(externalLeak);

    // Detect GC ineffectiveness
    const gcLeak = this.detectGCIneffectiveness(trend);
    if (gcLeak) leaks.push(gcLeak);

    // Add new leaks (avoid duplicates)
    for (const leak of leaks) {
      const existing = this.detectedLeaks.find(l => l.type === leak.type && l.severity === leak.severity);
      if (!existing) {
        this.detectedLeaks.push(leak);
      }
    }
  }

  /**
   * Detect heap growth memory leak
   */
  private detectHeapGrowthLeak(trend: MemoryTrend): MemoryLeak | undefined {
    const growthRate = trend.growthRate.heapUsed;
    if (growthRate <= this.config.leakDetectionThreshold) return undefined;

    const first = trend.snapshots[0];
    const last = trend.snapshots[trend.snapshots.length - 1];
    const totalGrowth = last.usage.heapUsed - first.usage.heapUsed;
    const duration = last.timestamp - first.timestamp;

    // Check if growth is sustained (not just a spike)
    const middleSnapshots = trend.snapshots.slice(1, -1);
    const sustainedGrowth = middleSnapshots.every((snapshot, index) => {
      const prev = trend.snapshots[index];
      return snapshot.usage.heapUsed >= prev.usage.heapUsed * 0.95; // Allow 5% variance
    });

    const confidence = sustainedGrowth ? 0.8 : 0.4;
    if (confidence < 0.5) return undefined;

    const severity = this.calculateLeakSeverity(growthRate, this.config.leakDetectionThreshold);

    return {
      id: `heap_growth_${Date.now()}`,
      type: 'heap_growth',
      severity,
      confidence,
      description: `Sustained heap growth detected: ${(growthRate / (1024 * 1024)).toFixed(2)}MB/s`,
      detectionTime: Date.now(),
      growthRate,
      totalGrowth,
      duration,
      recommendations: [
        'Review object lifecycle management',
        'Check for unclosed resources (files, streams, connections)',
        'Examine event listener registration/cleanup',
        'Consider implementing object pooling for frequently created objects',
        'Use weak references where appropriate',
      ],
      affectedOperations: this.getRecentOperations(trend.snapshots),
      evidence: {
        beforeSnapshot: first,
        afterSnapshot: last,
        gcEvents: this.getGCEventsInWindow(first.timestamp, last.timestamp),
        suspiciousGrowth: sustainedGrowth,
        retentionPattern: true,
      },
    };
  }

  /**
   * Detect external memory leak
   */
  private detectExternalMemoryLeak(trend: MemoryTrend): MemoryLeak | undefined {
    const growthRate = trend.growthRate.external;
    const threshold = this.config.leakDetectionThreshold * 0.5; // Lower threshold for external memory
    
    if (growthRate <= threshold) return undefined;

    const first = trend.snapshots[0];
    const last = trend.snapshots[trend.snapshots.length - 1];
    const totalGrowth = last.usage.external - first.usage.external;
    const duration = last.timestamp - first.timestamp;

    const severity = this.calculateLeakSeverity(growthRate, threshold);

    return {
      id: `external_growth_${Date.now()}`,
      type: 'external_growth',
      severity,
      confidence: 0.7,
      description: `External memory growth detected: ${(growthRate / (1024 * 1024)).toFixed(2)}MB/s`,
      detectionTime: Date.now(),
      growthRate,
      totalGrowth,
      duration,
      recommendations: [
        'Check for Buffer leaks',
        'Ensure proper cleanup of native modules',
        'Review file handle management',
        'Check ArrayBuffer usage and disposal',
      ],
      affectedOperations: this.getRecentOperations(trend.snapshots),
      evidence: {
        beforeSnapshot: first,
        afterSnapshot: last,
        gcEvents: this.getGCEventsInWindow(first.timestamp, last.timestamp),
        suspiciousGrowth: true,
        retentionPattern: false,
      },
    };
  }

  /**
   * Detect GC ineffectiveness (potential memory leak)
   */
  private detectGCIneffectiveness(trend: MemoryTrend): MemoryLeak | undefined {
    const gcEvents = this.getGCEventsInWindow(
      trend.snapshots[0].timestamp,
      trend.snapshots[trend.snapshots.length - 1].timestamp
    );

    if (gcEvents.length < 3) return undefined;

    // Calculate average memory freed per GC
    const avgMemoryFreed = gcEvents.reduce((sum, event) => sum + event.freedMemory, 0) / gcEvents.length;
    
    // Check if GC is becoming less effective
    const recentGC = gcEvents.slice(-3);
    const oldGC = gcEvents.slice(0, 3);
    
    const recentAvg = recentGC.reduce((sum, event) => sum + event.freedMemory, 0) / recentGC.length;
    const oldAvg = oldGC.reduce((sum, event) => sum + event.freedMemory, 0) / oldGC.length;
    
    const effectiveness = recentAvg / oldAvg;
    
    if (effectiveness > 0.7) return undefined; // GC is still reasonably effective

    const severity = effectiveness < 0.3 ? 'high' : effectiveness < 0.5 ? 'medium' : 'low';

    return {
      id: `gc_ineffective_${Date.now()}`,
      type: 'gc_ineffective',
      severity: severity as 'low' | 'medium' | 'high',
      confidence: 0.6,
      description: `GC effectiveness declined: ${(effectiveness * 100).toFixed(1)}% of previous effectiveness`,
      detectionTime: Date.now(),
      growthRate: trend.growthRate.heapUsed,
      totalGrowth: 0,
      duration: trend.timeWindow,
      recommendations: [
        'Review long-lived object references',
        'Check for circular references',
        'Consider manual cleanup of large objects',
        'Review cache sizes and eviction policies',
      ],
      affectedOperations: this.getRecentOperations(trend.snapshots),
      evidence: {
        beforeSnapshot: trend.snapshots[0],
        afterSnapshot: trend.snapshots[trend.snapshots.length - 1],
        gcEvents,
        suspiciousGrowth: false,
        retentionPattern: true,
      },
    };
  }

  /**
   * Calculate leak severity based on growth rate
   */
  private calculateLeakSeverity(growthRate: number, threshold: number): 'low' | 'medium' | 'high' | 'critical' {
    const ratio = growthRate / threshold;
    if (ratio >= 5) return 'critical';
    if (ratio >= 3) return 'high';
    if (ratio >= 2) return 'medium';
    return 'low';
  }

  /**
   * Get recent operations from snapshots
   */
  private getRecentOperations(snapshots: MemorySnapshot[]): string[] {
    const operations = new Set<string>();
    for (const snapshot of snapshots) {
      if (snapshot.operationType) {
        operations.add(snapshot.operationType);
      }
    }
    return Array.from(operations);
  }

  /**
   * Get GC events within a time window
   */
  private getGCEventsInWindow(startTime: number, endTime: number): GCEvent[] {
    return this.gcEvents.filter(event => 
      event.timestamp >= startTime && event.timestamp <= endTime
    );
  }

  /**
   * Calculate variance for an array of numbers
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  /**
   * Assess current memory pressure
   */
  assessMemoryPressure(): MemoryPressure {
    const currentUsage = process.memoryUsage();
    const heapUtilization = (currentUsage.heapUsed / currentUsage.heapTotal) * 100;

    // Calculate GC frequency in the last minute
    const oneMinuteAgo = Date.now() - 60000;
    const recentGCEvents = this.gcEvents.filter(event => event.timestamp >= oneMinuteAgo);
    const gcFrequency = recentGCEvents.length;

    // Calculate allocation rate based on recent trend
    const trend = this.analyzeTrend(60000); // Last minute
    const allocationRate = Math.max(0, trend.growthRate.heapUsed);

    // Calculate retention rate (simplified)
    const retentionRate = heapUtilization;

    let level: MemoryPressure['level'];
    let recommendation: string;
    let immediateAction: string | undefined;

    if (heapUtilization >= 90 || gcFrequency > 20) {
      level = 'critical';
      recommendation = 'Immediate action required: Memory usage is critically high';
      immediateAction = 'Force garbage collection and review memory-intensive operations';
    } else if (heapUtilization >= 80 || gcFrequency > 15) {
      level = 'high';
      recommendation = 'High memory pressure detected: Reduce memory allocation';
    } else if (heapUtilization >= 70 || gcFrequency > 10) {
      level = 'medium';
      recommendation = 'Moderate memory pressure: Monitor closely and optimize if needed';
    } else {
      level = 'low';
      recommendation = 'Memory usage is within normal limits';
    }

    return {
      level,
      heapUtilization,
      gcFrequency,
      allocationRate,
      retentionRate,
      recommendation,
      immediateAction,
    };
  }

  /**
   * Initialize GC tracking
   */
  private initializeGCTracking(): void {
    if (!this.config.gcTrackingEnabled) return;

    // In a real implementation, you would use performance hooks
    // This is a simplified version for demonstration
    const performanceObserver = {
      observe: () => {
        // Mock GC tracking - in reality you'd use:
        // const obs = new PerformanceObserver((list) => { ... });
        // obs.observe({ entryTypes: ['gc'] });
      }
    };

    try {
      performanceObserver.observe();
    } catch (error) {
      console.warn('GC tracking not available in this environment');
    }
  }

  /**
   * Record a GC event (would be called by performance observer)
   */
  recordGCEvent(event: Omit<GCEvent, 'timestamp' | 'freedMemory'>): void {
    const freedMemory = event.memoryBefore.heapUsed - event.memoryAfter.heapUsed;
    
    const gcEvent: GCEvent = {
      ...event,
      timestamp: Date.now(),
      freedMemory: Math.max(0, freedMemory),
    };

    this.gcEvents.push(gcEvent);

    // Limit GC events to prevent memory bloat
    if (this.gcEvents.length > 1000) {
      this.gcEvents = this.gcEvents.slice(-500);
    }
  }

  /**
   * Clean up old snapshots
   */
  private cleanupSnapshots(): void {
    if (this.snapshots.length <= this.config.maxSnapshots) return;

    this.snapshots = this.snapshots.slice(-this.config.maxSnapshots);
  }

  /**
   * Get all detected memory leaks
   */
  getDetectedLeaks(): MemoryLeak[] {
    return [...this.detectedLeaks];
  }

  /**
   * Get all memory snapshots
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get GC events
   */
  getGCEvents(): GCEvent[] {
    return [...this.gcEvents];
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.snapshots = [];
    this.gcEvents = [];
    this.detectedLeaks = [];
    this.allocationPatterns.clear();
    this.baselineSnapshot = undefined;
  }

  /**
   * Generate memory analysis report
   */
  generateReport(): {
    summary: {
      currentUsage: NodeJS.MemoryUsage;
      trend: MemoryTrend;
      pressure: MemoryPressure;
      leakCount: number;
    };
    leaks: MemoryLeak[];
    recommendations: string[];
  } {
    const currentUsage = process.memoryUsage();
    const trend = this.analyzeTrend();
    const pressure = this.assessMemoryPressure();
    const leaks = this.getDetectedLeaks();

    const recommendations = new Set<string>();
    
    // Add leak recommendations
    for (const leak of leaks) {
      leak.recommendations.forEach(rec => recommendations.add(rec));
    }

    // Add pressure recommendations
    recommendations.add(pressure.recommendation);
    if (pressure.immediateAction) {
      recommendations.add(pressure.immediateAction);
    }

    // Add general recommendations based on trends
    if (trend.growthRate.heapUsed > 0) {
      recommendations.add('Monitor heap growth trend and implement cleanup strategies');
    }

    return {
      summary: {
        currentUsage,
        trend,
        pressure,
        leakCount: leaks.length,
      },
      leaks,
      recommendations: Array.from(recommendations),
    };
  }
}