/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseBuilder } from './response-builder.js';
import {
  FileOperationResponse,
  AnalyzeResult,
  EditResult,
  CreateResult,
  DeleteResult,
  ValidateResult,
  ExtractedData,
  OperationError,
} from './file-operations-types.js';
import { FileDiff } from '../tools.js';

describe('ResponseBuilder', () => {
  let builder: ResponseBuilder;
  const rootDirectory = '/test/root';

  beforeEach(() => {
    builder = new ResponseBuilder(rootDirectory);
  });

  describe('trackFileChange', () => {
    it('should track file changes', () => {
      builder.trackFileChange({
        path: '/test/root/file.ts',
        type: 'created',
        newContent: 'new content',
      });

      builder.trackFileChange({
        path: '/test/root/other.ts',
        type: 'modified',
        oldContent: 'old',
        newContent: 'new',
      });

      // Verify changes are tracked (will be used in buildToolResult)
      const response: FileOperationResponse = {
        success: true,
        results: [],
        summary: {
          totalOperations: 2,
          successful: 2,
          failed: 0,
          duration: 100,
          filesAffected: ['/test/root/file.ts', '/test/root/other.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const llmContent = JSON.parse(result.llmContent as string);
      
      expect(llmContent.fileChanges).toHaveLength(2);
      expect(llmContent.fileChanges).toContainEqual({
        path: 'file.ts',
        type: 'created',
      });
      expect(llmContent.fileChanges).toContainEqual({
        path: 'other.ts',
        type: 'modified',
      });
    });
  });

  describe('addError', () => {
    it('should track errors', () => {
      const error: OperationError = {
        operationId: 'op1',
        message: 'Test error',
        code: 'TEST_ERROR',
      };
      
      builder.addError(error);

      const response: FileOperationResponse = {
        success: false,
        results: [],
        summary: {
          totalOperations: 1,
          successful: 0,
          failed: 1,
          duration: 50,
          filesAffected: [],
        },
        errors: [error],
      };

      const result = builder.buildToolResult(response);
      const llmContent = JSON.parse(result.llmContent as string);
      
      expect(llmContent.errors).toHaveLength(1);
      expect(llmContent.errors[0]).toEqual({
        operationId: 'op1',
        message: 'Test error',
        code: 'TEST_ERROR',
      });
    });
  });

  describe('buildToolResult', () => {
    it('should build minimal LLM content when returnFormat is minimal', () => {
      const response: FileOperationResponse = {
        success: true,
        results: [
          {
            operationId: 'op1',
            type: 'analyze',
            status: 'success',
            data: {
              filesAnalyzed: 5,
            } as AnalyzeResult,
          },
        ],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 200,
          filesAffected: [],
        },
      };

      const result = builder.buildToolResult(response, { returnFormat: 'minimal' });
      const llmContent = JSON.parse(result.llmContent as string);
      
      expect(llmContent.success).toBe(true);
      expect(llmContent.summary).toBeDefined();
      expect(llmContent.results).toBeUndefined();
    });

    it('should build structured LLM content by default', () => {
      const analyzeResult: AnalyzeResult = {
        filesAnalyzed: 3,
        matches: [
          {
            file: '/test/root/src/index.ts',
            line: 10,
            column: 5,
            match: 'console.log',
          },
        ],
      };

      const response: FileOperationResponse = {
        success: true,
        results: [
          {
            operationId: 'analyze1',
            type: 'analyze',
            status: 'success',
            data: analyzeResult,
            duration: 150,
          },
        ],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 150,
          filesAffected: ['/test/root/src/index.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const llmContent = JSON.parse(result.llmContent as string);
      
      expect(llmContent.results).toHaveLength(1);
      expect(llmContent.results[0].summary).toEqual({
        filesAnalyzed: 3,
        matchesFound: 1,
        extractedFiles: 0,
      });
      expect(llmContent.results[0].data).toBeUndefined();
    });

    it('should include raw data when returnFormat is raw', () => {
      const editResult: EditResult = {
        filesEdited: 2,
        changes: {
          '/test/root/file1.ts': 3,
          '/test/root/file2.ts': 1,
        },
      };

      const response: FileOperationResponse = {
        success: true,
        results: [
          {
            operationId: 'edit1',
            type: 'edit',
            status: 'success',
            data: editResult,
          },
        ],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 100,
          filesAffected: ['/test/root/file1.ts', '/test/root/file2.ts'],
        },
      };

      const result = builder.buildToolResult(response, { returnFormat: 'raw' });
      const llmContent = JSON.parse(result.llmContent as string);
      
      expect(llmContent.results[0].data).toEqual(editResult);
    });
  });

  describe('buildReturnDisplay', () => {
    it('should return FileDiff for single file modification', () => {
      builder.trackFileChange({
        path: '/test/root/file.ts',
        type: 'modified',
        oldContent: 'const a = 1;',
        newContent: 'const a = 2;',
      });

      const response: FileOperationResponse = {
        success: true,
        results: [],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 50,
          filesAffected: ['/test/root/file.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const display = result.returnDisplay as FileDiff;
      
      expect(display.fileDiff).toBeDefined();
      expect(display.fileName).toBe('file.ts');
      expect(display.fileDiff).toContain('const a = 1;');
      expect(display.fileDiff).toContain('const a = 2;');
    });

    it('should return combined FileDiff for multiple file modifications', () => {
      builder.trackFileChange({
        path: '/test/root/file1.ts',
        type: 'modified',
        oldContent: 'old1',
        newContent: 'new1',
      });

      builder.trackFileChange({
        path: '/test/root/file2.ts',
        type: 'created',
        newContent: 'new2',
      });

      const response: FileOperationResponse = {
        success: true,
        results: [],
        summary: {
          totalOperations: 2,
          successful: 2,
          failed: 0,
          duration: 100,
          filesAffected: ['/test/root/file1.ts', '/test/root/file2.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const display = result.returnDisplay as FileDiff;
      
      expect(display.fileName).toBe('2 files modified');
      expect(display.fileDiff).toContain('file1.ts');
      expect(display.fileDiff).toContain('file2.ts');
    });

    it('should return markdown summary when no file changes', () => {
      const response: FileOperationResponse = {
        success: true,
        results: [
          {
            operationId: 'validate1',
            type: 'validate',
            status: 'success',
            data: {
              valid: true,
              checks: {
                syntax: { passed: true, issueCount: 0 },
                lint: { passed: false, issueCount: 3 },
              },
            } as ValidateResult,
          },
        ],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 200,
          filesAffected: [],
        },
      };

      const result = builder.buildToolResult(response);
      const display = result.returnDisplay as string;
      
      expect(display).toContain('# File Operations Summary');
      expect(display).toContain('**Status:** ✅ Success');
      expect(display).toContain('## Operation Results');
      expect(display).toContain('### ✓ validate (validate1)');
      expect(display).toContain('- Validation: Passed');
      expect(display).toContain('✓ syntax: 0 issues');
      expect(display).toContain('✗ lint: 3 issues');
    });

    it('should return markdown for many file changes', () => {
      // Add 6 file changes (more than the 5 file limit for diffs)
      for (let i = 1; i <= 6; i++) {
        builder.trackFileChange({
          path: `/test/root/file${i}.ts`,
          type: 'modified',
          oldContent: `old${i}`,
          newContent: `new${i}`,
        });
      }

      const response: FileOperationResponse = {
        success: true,
        results: [],
        summary: {
          totalOperations: 6,
          successful: 6,
          failed: 0,
          duration: 300,
          filesAffected: Array.from({ length: 6 }, (_, i) => `/test/root/file${i + 1}.ts`),
        },
      };

      const result = builder.buildToolResult(response);
      const display = result.returnDisplay as string;
      
      expect(typeof display).toBe('string');
      expect(display).toContain('## File Changes');
      expect(display).toContain('### Modified Files');
      expect(display).toContain('file1.ts');
      expect(display).toContain('file6.ts');
    });
  });

  describe('operation summaries', () => {
    it('should format analyze operation summary correctly', () => {
      const extracted: ExtractedData = {
        functions: [
          {
            name: 'testFunc',
            async: false,
            generator: false,
            params: ['a', 'b'],
            line: 10,
            endLine: 15,
          },
        ],
        imports: [
          {
            source: './utils',
            symbols: ['helper'],
            line: 1,
          },
        ],
      };

      const response: FileOperationResponse = {
        success: true,
        results: [
          {
            operationId: 'analyze1',
            type: 'analyze',
            status: 'success',
            data: {
              filesAnalyzed: 2,
              extracted: {
                '/test/root/file1.ts': extracted,
              },
              matches: [
                {
                  file: '/test/root/file1.ts',
                  line: 5,
                  column: 10,
                  match: 'TODO: implement',
                },
              ],
            } as AnalyzeResult,
          },
        ],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 100,
          filesAffected: ['/test/root/file1.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const display = result.returnDisplay as string;
      
      expect(display).toContain('Files analyzed: 2');
      expect(display).toContain('Matches found: 1');
      expect(display).toContain('file1.ts:5:10 - TODO: implement');
      expect(display).toContain('Extracted data from 1 files');
    });

    it('should format create operation summary correctly', () => {
      const response: FileOperationResponse = {
        success: true,
        results: [
          {
            operationId: 'create1',
            type: 'create',
            status: 'success',
            data: {
              filesCreated: 2,
              created: ['/test/root/new1.ts', '/test/root/new2.ts'],
              alreadyExisted: ['/test/root/existing.ts'],
            } as CreateResult,
          },
        ],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 50,
          filesAffected: ['/test/root/new1.ts', '/test/root/new2.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const display = result.returnDisplay as string;
      
      expect(display).toContain('Files created: 2');
      expect(display).toContain('Already existed: 1');
    });

    it('should format delete operation summary correctly', () => {
      const response: FileOperationResponse = {
        success: true,
        results: [
          {
            operationId: 'delete1',
            type: 'delete',
            status: 'success',
            data: {
              filesDeleted: 3,
              deleted: ['/test/root/old1.ts', '/test/root/old2.ts', '/test/root/old3.ts'],
              notFound: ['/test/root/missing.ts'],
              directoriesRemoved: ['/test/root/empty-dir'],
            } as DeleteResult,
          },
        ],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 75,
          filesAffected: ['/test/root/old1.ts', '/test/root/old2.ts', '/test/root/old3.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const display = result.returnDisplay as string;
      
      expect(display).toContain('Files deleted: 3');
      expect(display).toContain('Not found: 1');
      expect(display).toContain('Directories removed: 1');
    });
  });

  describe('error handling', () => {
    it('should format errors in both LLM content and display', () => {
      const errors: OperationError[] = [
        {
          operationId: 'op1',
          message: 'File not found',
          code: 'ENOENT',
        },
        {
          operationId: 'op2',
          message: 'Permission denied',
          code: 'EACCES',
          details: { path: '/protected/file' },
        },
      ];

      const response: FileOperationResponse = {
        success: false,
        results: [
          {
            operationId: 'op1',
            type: 'edit',
            status: 'failed',
            error: errors[0],
          },
          {
            operationId: 'op2',
            type: 'delete',
            status: 'failed',
            error: errors[1],
          },
        ],
        summary: {
          totalOperations: 2,
          successful: 0,
          failed: 2,
          duration: 100,
          filesAffected: [],
        },
        errors,
      };

      const result = builder.buildToolResult(response);
      const llmContent = JSON.parse(result.llmContent as string);
      const display = result.returnDisplay as string;
      
      // Check LLM content
      expect(llmContent.success).toBe(false);
      expect(llmContent.errors).toHaveLength(2);
      expect(llmContent.errors[0].code).toBe('ENOENT');
      expect(llmContent.errors[1].code).toBe('EACCES');
      
      // Check display
      expect(display).toContain('**Status:** ❌ Failed');
      expect(display).toContain('## Errors');
      expect(display).toContain('File not found');
      expect(display).toContain('Permission denied');
      expect(display).toContain('**Code:** ENOENT');
      expect(display).toContain('**Code:** EACCES');
    });
  });

  describe('progress tracking', () => {
    it('should record and display progress messages', () => {
      builder.recordProgress('Starting operation...');
      builder.recordProgress('Processing file 1 of 3');
      builder.recordProgress('Processing file 2 of 3');
      builder.recordProgress('Processing file 3 of 3');
      builder.recordProgress('Operation complete');

      const response: FileOperationResponse = {
        success: true,
        results: [],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 200,
          filesAffected: [],
        },
      };

      const result = builder.buildToolResult(response, { returnFormat: 'raw' });
      const display = result.returnDisplay as string;
      
      expect(display).toContain('## Progress Log');
      expect(display).toContain('Starting operation...');
      expect(display).toContain('Operation complete');
    });

    it('should create progress callback with streaming updates', () => {
      let lastOutput = '';
      const updateOutput = (output: string) => {
        lastOutput = output;
      };

      const callback = builder.createProgressCallback(updateOutput);
      
      callback('Processing file 1...');
      expect(lastOutput).toContain('## File Operations Progress');
      expect(lastOutput).toContain('Processing file 1...');

      builder.trackFileChange({
        path: '/test/root/file1.ts',
        type: 'modified',
        oldContent: 'old',
        newContent: 'new',
      });

      callback('Processing file 2...');
      expect(lastOutput).toContain('Processing file 2...');
      expect(lastOutput).toContain('### Files Modified');
      expect(lastOutput).toContain('modified: file1.ts');
    });
  });

  describe('clear', () => {
    it('should clear all tracked state', () => {
      // Add some state
      builder.trackFileChange({
        path: '/test/root/file.ts',
        type: 'created',
        newContent: 'content',
      });
      builder.addError({
        operationId: 'op1',
        message: 'error',
      });
      builder.recordProgress('progress');

      // Clear
      builder.clear();

      // Verify state is cleared
      const response: FileOperationResponse = {
        success: true,
        results: [],
        summary: {
          totalOperations: 0,
          successful: 0,
          failed: 0,
          duration: 0,
          filesAffected: [],
        },
      };

      const result = builder.buildToolResult(response);
      const llmContent = JSON.parse(result.llmContent as string);
      
      expect(llmContent.fileChanges).toBeUndefined();
      expect(llmContent.errors).toBeUndefined();
      
      const display = result.returnDisplay as string;
      expect(display).not.toContain('## File Changes');
      expect(display).not.toContain('## Progress Log');
    });
  });

  describe('file path handling', () => {
    it('should use relative paths in output', () => {
      builder.trackFileChange({
        path: '/test/root/deeply/nested/file.ts',
        type: 'created',
        newContent: 'content',
      });

      const response: FileOperationResponse = {
        success: true,
        results: [],
        summary: {
          totalOperations: 1,
          successful: 1,
          failed: 0,
          duration: 50,
          filesAffected: ['/test/root/deeply/nested/file.ts'],
        },
      };

      const result = builder.buildToolResult(response);
      const llmContent = JSON.parse(result.llmContent as string);
      
      expect(llmContent.fileChanges[0].path).toBe('deeply/nested/file.ts');
      
      // When there's a single file change, it returns a FileDiff
      const display = result.returnDisplay as FileDiff;
      expect(display.fileName).toBe('deeply/nested/file.ts');
      expect(display.fileDiff).toContain('deeply/nested/file.ts');
      expect(display.fileDiff).not.toContain('/test/root/');
    });
  });
});