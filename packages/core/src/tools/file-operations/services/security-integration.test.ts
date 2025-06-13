/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecureExecutionEngine } from './secure-execution-engine.js';
import { FileOperationRequest } from '../file-operations-types.js';
import * as path from 'path';
import { vol } from 'memfs';

// Mock fs module
vi.mock('fs', () => ({
  default: vol,
  ...vol,
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: vol.promises,
  ...vol.promises,
}));

describe('Security Integration Tests', () => {
  let engine: SecureExecutionEngine;
  const rootDir = '/test/workspace';

  beforeEach(() => {
    vol.reset();
    
    // Create test directory structure
    vol.mkdirSync(rootDir, { recursive: true });
    vol.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    vol.mkdirSync(path.join(rootDir, 'test'), { recursive: true });
    vol.mkdirSync(path.join(rootDir, '.git'), { recursive: true });
    
    // Create test files
    vol.writeFileSync(path.join(rootDir, 'src/index.js'), 'console.log("hello");');
    vol.writeFileSync(path.join(rootDir, 'src/utils.js'), 'export const add = (a, b) => a + b;');
    vol.writeFileSync(path.join(rootDir, 'test/test.js'), 'test("add", () => {});');
    vol.writeFileSync(path.join(rootDir, 'package.json'), '{"name": "test"}');
    vol.writeFileSync(path.join(rootDir, '.env'), 'SECRET=123');

    engine = new SecureExecutionEngine(rootDir, {
      operationRateLimit: 10,
      maxMemoryUsage: 50 * 1024 * 1024,
      enableAuditLogging: true,
      blockedDirectories: ['.git'],
      blockedExtensions: ['.exe', '.sh'],
    });
  });

  afterEach(async () => {
    await engine.cleanup();
    vol.reset();
  });

  describe('Path Traversal Prevention', () => {
    it('should prevent parent directory traversal', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['../../../etc/passwd'],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('Invalid file path');
    });

    it('should prevent absolute path access outside root', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'edit',
            edits: [{
              file: '/etc/hosts',
              changes: [{ type: 'line', line: 1, content: 'malicious' }],
            }],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('Invalid file path');
    });

    it('should prevent access to blocked directories', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['.git/config'],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('blocked directory');
    });

    it('should allow valid paths within root', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['src/index.js'],
          },
        ],
      };

      const response = await engine.execute(request);
      expect(response.success).toBe(true);
      expect(response.results).toHaveLength(1);
    });
  });

  describe('Input Injection Prevention', () => {
    it('should sanitize script tags in content', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [{
              path: 'src/new.js',
              content: '<script>alert("xss")</script>const x = 1;',
            }],
          },
        ],
      };

      const response = await engine.execute(request);
      expect(response.success).toBe(true);
      
      const content = vol.readFileSync(path.join(rootDir, 'src/new.js'), 'utf8');
      expect(content).toBe('const x = 1;');
    });

    it('should sanitize regex patterns', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'analyze',
            files: ['src/index.js'],
            analyses: [{
              type: 'pattern',
              options: { pattern: 'console\0.log' },
            }],
          },
        ],
      };

      const response = await engine.execute(request);
      expect(response.success).toBe(true);
      // Pattern should be sanitized to 'console.log'
    });

    it('should prevent command injection in validators', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'validate',
            files: ['src/index.js'],
            validators: [{
              type: 'custom',
              options: {
                validator: `
                  function(content, path) {
                    const cp = require('child_process');
                    cp.exec('rm -rf /');
                    return [];
                  }
                `,
              },
            }],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('dangerous pattern');
    });
  });

  describe('Sandbox Execution', () => {
    it('should execute safe custom validators in sandbox', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'validate',
            files: ['src/index.js'],
            validators: [{
              type: 'custom',
              options: {
                validator: `
                  function(content, path) {
                    const issues = [];
                    if (content.includes('console.log')) {
                      issues.push({
                        line: 1,
                        column: 1,
                        message: 'Found console.log',
                        severity: 'warning',
                      });
                    }
                    return issues;
                  }
                `,
              },
            }],
          },
        ],
      };

      const response = await engine.execute(request);
      expect(response.success).toBe(true);
      
      const result = response.results[0] as any;
      expect(result.validationResults).toBeDefined();
      expect(result.validationResults[0].issues).toHaveLength(1);
      expect(result.validationResults[0].issues[0].message).toBe('Found console.log');
    });

    it('should timeout long-running validators', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'validate',
            files: ['src/index.js'],
            validators: [{
              type: 'custom',
              options: {
                validator: `
                  function(content, path) {
                    while (true) {} // Infinite loop
                    return [];
                  }
                `,
              },
            }],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow();
    });

    it('should prevent validators from accessing file system', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'validate',
            files: ['src/index.js'],
            validators: [{
              type: 'custom',
              options: {
                validator: `
                  function(content, path) {
                    try {
                      const fs = sandbox.require('fs');
                      fs.readFileSync('/etc/passwd');
                    } catch (e) {
                      return [{
                        line: 1,
                        column: 1,
                        message: e.message,
                        severity: 'error',
                      }];
                    }
                    return [];
                  }
                `,
              },
            }],
          },
        ],
      };

      const response = await engine.execute(request);
      expect(response.success).toBe(true);
      
      const result = response.results[0] as any;
      expect(result.validationResults[0].issues[0].message).toContain('not allowed');
    });
  });

  describe('Resource Limits', () => {
    it('should enforce rate limits per user', async () => {
      const request: FileOperationRequest = {
        operations: [{ type: 'analyze', files: ['src/index.js'] }],
      };

      // Exhaust rate limit for user1
      for (let i = 0; i < 10; i++) {
        await engine.execute(request, { userId: 'user1' });
      }

      // Next request should fail
      await expect(
        engine.execute(request, { userId: 'user1' })
      ).rejects.toThrow('Rate limit exceeded');

      // Different user should still work
      const response = await engine.execute(request, { userId: 'user2' });
      expect(response.success).toBe(true);
    });

    it('should enforce memory limits', async () => {
      const largeContent = 'x'.repeat(20 * 1024 * 1024); // 20MB
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [
              { path: 'file1.txt', content: largeContent },
              { path: 'file2.txt', content: largeContent },
              { path: 'file3.txt', content: largeContent },
            ],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('Memory limit exceeded');
    });

    it('should prevent creation of blocked file types', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [{ path: 'script.exe', content: 'malicious' }],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('is blocked');
    });

    it('should prevent executable permissions', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            type: 'create',
            files: [{ path: 'script.js', content: '#!/usr/bin/node', mode: '755' }],
          },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('Executable permissions not allowed');
    });
  });

  describe('Audit Logging', () => {
    it('should log all operations with metadata', async () => {
      const request: FileOperationRequest = {
        operations: [
          { id: 'op1', type: 'analyze', files: ['src/index.js'] },
          { id: 'op2', type: 'create', files: [{ path: 'src/new.js', content: 'test' }] },
        ],
      };

      await engine.execute(request, { userId: 'testuser' });

      const logs = engine.getSecurityService().getAuditLog();
      
      // Should have logs for each operation plus batch complete
      expect(logs.length).toBeGreaterThanOrEqual(3);
      
      const op1Log = logs.find(l => l.operationId === 'op1');
      expect(op1Log).toBeDefined();
      expect(op1Log!.userId).toBe('testuser');
      expect(op1Log!.result).toBe('allowed');
      
      const batchLog = logs.find(l => l.operationId === 'batch_complete');
      expect(batchLog).toBeDefined();
      expect(batchLog!.action).toContain('Completed 2 operations');
    });

    it('should log security violations', async () => {
      const request: FileOperationRequest = {
        operations: [
          { id: 'bad_op', type: 'analyze', files: ['../../etc/passwd'] },
        ],
      };

      try {
        await engine.execute(request, { userId: 'attacker' });
      } catch (e) {
        // Expected
      }

      const logs = engine.getSecurityService().getAuditLog();
      
      const deniedLog = logs.find(l => l.operationId === 'bad_op');
      expect(deniedLog).toBeDefined();
      expect(deniedLog!.result).toBe('denied');
      expect(deniedLog!.reason).toContain('Invalid file path');
      expect(deniedLog!.userId).toBe('attacker');
    });

    it('should generate security reports', async () => {
      // Perform mixed operations
      const validRequest: FileOperationRequest = {
        operations: [{ type: 'analyze', files: ['src/index.js'] }],
      };
      
      const invalidRequest: FileOperationRequest = {
        operations: [{ type: 'delete', paths: ['package.json'] }],
      };

      await engine.execute(validRequest, { userId: 'user1' });
      
      try {
        await engine.execute(invalidRequest, { userId: 'user2' });
      } catch (e) {
        // Expected
      }

      const report = engine.generateSecurityReport();
      
      expect(report.summary.totalOperations).toBeGreaterThan(0);
      expect(report.summary.deniedOperations).toBeGreaterThan(0);
      expect(report.summary.uniqueUsers).toBe(2);
      
      expect(report.topDeniedReasons.length).toBeGreaterThan(0);
      expect(report.topDeniedReasons[0].reason).toContain('critical file');
    });

    it('should include security metadata in response', async () => {
      const request: FileOperationRequest = {
        operations: [{ type: 'analyze', files: ['src/index.js'] }],
      };

      const response = await engine.execute(request, { userId: 'user1' });
      
      expect(response.metadata?.security).toBeDefined();
      expect(response.metadata!.security.operationsAllowed).toBeGreaterThan(0);
      expect(response.metadata!.security.sessionId).toBeDefined();
    });
  });

  describe('Critical File Protection', () => {
    it('should prevent deletion of package.json', async () => {
      const request: FileOperationRequest = {
        operations: [
          { type: 'delete', paths: ['package.json'] },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('Cannot delete critical file');
    });

    it('should prevent deletion of .env files', async () => {
      const request: FileOperationRequest = {
        operations: [
          { type: 'delete', paths: ['.env'] },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('Cannot delete critical file');
    });

    it('should prevent deletion of .git directory', async () => {
      const request: FileOperationRequest = {
        operations: [
          { type: 'delete', paths: ['.git/*'] },
        ],
      };

      await expect(engine.execute(request)).rejects.toThrow('Cannot delete critical file');
    });
  });
});