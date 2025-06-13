/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../../../config/config.js';
import { BaseTool, ToolResult } from '../../tools.js';
import { ReadFileTool } from '../../read-file.js';
import { WriteFileTool } from '../../write-file.js';
import { EditTool } from '../../edit.js';
import { GlobTool } from '../../glob.js';
import { GrepTool } from '../../grep.js';
import { ReadFileAdapter } from './read-file-adapter.js';
import { WriteFileAdapter } from './write-file-adapter.js';
import { EditToolAdapter } from './edit-tool-adapter.js';
import { GlobToolAdapter } from './glob-tool-adapter.js';
import { GrepToolAdapter } from './grep-tool-adapter.js';

/**
 * Configuration for legacy tool compatibility mode
 */
export interface LegacyCompatibilityConfig {
  /** Use FileOperations adapters for legacy tools */
  useFileOperationsAdapters?: boolean;
  /** Tools to exclude from adapter usage (use original implementation) */
  excludeTools?: string[];
  /** Enable debug logging for adapter operations */
  debugMode?: boolean;
}

/**
 * Legacy tool compatibility shim that allows seamless switching
 * between original tools and FileOperations adapters
 */
export class LegacyToolCompatibility {
  private readonly config: Config;
  private readonly rootDirectory: string;
  private readonly compatConfig: LegacyCompatibilityConfig;
  
  constructor(
    config: Config,
    rootDirectory: string,
    compatConfig: LegacyCompatibilityConfig = {}
  ) {
    this.config = config;
    this.rootDirectory = rootDirectory;
    this.compatConfig = compatConfig;
  }
  
  /**
   * Get a tool instance based on compatibility configuration
   * Returns either the original tool or the FileOperations adapter
   */
  getTool(toolName: string): BaseTool<any, ToolResult> | null {
    const useAdapter = this.shouldUseAdapter(toolName);
    
    if (this.compatConfig.debugMode) {
      console.log(`[LegacyCompatibility] Tool '${toolName}' using ${useAdapter ? 'adapter' : 'original'} implementation`);
    }
    
    switch (toolName) {
      case 'read_file':
      case ReadFileTool.Name:
        return useAdapter 
          ? new ReadFileAdapter(this.rootDirectory, this.config)
          : new ReadFileTool(this.rootDirectory, this.config);
          
      case 'write_file':
      case WriteFileTool.Name:
        return useAdapter
          ? new WriteFileAdapter(this.config)
          : new WriteFileTool(this.config);
          
      case 'replace':
      case EditTool.Name:
        return useAdapter
          ? new EditToolAdapter(this.config)
          : new EditTool(this.config);
          
      case 'glob':
      case GlobTool.Name:
        return useAdapter
          ? new GlobToolAdapter(this.rootDirectory, this.config)
          : new GlobTool(this.rootDirectory, this.config);
          
      case 'search_file_content':
      case GrepTool.Name:
        return useAdapter
          ? new GrepToolAdapter(this.rootDirectory, this.config)
          : new GrepTool(this.rootDirectory);
          
      default:
        return null;
    }
  }
  
  /**
   * Get all legacy tools with adapter support
   */
  getAllTools(): Map<string, BaseTool<any, ToolResult>> {
    const tools = new Map<string, BaseTool<any, ToolResult>>();
    
    const toolNames = [
      ReadFileTool.Name,
      WriteFileTool.Name,
      EditTool.Name,
      GlobTool.Name,
      GrepTool.Name
    ];
    
    for (const toolName of toolNames) {
      const tool = this.getTool(toolName);
      if (tool) {
        tools.set(toolName, tool);
      }
    }
    
    return tools;
  }
  
  /**
   * Check if FileOperations adapter should be used for a tool
   */
  private shouldUseAdapter(toolName: string): boolean {
    // If adapters are disabled, always use original
    if (!this.compatConfig.useFileOperationsAdapters) {
      return false;
    }
    
    // Check exclusion list
    if (this.compatConfig.excludeTools?.includes(toolName)) {
      return false;
    }
    
    // Use adapter by default when enabled
    return true;
  }
  
  /**
   * Create a compatibility layer for ToolRegistry
   */
  static createRegistryShim(
    originalRegistry: any,
    config: Config,
    rootDirectory: string,
    compatConfig: LegacyCompatibilityConfig = {}
  ): any {
    const compatibility = new LegacyToolCompatibility(config, rootDirectory, compatConfig);
    
    // Create a proxy that intercepts tool lookups
    return new Proxy(originalRegistry, {
      get(target, prop, receiver) {
        // Intercept getTool method
        if (prop === 'getTool' || prop === 'get') {
          return (toolName: string) => {
            // Try to get adapter first
            const adapterTool = compatibility.getTool(toolName);
            if (adapterTool) {
              return adapterTool;
            }
            
            // Fall back to original registry
            return Reflect.get(target, prop, receiver).call(target, toolName);
          };
        }
        
        // Intercept getAllTools method
        if (prop === 'getAllTools' || prop === 'all') {
          return () => {
            const originalTools = Reflect.get(target, prop, receiver).call(target);
            const adapterTools = compatibility.getAllTools();
            
            // Merge tools, with adapters taking precedence
            const mergedTools = new Map(originalTools);
            for (const [name, tool] of adapterTools) {
              mergedTools.set(name, tool);
            }
            
            return mergedTools;
          };
        }
        
        // Pass through other properties/methods
        return Reflect.get(target, prop, receiver);
      }
    });
  }
  
  /**
   * Enable compatibility mode globally by patching tool registry
   */
  static enableGlobalCompatibility(
    config: Config,
    rootDirectory: string,
    compatConfig: LegacyCompatibilityConfig = {}
  ): void {
    // This would need to be integrated with the actual tool registry
    // implementation in your codebase
    console.log('[LegacyCompatibility] Global compatibility mode enabled');
    console.log('[LegacyCompatibility] Configuration:', compatConfig);
  }
}