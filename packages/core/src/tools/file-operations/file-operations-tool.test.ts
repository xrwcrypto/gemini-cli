/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FileOperationsTool } from './file-operations.js';
import { Config, ApprovalMode } from '../../config/config.js';
import { FileOperationRequest } from './file-operations-types.js';

// Mock telemetry
vi.mock('../../telemetry/metrics.js', () => ({
  recordToolCallMetrics: vi.fn(),
}));

describe('FileOperationsTool Integration Tests', () => {
  let tempDir: string;
  let tool: FileOperationsTool;
  let config: Config;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-ops-test-'));
    
    // Create mock config
    config = {
      getApprovalMode: () => ApprovalMode.YOLO,
    } as Config;
    
    // Create tool instance
    tool = new FileOperationsTool(config, tempDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Basic Operations', () => {
    it('should execute a simple create operation', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              {
                path: 'test.txt',
                content: 'Hello, World!',
              },
            ],
          },
        ],
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      expect(result.llmContent).toBeTruthy();
      expect(result.returnDisplay).toBeTruthy();

      // Verify file was created
      const filePath = path.join(tempDir, 'test.txt');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Hello, World!');
    });

    it('should execute analyze operation', async () => {
      // Create a test file
      const filePath = path.join(tempDir, 'analyze.js');
      await fs.writeFile(filePath, `
        function hello() {
          console.log('Hello, World!');
        }
        
        const message = 'Test message';
        hello();
      `);

      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            paths: ['analyze.js'],
            extract: ['functions', 'variables'],
          },
        ],
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      const response = JSON.parse(result.llmContent);
      expect(response.success).toBe(true);
      expect(response.summary.successful).toBe(1);
      expect(response.results[0].status).toBe('success');
    });

    it('should execute edit operation', async () => {
      // Create a test file
      const filePath = path.join(tempDir, 'edit.txt');
      await fs.writeFile(filePath, 'Original content');

      const request: FileOperationRequest = {
        operations: [
          {
            type: 'edit',
            edits: [
              {
                file: 'edit.txt',
                changes: [
                  {
                    type: 'find-replace',
                    find: 'Original',
                    replace: 'Modified',
                  },
                ],
              },
            ],
          },
        ],
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      // Verify file was edited
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Modified content');
    });

    it('should execute delete operation', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'delete1.txt'), 'Content 1');
      await fs.writeFile(path.join(tempDir, 'delete2.txt'), 'Content 2');

      const request: FileOperationRequest = {
        operations: [
          {
            type: 'delete',
            paths: ['delete*.txt'],
          },
        ],
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      // Verify files were deleted
      const files = await fs.readdir(tempDir);
      expect(files).not.toContain('delete1.txt');
      expect(files).not.toContain('delete2.txt');
    });
  });

  describe('Multiple Operations', () => {
    it('should execute multiple operations in sequence', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            id: 'create-op',
            files: [
              {
                path: 'multi.txt',
                content: 'Initial content',
              },
            ],
          },
          {
            type: 'edit',
            id: 'edit-op',
            dependsOn: ['create-op'],
            edits: [
              {
                file: 'multi.txt',
                changes: [
                  {
                    type: 'find-replace',
                    find: 'Initial',
                    replace: 'Updated',
                  },
                ],
              },
            ],
          },
          {
            type: 'analyze',
            id: 'analyze-op',
            dependsOn: ['edit-op'],
            paths: ['multi.txt'],
          },
        ],
        options: {
          parallel: false,
        },
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      const response = JSON.parse(result.llmContent);
      expect(response.success).toBe(true);
      expect(response.summary.successful).toBe(3);

      // Verify final content
      const content = await fs.readFile(path.join(tempDir, 'multi.txt'), 'utf-8');
      expect(content).toBe('Updated content');
    });

    it('should execute independent operations in parallel', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              {
                path: 'parallel1.txt',
                content: 'File 1',
              },
            ],
          },
          {
            type: 'create',
            files: [
              {
                path: 'parallel2.txt',
                content: 'File 2',
              },
            ],
          },
          {
            type: 'create',
            files: [
              {
                path: 'parallel3.txt',
                content: 'File 3',
              },
            ],
          },
        ],
        options: {
          parallel: true,
        },
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      const response = JSON.parse(result.llmContent);
      expect(response.success).toBe(true);
      expect(response.summary.successful).toBe(3);

      // Verify all files were created
      const files = await fs.readdir(tempDir);
      expect(files).toContain('parallel1.txt');
      expect(files).toContain('parallel2.txt');
      expect(files).toContain('parallel3.txt');
    });
  });

  describe('Error Handling', () => {
    it('should handle operation failures gracefully', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'edit',
            edits: [
              {
                file: 'non-existent.txt',
                changes: [
                  {
                    type: 'find-replace',
                    find: 'something',
                    replace: 'else',
                  },
                ],
              },
            ],
          },
        ],
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      const response = JSON.parse(result.llmContent);
      expect(response.success).toBe(false);
      expect(response.summary.failed).toBe(1);
      expect(response.results[0].status).toBe('failed');
    });

    it('should stop on error in transaction mode', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              {
                path: 'trans1.txt',
                content: 'File 1',
              },
            ],
          },
          {
            type: 'edit',
            edits: [
              {
                file: 'non-existent.txt',
                changes: [
                  {
                    type: 'find-replace',
                    find: 'something',
                    replace: 'else',
                  },
                ],
              },
            ],
          },
          {
            type: 'create',
            files: [
              {
                path: 'trans3.txt',
                content: 'File 3',
              },
            ],
          },
        ],
        options: {
          transaction: true,
          parallel: false,
        },
      };

      const abortController = new AbortController();
      const result = await tool.execute(request, abortController.signal);

      const response = JSON.parse(result.llmContent);
      expect(response.success).toBe(false);
      expect(response.summary.successful).toBe(1);
      expect(response.summary.failed).toBe(1);
      
      // Verify only first operation succeeded
      const files = await fs.readdir(tempDir);
      expect(files).toContain('trans1.txt');
      expect(files).not.toContain('trans3.txt');
    });
  });

  describe('Abort Handling', () => {
    it('should handle abort signal', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              {
                path: 'abort1.txt',
                content: 'File 1',
              },
            ],
          },
          {
            type: 'create',
            files: [
              {
                path: 'abort2.txt',
                content: 'File 2',
              },
            ],
          },
        ],
      };

      const abortController = new AbortController();
      
      // Abort immediately
      abortController.abort();

      const result = await tool.execute(request, abortController.signal);

      const response = JSON.parse(result.llmContent);
      // Should have at least one cancelled operation
      expect(response.results.some((r: any) => r.status === 'cancelled')).toBe(true);
    });
  });

  describe('Progress Updates', () => {
    it('should provide progress updates', async () => {
      const progressUpdates: string[] = [];

      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              {
                path: 'progress.txt',
                content: 'Progress test',
              },
            ],
          },
        ],
      };

      const abortController = new AbortController();
      const result = await tool.execute(
        request,
        abortController.signal,
        (update) => progressUpdates.push(update)
      );

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some(u => u.includes('Parsing and validating'))).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should validate request parameters', () => {
      const invalidRequest = {
        operations: [], // Empty operations
      } as FileOperationRequest;

      const error = tool.validateToolParams(invalidRequest);
      expect(error).toBeTruthy();
      expect(error).toContain('At least one operation must be specified');
    });

    it('should validate file paths', () => {
      const invalidRequest: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              {
                path: '../../../etc/passwd', // Path traversal attempt
                content: 'evil',
              },
            ],
          },
        ],
      };

      const error = tool.validateToolParams(invalidRequest);
      expect(error).toBeTruthy();
      expect(error).toContain('outside root directory');
    });
  });

  describe('Confirmation', () => {
    it('should not require confirmation in YOLO mode', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'delete',
            paths: ['*.txt'],
          },
        ],
      };

      const abortController = new AbortController();
      const confirmation = await tool.shouldConfirmExecute(request, abortController.signal);
      
      expect(confirmation).toBe(false);
    });

    it('should require confirmation for modifying operations in normal mode', async () => {
      // Override config to return normal mode
      config.getApprovalMode = () => ApprovalMode.NORMAL;

      const request: FileOperationRequest = {
        operations: [
          {
            type: 'delete',
            paths: ['*.txt'],
          },
        ],
      };

      const abortController = new AbortController();
      const confirmation = await tool.shouldConfirmExecute(request, abortController.signal);
      
      expect(confirmation).not.toBe(false);
      if (confirmation !== false) {
        expect(confirmation.type).toBe('exec');
        expect(confirmation.title).toContain('FileOperations');
      }
    });
  });
});