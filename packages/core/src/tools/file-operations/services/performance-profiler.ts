/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { performance } from 'perf_hooks';

/**
 * Performance profile entry representing a timed operation
 */
export interface ProfileEntry {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  parentId?: string;
  children: ProfileEntry[];
  metadata: Record<string, unknown>;
  marks: Mark[];
  phases: Phase[];
}

/**
 * Performance mark within an operation
 */
export interface Mark {
  name: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Performance phase within an operation
 */
export interface Phase {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

/**
 * Performance bottleneck identification
 */
export interface Bottleneck {
  operationId: string;
  operationName: string;
  phase?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impactScore: number;
  description: string;
  recommendations: string[];
  metrics: {
    duration: number;
    cpuTime?: number;
    memoryDelta?: number;
    percentOfTotal: number;
  };
}

/**
 * Call stack frame for profiling
 */
export interface CallFrame {
  functionName: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  selfTime: number;
  totalTime: number;
  callCount: number;
}

/**
 * Performance profile analysis result
 */
export interface ProfileAnalysis {
  totalDuration: number;
  criticalPath: ProfileEntry[];
  bottlenecks: Bottleneck[];
  timeBreakdown: { [phaseName: string]: number };
  callStack: CallFrame[];
  memoryUsage: {
    initial: NodeJS.MemoryUsage;
    peak: NodeJS.MemoryUsage;
    final: NodeJS.MemoryUsage;
    leakIndicators: MemoryLeakIndicator[];
  };
  recommendations: string[];
}

/**
 * Memory leak indicator
 */
export interface MemoryLeakIndicator {
  type: 'heap_growth' | 'external_growth' | 'gc_pressure' | 'retained_objects';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metrics: Record<string, number>;
  recommendation: string;
}

/**
 * Profiling configuration
 */
export interface ProfilerConfig {
  enableCallStackTracking: boolean;
  enableMemoryProfiling: boolean;
  enableGCTracking: boolean;
  maxProfileEntries: number;
  memorySnapshotInterval: number;
  bottleneckThresholds: {
    durationMs: number;
    memoryGrowthMb: number;
    cpuUsagePercent: number;
  };
}

/**
 * Performance profiler for detailed operation analysis
 */
export class PerformanceProfiler {
  private config: ProfilerConfig;
  private profiles = new Map<string, ProfileEntry>();
  private activeProfiles = new Map<string, ProfileEntry>();
  private memorySnapshots: Array<{ timestamp: number; usage: NodeJS.MemoryUsage }> = [];
  private gcEvents: Array<{ timestamp: number; type: string; duration: number }> = [];
  private callFrames = new Map<string, CallFrame>();

  constructor(config: Partial<ProfilerConfig> = {}) {
    this.config = {
      enableCallStackTracking: true,
      enableMemoryProfiling: true,
      enableGCTracking: true,
      maxProfileEntries: 1000,
      memorySnapshotInterval: 1000, // 1 second
      bottleneckThresholds: {
        durationMs: 1000,
        memoryGrowthMb: 50,
        cpuUsagePercent: 80,
      },
      ...config,
    };

    this.initializeGCTracking();
    this.startMemorySnapshots();
  }

  /**
   * Start profiling an operation
   */
  startProfile(id: string, name: string, parentId?: string, metadata: Record<string, unknown> = {}): void {
    const entry: ProfileEntry = {
      id,
      name,
      startTime: performance.now(),
      parentId,
      children: [],
      metadata,
      marks: [],
      phases: [],
    };

    this.activeProfiles.set(id, entry);

    // Add to parent's children if applicable
    if (parentId) {
      const parent = this.activeProfiles.get(parentId);
      if (parent) {
        parent.children.push(entry);
      }
    }

    // Take memory snapshot if enabled
    if (this.config.enableMemoryProfiling) {
      this.takeMemorySnapshot(`profile_start_${id}`);
    }

    // Start call stack tracking if enabled
    if (this.config.enableCallStackTracking) {
      this.trackCallFrame(name, performance.now());
    }
  }

  /**
   * End profiling an operation
   */
  endProfile(id: string, metadata: Record<string, unknown> = {}): ProfileEntry | undefined {
    const entry = this.activeProfiles.get(id);
    if (!entry) return undefined;

    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;
    entry.metadata = { ...entry.metadata, ...metadata };

    this.activeProfiles.delete(id);
    this.profiles.set(id, entry);

    // Take memory snapshot if enabled
    if (this.config.enableMemoryProfiling) {
      this.takeMemorySnapshot(`profile_end_${id}`);
    }

    // End call stack tracking if enabled
    if (this.config.enableCallStackTracking) {
      this.endCallFrameTracking(entry.name, entry.duration);
    }

    // Clean up old profiles if needed
    this.cleanupProfiles();

    return entry;
  }

  /**
   * Add a performance mark within an operation
   */
  mark(profileId: string, markName: string, metadata: Record<string, unknown> = {}): void {
    const entry = this.activeProfiles.get(profileId);
    if (!entry) return;

    const mark: Mark = {
      name: markName,
      timestamp: performance.now(),
      metadata,
    };

    entry.marks.push(mark);
  }

  /**
   * Start a performance phase within an operation
   */
  startPhase(profileId: string, phaseName: string, metadata: Record<string, unknown> = {}): string {
    const phaseId = `${profileId}_phase_${phaseName}_${Date.now()}`;
    this.startProfile(phaseId, phaseName, profileId, metadata);
    return phaseId;
  }

  /**
   * End a performance phase within an operation
   */
  endPhase(phaseId: string, metadata: Record<string, unknown> = {}): void {
    const phaseEntry = this.endProfile(phaseId, metadata);
    if (!phaseEntry || !phaseEntry.parentId) return;

    const parentEntry = this.activeProfiles.get(phaseEntry.parentId);
    if (!parentEntry) return;

    const phase: Phase = {
      name: phaseEntry.name,
      startTime: phaseEntry.startTime,
      endTime: phaseEntry.endTime!,
      duration: phaseEntry.duration!,
      metadata: phaseEntry.metadata,
    };

    parentEntry.phases.push(phase);
  }

  /**
   * Analyze a performance profile
   */
  analyzeProfile(profileId: string): ProfileAnalysis | undefined {
    const entry = this.profiles.get(profileId);
    if (!entry || !entry.duration) return undefined;

    // Find critical path
    const criticalPath = this.findCriticalPath(entry);

    // Identify bottlenecks
    const bottlenecks = this.identifyBottlenecks(entry);

    // Calculate time breakdown
    const timeBreakdown = this.calculateTimeBreakdown(entry);

    // Get call stack analysis
    const callStack = this.getCallStackAnalysis();

    // Analyze memory usage
    const memoryUsage = this.analyzeMemoryUsage(entry);

    // Generate recommendations
    const recommendations = this.generateRecommendations(bottlenecks, memoryUsage);

    return {
      totalDuration: entry.duration,
      criticalPath,
      bottlenecks,
      timeBreakdown,
      callStack,
      memoryUsage,
      recommendations,
    };
  }

  /**
   * Find the critical path (longest chain of operations)
   */
  private findCriticalPath(entry: ProfileEntry): ProfileEntry[] {
    const path: ProfileEntry[] = [entry];
    
    if (entry.children.length === 0) {
      return path;
    }

    // Find the child with the longest duration
    let longestChild: ProfileEntry | undefined;
    let longestDuration = 0;

    for (const child of entry.children) {
      if (child.duration && child.duration > longestDuration) {
        longestDuration = child.duration;
        longestChild = child;
      }
    }

    if (longestChild) {
      path.push(...this.findCriticalPath(longestChild));
    }

    return path;
  }

  /**
   * Identify performance bottlenecks
   */
  private identifyBottlenecks(entry: ProfileEntry): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];
    
    // Check operation duration
    if (entry.duration && entry.duration > this.config.bottleneckThresholds.durationMs) {
      const severity = this.calculateSeverity(entry.duration, this.config.bottleneckThresholds.durationMs);
      
      bottlenecks.push({
        operationId: entry.id,
        operationName: entry.name,
        severity,
        impactScore: entry.duration / this.config.bottleneckThresholds.durationMs,
        description: `Operation exceeded duration threshold: ${entry.duration.toFixed(2)}ms`,
        recommendations: this.generateDurationRecommendations(entry),
        metrics: {
          duration: entry.duration,
          percentOfTotal: 100, // This is the top-level operation
        },
      });
    }

    // Check phases for bottlenecks
    for (const phase of entry.phases) {
      if (phase.duration > this.config.bottleneckThresholds.durationMs * 0.5) {
        const severity = this.calculateSeverity(phase.duration, this.config.bottleneckThresholds.durationMs * 0.5);
        const percentOfTotal = entry.duration ? (phase.duration / entry.duration) * 100 : 0;
        
        bottlenecks.push({
          operationId: entry.id,
          operationName: entry.name,
          phase: phase.name,
          severity,
          impactScore: phase.duration / (this.config.bottleneckThresholds.durationMs * 0.5),
          description: `Phase '${phase.name}' took ${phase.duration.toFixed(2)}ms (${percentOfTotal.toFixed(1)}% of total)`,
          recommendations: this.generatePhaseRecommendations(phase),
          metrics: {
            duration: phase.duration,
            percentOfTotal,
          },
        });
      }
    }

    // Check children recursively
    for (const child of entry.children) {
      bottlenecks.push(...this.identifyBottlenecks(child));
    }

    return bottlenecks.sort((a, b) => b.impactScore - a.impactScore);
  }

  /**
   * Calculate severity based on threshold
   */
  private calculateSeverity(value: number, threshold: number): 'low' | 'medium' | 'high' | 'critical' {
    const ratio = value / threshold;
    if (ratio >= 3) return 'critical';
    if (ratio >= 2) return 'high';
    if (ratio >= 1.5) return 'medium';
    return 'low';
  }

  /**
   * Generate duration-based recommendations
   */
  private generateDurationRecommendations(entry: ProfileEntry): string[] {
    const recommendations: string[] = [];
    
    // Analyze phases to suggest optimizations
    const sortedPhases = [...entry.phases].sort((a, b) => b.duration - a.duration);
    
    if (sortedPhases.length > 0) {
      const slowestPhase = sortedPhases[0];
      recommendations.push(`Optimize '${slowestPhase.name}' phase which takes ${slowestPhase.duration.toFixed(2)}ms`);
    }

    // Check for sequential vs parallel opportunities
    if (entry.children.length > 1) {
      const totalChildDuration = entry.children.reduce((sum, child) => sum + (child.duration || 0), 0);
      if (totalChildDuration > (entry.duration || 0) * 0.8) {
        recommendations.push('Consider parallelizing child operations to reduce total duration');
      }
    }

    // Generic recommendations
    recommendations.push('Profile individual components to identify specific bottlenecks');
    recommendations.push('Consider caching intermediate results');
    recommendations.push('Review algorithm complexity and data structures');

    return recommendations;
  }

  /**
   * Generate phase-specific recommendations
   */
  private generatePhaseRecommendations(phase: Phase): string[] {
    const recommendations: string[] = [];
    
    switch (phase.name.toLowerCase()) {
      case 'file_read':
      case 'read':
        recommendations.push('Consider streaming large files instead of loading entirely into memory');
        recommendations.push('Implement file content caching for frequently accessed files');
        break;
      case 'file_write':
      case 'write':
        recommendations.push('Use atomic writes with temporary files for safety');
        recommendations.push('Batch multiple writes to the same file');
        break;
      case 'parse':
      case 'parsing':
        recommendations.push('Cache parsed ASTs to avoid re-parsing');
        recommendations.push('Use incremental parsing for large files');
        break;
      case 'analyze':
      case 'analysis':
        recommendations.push('Implement analysis result caching');
        recommendations.push('Consider parallel analysis of independent files');
        break;
      case 'validate':
      case 'validation':
        recommendations.push('Run validation in parallel where possible');
        recommendations.push('Cache validation results for unchanged files');
        break;
      default:
        recommendations.push(`Review '${phase.name}' implementation for optimization opportunities`);
    }

    return recommendations;
  }

  /**
   * Calculate time breakdown by phases
   */
  private calculateTimeBreakdown(entry: ProfileEntry): { [phaseName: string]: number } {
    const breakdown: { [phaseName: string]: number } = {};
    
    for (const phase of entry.phases) {
      breakdown[phase.name] = phase.duration;
    }

    return breakdown;
  }

  /**
   * Track call frame for profiling
   */
  private trackCallFrame(functionName: string, startTime: number): void {
    if (!this.config.enableCallStackTracking) return;

    const existing = this.callFrames.get(functionName);
    if (existing) {
      existing.callCount++;
      existing.totalTime += startTime; // Will be corrected in endCallFrameTracking
    } else {
      this.callFrames.set(functionName, {
        functionName,
        selfTime: 0,
        totalTime: startTime,
        callCount: 1,
      });
    }
  }

  /**
   * End call frame tracking
   */
  private endCallFrameTracking(functionName: string, duration: number): void {
    if (!this.config.enableCallStackTracking) return;

    const frame = this.callFrames.get(functionName);
    if (frame) {
      frame.totalTime = duration;
      frame.selfTime += duration; // Simplified - would need more complex logic for nested calls
    }
  }

  /**
   * Get call stack analysis
   */
  private getCallStackAnalysis(): CallFrame[] {
    return Array.from(this.callFrames.values())
      .sort((a, b) => b.totalTime - a.totalTime);
  }

  /**
   * Take memory snapshot
   */
  private takeMemorySnapshot(label: string): void {
    if (!this.config.enableMemoryProfiling) return;

    this.memorySnapshots.push({
      timestamp: Date.now(),
      usage: process.memoryUsage(),
    });

    // Limit snapshots to prevent memory bloat
    if (this.memorySnapshots.length > 1000) {
      this.memorySnapshots = this.memorySnapshots.slice(-500);
    }
  }

  /**
   * Start periodic memory snapshots
   */
  private startMemorySnapshots(): void {
    if (!this.config.enableMemoryProfiling) return;

    setInterval(() => {
      this.takeMemorySnapshot('periodic');
    }, this.config.memorySnapshotInterval);
  }

  /**
   * Initialize GC tracking
   */
  private initializeGCTracking(): void {
    if (!this.config.enableGCTracking) return;

    // Note: In a real implementation, you'd use performance hooks or v8 APIs
    // This is a simplified version
    const originalGC = (global as any).gc;
    if (originalGC) {
      (global as any).gc = (...args: any[]) => {
        const start = performance.now();
        const result = originalGC.apply(this, args);
        const duration = performance.now() - start;
        
        this.gcEvents.push({
          timestamp: Date.now(),
          type: 'manual',
          duration,
        });

        return result;
      };
    }
  }

  /**
   * Analyze memory usage for leaks and issues
   */
  private analyzeMemoryUsage(entry: ProfileEntry): ProfileAnalysis['memoryUsage'] {
    if (this.memorySnapshots.length === 0) {
      const currentUsage = process.memoryUsage();
      return {
        initial: currentUsage,
        peak: currentUsage,
        final: currentUsage,
        leakIndicators: [],
      };
    }

    const initial = this.memorySnapshots[0].usage;
    const final = this.memorySnapshots[this.memorySnapshots.length - 1].usage;
    
    // Find peak memory usage
    let peak = initial;
    for (const snapshot of this.memorySnapshots) {
      if (snapshot.usage.heapUsed > peak.heapUsed) {
        peak = snapshot.usage;
      }
    }

    // Detect potential memory leaks
    const leakIndicators = this.detectMemoryLeaks();

    return {
      initial,
      peak,
      final,
      leakIndicators,
    };
  }

  /**
   * Detect potential memory leaks
   */
  private detectMemoryLeaks(): MemoryLeakIndicator[] {
    const indicators: MemoryLeakIndicator[] = [];
    
    if (this.memorySnapshots.length < 2) return indicators;

    const initial = this.memorySnapshots[0].usage;
    const final = this.memorySnapshots[this.memorySnapshots.length - 1].usage;

    // Check for heap growth
    const heapGrowth = final.heapUsed - initial.heapUsed;
    const heapGrowthMb = heapGrowth / (1024 * 1024);
    
    if (heapGrowthMb > this.config.bottleneckThresholds.memoryGrowthMb) {
      indicators.push({
        type: 'heap_growth',
        severity: this.calculateSeverity(heapGrowthMb, this.config.bottleneckThresholds.memoryGrowthMb),
        description: `Heap memory grew by ${heapGrowthMb.toFixed(2)}MB during operation`,
        metrics: {
          growthMb: heapGrowthMb,
          initialMb: initial.heapUsed / (1024 * 1024),
          finalMb: final.heapUsed / (1024 * 1024),
        },
        recommendation: 'Review object lifecycle and ensure proper cleanup of large objects',
      });
    }

    // Check for external memory growth
    const externalGrowth = final.external - initial.external;
    const externalGrowthMb = externalGrowth / (1024 * 1024);
    
    if (externalGrowthMb > 10) {
      indicators.push({
        type: 'external_growth',
        severity: this.calculateSeverity(externalGrowthMb, 10),
        description: `External memory grew by ${externalGrowthMb.toFixed(2)}MB`,
        metrics: {
          growthMb: externalGrowthMb,
          initialMb: initial.external / (1024 * 1024),
          finalMb: final.external / (1024 * 1024),
        },
        recommendation: 'Check for buffer leaks and ensure proper disposal of native resources',
      });
    }

    // Check for GC pressure
    const recentGCEvents = this.gcEvents.filter(event => 
      Date.now() - event.timestamp < 60000 // Last minute
    );
    
    if (recentGCEvents.length > 10) {
      indicators.push({
        type: 'gc_pressure',
        severity: 'medium',
        description: `High GC activity: ${recentGCEvents.length} events in the last minute`,
        metrics: {
          gcCount: recentGCEvents.length,
          avgGCDuration: recentGCEvents.reduce((sum, event) => sum + event.duration, 0) / recentGCEvents.length,
        },
        recommendation: 'Reduce object allocation frequency and review object pooling opportunities',
      });
    }

    return indicators;
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(bottlenecks: Bottleneck[], memoryUsage: ProfileAnalysis['memoryUsage']): string[] {
    const recommendations = new Set<string>();

    // Add bottleneck recommendations
    for (const bottleneck of bottlenecks.slice(0, 3)) { // Top 3 bottlenecks
      bottleneck.recommendations.forEach(rec => recommendations.add(rec));
    }

    // Add memory recommendations
    for (const indicator of memoryUsage.leakIndicators) {
      recommendations.add(indicator.recommendation);
    }

    // Add general recommendations
    if (bottlenecks.length > 0) {
      recommendations.add('Consider implementing operation-level caching');
      recommendations.add('Profile with more granular timing to identify specific bottlenecks');
    }

    return Array.from(recommendations);
  }

  /**
   * Clean up old profiles
   */
  private cleanupProfiles(): void {
    if (this.profiles.size <= this.config.maxProfileEntries) return;

    // Remove oldest profiles
    const sortedEntries = Array.from(this.profiles.entries())
      .sort((a, b) => a[1].startTime - b[1].startTime);
    
    const toRemove = sortedEntries.slice(0, sortedEntries.length - this.config.maxProfileEntries);
    for (const [id] of toRemove) {
      this.profiles.delete(id);
    }
  }

  /**
   * Get all profiles
   */
  getProfiles(): ProfileEntry[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get profile by ID
   */
  getProfile(id: string): ProfileEntry | undefined {
    return this.profiles.get(id);
  }

  /**
   * Clear all profiles
   */
  clearProfiles(): void {
    this.profiles.clear();
    this.activeProfiles.clear();
    this.memorySnapshots = [];
    this.gcEvents = [];
    this.callFrames.clear();
  }

  /**
   * Get profiler statistics
   */
  getStatistics(): {
    totalProfiles: number;
    activeProfiles: number;
    memorySnapshots: number;
    gcEvents: number;
    callFrames: number;
  } {
    return {
      totalProfiles: this.profiles.size,
      activeProfiles: this.activeProfiles.size,
      memorySnapshots: this.memorySnapshots.length,
      gcEvents: this.gcEvents.length,
      callFrames: this.callFrames.size,
    };
  }
}