/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { 
  EnhancedLanguageParser, 
  PluginMetadata, 
  PluginConfiguration, 
  PluginValidationResult,
  BaseLanguagePlugin
} from './base-plugin.js';
import { SupportedLanguage } from '../services/ast-parser.js';
import { CacheManager } from '../services/cache-manager.js';

/**
 * Plugin registration information
 */
export interface PluginRegistration {
  /** Plugin instance */
  plugin: EnhancedLanguageParser;
  /** Plugin metadata */
  metadata: PluginMetadata;
  /** Plugin configuration */
  config: PluginConfiguration;
  /** Registration timestamp */
  registeredAt: Date;
  /** Whether plugin is currently active */
  active: boolean;
  /** Validation result */
  validation?: PluginValidationResult;
}

/**
 * Plugin discovery result
 */
export interface PluginDiscoveryResult {
  /** Found plugin paths */
  plugins: Array<{
    path: string;
    metadata?: PluginMetadata;
    error?: string;
  }>;
  /** Discovery errors */
  errors: string[];
}

/**
 * Plugin loading options
 */
export interface PluginLoadOptions {
  /** Validate plugin before loading */
  validate?: boolean;
  /** Initialize plugin after loading */
  initialize?: boolean;
  /** Plugin configuration */
  config?: Partial<PluginConfiguration>;
  /** Timeout for loading operations */
  timeout?: number;
}

/**
 * Plugin registry events
 */
export interface PluginRegistryEvents {
  'plugin-registered': (plugin: PluginRegistration) => void;
  'plugin-unregistered': (metadata: PluginMetadata) => void;
  'plugin-validated': (metadata: PluginMetadata, result: PluginValidationResult) => void;
  'plugin-error': (metadata: PluginMetadata, error: Error) => void;
}

/**
 * Enhanced plugin registry with discovery and validation
 */
export class PluginRegistry {
  private plugins = new Map<string, PluginRegistration>();
  private languageMap = new Map<SupportedLanguage, string[]>();
  private eventListeners = new Map<keyof PluginRegistryEvents, Function[]>();
  private readonly cacheManager?: CacheManager;

  constructor(cacheManager?: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Register a plugin instance
   */
  async register(
    plugin: EnhancedLanguageParser,
    config?: Partial<PluginConfiguration>
  ): Promise<PluginRegistration> {
    const metadata = plugin.getMetadata();
    
    // Check for duplicate plugin IDs
    if (this.plugins.has(metadata.id)) {
      throw new Error(`Plugin with ID '${metadata.id}' is already registered`);
    }

    // Create default configuration
    const pluginConfig: PluginConfiguration = {
      enabled: true,
      settings: {},
      timeout: 30000,
      maxMemory: 100 * 1024 * 1024, // 100MB default
      ...config
    };

    // Validate plugin if enabled
    let validation: PluginValidationResult | undefined;
    if (pluginConfig.enabled) {
      validation = await plugin.validate();
      this.emit('plugin-validated', metadata, validation);
      
      if (!validation.valid) {
        throw new Error(`Plugin validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // Initialize plugin if enabled
    if (pluginConfig.enabled) {
      try {
        await plugin.initialize(pluginConfig);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('plugin-error', metadata, err);
        throw new Error(`Plugin initialization failed: ${err.message}`);
      }
    }

    // Create registration
    const registration: PluginRegistration = {
      plugin,
      metadata,
      config: pluginConfig,
      registeredAt: new Date(),
      active: pluginConfig.enabled,
      validation
    };

    this.plugins.set(metadata.id, registration);

    // Update language mapping
    for (const language of metadata.languages) {
      if (!this.languageMap.has(language)) {
        this.languageMap.set(language, []);
      }
      this.languageMap.get(language)!.push(metadata.id);
    }

    this.emit('plugin-registered', registration);
    return registration;
  }

  /**
   * Unregister a plugin
   */
  async unregister(pluginId: string): Promise<boolean> {
    const registration = this.plugins.get(pluginId);
    if (!registration) {
      return false;
    }

    // Cleanup plugin
    try {
      await registration.plugin.cleanup();
    } catch (error) {
      console.warn(`Error cleaning up plugin ${pluginId}:`, error);
    }

    // Remove from language mapping
    for (const language of registration.metadata.languages) {
      const plugins = this.languageMap.get(language);
      if (plugins) {
        const index = plugins.indexOf(pluginId);
        if (index !== -1) {
          plugins.splice(index, 1);
        }
        if (plugins.length === 0) {
          this.languageMap.delete(language);
        }
      }
    }

    this.plugins.delete(pluginId);
    this.emit('plugin-unregistered', registration.metadata);
    return true;
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(pluginId: string): PluginRegistration | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get plugins for a specific language
   */
  getPluginsForLanguage(language: SupportedLanguage): PluginRegistration[] {
    const pluginIds = this.languageMap.get(language) || [];
    return pluginIds
      .map(id => this.plugins.get(id))
      .filter((plugin): plugin is PluginRegistration => plugin !== undefined)
      .filter(plugin => plugin.active);
  }

  /**
   * Get the best plugin for a file
   */
  getBestPluginForFile(filePath: string, content?: string): PluginRegistration | undefined {
    const allPlugins = Array.from(this.plugins.values())
      .filter(registration => registration.active);

    // Find plugins that support this file
    const supportingPlugins = allPlugins.filter(registration =>
      registration.plugin.supportsFile(filePath, content)
    );

    if (supportingPlugins.length === 0) {
      return undefined;
    }

    // Sort by preference (most specific first)
    supportingPlugins.sort((a, b) => {
      // Prefer plugins with more specific file extensions
      const aExtensions = a.metadata.capabilities.fileExtensions.length;
      const bExtensions = b.metadata.capabilities.fileExtensions.length;
      if (aExtensions !== bExtensions) {
        return bExtensions - aExtensions;
      }

      // Prefer plugins with more capabilities
      const aCapabilities = this.countCapabilities(a.metadata.capabilities);
      const bCapabilities = this.countCapabilities(b.metadata.capabilities);
      return bCapabilities - aCapabilities;
    });

    return supportingPlugins[0];
  }

  /**
   * List all registered plugins
   */
  listPlugins(): PluginRegistration[] {
    return Array.from(this.plugins.values());
  }

  /**
   * List supported languages
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return Array.from(this.languageMap.keys());
  }

  /**
   * Check if a language is supported
   */
  supportsLanguage(language: SupportedLanguage): boolean {
    return this.languageMap.has(language) && 
           (this.languageMap.get(language)?.length || 0) > 0;
  }

  /**
   * Validate all registered plugins
   */
  async validateAll(): Promise<Map<string, PluginValidationResult>> {
    const results = new Map<string, PluginValidationResult>();
    
    for (const [pluginId, registration] of this.plugins) {
      try {
        const result = await registration.plugin.validate();
        results.set(pluginId, result);
        registration.validation = result;
        this.emit('plugin-validated', registration.metadata, result);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('plugin-error', registration.metadata, err);
        results.set(pluginId, {
          valid: false,
          errors: [err.message],
          warnings: [],
          compatibility: []
        });
      }
    }
    
    return results;
  }

  /**
   * Discover plugins in a directory
   */
  async discoverPlugins(searchPaths: string[]): Promise<PluginDiscoveryResult> {
    const result: PluginDiscoveryResult = {
      plugins: [],
      errors: []
    };

    for (const searchPath of searchPaths) {
      try {
        const discovered = await this.discoverInPath(searchPath);
        result.plugins.push(...discovered.plugins);
        result.errors.push(...discovered.errors);
      } catch (error) {
        result.errors.push(`Failed to search path ${searchPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  /**
   * Load a plugin from a file path
   */
  async loadPlugin(
    pluginPath: string,
    options: PluginLoadOptions = {}
  ): Promise<PluginRegistration> {
    const timeout = options.timeout || 30000;
    
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Plugin loading timed out after ${timeout}ms`));
      }, timeout);

      try {
        // Dynamic import of the plugin
        const module = await import(pluginPath);
        
        let plugin: EnhancedLanguageParser;
        
        if (module.default && this.isEnhancedLanguageParser(module.default)) {
          plugin = module.default;
        } else if (module.createPlugin && typeof module.createPlugin === 'function') {
          plugin = module.createPlugin(this.cacheManager);
        } else if (module.default && typeof module.default === 'function') {
          plugin = module.default(this.cacheManager);
        } else {
          throw new Error('Invalid plugin format. Plugin must export a parser instance or factory function.');
        }

        // Validate if requested
        if (options.validate !== false) {
          const validation = await plugin.validate();
          if (!validation.valid) {
            throw new Error(`Plugin validation failed: ${validation.errors.join(', ')}`);
          }
        }

        // Register the plugin
        const registration = await this.register(plugin, options.config);
        
        clearTimeout(timer);
        resolve(registration);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Cleanup all plugins
   */
  async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.plugins.values()).map(async registration => {
      try {
        await registration.plugin.cleanup();
      } catch (error) {
        console.warn(`Error cleaning up plugin ${registration.metadata.id}:`, error);
      }
    });

    await Promise.all(cleanupPromises);
    this.plugins.clear();
    this.languageMap.clear();
  }

  /**
   * Add event listener
   */
  on<K extends keyof PluginRegistryEvents>(
    event: K,
    listener: PluginRegistryEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof PluginRegistryEvents>(
    event: K,
    listener: PluginRegistryEvents[K]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  private emit<K extends keyof PluginRegistryEvents>(
    event: K,
    ...args: Parameters<PluginRegistryEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in plugin registry event listener:`, error);
      }
    }
  }

  /**
   * Discover plugins in a specific path
   */
  private async discoverInPath(searchPath: string): Promise<PluginDiscoveryResult> {
    const result: PluginDiscoveryResult = {
      plugins: [],
      errors: []
    };

    try {
      const stats = await fs.stat(searchPath);
      
      if (stats.isFile()) {
        // Single plugin file
        if (this.isPluginFile(searchPath)) {
          await this.examinePluginFile(searchPath, result);
        }
      } else if (stats.isDirectory()) {
        // Plugin directory
        const entries = await fs.readdir(searchPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(searchPath, entry.name);
          
          if (entry.isFile() && this.isPluginFile(fullPath)) {
            await this.examinePluginFile(fullPath, result);
          } else if (entry.isDirectory()) {
            // Recursively search subdirectories
            const subResult = await this.discoverInPath(fullPath);
            result.plugins.push(...subResult.plugins);
            result.errors.push(...subResult.errors);
          }
        }
      }
    } catch (error) {
      result.errors.push(`Failed to examine path ${searchPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Examine a plugin file
   */
  private async examinePluginFile(
    filePath: string,
    result: PluginDiscoveryResult
  ): Promise<void> {
    try {
      // Try to load and get metadata without full initialization
      const module = await import(filePath);
      
      let plugin: EnhancedLanguageParser | undefined;
      
      if (module.default && this.isEnhancedLanguageParser(module.default)) {
        plugin = module.default;
      } else if (module.createPlugin && typeof module.createPlugin === 'function') {
        try {
          plugin = module.createPlugin(this.cacheManager);
        } catch (error) {
          // Skip if factory function fails
        }
      } else if (module.default && typeof module.default === 'function') {
        try {
          plugin = module.default(this.cacheManager);
        } catch (error) {
          // Skip if factory function fails
        }
      }

      if (plugin) {
        const metadata = plugin.getMetadata();
        result.plugins.push({
          path: filePath,
          metadata
        });
      } else {
        result.plugins.push({
          path: filePath,
          error: 'Invalid plugin format'
        });
      }
    } catch (error) {
      result.plugins.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Check if a file is a potential plugin file
   */
  private isPluginFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.js', '.ts', '.mjs'].includes(ext) && 
           !filePath.includes('.test.') && 
           !filePath.includes('.spec.');
  }

  /**
   * Check if an object implements EnhancedLanguageParser
   */
  private isEnhancedLanguageParser(obj: any): obj is EnhancedLanguageParser {
    return (
      obj &&
      typeof obj.parse === 'function' &&
      typeof obj.getMetadata === 'function' &&
      typeof obj.validate === 'function' &&
      typeof obj.initialize === 'function' &&
      typeof obj.cleanup === 'function' &&
      typeof obj.supportsFile === 'function'
    );
  }

  /**
   * Count plugin capabilities
   */
  private countCapabilities(capabilities: any): number {
    let count = 0;
    if (capabilities.incremental) count++;
    if (capabilities.syntaxHighlighting) count++;
    if (capabilities.codeCompletion) count++;
    if (capabilities.diagnostics) count++;
    if (capabilities.formatting) count++;
    if (capabilities.refactoring) count++;
    return count;
  }
}

/**
 * Create a plugin registry instance
 */
export function createPluginRegistry(cacheManager?: CacheManager): PluginRegistry {
  return new PluginRegistry(cacheManager);
}