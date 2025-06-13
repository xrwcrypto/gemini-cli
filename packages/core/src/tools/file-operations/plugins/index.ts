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

// Export plugin loader
export { PluginLoader, createPluginLoader, PluginConfig } from './plugin-loader.js';

// Export plugin registry interface
export interface PluginRegistry {
  register(language: string, plugin: any): void;
  get(language: string): any | undefined;
  has(language: string): boolean;
  list(): string[];
}

/**
 * Create a plugin registry
 */
export function createPluginRegistry(): PluginRegistry {
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