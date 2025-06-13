/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ASTParserService, SupportedLanguage, LanguageParser } from '../services/ast-parser.js';
import { createTypeScriptPlugin } from './typescript-plugin.js';
import { createEnhancedTypeScriptPlugin } from './typescript-enhanced-plugin.js';
import { createPythonPlugin } from './python-plugin.js';
import { CacheManager } from '../services/cache-manager.js';

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** Enable TypeScript plugin */
  typescript?: boolean;
  /** Enable enhanced TypeScript plugin (includes all features of regular plugin) */
  typescriptEnhanced?: boolean;
  /** Enable future plugins */
  python?: boolean;
  go?: boolean;
  java?: boolean;
  rust?: boolean;
  /** Custom plugin paths */
  customPlugins?: Array<{
    language: SupportedLanguage;
    path: string;
  }>;
}

/**
 * Default plugin configuration
 */
const DEFAULT_CONFIG: PluginConfig = {
  typescript: true,
  typescriptEnhanced: false, // Regular TypeScript plugin by default
  python: true, // Enable Python plugin by default
  go: false,
  java: false,
  rust: false,
  customPlugins: []
};

/**
 * Plugin loader for AST parser service
 */
export class PluginLoader {
  private config: PluginConfig;
  private cacheManager?: CacheManager;

  constructor(config: Partial<PluginConfig> = {}, cacheManager?: CacheManager) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cacheManager = cacheManager;
  }

  /**
   * Load and register all configured plugins
   */
  async loadPlugins(parserService: ASTParserService): Promise<void> {
    const loadPromises: Promise<void>[] = [];

    // Load TypeScript plugin (enhanced takes precedence over regular)
    if (this.config.typescriptEnhanced) {
      loadPromises.push(this.loadEnhancedTypeScriptPlugin(parserService));
    } else if (this.config.typescript) {
      loadPromises.push(this.loadTypeScriptPlugin(parserService));
    }

    // Load other plugins when implemented
    if (this.config.python) {
      loadPromises.push(this.loadPythonPlugin(parserService));
    }

    if (this.config.go) {
      loadPromises.push(this.loadGoPlugin(parserService));
    }

    if (this.config.java) {
      loadPromises.push(this.loadJavaPlugin(parserService));
    }

    if (this.config.rust) {
      loadPromises.push(this.loadRustPlugin(parserService));
    }

    // Load custom plugins
    if (this.config.customPlugins && this.config.customPlugins.length > 0) {
      for (const customPlugin of this.config.customPlugins) {
        loadPromises.push(this.loadCustomPlugin(parserService, customPlugin));
      }
    }

    await Promise.all(loadPromises);
  }

  /**
   * Load TypeScript plugin
   */
  private async loadTypeScriptPlugin(parserService: ASTParserService): Promise<void> {
    try {
      const plugin = createTypeScriptPlugin(this.cacheManager);
      parserService.registerParser('typescript', plugin);
      parserService.registerParser('javascript', plugin);
    } catch (error) {
      console.warn('Failed to load TypeScript plugin:', error);
    }
  }

  /**
   * Load enhanced TypeScript plugin
   */
  private async loadEnhancedTypeScriptPlugin(parserService: ASTParserService): Promise<void> {
    try {
      const plugin = createEnhancedTypeScriptPlugin(this.cacheManager);
      parserService.registerParser('typescript', plugin);
      parserService.registerParser('javascript', plugin);
    } catch (error) {
      console.warn('Failed to load enhanced TypeScript plugin, falling back to regular plugin:', error);
      // Fallback to regular TypeScript plugin
      await this.loadTypeScriptPlugin(parserService);
    }
  }

  /**
   * Load Python plugin
   */
  private async loadPythonPlugin(parserService: ASTParserService): Promise<void> {
    try {
      const plugin = createPythonPlugin(this.cacheManager);
      parserService.registerParser('python', plugin);
    } catch (error) {
      console.warn('Failed to load Python plugin:', error);
    }
  }

  /**
   * Load Go plugin (placeholder for future implementation)
   */
  private async loadGoPlugin(parserService: ASTParserService): Promise<void> {
    // TODO: Implement Go plugin using tree-sitter or similar
    console.warn('Go plugin not yet implemented');
  }

  /**
   * Load Java plugin (placeholder for future implementation)
   */
  private async loadJavaPlugin(parserService: ASTParserService): Promise<void> {
    // TODO: Implement Java plugin using tree-sitter or similar
    console.warn('Java plugin not yet implemented');
  }

  /**
   * Load Rust plugin (placeholder for future implementation)
   */
  private async loadRustPlugin(parserService: ASTParserService): Promise<void> {
    // TODO: Implement Rust plugin using tree-sitter or similar
    console.warn('Rust plugin not yet implemented');
  }

  /**
   * Load custom plugin from path
   */
  private async loadCustomPlugin(
    parserService: ASTParserService,
    config: { language: SupportedLanguage; path: string }
  ): Promise<void> {
    try {
      // Dynamic import of custom plugin
      const module = await import(config.path);
      
      if (module.default && typeof module.default === 'function') {
        // Plugin exports a factory function
        const plugin = module.default(this.cacheManager);
        parserService.registerParser(config.language, plugin);
      } else if (module.createPlugin && typeof module.createPlugin === 'function') {
        // Plugin exports a createPlugin function
        const plugin = module.createPlugin(this.cacheManager);
        parserService.registerParser(config.language, plugin);
      } else if (module.default && this.isLanguageParser(module.default)) {
        // Plugin exports a parser instance directly
        parserService.registerParser(config.language, module.default);
      } else {
        throw new Error('Invalid plugin format');
      }
    } catch (error) {
      console.error(`Failed to load custom plugin for ${config.language}:`, error);
    }
  }

  /**
   * Check if an object implements LanguageParser interface
   */
  private isLanguageParser(obj: any): obj is LanguageParser {
    return (
      obj &&
      typeof obj.parse === 'function' &&
      typeof obj.supportsIncremental === 'function' &&
      typeof obj.parseIncremental === 'function'
    );
  }

  /**
   * Get list of available plugins
   */
  getAvailablePlugins(): string[] {
    const available: string[] = [];
    
    if (this.config.typescriptEnhanced || this.config.typescript) {
      available.push('typescript', 'javascript');
    }
    
    if (this.config.python) {
      available.push('python');
    }
    
    // Add other plugins when implemented
    
    return available;
  }

  /**
   * Create a pre-configured AST parser service with plugins
   */
  async createConfiguredParser(): Promise<ASTParserService> {
    const parserService = new ASTParserService(this.cacheManager);
    await this.loadPlugins(parserService);
    return parserService;
  }
}

/**
 * Create a plugin loader with default configuration
 */
export function createPluginLoader(
  config?: Partial<PluginConfig>,
  cacheManager?: CacheManager
): PluginLoader {
  return new PluginLoader(config, cacheManager);
}