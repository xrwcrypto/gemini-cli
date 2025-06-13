/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MigrationMetrics, PerformanceComparison } from './migration-metrics.js';

/**
 * Usage comparison data between legacy tools and FileOperations
 */
export interface UsageComparison {
  toolName: string;
  period: {
    start: Date;
    end: Date;
  };
  legacy: {
    totalCalls: number;
    successfulCalls: number;
    avgExecutionTime: number;
    totalBytesProcessed: number;
    errorRate: number;
  };
  fileOperations: {
    totalCalls: number;
    successfulCalls: number;
    avgExecutionTime: number;
    totalBytesProcessed: number;
    errorRate: number;
  };
  comparison: {
    performanceImprovement: number; // Positive = FileOps faster
    reliabilityImprovement: number; // Positive = FileOps more reliable
    adoptionRate: number; // 0-1
    userSatisfaction?: number; // 0-1, if available
  };
}

/**
 * Aggregated usage metrics across all tools
 */
export interface AggregatedUsageMetrics {
  totalPeriod: {
    start: Date;
    end: Date;
  };
  summary: {
    totalLegacyCalls: number;
    totalFileOperationsCalls: number;
    overallAdoptionRate: number;
    avgPerformanceImprovement: number;
    avgReliabilityImprovement: number;
  };
  byTool: Record<string, UsageComparison>;
  trends: {
    adoptionTrend: Array<{ date: Date; adoptionRate: number }>;
    performanceTrend: Array<{ date: Date; performanceRatio: number }>;
    errorRateTrend: Array<{ date: Date; legacyErrorRate: number; fileOpsErrorRate: number }>;
  };
}

/**
 * Usage metrics collector and analyzer
 */
export class UsageMetricsCollector {
  private migrationMetrics: MigrationMetrics;
  private legacyMetrics: Map<string, any[]> = new Map(); // Store legacy tool metrics
  private comparisonHistory: PerformanceComparison[] = [];
  
  constructor(migrationMetrics: MigrationMetrics) {
    this.migrationMetrics = migrationMetrics;
  }
  
  /**
   * Record legacy tool usage for comparison
   */
  recordLegacyUsage(
    toolName: string,
    executionTime: number,
    success: boolean,
    bytesProcessed: number = 0
  ): void {
    if (!this.legacyMetrics.has(toolName)) {
      this.legacyMetrics.set(toolName, []);
    }
    
    this.legacyMetrics.get(toolName)!.push({
      timestamp: new Date(),
      executionTime,
      success,
      bytesProcessed,
    });
    
    // Keep only recent data (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const metrics = this.legacyMetrics.get(toolName)!;
    this.legacyMetrics.set(
      toolName,
      metrics.filter(m => m.timestamp > thirtyDaysAgo)
    );
  }
  
  /**
   * Record A/B comparison between legacy and FileOperations
   */
  recordABComparison(
    toolName: string,
    legacyTime: number,
    fileOpsTime: number,
    bytesProcessed: number = 0
  ): void {
    this.migrationMetrics.recordPerformanceComparison(
      toolName,
      legacyTime,
      fileOpsTime,
      bytesProcessed
    );
    
    // Also store in our comparison history
    this.comparisonHistory.push({
      toolName,
      legacyTime,
      fileOperationsTime: fileOpsTime,
      performanceRatio: fileOpsTime / legacyTime,
      bytesProcessed,
      timestamp: new Date(),
    });
    
    // Trim old comparisons
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.comparisonHistory = this.comparisonHistory.filter(
      c => c.timestamp > sevenDaysAgo
    );
  }
  
  /**
   * Generate usage comparison for a specific tool
   */
  generateToolComparison(
    toolName: string,
    periodDays: number = 7
  ): UsageComparison | null {
    const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const periodEnd = new Date();
    
    // Get legacy metrics
    const legacyData = this.legacyMetrics.get(toolName) || [];
    const legacyPeriodData = legacyData.filter(
      d => d.timestamp >= periodStart && d.timestamp <= periodEnd
    );
    
    // Get FileOperations metrics
    const fileOpsStats = this.migrationMetrics.getToolStats(toolName);
    const decisions = this.migrationMetrics.getDecisionRecords(toolName);
    const periodDecisions = decisions.filter(
      d => d.timestamp >= periodStart && d.timestamp <= periodEnd
    );
    
    // Get performance comparisons
    const comparisons = this.migrationMetrics.getPerformanceComparisons(toolName);
    const periodComparisons = comparisons.filter(
      c => c.timestamp >= periodStart && c.timestamp <= periodEnd
    );
    
    if (legacyPeriodData.length === 0 && periodDecisions.length === 0) {
      return null; // No data for this period
    }
    
    // Calculate legacy metrics
    const legacySuccessful = legacyPeriodData.filter(d => d.success);
    const legacyMetrics = {
      totalCalls: legacyPeriodData.length,
      successfulCalls: legacySuccessful.length,
      avgExecutionTime: legacyPeriodData.length > 0 
        ? legacyPeriodData.reduce((sum, d) => sum + d.executionTime, 0) / legacyPeriodData.length 
        : 0,
      totalBytesProcessed: legacyPeriodData.reduce((sum, d) => sum + (d.bytesProcessed || 0), 0),
      errorRate: legacyPeriodData.length > 0 
        ? (legacyPeriodData.length - legacySuccessful.length) / legacyPeriodData.length 
        : 0,
    };
    
    // Calculate FileOperations metrics (approximate based on decisions and stats)
    const fileOpsDecisions = periodDecisions.filter(d => d.decision.useFileOperations);
    const legacyDecisions = periodDecisions.filter(d => !d.decision.useFileOperations);
    
    const fileOpsMetrics = {
      totalCalls: fileOpsDecisions.length,
      successfulCalls: fileOpsStats ? Math.round(fileOpsDecisions.length * fileOpsStats.successRate) : 0,
      avgExecutionTime: fileOpsStats?.avgExecutionTime || 0,
      totalBytesProcessed: fileOpsStats?.totalBytesProcessed || 0,
      errorRate: fileOpsStats ? 1 - fileOpsStats.successRate : 0,
    };
    
    // Calculate comparison metrics
    const totalDecisions = periodDecisions.length;
    const adoptionRate = totalDecisions > 0 ? fileOpsDecisions.length / totalDecisions : 0;
    
    const avgPerformanceRatio = periodComparisons.length > 0
      ? periodComparisons.reduce((sum, c) => sum + c.performanceRatio, 0) / periodComparisons.length
      : 1.0;
    
    const performanceImprovement = 1 - avgPerformanceRatio; // Positive = improvement
    const reliabilityImprovement = legacyMetrics.errorRate - fileOpsMetrics.errorRate;
    
    return {
      toolName,
      period: { start: periodStart, end: periodEnd },
      legacy: legacyMetrics,
      fileOperations: fileOpsMetrics,
      comparison: {
        performanceImprovement,
        reliabilityImprovement,
        adoptionRate,
      },
    };
  }
  
  /**
   * Generate aggregated usage metrics across all tools
   */
  generateAggregatedMetrics(periodDays: number = 7): AggregatedUsageMetrics {
    const tools = ['ReadFileTool', 'WriteFileTool', 'EditTool', 'GlobTool', 'GrepTool'];
    const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const periodEnd = new Date();
    
    const byTool: Record<string, UsageComparison> = {};
    let totalLegacy = 0;
    let totalFileOps = 0;
    let totalPerformanceImprovement = 0;
    let totalReliabilityImprovement = 0;
    let toolsWithData = 0;
    
    // Generate per-tool comparisons
    for (const tool of tools) {
      const comparison = this.generateToolComparison(tool, periodDays);
      if (comparison) {
        byTool[tool] = comparison;
        totalLegacy += comparison.legacy.totalCalls;
        totalFileOps += comparison.fileOperations.totalCalls;
        totalPerformanceImprovement += comparison.comparison.performanceImprovement;
        totalReliabilityImprovement += comparison.comparison.reliabilityImprovement;
        toolsWithData++;
      }
    }
    
    // Generate trend data
    const trends = this.generateTrends(periodDays);
    
    return {
      totalPeriod: { start: periodStart, end: periodEnd },
      summary: {
        totalLegacyCalls: totalLegacy,
        totalFileOperationsCalls: totalFileOps,
        overallAdoptionRate: (totalLegacy + totalFileOps) > 0 
          ? totalFileOps / (totalLegacy + totalFileOps) 
          : 0,
        avgPerformanceImprovement: toolsWithData > 0 
          ? totalPerformanceImprovement / toolsWithData 
          : 0,
        avgReliabilityImprovement: toolsWithData > 0 
          ? totalReliabilityImprovement / toolsWithData 
          : 0,
      },
      byTool,
      trends,
    };
  }
  
  /**
   * Generate trend data over time
   */
  private generateTrends(periodDays: number): AggregatedUsageMetrics['trends'] {
    const adoptionTrend: Array<{ date: Date; adoptionRate: number }> = [];
    const performanceTrend: Array<{ date: Date; performanceRatio: number }> = [];
    const errorRateTrend: Array<{ date: Date; legacyErrorRate: number; fileOpsErrorRate: number }> = [];
    
    // Generate daily trend data for the period
    for (let i = periodDays - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      
      // Get decisions for this day
      const dayDecisions = this.migrationMetrics.getDecisionRecords().filter(
        d => d.timestamp >= dayStart && d.timestamp < dayEnd
      );
      
      const fileOpsDecisions = dayDecisions.filter(d => d.decision.useFileOperations);
      const adoptionRate = dayDecisions.length > 0 
        ? fileOpsDecisions.length / dayDecisions.length 
        : 0;
      
      adoptionTrend.push({ date, adoptionRate });
      
      // Get performance comparisons for this day
      const dayComparisons = this.comparisonHistory.filter(
        c => c.timestamp >= dayStart && c.timestamp < dayEnd
      );
      
      const avgPerformanceRatio = dayComparisons.length > 0
        ? dayComparisons.reduce((sum, c) => sum + c.performanceRatio, 0) / dayComparisons.length
        : 1.0;
      
      performanceTrend.push({ date, performanceRatio: avgPerformanceRatio });
      
      // Calculate error rates (simplified - would need more detailed tracking in real implementation)
      errorRateTrend.push({ 
        date, 
        legacyErrorRate: 0.02, // Placeholder
        fileOpsErrorRate: 0.01  // Placeholder
      });
    }
    
    return {
      adoptionTrend,
      performanceTrend,
      errorRateTrend,
    };
  }
  
  /**
   * Export metrics for external analysis
   */
  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    const metrics = this.generateAggregatedMetrics(30); // 30-day window
    
    if (format === 'json') {
      return JSON.stringify(metrics, null, 2);
    }
    
    // CSV format
    const csvLines: string[] = [];
    csvLines.push('Tool,Legacy Calls,FileOps Calls,Adoption Rate,Performance Improvement,Reliability Improvement');
    
    for (const [toolName, data] of Object.entries(metrics.byTool)) {
      csvLines.push([
        toolName,
        data.legacy.totalCalls,
        data.fileOperations.totalCalls,
        data.comparison.adoptionRate.toFixed(3),
        data.comparison.performanceImprovement.toFixed(3),
        data.comparison.reliabilityImprovement.toFixed(3),
      ].join(','));
    }
    
    return csvLines.join('\n');
  }
  
  /**
   * Generate migration progress report
   */
  generateProgressReport(): {
    status: 'early' | 'progressing' | 'mature' | 'complete';
    summary: string;
    recommendations: string[];
    metrics: AggregatedUsageMetrics;
  } {
    const metrics = this.generateAggregatedMetrics(7);
    const adoptionRate = metrics.summary.overallAdoptionRate;
    const performanceImprovement = metrics.summary.avgPerformanceImprovement;
    const reliabilityImprovement = metrics.summary.avgReliabilityImprovement;
    
    let status: 'early' | 'progressing' | 'mature' | 'complete';
    let summary: string;
    const recommendations: string[] = [];
    
    if (adoptionRate < 0.1) {
      status = 'early';
      summary = 'Migration is in early stages with low adoption.';
      recommendations.push('Consider increasing rollout percentage');
      recommendations.push('Review migration guide with users');
      recommendations.push('Enable debug mode to identify issues');
    } else if (adoptionRate < 0.5) {
      status = 'progressing';
      summary = 'Migration is progressing with moderate adoption.';
      recommendations.push('Monitor performance and error metrics');
      recommendations.push('Gather user feedback');
      if (performanceImprovement < 0) {
        recommendations.push('Investigate performance regressions');
      }
    } else if (adoptionRate < 0.9) {
      status = 'mature';
      summary = 'Migration is mature with high adoption.';
      recommendations.push('Plan for full rollout');
      recommendations.push('Document lessons learned');
      if (reliabilityImprovement < 0) {
        recommendations.push('Address reliability concerns before full rollout');
      }
    } else {
      status = 'complete';
      summary = 'Migration is complete with full adoption.';
      recommendations.push('Consider disabling legacy tools');
      recommendations.push('Monitor for any remaining issues');
      recommendations.push('Document success metrics');
    }
    
    return {
      status,
      summary,
      recommendations,
      metrics,
    };
  }
}