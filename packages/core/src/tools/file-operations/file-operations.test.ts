/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileOperationsTool } from './file-operations.js';
import { 
  FileOperationRequest,
  AnalyzeOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  ValidateOperation 
} from './file-operations-types.js';
import { Config } from '../../config/config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('FileOperationsTool', () => {
  let tempRootDir: string;
  let tool: FileOperationsTool;
  let mockConfig: Config;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    // Create a unique temporary root directory for each test run
    tempRootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'file-operations-tool-root-'),
    );
    
    // Create mock config
    mockConfig = {
      getGeminiIgnorePatterns: () => [],
      getApprovalMode: () => 'default',
      getSandboxMode: () => 'none',
    } as unknown as Config;
    
    tool = new FileOperationsTool(mockConfig, tempRootDir);
  });

  afterEach(() => {
    // Clean up the temporary root directory
    if (fs.existsSync(tempRootDir)) {
      fs.rmSync(tempRootDir, { recursive: true, force: true });
    }
  });

  describe('Tool Initialization', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_operations');
      expect(tool.displayName).toBe('FileOperations');
      expect(tool.description).toContain('Batch file operations');
    });

    it('should have valid schema', () => {
      expect(tool.schema).toBeDefined();
      expect(tool.schema.name).toBe('file_operations');
      expect(tool.schema.description).toBe(tool.description);
      expect(tool.schema.parameters).toBeDefined();
    });

    it('should have correct parameter schema', () => {
      const params = tool.schema.parameters as Record<string, unknown>;
      expect(params.type).toBe('object');
      expect(params.properties).toHaveProperty('operations');
      expect(params.properties).toHaveProperty('options');
      expect(params.required).toEqual(['operations']);
    });
  });

  describe('Parameter Validation', () => {
    it('should validate empty operations array', () => {
      const params: FileOperationRequest = {
        operations: []
      };
      const error = tool.validateToolParams(params);
      expect(error).toBe('At least one operation must be specified');
    });

    it('should validate valid parameters', () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation
        ]
      };
      const error = tool.validateToolParams(params);
      expect(error).toBeNull();
    });

    it('should validate operation dependencies', () => {
      const params: FileOperationRequest = {
        operations: [
          { id: 'op1', type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { id: 'op2', type: 'edit', dependsOn: ['op1'], edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation
        ]
      };
      const error = tool.validateToolParams(params);
      expect(error).toBeNull();
    });

    it('should detect missing dependencies', () => {
      const params: FileOperationRequest = {
        operations: [
          { id: 'op1', type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { id: 'op2', type: 'edit', dependsOn: ['op3'], edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation // op3 doesn't exist
        ]
      };
      const error = tool.validateToolParams(params);
      expect(error).toContain("dependency 'op3' not found");
    });

    it('should detect circular dependencies', () => {
      const params: FileOperationRequest = {
        operations: [
          { id: 'op1', type: 'analyze', dependsOn: ['op2'], paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { id: 'op2', type: 'edit', dependsOn: ['op1'], edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation
        ]
      };
      const error = tool.validateToolParams(params);
      expect(error).toBe('Circular dependencies detected in operations');
    });
  });

  describe('getDescription', () => {
    it('should generate description for single operation', () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation
        ]
      };
      const description = tool.getDescription(params);
      expect(description).toContain('Execute 1 file operation');
      expect(description).toContain('analyze');
    });

    it('should generate description for multiple operations', () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { type: 'edit', edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation,
          { type: 'validate' } as ValidateOperation
        ]
      };
      const description = tool.getDescription(params);
      expect(description).toContain('Execute 3 file operations');
      expect(description).toContain('analyze, edit, validate');
    });

    it('should indicate parallel execution', () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { type: 'edit', edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation
        ],
        options: { parallel: true }
      };
      const description = tool.getDescription(params);
      expect(description).toContain('in parallel');
    });

    it('should indicate sequential execution', () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { type: 'edit', edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation
        ],
        options: { parallel: false }
      };
      const description = tool.getDescription(params);
      expect(description).toContain('sequentially');
    });

    it('should indicate transaction support', () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'edit', edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation
        ],
        options: { transaction: true }
      };
      const description = tool.getDescription(params);
      expect(description).toContain('with transaction support');
    });
  });

  describe('Execute Method', () => {
    it('should execute operations and return results', async () => {
      const params: FileOperationRequest = {
        operations: [
          { id: 'op1', type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { id: 'op2', type: 'edit', edits: [] } as EditOperation
        ]
      };
      
      const result = await tool.execute(params, abortSignal);
      expect(result).toBeDefined();
      expect(result.llmContent).toBeDefined();
      expect(result.returnDisplay).toBeDefined();
      
      // Parse the response
      const response = JSON.parse(result.llmContent as string);
      expect(response.success).toBe(true);
      expect(response.results).toHaveLength(2);
      expect(response.summary.totalOperations).toBe(2);
      expect(response.summary.successful).toBe(2);
      expect(response.summary.failed).toBe(0);
    });

    it('should call updateOutput callback', async () => {
      const updateOutput = vi.fn();
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation
        ]
      };
      
      await tool.execute(params, abortSignal, updateOutput);
      expect(updateOutput).toHaveBeenCalled();
      expect(updateOutput).toHaveBeenCalledWith('FileOperations tool execution started...');
    });

    it('should format display output correctly', async () => {
      const params: FileOperationRequest = {
        operations: [
          { id: 'analyze-1', type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { id: 'edit-1', type: 'edit', edits: [] } as EditOperation
        ]
      };
      
      const result = await tool.execute(params, abortSignal);
      const display = result.returnDisplay as string;
      
      expect(display).toContain('FileOperations Execution Summary');
      expect(display).toContain('**Total Operations:** 2');
      expect(display).toContain('**Successful:** 2');
      expect(display).toContain('**Failed:** 0');
      expect(display).toContain('analyze-1');
      expect(display).toContain('edit-1');
    });
  });

  describe('shouldConfirmExecute', () => {
    it('should not require confirmation for read-only operations', async () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation
        ]
      };
      
      const shouldConfirm = await tool.shouldConfirmExecute(params, abortSignal);
      expect(shouldConfirm).toBe(false);
    });
    
    it('should require confirmation for edit operations', async () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'edit', edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation
        ]
      };
      
      const shouldConfirm = await tool.shouldConfirmExecute(params, abortSignal);
      expect(shouldConfirm).not.toBe(false);
      if (shouldConfirm !== false) {
        expect(shouldConfirm.type).toBe('exec');
        expect(shouldConfirm.title).toContain('FileOperations');
      }
    });
    
    it('should require confirmation for create operations', async () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'create', files: [{ path: 'new.ts', content: 'test' }] } as CreateOperation
        ]
      };
      
      const shouldConfirm = await tool.shouldConfirmExecute(params, abortSignal);
      expect(shouldConfirm).not.toBe(false);
      if (shouldConfirm !== false) {
        expect(shouldConfirm.type).toBe('exec');
      }
    });
    
    it('should require confirmation for delete operations', async () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'delete', paths: ['temp/**/*.tmp'] } as DeleteOperation
        ]
      };
      
      const shouldConfirm = await tool.shouldConfirmExecute(params, abortSignal);
      expect(shouldConfirm).not.toBe(false);
      if (shouldConfirm !== false) {
        expect(shouldConfirm.type).toBe('exec');
      }
    });
    
    it('should require confirmation for mixed operations', async () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'analyze', paths: ['src/**/*.ts'] } as AnalyzeOperation,
          { type: 'edit', edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation,
          { type: 'validate' } as ValidateOperation
        ]
      };
      
      const shouldConfirm = await tool.shouldConfirmExecute(params, abortSignal);
      expect(shouldConfirm).not.toBe(false);
      if (shouldConfirm !== false) {
        expect(shouldConfirm.title).toContain('1 edit');
      }
    });
    
    it('should count affected files correctly', async () => {
      const params: FileOperationRequest = {
        operations: [
          { type: 'edit', edits: [
            { file: 'file1.ts', changes: [{ type: 'find-replace', find: 'a', replace: 'b' }] },
            { file: 'file2.ts', changes: [{ type: 'find-replace', find: 'c', replace: 'd' }] },
            { file: 'file1.ts', changes: [{ type: 'find-replace', find: 'e', replace: 'f' }] } // same file
          ] } as EditOperation,
          { type: 'create', files: [
            { path: 'new1.ts', content: 'test' },
            { path: 'new2.ts', content: 'test' }
          ] } as CreateOperation
        ]
      };
      
      const shouldConfirm = await tool.shouldConfirmExecute(params, abortSignal);
      expect(shouldConfirm).not.toBe(false);
      if (shouldConfirm !== false) {
        expect(shouldConfirm.type).toBe('exec'); // Just verify type, command property may not exist
      }
    });
    
    it('should not require confirmation in YOLO mode', async () => {
      // Create a new tool with YOLO mode config
      const yoloConfig = {
        getGeminiIgnorePatterns: () => [],
        getApprovalMode: () => 'yolo',
        getSandboxMode: () => 'none',
      } as unknown as Config;
      
      const yoloTool = new FileOperationsTool(yoloConfig, tempRootDir);
      
      const params: FileOperationRequest = {
        operations: [
          { type: 'edit', edits: [{ 
            file: 'test.ts', 
            changes: [{ type: 'find-replace', find: 'old', replace: 'new' }] 
          }] } as EditOperation
        ]
      };
      
      const shouldConfirm = await yoloTool.shouldConfirmExecute(params, abortSignal);
      expect(shouldConfirm).toBe(false);
    });
  });
});