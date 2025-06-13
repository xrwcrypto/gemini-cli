/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecureRequestParser } from './secure-request-parser.js';
import { FileOperationRequest } from '../file-operations-types.js';
import { ValidationError } from '../file-operations-errors.js';

// Mock the parent RequestParser
vi.mock('../request-parser.js', () => {
  return {
    RequestParser: class {
      constructor(public rootDirectory: string) {}
      
      async parseRequest(params: unknown): Promise<any> {
        // Simple mock validation
        if (!params || typeof params !== 'object') {
          throw new ValidationError('Invalid request');
        }
        return params;
      }
    }
  };
});

describe('SecureRequestParser', () => {
  let parser: SecureRequestParser;
  const rootDir = '/test/root';

  beforeEach(() => {
    parser = new SecureRequestParser(rootDir, {
      operationRateLimit: 10,
      maxMemoryUsage: 100 * 1024 * 1024, // 100MB
      sandboxTimeout: 5000,
    });
  });

  afterEach(async () => {
    await parser.cleanup();
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['test.js'],
          },
        ],
      };

      // Exhaust rate limit
      for (let i = 0; i < 10; i++) {
        await parser.parseRequest(request, 'user1');
      }

      // Next request should fail
      await expect(parser.parseRequest(request, 'user1')).rejects.toThrow('Rate limit exceeded');
    });

    it('should track rate limits per user', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['test.js'],
          },
        ],
      };

      // User 1 exhausts limit
      for (let i = 0; i < 10; i++) {
        await parser.parseRequest(request, 'user1');
      }

      // User 2 should still work
      await expect(parser.parseRequest(request, 'user2')).resolves.toBeDefined();
    });
  });

  describe('Memory Limits', () => {
    it('should enforce memory limits', async () => {
      const largeContent = 'x'.repeat(50 * 1024 * 1024); // 50MB
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              { path: 'file1.txt', content: largeContent },
              { path: 'file2.txt', content: largeContent },
              { path: 'file3.txt', content: largeContent }, // Total > 100MB
            ],
          },
        ],
      };

      await expect(parser.parseRequest(request, 'user1')).rejects.toThrow('Memory limit exceeded');
    });

    it('should estimate memory usage correctly', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['file1.js', 'file2.js'], // Should estimate ~20KB
          },
          {
            type: 'edit',
            edits: [
              {
                file: 'test.js',
                changes: [{ type: 'line', line: 1, content: 'new line' }],
              },
            ], // Should estimate ~5KB
          },
          {
            type: 'create',
            files: [
              { path: 'new.txt', content: 'test'.repeat(1000) }, // 4KB
            ],
          },
          {
            type: 'validate',
            files: ['validate.js'], // Should estimate ~20KB
          },
        ],
      };

      // Should not exceed limit
      await expect(parser.parseRequest(request, 'user1')).resolves.toBeDefined();
    });
  });

  describe('Path Security', () => {
    it('should reject path traversal in analyze operations', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['../../etc/passwd'],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid file path');
    });

    it('should reject dangerous paths in edit operations', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'edit',
            edits: [
              {
                file: '/dev/null',
                changes: [{ type: 'line', line: 1, content: 'test' }],
              },
            ],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid file path');
    });

    it('should reject null bytes in paths', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [{ path: 'file\0.txt', content: 'test' }],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid file path');
    });

    it('should prevent deletion of critical files', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'delete',
            paths: ['package.json'],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow('Cannot delete critical file');
    });

    it('should prevent executable file creation', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [{ path: 'script.sh', content: '#!/bin/bash', mode: '755' }],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow('Executable permissions not allowed');
    });
  });

  describe('Input Sanitization', () => {
    it('should sanitize regex patterns', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['test.js'],
            analyses: [
              {
                type: 'pattern',
                options: { pattern: 'test\0pattern' },
              },
            ],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      const analysis = result.operations[0] as any;
      expect(analysis.analyses[0].options.pattern).toBe('testpattern');
    });

    it('should sanitize code in edits', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'edit',
            edits: [
              {
                file: 'test.js',
                changes: [
                  {
                    type: 'findReplace',
                    pattern: 'old',
                    replacement: '<script>alert("xss")</script>new',
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      const edit = result.operations[0] as any;
      expect(edit.edits[0].changes[0].replacement).toBe('new');
    });

    it('should sanitize AST queries', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['test.js'],
            analyses: [
              {
                type: 'ast',
                options: { query: 'javascript:alert("xss")' },
              },
            ],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      const analysis = result.operations[0] as any;
      expect(analysis.analyses[0].options.query).toBe('alert("xss")');
    });
  });

  describe('Custom Validator Security', () => {
    it('should reject dangerous validator code', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'validate',
            files: ['test.js'],
            validators: [
              {
                type: 'custom',
                options: {
                  validator: `
                    function(content, path) {
                      require('child_process').exec('rm -rf /');
                      return [];
                    }
                  `,
                },
              },
            ],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow('dangerous pattern');
    });

    it('should validate custom validator returns array', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'validate',
            files: ['test.js'],
            validators: [
              {
                type: 'custom',
                options: {
                  validator: `
                    function(content, path) {
                      return 'not an array';
                    }
                  `,
                },
              },
            ],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow('Validator must return an array');
    });

    it('should accept safe validator code', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'validate',
            files: ['test.js'],
            validators: [
              {
                type: 'custom',
                options: {
                  validator: `
                    function(content, path) {
                      const errors = [];
                      if (content.includes('TODO')) {
                        errors.push({
                          line: 1,
                          column: 1,
                          message: 'Found TODO',
                          severity: 'warning'
                        });
                      }
                      return errors;
                    }
                  `,
                },
              },
            ],
          },
        ],
      };

      await expect(parser.parseRequest(request)).resolves.toBeDefined();
    });
  });

  describe('Audit Logging', () => {
    it('should log allowed operations', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'op1',
            type: 'analyze',
            files: ['test.js'],
          },
        ],
      };

      await parser.parseRequest(request, 'user1');

      const logs = parser.getSecurityService().getAuditLog();
      expect(logs).toHaveLength(1);
      expect(logs[0].operationId).toBe('op1');
      expect(logs[0].result).toBe('allowed');
      expect(logs[0].userId).toBe('user1');
    });

    it('should log denied operations', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'op1',
            type: 'analyze',
            files: ['../../etc/passwd'],
          },
        ],
      };

      try {
        await parser.parseRequest(request, 'user1');
      } catch (e) {
        // Expected
      }

      const logs = parser.getSecurityService().getAuditLog();
      expect(logs).toHaveLength(1);
      expect(logs[0].operationId).toBe('op1');
      expect(logs[0].result).toBe('denied');
      expect(logs[0].reason).toContain('Invalid file path');
    });
  });

  describe('Security Integration', () => {
    it('should handle complex multi-operation request', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'analyze1',
            type: 'analyze',
            files: ['src/**/*.js'],
            analyses: [
              { type: 'pattern', options: { pattern: 'console\\.log' } },
              { type: 'ast', options: { query: 'function' } },
            ],
          },
          {
            id: 'edit1',
            type: 'edit',
            dependsOn: ['analyze1'],
            edits: [
              {
                file: 'src/test.js',
                changes: [
                  { type: 'line', line: 1, content: '// Updated' },
                  { type: 'findReplace', pattern: 'old', replacement: 'new' },
                ],
              },
            ],
          },
          {
            id: 'create1',
            type: 'create',
            files: [
              { path: 'src/new.js', content: 'export const x = 1;' },
              { path: 'src/new.test.js', content: 'test("x", () => {});' },
            ],
          },
          {
            id: 'validate1',
            type: 'validate',
            dependsOn: ['edit1', 'create1'],
            files: ['src/**/*.js'],
            validators: [
              { type: 'syntax' },
              { type: 'imports' },
            ],
          },
        ],
      };

      const result = await parser.parseRequest(request, 'user1');
      expect(result.operations).toHaveLength(4);
      
      // Check that all operations were logged
      const logs = parser.getSecurityService().getAuditLog();
      expect(logs).toHaveLength(4);
      expect(logs.every(log => log.result === 'allowed')).toBe(true);
    });

    it('should generate security report', async () => {
      // Perform some operations
      const validRequest: FileOperationRequest = {
        operations: [{ type: 'analyze', files: ['test.js'] }],
      };

      const invalidRequest: FileOperationRequest = {
        operations: [{ type: 'analyze', files: ['../../etc/passwd'] }],
      };

      await parser.parseRequest(validRequest, 'user1');
      
      try {
        await parser.parseRequest(invalidRequest, 'user2');
      } catch (e) {
        // Expected
      }

      const report = parser.getSecurityService().generateSecurityReport();
      expect(report.summary.totalOperations).toBe(2);
      expect(report.summary.allowedOperations).toBe(1);
      expect(report.summary.deniedOperations).toBe(1);
    });
  });
});