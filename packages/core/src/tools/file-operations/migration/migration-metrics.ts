/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MigrationDecision, MigrationUserContext } from './migration-config.js';

/**
 * Tool usage statistics
 */
export interface ToolStats {
  /** Total number of operations */
  totalOperations: number;
  /** Number of successful operations */
  successCount: number;
  /** Number of failed operations */
  errorCount: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average execution time in milliseconds */
  avgExecutionTime: number;
  /** Average performance ratio compared to baseline (1.0 = same, 2.0 = 2x slower) */
  avgPerformanceRatio: number;
  /** Total bytes processed */
  totalBytesProcessed: number;
  /** Most recent operation timestamp */
  lastOperationTime: Date;
}

/**
 * Performance comparison data
 */
export interface PerformanceComparison {
  toolName: string;
  legacyTime: number;
  fileOperationsTime: number;
  performanceRatio: number;
  bytesProcessed: number;
  timestamp: Date;
}

/**
 * Migration decision record
 */
export interface DecisionRecord {
  toolName: string;
  decision: MigrationDecision;
  userContext: MigrationUserContext;
  timestamp: Date;
}

/**
 * Rollback event record
 */
export interface RollbackRecord {
  toolName: string;
  reason: string;
  timestamp: Date;
  triggerType: 'manual' | 'automatic';
}

/**
 * Migration metrics collection and analysis
 */
export class MigrationMetrics {
  private toolStats: Map<string, ToolStats> = new Map();
  private performanceComparisons: PerformanceComparison[] = [];
  private decisionRecords: DecisionRecord[] = [];
  private rollbackRecords: RollbackRecord[] = [];
  private maxRecordHistory = 10000; // Limit memory usage
  
  /**
   * Record a migration decision
   */
  recordDecision(
    toolName: string,
    decision: MigrationDecision,
    userContext: MigrationUserContext
  ): void {
    const record: DecisionRecord = {
      toolName,
      decision,
      userContext,
      timestamp: new Date(),
    };
    
    this.decisionRecords.push(record);
    this.trimRecords();
  }
  
  /**
   * Record tool operation result
   */
  recordOperation(
    toolName: string,
    success: boolean,
    executionTime: number,
    bytesProcessed: number = 0
  ): void {
    const stats = this.getOrCreateToolStats(toolName);
    
    stats.totalOperations++;
    if (success) {
      stats.successCount++;
    } else {
      stats.errorCount++;
    }
    
    stats.successRate = stats.successCount / stats.totalOperations;
    stats.avgExecutionTime = this.updateAverage(
      stats.avgExecutionTime,
      executionTime,
      stats.totalOperations
    );
    stats.totalBytesProcessed += bytesProcessed;
    stats.lastOperationTime = new Date();
  }
  
  /**
   * Record performance comparison between legacy and FileOperations
   */
  recordPerformanceComparison(
    toolName: string,
    legacyTime: number,
    fileOperationsTime: number,
    bytesProcessed: number = 0
  ): void {
    const comparison: PerformanceComparison = {
      toolName,
      legacyTime,
      fileOperationsTime,
      performanceRatio: fileOperationsTime / legacyTime,
      bytesProcessed,
      timestamp: new Date(),
    };
    
    this.performanceComparisons.push(comparison);
    
    // Update tool stats with performance ratio
    const stats = this.getOrCreateToolStats(toolName);
    stats.avgPerformanceRatio = this.updateAverage(
      stats.avgPerformanceRatio,
      comparison.performanceRatio,
      this.performanceComparisons.filter(c => c.toolName === toolName).length
    );
    
    this.trimRecords();
  }
  
  /**
   * Record rollback event
   */
  recordRollback(toolName: string, reason: string, triggerType: 'manual' | 'automatic' = 'manual'): void {
    const record: RollbackRecord = {
      toolName,
      reason,
      timestamp: new Date(),
      triggerType,
    };
    
    this.rollbackRecords.push(record);
    this.trimRecords();
  }
  
  /**
   * Get statistics for a specific tool
   */
  getToolStats(toolName: string): ToolStats | null {
    return this.toolStats.get(toolName) || null;
  }
  
  /**
   * Get all tool statistics
   */
  getAllStats(): Record<string, ToolStats> {
    const result: Record<string, ToolStats> = {};
    for (const [toolName, stats] of this.toolStats) {
      result[toolName] = { ...stats };
    }
    return result;
  }
  
  /**
   * Get performance comparison data for a tool
   */
  getPerformanceComparisons(toolName?: string): PerformanceComparison[] {
    if (toolName) {
      return this.performanceComparisons.filter(c => c.toolName === toolName);
    }
    return [...this.performanceComparisons];
  }
  
  /**
   * Get decision records
   */
  getDecisionRecords(toolName?: string): DecisionRecord[] {
    if (toolName) {
      return this.decisionRecords.filter(r => r.toolName === toolName);
    }
    return [...this.decisionRecords];
  }
  
  /**
   * Get rollback records
   */
  getRollbackRecords(toolName?: string): RollbackRecord[] {
    if (toolName) {
      return this.rollbackRecords.filter(r => r.toolName === toolName);
    }
    return [...this.rollbackRecords];
  }
  
  /**
   * Get migration adoption metrics
   */
  getAdoptionMetrics(): {
    totalDecisions: number;
    fileOperationsUsage: number;
    legacyUsage: number;
    adoptionRate: number;
    byTool: Record<string, { total: number; fileOps: number; legacy: number; rate: number }>;
  } {
    const byTool: Record<string, { total: number; fileOps: number; legacy: number; rate: number }> = {};
    let totalDecisions = 0;
    let fileOperationsUsage = 0;
    
    for (const record of this.decisionRecords) {
      const toolName = record.toolName;
      if (!byTool[toolName]) {
        byTool[toolName] = { total: 0, fileOps: 0, legacy: 0, rate: 0 };
      }
      
      byTool[toolName].total++;
      totalDecisions++;
      
      if (record.decision.useFileOperations) {
        byTool[toolName].fileOps++;
        fileOperationsUsage++;
      } else {
        byTool[toolName].legacy++;
      }
    }
    
    // Calculate rates
    for (const toolName of Object.keys(byTool)) {
      const stats = byTool[toolName];
      stats.rate = stats.total > 0 ? stats.fileOps / stats.total : 0;
    }
    
    return {
      totalDecisions,
      fileOperationsUsage,
      legacyUsage: totalDecisions - fileOperationsUsage,
      adoptionRate: totalDecisions > 0 ? fileOperationsUsage / totalDecisions : 0,
      byTool,
    };
  }
  
  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalComparisons: number;
    avgPerformanceRatio: number;
    improvements: number;
    degradations: number;
    byTool: Record<string, { comparisons: number; avgRatio: number; improvements: number; degradations: number }>;
  } {
    const byTool: Record<string, { comparisons: number; avgRatio: number; improvements: number; degradations: number }> = {};
    let totalComparisons = 0;
    let totalRatio = 0;
    let improvements = 0;
    let degradations = 0;
    
    for (const comparison of this.performanceComparisons) {
      const toolName = comparison.toolName;
      if (!byTool[toolName]) {
        byTool[toolName] = { comparisons: 0, avgRatio: 0, improvements: 0, degradations: 0 };
      }
      
      byTool[toolName].comparisons++;
      byTool[toolName].avgRatio = this.updateAverage(
        byTool[toolName].avgRatio,
        comparison.performanceRatio,
        byTool[toolName].comparisons
      );
      
      totalComparisons++;
      totalRatio += comparison.performanceRatio;
      
      if (comparison.performanceRatio < 1.0) {
        byTool[toolName].improvements++;
        improvements++;
      } else if (comparison.performanceRatio > 1.0) {
        byTool[toolName].degradations++;
        degradations++;
      }
    }
    
    return {
      totalComparisons,
      avgPerformanceRatio: totalComparisons > 0 ? totalRatio / totalComparisons : 1.0,
      improvements,
      degradations,
      byTool,
    };
  }
  
  /**
   * Export metrics to external system
   */
  exportMetrics(): {
    stats: Record<string, ToolStats>;
    adoption: ReturnType<typeof this.getAdoptionMetrics>;
    performance: ReturnType<typeof this.getPerformanceSummary>;
    rollbacks: RollbackRecord[];
    timestamp: Date;
  } {
    return {
      stats: this.getAllStats(),
      adoption: this.getAdoptionMetrics(),
      performance: this.getPerformanceSummary(),
      rollbacks: this.getRollbackRecords(),
      timestamp: new Date(),
    };
  }
  
  /**
   * Clear old records to manage memory usage
   */
  private trimRecords(): void {
    if (this.decisionRecords.length > this.maxRecordHistory) {
      this.decisionRecords = this.decisionRecords.slice(-this.maxRecordHistory / 2);
    }
    
    if (this.performanceComparisons.length > this.maxRecordHistory) {
      this.performanceComparisons = this.performanceComparisons.slice(-this.maxRecordHistory / 2);
    }
  }
  
  /**
   * Get or create tool statistics
   */
  private getOrCreateToolStats(toolName: string): ToolStats {
    if (!this.toolStats.has(toolName)) {
      this.toolStats.set(toolName, {
        totalOperations: 0,
        successCount: 0,
        errorCount: 0,
        successRate: 0,
        avgExecutionTime: 0,
        avgPerformanceRatio: 1.0,
        totalBytesProcessed: 0,
        lastOperationTime: new Date(),
      });
    }
    
    return this.toolStats.get(toolName)!;
  }
  
  /**
   * Update running average
   */
  private updateAverage(currentAvg: number, newValue: number, count: number): number {
    return (currentAvg * (count - 1) + newValue) / count;
  }
  
  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.toolStats.clear();
    this.performanceComparisons = [];
    this.decisionRecords = [];
    this.rollbackRecords = [];
  }
}