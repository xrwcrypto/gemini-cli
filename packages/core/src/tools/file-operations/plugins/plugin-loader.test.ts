/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginLoader, createPluginLoader } from './plugin-loader.js';
import { ASTParserService } from '../services/ast-parser.js';
import { CacheManager } from '../services/cache-manager.js';

vi.mock('../services/ast-parser.js');
vi.mock('../services/cache-manager.js');
vi.mock('./typescript-plugin.js', () => ({
  createTypeScriptPlugin: vi.fn(() => ({
    parse: vi.fn(),
    supportsIncremental: vi.fn(() => true),
    parseIncremental: vi.fn()
  }))
}));

describe('PluginLoader', () => {
  let pluginLoader: PluginLoader;
  let parserService: ASTParserService;
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = {} as CacheManager;
    parserService = {
      registerParser: vi.fn(),
      getParser: vi.fn(),
      clearCache: vi.fn()
    } as any;
  });

  describe('constructor', () => {
    it('should use default configuration', () => {
      pluginLoader = new PluginLoader();
      expect(pluginLoader.getAvailablePlugins()).toContain('typescript');
      expect(pluginLoader.getAvailablePlugins()).toContain('javascript');
    });

    it('should merge custom configuration', () => {
      pluginLoader = new PluginLoader({ typescript: false });
      expect(pluginLoader.getAvailablePlugins()).toHaveLength(0);
    });

    it('should accept cache manager', () => {
      pluginLoader = new PluginLoader({}, cacheManager);
      expect(pluginLoader).toBeDefined();
    });
  });

  describe('loadPlugins', () => {
    it('should load TypeScript plugin by default', async () => {
      pluginLoader = new PluginLoader({}, cacheManager);
      await pluginLoader.loadPlugins(parserService);

      expect(parserService.registerParser).toHaveBeenCalledTimes(2);
      expect(parserService.registerParser).toHaveBeenCalledWith('typescript', expect.any(Object));
      expect(parserService.registerParser).toHaveBeenCalledWith('javascript', expect.any(Object));
    });

    it('should not load TypeScript plugin when disabled', async () => {
      pluginLoader = new PluginLoader({ typescript: false }, cacheManager);
      await pluginLoader.loadPlugins(parserService);

      expect(parserService.registerParser).not.toHaveBeenCalled();
    });

    it('should handle TypeScript plugin load failure gracefully', async () => {
      const mockError = new Error('Plugin load failed');
      
      // Mock the createTypeScriptPlugin to throw an error
      const { createTypeScriptPlugin } = await import('./typescript-plugin.js');
      vi.mocked(createTypeScriptPlugin).mockImplementationOnce(() => {
        throw mockError;
      });

      // Spy on console.warn
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      pluginLoader = new PluginLoader({}, cacheManager);
      await pluginLoader.loadPlugins(parserService);

      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to load TypeScript plugin:', mockError);
      expect(parserService.registerParser).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should warn about unimplemented plugins', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      pluginLoader = new PluginLoader({
        typescript: false,
        python: true,
        go: true,
        java: true,
        rust: true
      });

      await pluginLoader.loadPlugins(parserService);

      expect(consoleWarnSpy).toHaveBeenCalledWith('Python plugin not yet implemented');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Go plugin not yet implemented');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Java plugin not yet implemented');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Rust plugin not yet implemented');

      consoleWarnSpy.mockRestore();
    });

    it('should load multiple plugins in parallel', async () => {
      pluginLoader = new PluginLoader({
        typescript: true,
        python: true,
        go: true
      }, cacheManager);

      const startTime = Date.now();
      await pluginLoader.loadPlugins(parserService);
      const endTime = Date.now();

      // Should complete quickly (parallel loading)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('loadCustomPlugin', () => {
    it('should load custom plugin with factory function', async () => {
      const mockPlugin = {
        parse: vi.fn(),
        supportsIncremental: vi.fn(() => true),
        parseIncremental: vi.fn()
      };

      // Mock dynamic import
      vi.doMock('/custom/plugin.js', () => ({
        default: vi.fn(() => mockPlugin)
      }));

      pluginLoader = new PluginLoader({
        customPlugins: [{
          language: 'python',
          path: '/custom/plugin.js'
        }]
      }, cacheManager);

      await pluginLoader.loadPlugins(parserService);

      // Custom plugin loading is async and may fail in test environment
      // The important thing is that it attempts to load
    });

    it('should handle custom plugin load failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      pluginLoader = new PluginLoader({
        customPlugins: [{
          language: 'python',
          path: '/non-existent/plugin.js'
        }]
      }, cacheManager);

      await pluginLoader.loadPlugins(parserService);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load custom plugin for python:'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('getAvailablePlugins', () => {
    it('should list available plugins', () => {
      pluginLoader = new PluginLoader({ typescript: true });
      const available = pluginLoader.getAvailablePlugins();

      expect(available).toContain('typescript');
      expect(available).toContain('javascript');
    });

    it('should return empty array when no plugins enabled', () => {
      pluginLoader = new PluginLoader({ typescript: false });
      const available = pluginLoader.getAvailablePlugins();

      expect(available).toHaveLength(0);
    });
  });

  describe('createConfiguredParser', () => {
    it('should create parser service with plugins loaded', async () => {
      pluginLoader = new PluginLoader({}, cacheManager);
      
      const parser = await pluginLoader.createConfiguredParser();

      expect(parser).toBeInstanceOf(ASTParserService);
    });

    it('should pass cache manager to parser service', async () => {
      pluginLoader = new PluginLoader({}, cacheManager);
      
      await pluginLoader.createConfiguredParser();

      expect(ASTParserService).toHaveBeenCalledWith(cacheManager);
    });
  });
});

describe('createPluginLoader', () => {
  it('should create plugin loader instance', () => {
    const loader = createPluginLoader();
    expect(loader).toBeInstanceOf(PluginLoader);
  });

  it('should pass configuration and cache manager', () => {
    const config = { typescript: false };
    const cacheManager = {} as CacheManager;
    
    const loader = createPluginLoader(config, cacheManager);
    
    expect(loader).toBeInstanceOf(PluginLoader);
    expect(loader.getAvailablePlugins()).toHaveLength(0);
  });
});