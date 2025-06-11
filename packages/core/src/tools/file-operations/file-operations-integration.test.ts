/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createToolRegistry, ConfigParameters } from '../../config/config.js';
import { Config } from '../../config/config.js';
import { FileOperationsTool } from './file-operations.js';
import { AnalyzeOperation, EditOperation } from './file-operations-types.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, existsSync } from 'fs';

describe('FileOperationsTool Integration', () => {
  let tempDir: string;
  let config: Config;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = mkdtempSync(join(tmpdir(), 'file-operations-integration-'));
    
    // Create a test config
    const configParams: ConfigParameters = {
      contentGeneratorConfig: {
        apiKey: 'test-key',
        model: 'gemini-pro',
      },
      embeddingModel: 'text-embedding-001',
      targetDir: tempDir,
      debugMode: false,
      sandbox: false,
      coreTools: undefined, // Use all tools
    };
    config = new Config(configParams);
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Tool Registration', () => {
    it('should register FileOperationsTool in the tool registry', async () => {
      const registry = await createToolRegistry(config);
      
      // Check that FileOperationsTool is registered
      const tool = registry.getTool(FileOperationsTool.Name);
      expect(tool).toBeDefined();
      expect(tool).toBeInstanceOf(FileOperationsTool);
    });

    it('should have correct tool name and description', async () => {
      const registry = await createToolRegistry(config);
      const tool = registry.getTool(FileOperationsTool.Name);
      
      expect(tool?.name).toBe('file_operations');
      expect(tool?.displayName).toBe('FileOperations');
      expect(tool?.description).toContain('Batch file operations');
    });

    it('should respect coreTools configuration', async () => {
      // Create config with limited tools
      const limitedConfigParams: ConfigParameters = {
        contentGeneratorConfig: {
          apiKey: 'test-key',
          model: 'gemini-pro',
        },
        embeddingModel: 'text-embedding-001',
        targetDir: tempDir,
        debugMode: false,
        sandbox: false,
        coreTools: ['ReadFileTool', 'WriteFileTool'], // Exclude FileOperationsTool
      };
      const limitedConfig = new Config(limitedConfigParams);
      
      const registry = await createToolRegistry(limitedConfig);
      
      // FileOperationsTool should not be registered
      const tool = registry.getTool(FileOperationsTool.Name);
      expect(tool).toBeUndefined();
    });

    it('should include FileOperationsTool when explicitly listed in coreTools', async () => {
      // Create config with FileOperationsTool explicitly included
      const explicitConfigParams: ConfigParameters = {
        contentGeneratorConfig: {
          apiKey: 'test-key',
          model: 'gemini-pro',
        },
        embeddingModel: 'text-embedding-001',
        targetDir: tempDir,
        debugMode: false,
        sandbox: false,
        coreTools: ['FileOperationsTool', 'file_operations'], // Both class name and tool name
      };
      const explicitConfig = new Config(explicitConfigParams);
      
      const registry = await createToolRegistry(explicitConfig);
      
      // FileOperationsTool should be registered
      const tool = registry.getTool(FileOperationsTool.Name);
      expect(tool).toBeDefined();
      expect(tool).toBeInstanceOf(FileOperationsTool);
    });
  });

  describe('Tool Functionality', () => {
    it('should validate parameters correctly', async () => {
      const registry = await createToolRegistry(config);
      const tool = registry.getTool(FileOperationsTool.Name) as FileOperationsTool;
      
      // Test invalid params
      const invalidParams = {
        operations: []
      };
      
      const error = tool.validateToolParams(invalidParams);
      expect(error).toBe('At least one operation must be specified');
      
      // Test valid params
      const validParams = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation
        ]
      };
      
      const validError = tool.validateToolParams(validParams);
      expect(validError).toBeNull();
    });

    it('should integrate with approval workflow', async () => {
      const registry = await createToolRegistry(config);
      const tool = registry.getTool(FileOperationsTool.Name) as FileOperationsTool;
      const abortSignal = new AbortController().signal;
      
      // Test read-only operation - no confirmation needed
      const readOnlyParams = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation
        ]
      };
      
      const readOnlyConfirm = await tool.shouldConfirmExecute(readOnlyParams, abortSignal);
      expect(readOnlyConfirm).toBe(false);
      
      // Test modifying operation - confirmation needed
      const modifyingParams = {
        operations: [
          { 
            type: 'edit', 
            edits: [{
              file: 'test.ts',
              changes: [{ type: 'find-replace', find: 'old', replace: 'new' }]
            }]
          } as EditOperation
        ]
      };
      
      const modifyingConfirm = await tool.shouldConfirmExecute(modifyingParams, abortSignal);
      expect(modifyingConfirm).not.toBe(false);
      expect(modifyingConfirm).toHaveProperty('type', 'exec');
      expect(modifyingConfirm).toHaveProperty('title');
      expect(modifyingConfirm).toHaveProperty('command');
    });
  });
});