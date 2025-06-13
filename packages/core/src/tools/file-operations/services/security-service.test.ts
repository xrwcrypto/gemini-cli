/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { SecurityService, SecurityConfig } from './security-service.js';

const mkdir = promisify(fs.mkdir);
const rmdir = promisify(fs.rmdir);
const symlink = promisify(fs.symlink);
const unlink = promisify(fs.unlink);

describe('SecurityService', () => {
  let service: SecurityService;
  const rootDir = '/test/root';
  const tempDir = '/tmp/security-test';

  beforeEach(async () => {
    // Create temp directory for tests
    try {
      await mkdir(tempDir, { recursive: true });
    } catch (e) {
      // Ignore if exists
    }
    
    service = new SecurityService(rootDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rmdir(tempDir, { recursive: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  describe('Path Validation', () => {
    it('should reject null bytes in paths', async () => {
      const result = await service.validatePath('/test/file\0.txt', 'read');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('null byte');
    });

    it('should reject multiple parent directory traversals', async () => {
      const result = await service.validatePath('../../etc/passwd', 'read');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Dangerous path pattern');
    });

    it('should reject system paths', async () => {
      const paths = [
        '/dev/null',
        '/proc/cpuinfo',
        '/sys/kernel',
        '/etc/passwd',
        '~/.ssh/id_rsa',
        '~/.gnupg/private-keys',
      ];

      for (const p of paths) {
        const result = await service.validatePath(p, 'read');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Dangerous path pattern');
      }
    });

    it('should reject shell variable expansion', async () => {
      const paths = ['${HOME}/file.txt', '`whoami`.txt'];
      
      for (const p of paths) {
        const result = await service.validatePath(p, 'read');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Dangerous path pattern');
      }
    });

    it('should accept valid paths within root', async () => {
      const result = await service.validatePath('src/file.js', 'read');
      expect(result.isValid).toBe(true);
      expect(result.resolvedPath).toBe(path.join(rootDir, 'src/file.js'));
    });

    it('should accept glob patterns when allowed', async () => {
      const result = await service.validatePath('src/**/*.js', 'read', { allowGlob: true });
      expect(result.isValid).toBe(true);
    });

    it('should validate against blocked directories', async () => {
      const secureService = new SecurityService(rootDir, {
        blockedDirectories: ['/test/root/blocked', '/test/root/sensitive'],
      });

      const result = await secureService.validatePath('blocked/file.txt', 'read');
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('blocked directory');
    });

    it('should validate against allowed directories whitelist', async () => {
      const secureService = new SecurityService(rootDir, {
        allowedDirectories: ['/test/root/allowed'],
      });

      const validResult = await secureService.validatePath('allowed/file.txt', 'read');
      expect(validResult.isValid).toBe(true);

      const invalidResult = await secureService.validatePath('other/file.txt', 'read');
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.reason).toContain('not in allowed directories');
    });

    it('should check directory depth', async () => {
      const secureService = new SecurityService(rootDir, {
        maxDirectoryDepth: 3,
      });

      const validResult = await secureService.validatePath('a/b/c/file.txt', 'read');
      expect(validResult.isValid).toBe(true);

      const invalidResult = await secureService.validatePath('a/b/c/d/e/file.txt', 'read');
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.reason).toContain('exceeds maximum directory depth');
    });

    it('should validate file extensions', async () => {
      const secureService = new SecurityService(rootDir, {
        allowedExtensions: ['.js', '.ts', '.json'],
      });

      const validResult = await secureService.validatePath('file.js', 'read');
      expect(validResult.isValid).toBe(true);

      const invalidResult = await secureService.validatePath('file.exe', 'read');
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.reason).toContain('not allowed');
    });

    it('should block specific extensions', async () => {
      const secureService = new SecurityService(rootDir, {
        blockedExtensions: ['.exe', '.dll', '.so'],
      });

      const validResult = await secureService.validatePath('file.js', 'read');
      expect(validResult.isValid).toBe(true);

      const invalidResult = await secureService.validatePath('file.exe', 'read');
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.reason).toContain('is blocked');
    });

    // Note: Symbolic link tests would require actual file system operations
    // which are complex to mock properly
  });

  describe('Input Sanitization', () => {
    it('should sanitize path input', () => {
      const input = 'file\0.txt\x1F';
      const sanitized = service.sanitizeInput(input, 'path');
      expect(sanitized).toBe('file.txt');
    });

    it('should sanitize regex input', () => {
      const input = 'test\0pattern';
      const sanitized = service.sanitizeInput(input, 'regex');
      expect(sanitized).toBe('testpattern');
    });

    it('should sanitize code input', () => {
      const input = '<script>alert("xss")</script>function test() {}';
      const sanitized = service.sanitizeInput(input, 'code');
      expect(sanitized).toBe('function test() {}');
    });

    it('should remove javascript: protocol', () => {
      const input = 'javascript:alert("xss")';
      const sanitized = service.sanitizeInput(input, 'code');
      expect(sanitized).toBe('alert("xss")');
    });

    it('should remove event handlers', () => {
      const input = 'onclick="alert()" onload=evil()';
      const sanitized = service.sanitizeInput(input, 'code');
      expect(sanitized).toBe('');
    });
  });

  describe('Rate Limiting', () => {
    it('should allow operations within rate limit', () => {
      const limit = 5;
      const secureService = new SecurityService(rootDir, {
        operationRateLimit: limit,
      });

      for (let i = 0; i < limit; i++) {
        expect(secureService.checkRateLimit('user1')).toBe(true);
      }
    });

    it('should deny operations exceeding rate limit', () => {
      const limit = 5;
      const secureService = new SecurityService(rootDir, {
        operationRateLimit: limit,
      });

      for (let i = 0; i < limit; i++) {
        secureService.checkRateLimit('user1');
      }

      expect(secureService.checkRateLimit('user1')).toBe(false);
    });

    it('should track rate limits per user', () => {
      const limit = 2;
      const secureService = new SecurityService(rootDir, {
        operationRateLimit: limit,
      });

      // User 1 hits limit
      expect(secureService.checkRateLimit('user1')).toBe(true);
      expect(secureService.checkRateLimit('user1')).toBe(true);
      expect(secureService.checkRateLimit('user1')).toBe(false);

      // User 2 still has quota
      expect(secureService.checkRateLimit('user2')).toBe(true);
      expect(secureService.checkRateLimit('user2')).toBe(true);
      expect(secureService.checkRateLimit('user2')).toBe(false);
    });

    it('should reset rate limits after time window', async () => {
      vi.useFakeTimers();
      
      const limit = 2;
      const secureService = new SecurityService(rootDir, {
        operationRateLimit: limit,
      });

      // Hit the limit
      expect(secureService.checkRateLimit('user1')).toBe(true);
      expect(secureService.checkRateLimit('user1')).toBe(true);
      expect(secureService.checkRateLimit('user1')).toBe(false);

      // Advance time by more than a minute
      vi.advanceTimersByTime(61000);

      // Should be allowed again
      expect(secureService.checkRateLimit('user1')).toBe(true);
      
      vi.useRealTimers();
    });
  });

  describe('Memory Usage Tracking', () => {
    it('should allow operations within memory limit', () => {
      const limit = 1000;
      const secureService = new SecurityService(rootDir, {
        maxMemoryUsage: limit,
      });

      expect(secureService.checkMemoryUsage(500, 'user1')).toBe(true);
      expect(secureService.checkMemoryUsage(400, 'user1')).toBe(true);
    });

    it('should deny operations exceeding memory limit', () => {
      const limit = 1000;
      const secureService = new SecurityService(rootDir, {
        maxMemoryUsage: limit,
      });

      expect(secureService.checkMemoryUsage(600, 'user1')).toBe(true);
      expect(secureService.checkMemoryUsage(600, 'user1')).toBe(false);
    });

    it('should update memory usage after operation', () => {
      const limit = 1000;
      const secureService = new SecurityService(rootDir, {
        maxMemoryUsage: limit,
      });

      secureService.checkMemoryUsage(800, 'user1');
      secureService.updateMemoryUsage(800, 'user1');

      // Should allow new operation after freeing memory
      expect(secureService.checkMemoryUsage(500, 'user1')).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    it('should log security events', () => {
      const events: any[] = [];
      service.on('security-event', (event) => events.push(event));

      service.logOperation(
        { type: 'read', id: 'op1', files: ['test.js'] } as any,
        'allowed',
        undefined,
        'user1'
      );

      expect(events).toHaveLength(1);
      expect(events[0].operationId).toBe('op1');
      expect(events[0].result).toBe('allowed');
      expect(events[0].userId).toBe('user1');
    });

    it('should retrieve filtered audit logs', () => {
      // Log some operations
      service.logOperation(
        { type: 'read', id: 'op1', files: ['test.js'] } as any,
        'allowed',
        undefined,
        'user1'
      );

      service.logOperation(
        { type: 'write', id: 'op2', files: ['test.js'] } as any,
        'denied',
        'Permission denied',
        'user2'
      );

      service.logOperation(
        { type: 'delete', id: 'op3', files: ['test.js'] } as any,
        'allowed',
        undefined,
        'user1'
      );

      // Get all logs
      const allLogs = service.getAuditLog();
      expect(allLogs).toHaveLength(3);

      // Filter by user
      const user1Logs = service.getAuditLog({ userId: 'user1' });
      expect(user1Logs).toHaveLength(2);

      // Filter by result
      const deniedLogs = service.getAuditLog({ result: 'denied' });
      expect(deniedLogs).toHaveLength(1);
      expect(deniedLogs[0].reason).toBe('Permission denied');
    });

    it('should limit audit log size', () => {
      // Set a small limit for testing
      const secureService = new SecurityService(rootDir);
      
      // Log many operations
      for (let i = 0; i < 11000; i++) {
        secureService.logOperation(
          { type: 'read', id: `op${i}`, files: ['test.js'] } as any,
          'allowed'
        );
      }

      // Should have removed oldest entries
      const logs = secureService.getAuditLog();
      expect(logs.length).toBeLessThanOrEqual(10000);
    });
  });

  describe('Security Reports', () => {
    it('should generate comprehensive security report', () => {
      // Log various operations
      service.logOperation(
        { type: 'read', id: 'op1', files: ['test.js'] } as any,
        'allowed',
        undefined,
        'user1'
      );

      service.logOperation(
        { type: 'write', id: 'op2', files: ['test.js'] } as any,
        'denied',
        'Path outside root',
        'user2'
      );

      service.logOperation(
        { type: 'delete', id: 'op3', files: ['test.js'] } as any,
        'denied',
        'Path outside root',
        'user2'
      );

      service.logOperation(
        { type: 'analyze', id: 'op4', paths: ['test.js'] } as any,
        'error',
        'File not found',
        'user1'
      );

      const report = service.generateSecurityReport();

      expect(report.summary.totalOperations).toBe(4);
      expect(report.summary.allowedOperations).toBe(1);
      expect(report.summary.deniedOperations).toBe(2);
      expect(report.summary.errorOperations).toBe(1);
      expect(report.summary.uniqueUsers).toBe(2);

      expect(report.topDeniedReasons).toHaveLength(1);
      expect(report.topDeniedReasons[0].reason).toBe('Path outside root');
      expect(report.topDeniedReasons[0].count).toBe(2);

      expect(report.operationsByType).toMatchObject({
        read: 2,
        write: 1,
        delete: 1,
      });
    });

    it('should identify suspicious activity', () => {
      // Simulate many denied attempts from one user
      for (let i = 0; i < 10; i++) {
        service.logOperation(
          { type: 'read', id: `op${i}`, files: ['../../etc/passwd'] } as any,
          'denied',
          'Path traversal attempt',
          'suspicious_user'
        );
      }

      const report = service.generateSecurityReport();
      expect(report.suspiciousActivity.length).toBeGreaterThan(0);
      expect(report.suspiciousActivity[0].userId).toBe('suspicious_user');
    });
  });

  describe('Resource Management', () => {
    it('should clear resource usage for user', () => {
      service.checkRateLimit('user1');
      service.checkMemoryUsage(1000, 'user1');

      expect(service.getResourceUsage('user1')).toBeDefined();
      
      service.clearResourceUsage('user1');
      
      expect(service.getResourceUsage('user1')).toBeUndefined();
    });

    it('should get current resource usage', () => {
      service.checkRateLimit('user1');
      service.checkMemoryUsage(5000, 'user1');

      const usage = service.getResourceUsage('user1');
      expect(usage).toBeDefined();
      expect(usage!.operationCount).toBe(1);
      expect(usage!.memoryUsage).toBe(5000);
    });
  });
});