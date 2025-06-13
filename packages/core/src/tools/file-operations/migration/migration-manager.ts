/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  FileOperationsMigrationConfig, 
  MigrationPhase, 
  MigrationDecision, 
  MigrationUserContext,
  ToolMigrationConfig,
  DEFAULT_MIGRATION_CONFIG 
} from './migration-config.js';
import { MigrationMetrics } from './migration-metrics.js';

/**
 * Migration manager handles decisions about when to use FileOperations
 * vs legacy tools based on configuration and rollout strategy
 */
export class MigrationManager {
  private config: FileOperationsMigrationConfig;
  private metrics: MigrationMetrics;
  
  constructor(
    config: Partial<FileOperationsMigrationConfig> = {},
    metrics?: MigrationMetrics
  ) {
    this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config };
    this.metrics = metrics || new MigrationMetrics();
  }
  
  /**
   * Update migration configuration
   */
  updateConfig(config: Partial<FileOperationsMigrationConfig>): void {
    this.config = { ...this.config, ...config };
    this.log('Configuration updated', config);
  }
  
  /**
   * Make migration decision for a specific tool
   */
  shouldUseFileOperations(
    toolName: string,
    userContext: MigrationUserContext = {}
  ): MigrationDecision {
    // Handle dry-run mode
    if (this.config.debug.dryRun) {
      const decision = this.makeMigrationDecision(toolName, userContext);
      this.log(`DRY RUN: Would ${decision.useFileOperations ? 'use' : 'skip'} FileOperations for ${toolName}`, decision);
      return { ...decision, useFileOperations: false }; // Always skip in dry-run
    }
    
    const decision = this.makeMigrationDecision(toolName, userContext);
    
    // Record decision metrics
    this.metrics.recordDecision(toolName, decision, userContext);
    
    // Log decision if debug mode is enabled
    if (this.config.debug.logAdapterDecisions) {
      this.log(`Migration decision for ${toolName}:`, decision);
    }
    
    return decision;
  }
  
  /**
   * Internal migration decision logic
   */
  private makeMigrationDecision(
    toolName: string,
    userContext: MigrationUserContext
  ): MigrationDecision {
    // Check if migration is globally disabled
    if (this.config.phase === MigrationPhase.DISABLED) {
      return {
        useFileOperations: false,
        phase: MigrationPhase.DISABLED,
        reason: 'Migration globally disabled',
      };
    }
    
    // Get tool-specific configuration
    const toolConfig = this.getToolConfig(toolName);
    
    // Check tool-specific enablement
    if (!toolConfig.enabled) {
      return {
        useFileOperations: false,
        phase: this.config.phase,
        reason: `Tool ${toolName} migration disabled`,
        toolConfig,
      };
    }
    
    // Determine effective phase (tool-specific overrides global)
    const effectivePhase = toolConfig.phase || this.config.phase;
    
    // Check user inclusion/exclusion lists
    if (userContext.userId) {
      if (toolConfig.excludeUsers?.includes(userContext.userId)) {
        return {
          useFileOperations: false,
          phase: effectivePhase,
          reason: `User ${userContext.userId} excluded from migration`,
          toolConfig,
        };
      }
      
      if (toolConfig.includeUsers?.includes(userContext.userId)) {
        return {
          useFileOperations: true,
          phase: effectivePhase,
          reason: `User ${userContext.userId} explicitly included in migration`,
          toolConfig,
        };
      }
    }
    
    // Check rollout percentage
    const rolloutPercentage = toolConfig.rolloutPercentage ?? this.config.rolloutPercentage;
    if (!this.isUserInRollout(userContext, rolloutPercentage)) {
      return {
        useFileOperations: false,
        phase: effectivePhase,
        reason: `User not in ${rolloutPercentage}% rollout`,
        toolConfig,
      };
    }
    
    // Check for automatic rollback conditions
    if (this.shouldAutoRollback(toolName)) {
      return {
        useFileOperations: false,
        phase: effectivePhase,
        reason: 'Automatic rollback triggered due to high error rate or performance degradation',
        toolConfig,
      };
    }
    
    // Migration approved
    return {
      useFileOperations: true,
      phase: effectivePhase,
      reason: `Migration enabled (phase: ${effectivePhase}, rollout: ${rolloutPercentage}%)`,
      toolConfig,
    };
  }
  
  /**
   * Get tool-specific configuration with defaults
   */
  private getToolConfig(toolName: string): ToolMigrationConfig {
    const toolKey = this.getToolConfigKey(toolName);
    const toolConfig = this.config.tools[toolKey as keyof typeof this.config.tools];
    
    return {
      enabled: true, // Default to enabled
      ...toolConfig,
    };
  }
  
  /**
   * Map tool names to configuration keys
   */
  private getToolConfigKey(toolName: string): string {
    const mapping: Record<string, string> = {
      'read_file': 'readFile',
      'ReadFileTool': 'readFile',
      'write_file': 'writeFile',
      'WriteFileTool': 'writeFile',
      'replace': 'editTool',
      'EditTool': 'editTool',
      'glob': 'globTool',
      'GlobTool': 'globTool',
      'search_file_content': 'grepTool',
      'GrepTool': 'grepTool',
    };
    
    return mapping[toolName] || toolName.toLowerCase();
  }
  
  /**
   * Determine if user is included in rollout percentage
   */
  private isUserInRollout(userContext: MigrationUserContext, percentage: number): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    
    // Use consistent hashing based on user/session ID to ensure stable rollout
    const identifier = userContext.userId || userContext.sessionId || 'anonymous';
    const hash = this.hashString(identifier);
    const userPercentile = (hash % 100) + 1; // 1-100
    
    return userPercentile <= percentage;
  }
  
  /**
   * Simple hash function for consistent user assignment
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
  
  /**
   * Check if automatic rollback should be triggered
   */
  private shouldAutoRollback(toolName: string): boolean {
    if (!this.config.rollback.autoRollback) {
      return false;
    }
    
    const stats = this.metrics.getToolStats(toolName);
    if (!stats || stats.totalOperations < this.config.rollback.minSampleSize) {
      return false; // Not enough data
    }
    
    // Check error rate
    const errorRate = stats.errorCount / stats.totalOperations;
    if (errorRate > this.config.rollback.errorThreshold) {
      this.log(`Auto-rollback triggered for ${toolName}: error rate ${errorRate.toFixed(3)} > ${this.config.rollback.errorThreshold}`);
      return true;
    }
    
    // Check performance degradation
    if (stats.avgPerformanceRatio > this.config.rollback.performanceThreshold) {
      this.log(`Auto-rollback triggered for ${toolName}: performance ratio ${stats.avgPerformanceRatio.toFixed(2)} > ${this.config.rollback.performanceThreshold}`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Get current migration statistics
   */
  getMigrationStats(): any {
    return {
      config: this.config,
      metrics: this.metrics.getAllStats(),
      rollbackStatus: this.getRollbackStatus(),
    };
  }
  
  /**
   * Get rollback status for all tools
   */
  private getRollbackStatus(): Record<string, boolean> {
    const tools = ['readFile', 'writeFile', 'editTool', 'globTool', 'grepTool'];
    const status: Record<string, boolean> = {};
    
    for (const tool of tools) {
      status[tool] = this.shouldAutoRollback(tool);
    }
    
    return status;
  }
  
  /**
   * Force rollback for a specific tool
   */
  forceRollback(toolName: string, reason: string): void {
    const toolConfigKey = this.getToolConfigKey(toolName);
    this.config.tools = {
      ...this.config.tools,
      [toolConfigKey]: {
        ...this.getToolConfig(toolName),
        enabled: false,
      },
    };
    
    this.log(`Forced rollback for ${toolName}: ${reason}`);
    this.metrics.recordRollback(toolName, reason);
  }
  
  /**
   * Enable migration for a specific tool
   */
  enableTool(toolName: string, config: Partial<ToolMigrationConfig> = {}): void {
    const toolConfigKey = this.getToolConfigKey(toolName);
    this.config.tools = {
      ...this.config.tools,
      [toolConfigKey]: {
        ...this.getToolConfig(toolName),
        enabled: true,
        ...config,
      },
    };
    
    this.log(`Enabled migration for ${toolName}`, config);
  }
  
  /**
   * Disable migration for a specific tool
   */
  disableTool(toolName: string): void {
    const toolConfigKey = this.getToolConfigKey(toolName);
    this.config.tools = {
      ...this.config.tools,
      [toolConfigKey]: {
        ...this.getToolConfig(toolName),
        enabled: false,
      },
    };
    
    this.log(`Disabled migration for ${toolName}`);
  }
  
  /**
   * Debug logging helper
   */
  private log(message: string, data?: any): void {
    if (this.config.debug.enabled) {
      console.log(`[MigrationManager] ${message}`, data || '');
    }
  }
}