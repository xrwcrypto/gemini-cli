/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Export TypeScript plugin
export { TypeScriptPlugin, createTypeScriptPlugin } from './typescript-plugin.js';

// Export enhanced TypeScript plugin
export { 
  TypeScriptEnhancedPlugin, 
  createEnhancedTypeScriptPlugin,
  type EnhancedTypeInfo,
  type EnhancedParseResult
} from './typescript-enhanced-plugin.js';

// Export Python plugin
export { PythonPlugin, createPythonPlugin } from './python-plugin.js';

// Export Go plugin
export { GoPlugin, createGoPlugin, type GoParseResult } from './go-plugin.js';

// Export plugin loader
export { PluginLoader, createPluginLoader, PluginConfig } from './plugin-loader.js';

// Export base plugin and new plugin system
export {
  BaseLanguagePlugin,
  type PluginMetadata,
  type PluginCapabilities,
  type PluginConfiguration,
  type PluginValidationResult,
  type EnhancedLanguageParser
} from './base-plugin.js';

// Export plugin registry
export {
  PluginRegistry as EnhancedPluginRegistry,
  createPluginRegistry as createEnhancedPluginRegistry,
  type PluginRegistration,
  type PluginDiscoveryResult
} from './plugin-registry.js';

// Export plugin validator
export {
  PluginValidator,
  createPluginValidator,
  type PluginValidationOptions,
  type DetailedValidationResult
} from './plugin-validator.js';

// Export language detection
export {
  LanguageDetector,
  createLanguageDetector,
  type LanguageDetectionResult,
  type LanguageDetectionOptions
} from './language-detection.js';

// Export plugin registry interface (legacy)
export interface PluginRegistry {
  register(language: string, plugin: any): void;
  get(language: string): any | undefined;
  has(language: string): boolean;
  list(): string[];
}

/**
 * Create a simple plugin registry (legacy interface)
 */
export function createSimplePluginRegistry(): PluginRegistry {
  const plugins = new Map<string, any>();

  return {
    register(language: string, plugin: any): void {
      plugins.set(language, plugin);
    },

    get(language: string): any | undefined {
      return plugins.get(language);
    },

    has(language: string): boolean {
      return plugins.has(language);
    },

    list(): string[] {
      return Array.from(plugins.keys());
    }
  };
}