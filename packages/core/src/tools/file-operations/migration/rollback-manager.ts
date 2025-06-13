/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  FileOperationsMigrationConfig, 
  MigrationPhase, 
  DEFAULT_MIGRATION_CONFIG 
} from './migration-config.js';
import { MigrationMetrics } from './migration-metrics.js';
import { UsageMetricsCollector } from './usage-metrics.js';

/**
 * Rollback event types
 */
export enum RollbackTrigger {
  MANUAL = 'manual',
  AUTO_ERROR_RATE = 'auto_error_rate',
  AUTO_PERFORMANCE = 'auto_performance',
  AUTO_USER_FEEDBACK = 'auto_user_feedback',
  CIRCUIT_BREAKER = 'circuit_breaker',
}

/**
 * Rollback action details
 */
export interface RollbackAction {
  trigger: RollbackTrigger;
  scope: 'global' | 'tool' | 'user';
  target?: string; // Tool name or user ID
  reason: string;
  timestamp: Date;
  automatic: boolean;
  metrics?: any;
}

/**
 * Rollback state
 */
export interface RollbackState {
  isActive: boolean;
  scope: 'global' | 'tool' | 'user';
  targets: string[];
  trigger: RollbackTrigger;
  startTime: Date;
  endTime?: Date;
  reason: string;
  canRevert: boolean;
}

/**
 * Circuit breaker state for automatic rollback
 */
interface CircuitBreakerState {
  toolName: string;
  failureCount: number;
  lastFailureTime: Date;
  state: 'closed' | 'open' | 'half-open';
  nextAttemptTime: Date;
}

/**
 * Manages rollback scenarios for FileOperations migration
 */
export class RollbackManager {
  private config: FileOperationsMigrationConfig;
  private metrics: MigrationMetrics;
  private usageMetrics: UsageMetricsCollector;
  private rollbackHistory: RollbackAction[] = [];
  private activeRollbacks: Map<string, RollbackState> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private configBackup?: FileOperationsMigrationConfig;
  
  constructor(
    config: FileOperationsMigrationConfig,
    metrics: MigrationMetrics,
    usageMetrics: UsageMetricsCollector
  ) {
    this.config = { ...config };
    this.metrics = metrics;
    this.usageMetrics = usageMetrics;
    this.configBackup = { ...config };
    
    // Initialize circuit breakers for all tools
    this.initializeCircuitBreakers();
    
    // Start monitoring if auto-rollback is enabled
    if (config.rollback.autoRollback) {
      this.startMonitoring();
    }
  }
  
  /**
   * Manually trigger rollback for specific scope
   */
  triggerManualRollback(
    scope: 'global' | 'tool' | 'user',
    target?: string,
    reason: string = 'Manual rollback requested'
  ): RollbackState {
    const action: RollbackAction = {
      trigger: RollbackTrigger.MANUAL,
      scope,
      target,
      reason,
      timestamp: new Date(),
      automatic: false,
    };
    
    return this.executeRollback(action);
  }
  
  /**
   * Trigger automatic rollback based on metrics
   */
  triggerAutoRollback(
    toolName: string,
    trigger: RollbackTrigger,
    reason: string,
    metrics: any
  ): RollbackState | null {
    // Check if rollback is already active for this tool
    if (this.activeRollbacks.has(toolName)) {
      return null;
    }
    
    const action: RollbackAction = {
      trigger,
      scope: 'tool',
      target: toolName,
      reason,
      timestamp: new Date(),
      automatic: true,
      metrics,
    };
    
    return this.executeRollback(action);
  }
  
  /**
   * Execute rollback action
   */
  private executeRollback(action: RollbackAction): RollbackState {
    const rollbackId = this.generateRollbackId(action);
    
    // Create rollback state
    const state: RollbackState = {
      isActive: true,
      scope: action.scope,
      targets: action.target ? [action.target] : [],
      trigger: action.trigger,
      startTime: action.timestamp,
      reason: action.reason,
      canRevert: true,
    };
    
    // Apply rollback configuration changes
    this.applyRollbackConfig(action);
    
    // Record rollback
    this.rollbackHistory.push(action);
    this.activeRollbacks.set(rollbackId, state);
    this.metrics.recordRollback(
      action.target || 'global',
      action.reason,
      action.automatic ? 'automatic' : 'manual'
    );
    
    // Log rollback
    console.log(`[RollbackManager] Rollback executed:`, {
      id: rollbackId,
      action,
      state,
    });
    
    return state;
  }
  
  /**
   * Apply configuration changes for rollback
   */
  private applyRollbackConfig(action: RollbackAction): void {
    switch (action.scope) {
      case 'global':
        // Disable migration globally
        this.config.phase = MigrationPhase.DISABLED;
        break;
        
      case 'tool':
        if (action.target) {
          // Disable migration for specific tool
          const toolConfigKey = this.getToolConfigKey(action.target);
          this.config.tools = {
            ...this.config.tools,
            [toolConfigKey]: {
              ...this.config.tools[toolConfigKey as keyof typeof this.config.tools],
              enabled: false,
            },
          };
        }
        break;
        
      case 'user':
        if (action.target) {
          // Add user to exclusion list for all tools
          Object.keys(this.config.tools).forEach(toolKey => {
            const toolConfig = this.config.tools[toolKey as keyof typeof this.config.tools];
            if (toolConfig) {
              const excludeUsers = toolConfig.excludeUsers || [];
              if (!excludeUsers.includes(action.target!)) {
                excludeUsers.push(action.target!);
              }
              (this.config.tools[toolKey as keyof typeof this.config.tools] as any) = {
                ...toolConfig,
                excludeUsers,
              };
            }
          });
        }
        break;
    }
  }
  
  /**
   * Revert rollback and restore previous configuration
   */
  revertRollback(rollbackId: string): boolean {
    const state = this.activeRollbacks.get(rollbackId);
    if (!state || !state.canRevert) {
      return false;
    }
    
    // Restore configuration from backup
    if (this.configBackup) {
      this.config = { ...this.configBackup };
    }
    
    // Mark rollback as completed
    state.isActive = false;
    state.endTime = new Date();
    this.activeRollbacks.delete(rollbackId);
    
    console.log(`[RollbackManager] Rollback reverted:`, rollbackId);
    return true;
  }
  
  /**
   * Check if rollback conditions are met and trigger if necessary
   */
  checkRollbackConditions(): void {
    if (!this.config.rollback.autoRollback) {
      return;
    }
    
    const tools = ['ReadFileTool', 'WriteFileTool', 'EditTool', 'GlobTool', 'GrepTool'];
    
    for (const toolName of tools) {
      this.checkToolRollbackConditions(toolName);
    }
  }
  
  /**
   * Check rollback conditions for a specific tool
   */
  private checkToolRollbackConditions(toolName: string): void {
    // Skip if rollback already active
    if (this.activeRollbacks.has(toolName)) {
      return;
    }
    
    const stats = this.metrics.getToolStats(toolName);
    if (!stats || stats.totalOperations < this.config.rollback.minSampleSize) {
      return;
    }
    
    // Check error rate threshold
    const errorRate = stats.errorCount / stats.totalOperations;
    if (errorRate > this.config.rollback.errorThreshold) {
      this.triggerAutoRollback(
        toolName,
        RollbackTrigger.AUTO_ERROR_RATE,
        `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(this.config.rollback.errorThreshold * 100).toFixed(1)}%`,
        { errorRate, threshold: this.config.rollback.errorThreshold }
      );
      return;
    }
    
    // Check performance threshold
    if (stats.avgPerformanceRatio > this.config.rollback.performanceThreshold) {
      this.triggerAutoRollback(
        toolName,
        RollbackTrigger.AUTO_PERFORMANCE,
        `Performance ratio ${stats.avgPerformanceRatio.toFixed(2)} exceeds threshold ${this.config.rollback.performanceThreshold.toFixed(2)}`,
        { performanceRatio: stats.avgPerformanceRatio, threshold: this.config.rollback.performanceThreshold }
      );
      return;
    }
    
    // Check circuit breaker
    this.checkCircuitBreaker(toolName);
  }
  
  /**
   * Check and update circuit breaker state
   */
  private checkCircuitBreaker(toolName: string): void {
    const breaker = this.circuitBreakers.get(toolName);
    if (!breaker) return;
    
    const now = new Date();
    const stats = this.metrics.getToolStats(toolName);
    
    if (!stats) return;
    
    switch (breaker.state) {
      case 'closed':
        // Normal operation - check for failures
        if (stats.errorCount > 0) {
          breaker.failureCount++;
          breaker.lastFailureTime = now;
          
          // Trip circuit breaker if too many failures
          if (breaker.failureCount >= 5) { // Configurable threshold
            breaker.state = 'open';
            breaker.nextAttemptTime = new Date(now.getTime() + 60000); // 1 minute timeout
            
            this.triggerAutoRollback(
              toolName,
              RollbackTrigger.CIRCUIT_BREAKER,
              `Circuit breaker tripped after ${breaker.failureCount} failures`,
              { failureCount: breaker.failureCount }
            );
          }
        } else {
          // Reset failure count on successful operations
          breaker.failureCount = 0;
        }
        break;
        
      case 'open':
        // Circuit is open - check if we can attempt recovery
        if (now >= breaker.nextAttemptTime) {
          breaker.state = 'half-open';
          breaker.failureCount = 0;
        }
        break;
        
      case 'half-open':
        // Test recovery - if operations succeed, close circuit
        if (stats.successCount > 0 && stats.errorCount === 0) {
          breaker.state = 'closed';
          breaker.failureCount = 0;
          
          // Try to revert rollback if it was circuit breaker triggered
          const rollbackId = this.findActiveRollback(toolName, RollbackTrigger.CIRCUIT_BREAKER);
          if (rollbackId) {
            this.revertRollback(rollbackId);
          }
        } else if (stats.errorCount > 0) {
          // Failure during recovery - reopen circuit
          breaker.state = 'open';
          breaker.failureCount++;
          breaker.nextAttemptTime = new Date(now.getTime() + 120000); // 2 minute timeout
        }
        break;
    }
  }
  
  /**
   * Find active rollback by tool and trigger
   */
  private findActiveRollback(toolName: string, trigger: RollbackTrigger): string | null {
    for (const [id, state] of this.activeRollbacks) {
      if (state.isActive && 
          state.scope === 'tool' && 
          state.targets.includes(toolName) && 
          state.trigger === trigger) {
        return id;
      }
    }
    return null;
  }
  
  /**
   * Initialize circuit breakers for all tools
   */
  private initializeCircuitBreakers(): void {
    const tools = ['ReadFileTool', 'WriteFileTool', 'EditTool', 'GlobTool', 'GrepTool'];
    
    for (const toolName of tools) {
      this.circuitBreakers.set(toolName, {
        toolName,
        failureCount: 0,
        lastFailureTime: new Date(),
        state: 'closed',
        nextAttemptTime: new Date(),
      });
    }
  }
  
  /**
   * Start monitoring for auto-rollback conditions
   */
  private startMonitoring(): void {
    // Check conditions every 30 seconds
    setInterval(() => {
      this.checkRollbackConditions();
    }, 30000);
    
    console.log('[RollbackManager] Monitoring started for auto-rollback conditions');
  }
  
  /**
   * Generate unique rollback ID
   */
  private generateRollbackId(action: RollbackAction): string {
    const timestamp = action.timestamp.getTime();
    const scope = action.scope;
    const target = action.target || 'global';
    return `rollback_${scope}_${target}_${timestamp}`;
  }
  
  /**
   * Map tool names to configuration keys
   */
  private getToolConfigKey(toolName: string): string {
    const mapping: Record<string, string> = {
      'ReadFileTool': 'readFile',
      'WriteFileTool': 'writeFile',
      'EditTool': 'editTool',
      'GlobTool': 'globTool',
      'GrepTool': 'grepTool',
    };
    
    return mapping[toolName] || toolName.toLowerCase();
  }
  
  /**
   * Get current rollback status
   */
  getRollbackStatus(): {
    activeRollbacks: RollbackState[];
    rollbackHistory: RollbackAction[];
    circuitBreakerStates: Record<string, CircuitBreakerState>;
    configBackup?: FileOperationsMigrationConfig;
  } {
    return {
      activeRollbacks: Array.from(this.activeRollbacks.values()),
      rollbackHistory: [...this.rollbackHistory],
      circuitBreakerStates: Object.fromEntries(this.circuitBreakers),
      configBackup: this.configBackup,
    };
  }
  
  /**
   * Create rollback plan for emergency scenarios
   */
  createEmergencyRollbackPlan(): {
    immediate: Array<{ action: string; command: string }>;
    graceful: Array<{ action: string; command: string }>;
    communication: Array<{ action: string; message: string }>;
  } {
    return {
      immediate: [
        {
          action: 'Disable all FileOperations migration',
          command: 'config.fileOperationsMigration.phase = "disabled"',
        },
        {
          action: 'Stop new FileOperations tool registrations',
          command: 'config.fileOperationsMigration.rolloutPercentage = 0',
        },
        {
          action: 'Enable debug logging',
          command: 'config.fileOperationsMigration.debug.enabled = true',
        },
      ],
      graceful: [
        {
          action: 'Reduce rollout percentage gradually',
          command: 'Decrease rolloutPercentage by 25% every 5 minutes',
        },
        {
          action: 'Exclude problematic tools',
          command: 'Add failing tools to excludeTools list',
        },
        {
          action: 'Enable dry-run mode',
          command: 'config.fileOperationsMigration.debug.dryRun = true',
        },
      ],
      communication: [
        {
          action: 'Alert development team',
          message: 'FileOperations migration rollback triggered',
        },
        {
          action: 'Notify users of service degradation',
          message: 'Experiencing issues with file operations, reverting to legacy tools',
        },
        {
          action: 'Update status page',
          message: 'FileOperations temporarily disabled for stability',
        },
      ],
    };
  }
  
  /**
   * Export rollback data for analysis
   */
  exportRollbackData(): string {
    const data = {
      status: this.getRollbackStatus(),
      emergencyPlan: this.createEmergencyRollbackPlan(),
      exportTime: new Date(),
    };
    
    return JSON.stringify(data, null, 2);
  }
}