/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../../../config/config.js';
import { ToolRegistry } from '../../tool-registry.js';
import { BaseTool, ToolResult } from '../../tools.js';
import { ReadFileTool } from '../../read-file.js';
import { WriteFileTool } from '../../write-file.js';
import { EditTool } from '../../edit.js';
import { GlobTool } from '../../glob.js';
import { GrepTool } from '../../grep.js';
import { MigrationManager } from './migration-manager.js';
import { MigrationMetrics } from './migration-metrics.js';
import { MigrationUserContext } from './migration-config.js';
import { LegacyToolCompatibility } from '../adapters/legacy-compatibility.js';

/**
 * Enhanced tool registry that supports FileOperations migration
 */
export class MigrationAwareToolRegistry extends ToolRegistry {
  private migrationManager: MigrationManager;
  private migrationMetrics: MigrationMetrics;
  private legacyCompatibility: LegacyToolCompatibility;
  private userContext: MigrationUserContext = {};
  
  constructor(config: Config) {
    super(config);
    
    // Initialize migration system
    this.migrationMetrics = new MigrationMetrics();
    this.migrationManager = new MigrationManager(
      config.getFileOperationsMigration(),
      this.migrationMetrics
    );
    
    // Initialize legacy compatibility layer
    this.legacyCompatibility = new LegacyToolCompatibility(
      config,
      config.getTargetDir(),
      {
        useFileOperationsAdapters: true,
        debugMode: config.getFileOperationsMigration().debug?.enabled ?? false,
      }
    );
  }
  
  /**
   * Set user context for migration decisions
   */
  setUserContext(context: MigrationUserContext): void {
    this.userContext = context;
  }
  
  /**
   * Get user context
   */
  getUserContext(): MigrationUserContext {
    return this.userContext;
  }
  
  /**
   * Override tool registration to include migration logic
   */
  registerTool(tool: BaseTool<any, ToolResult>): void {
    // Check if this is a legacy tool that might be migrated
    const toolName = tool.constructor.name;
    const isLegacyTool = this.isLegacyTool(toolName);
    
    if (isLegacyTool) {
      // Wrap tool with migration-aware proxy
      const wrappedTool = this.createMigrationProxy(tool);
      super.registerTool(wrappedTool);
    } else {
      // Register normally for non-legacy tools
      super.registerTool(tool);
    }
  }
  
  /**
   * Override tool retrieval to respect migration decisions
   */
  getTool(name: string): BaseTool<any, ToolResult> | undefined {
    const decision = this.migrationManager.shouldUseFileOperations(name, this.userContext);
    
    if (decision.useFileOperations) {
      // Use FileOperations adapter
      const adapterTool = this.legacyCompatibility.getTool(name);
      if (adapterTool) {
        return adapterTool;
      }
    }
    
    // Fall back to original tool
    return super.getTool(name);
  }
  
  /**
   * Get migration statistics
   */
  getMigrationStats(): any {
    return this.migrationManager.getMigrationStats();
  }
  
  /**
   * Get migration metrics
   */
  getMigrationMetrics(): MigrationMetrics {
    return this.migrationMetrics;
  }
  
  /**
   * Force rollback for a specific tool
   */
  rollbackTool(toolName: string, reason: string): void {
    this.migrationManager.forceRollback(toolName, reason);
  }
  
  /**
   * Enable migration for a specific tool
   */
  enableToolMigration(toolName: string): void {
    this.migrationManager.enableTool(toolName);
  }
  
  /**
   * Disable migration for a specific tool
   */
  disableToolMigration(toolName: string): void {
    this.migrationManager.disableTool(toolName);
  }
  
  /**
   * Check if a tool is a legacy tool that can be migrated
   */
  private isLegacyTool(toolName: string): boolean {
    const legacyTools = [
      'ReadFileTool',
      'WriteFileTool', 
      'EditTool',
      'GlobTool',
      'GrepTool'
    ];
    
    return legacyTools.includes(toolName);
  }
  
  /**
   * Create a proxy that wraps tool execution with migration tracking
   */
  private createMigrationProxy(tool: BaseTool<any, ToolResult>): BaseTool<any, ToolResult> {
    const toolName = tool.constructor.name;
    const migrationManager = this.migrationManager;
    const migrationMetrics = this.migrationMetrics;
    const userContext = this.userContext;
    
    return new Proxy(tool, {
      get(target, prop, receiver) {
        // Intercept execute method to add migration tracking
        if (prop === 'execute') {
          return async function(this: any, params: any, ...args: any[]) {
            const startTime = Date.now();
            let success = false;
            let error: Error | null = null;
            
            try {
              // Make migration decision
              const decision = migrationManager.shouldUseFileOperations(toolName, userContext);
              
              let result: ToolResult;
              if (decision.useFileOperations) {
                // This shouldn't happen in the proxy since we handle it in getTool,
                // but it's here as a safety net
                result = await target.execute.call(this, params, ...args);
              } else {
                // Execute original tool
                result = await target.execute.call(this, params, ...args);
              }
              
              success = true;
              return result;
            } catch (err) {
              error = err as Error;
              throw err;
            } finally {
              // Record performance metrics
              const executionTime = Date.now() - startTime;
              migrationMetrics.recordOperation(toolName, success, executionTime);
              
              if (error && migrationManager.config?.debug?.enabled) {
                console.log(`[MigrationProxy] Tool ${toolName} failed:`, error.message);
              }
            }
          };
        }
        
        // Pass through other properties
        return Reflect.get(target, prop, receiver);
      }
    });
  }
}

/**
 * Enhanced createToolRegistry function that uses migration-aware registry
 */
export function createMigrationAwareToolRegistry(config: Config): Promise<MigrationAwareToolRegistry> {
  const registry = new MigrationAwareToolRegistry(config);
  const targetDir = config.getTargetDir();
  const tools = config.getCoreTools()
    ? new Set(config.getCoreTools())
    : undefined;

  // helper to create & register core tools that are enabled
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registerCoreTool = (ToolClass: any, ...args: unknown[]) => {
    // check both the tool name (.Name) and the class name (.name)
    if (!tools || tools.has(ToolClass.Name) || tools.has(ToolClass.name)) {
      registry.registerTool(new ToolClass(...args));
    }
  };

  // Register tools normally - the registry will handle migration logic
  registerCoreTool(ReadFileTool, targetDir, config);
  registerCoreTool(WriteFileTool, config);
  registerCoreTool(EditTool, config);
  registerCoreTool(GlobTool, targetDir, config);
  registerCoreTool(GrepTool, targetDir);
  
  return (async () => {
    await registry.discoverTools();
    return registry;
  })();
}

/**
 * Update existing createToolRegistry to optionally use migration-aware version
 */
export function updateCreateToolRegistry(config: Config): Promise<ToolRegistry> {
  const migrationConfig = config.getFileOperationsMigration();
  
  // Check if migration is enabled
  if (migrationConfig.phase && migrationConfig.phase !== 'disabled') {
    return createMigrationAwareToolRegistry(config);
  }
  
  // Fall back to original registry (this would call the original createToolRegistry)
  // For now, we'll return the migration-aware one but disabled
  const registry = new MigrationAwareToolRegistry(config);
  // ... (same registration logic as original)
  
  return (async () => {
    await registry.discoverTools();
    return registry;
  })();
}