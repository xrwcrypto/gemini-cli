/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SandboxService } from './sandbox-service.js';
import { ValidationError } from '../file-operations-errors.js';

describe('SandboxService', () => {
  let service: SandboxService;

  beforeEach(() => {
    service = new SandboxService({
      timeout: 5000,
      memoryLimit: 50,
    });
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('Code Validation', () => {
    it('should reject code with child_process require', async () => {
      const code = `
        const cp = require('child_process');
        cp.exec('ls');
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('dangerous pattern');
    });

    it('should reject code with fs require', async () => {
      const code = `
        const fs = require('fs');
        fs.readFileSync('/etc/passwd');
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('dangerous pattern');
    });

    it('should reject code with eval', async () => {
      const code = `
        const evil = "console.log('hacked')";
        eval(evil);
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('dangerous pattern');
    });

    it('should reject code with Function constructor', async () => {
      const code = `
        const fn = new Function('return process.exit()');
        fn();
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('dangerous pattern');
    });

    it('should reject process.exit calls', async () => {
      const code = `
        process.exit(1);
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('dangerous pattern');
    });

    it('should reject network imports', async () => {
      const code = `
        import http from 'http';
        http.get('http://evil.com');
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('dangerous pattern');
    });
  });

  describe('Safe Code Execution', () => {
    it('should execute simple arithmetic', async () => {
      const code = `
        const a = 5;
        const b = 10;
        return a + b;
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toBe(15);
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should execute string manipulation', async () => {
      const code = `
        const str = 'hello';
        return str.toUpperCase() + ' WORLD';
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toBe('HELLO WORLD');
    });

    it('should execute array operations', async () => {
      const code = `
        const arr = [1, 2, 3, 4, 5];
        return arr.filter(n => n % 2 === 0).reduce((a, b) => a + b, 0);
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toBe(6);
    });

    it('should execute async code', async () => {
      const code = `
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'done';
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toBe('done');
      expect(result.executionTime).toBeGreaterThan(100);
    });

    it('should pass arguments to code', async () => {
      const code = `
        const [a, b] = args;
        return a * b;
      `;

      const result = await service.execute(code, [7, 8]);
      expect(result.success).toBe(true);
      expect(result.result).toBe(56);
    });
  });

  describe('Resource Limits', () => {
    it('should timeout long-running code', async () => {
      const code = `
        while (true) {
          // Infinite loop
        }
      `;

      const result = await service.execute(code, [], { timeout: 1000 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should limit memory usage', async () => {
      const code = `
        const arr = [];
        for (let i = 0; i < 10000000; i++) {
          arr.push(new Array(1000).fill(i));
        }
        return arr.length;
      `;

      const result = await service.execute(code, [], { memoryLimit: 10 });
      expect(result.success).toBe(false);
      // Worker might be terminated before proper error message
    });

    it('should track execution metrics', async () => {
      const code = `
        const arr = [];
        for (let i = 0; i < 1000; i++) {
          arr.push(i * i);
        }
        return arr.length;
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.memoryUsed).toBeGreaterThan(0);
      expect(result.cpuTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Module Access Control', () => {
    it('should allow safe built-in modules', async () => {
      const code = `
        const path = sandbox.require('path');
        return path.join('a', 'b', 'c');
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toBe('a/b/c');
    });

    it('should block dangerous modules', async () => {
      const code = `
        try {
          const fs = sandbox.require('fs');
          return 'should not reach here';
        } catch (error) {
          return error.message;
        }
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toContain('not allowed');
    });

    it('should block process global', async () => {
      const code = `
        return typeof process;
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
    });

    it('should block eval global', async () => {
      const code = `
        return typeof eval;
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
    });
  });

  describe('Console Output', () => {
    it('should capture console.log', async () => {
      const logs: unknown[] = [];
      service.on('sandbox-log', (data) => logs.push(data));

      const code = `
        sandbox.console.log('test', 123, { foo: 'bar' });
        return 'done';
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual(['test', 123, { foo: 'bar' }]);
    });

    it('should capture console.error', async () => {
      const logs: unknown[] = [];
      service.on('sandbox-log', (data) => logs.push(data));

      const code = `
        sandbox.console.error('error message');
        return 'done';
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(true);
      expect(logs).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should catch thrown errors', async () => {
      const code = `
        throw new Error('Custom error');
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Custom error');
    });

    it('should catch syntax errors', async () => {
      const code = `
        const x = {;
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle promise rejections', async () => {
      const code = `
        await Promise.reject(new Error('Async error'));
      `;

      const result = await service.execute(code);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Async error');
    });
  });

  describe('Language Sandboxes', () => {
    it('should execute JavaScript code', async () => {
      const code = `
        const sum = (a, b) => a + b;
        return sum(5, 3);
      `;

      const result = await service.createLanguageSandbox('javascript', code);
      expect(result.success).toBe(true);
      expect(result.result).toBe(8);
    });

    it('should handle basic TypeScript transpilation', async () => {
      const code = `
        const add = (a: number, b: number): number => {
          return a + b;
        }
        return add(5, 3);
      `;

      const result = await service.createLanguageSandbox('typescript', code);
      expect(result.success).toBe(true);
      expect(result.result).toBe(8);
    });

    it('should strip TypeScript interfaces', async () => {
      const code = `
        interface User {
          name: string;
          age: number;
        }
        const user = { name: 'John', age: 30 };
        return user.name;
      `;

      const result = await service.createLanguageSandbox('typescript', code);
      expect(result.success).toBe(true);
      expect(result.result).toBe('John');
    });

    it('should throw for unsupported languages', async () => {
      await expect(
        service.createLanguageSandbox('python', 'print("hello")')
      ).rejects.toThrow('Python sandbox not yet implemented');
    });
  });

  describe('Worker Management', () => {
    it('should terminate all workers on cleanup', async () => {
      // Start multiple executions
      const promises = [
        service.execute('return 1'),
        service.execute('return 2'),
        service.execute('return 3'),
      ];

      // Terminate all
      await service.terminateAll();

      // All should complete (either success or terminated)
      const results = await Promise.allSettled(promises);
      expect(results).toHaveLength(3);
    });

    it('should clean up temporary files', async () => {
      const code = 'return "test"';
      await service.execute(code);
      
      // Cleanup should not throw
      await expect(service.cleanup()).resolves.not.toThrow();
    });
  });
});