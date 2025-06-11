/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { TransactionManager, TransactionEvent } from './transaction-manager.js';
import { FileSystemService } from './file-system-service.js';
import { Operation } from '../file-operations-types.js';
import { OperationResult } from './parallel-execution-engine.js';

// Create a mock file system in memory
class MockFileSystem {
  private files: Map<string, { content: string; stats: { mode: number; size: number; mtime: Date } }> = new Map();
  private directories: Set<string> = new Set();

  reset() {
    this.files.clear();
    this.directories.clear();
  }

  writeFile(path: string, content: string) {
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      this.directories.add(dir);
    }
    this.files.set(path, {
      content,
      stats: {
        mode: 0o644,
        size: content.length,
        mtime: new Date()
      }
    });
  }

  readFile(path: string) {
    const file = this.files.get(path);
    if (!file) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
    }
    return file.content;
  }

  stat(path: string) {
    const file = this.files.get(path);
    if (!file) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: 'ENOENT' });
    }
    return file.stats;
  }

  unlink(path: string) {
    if (!this.files.has(path)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, unlink '${path}'`), { code: 'ENOENT' });
    }
    this.files.delete(path);
  }

  mkdir(path: string) {
    this.directories.add(path);
  }

  exists(path: string) {
    return this.files.has(path) || this.directories.has(path);
  }

  chmod(path: string, mode: number) {
    const file = this.files.get(path);
    if (file) {
      file.stats.mode = mode;
    }
  }
}

const mockFileSystem = new MockFileSystem();

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {},
  stat: vi.fn((path) => Promise.resolve(mockFileSystem.stat(path))),
  readFile: vi.fn((path) => Promise.resolve(mockFileSystem.readFile(path))),
  writeFile: vi.fn((path, content) => {
    mockFileSystem.writeFile(path, content);
    return Promise.resolve();
  }),
  unlink: vi.fn((path) => {
    mockFileSystem.unlink(path);
    return Promise.resolve();
  }),
  mkdir: vi.fn((path, _options) => {
    mockFileSystem.mkdir(path);
    return Promise.resolve();
  }),
  rm: vi.fn(() => Promise.resolve()),
  chmod: vi.fn((path, mode) => {
    mockFileSystem.chmod(path, mode);
    return Promise.resolve();
  }),
  utimes: vi.fn(() => Promise.resolve())
}));

describe('TransactionManager', () => {
  let transactionManager: TransactionManager;
  let fileService: FileSystemService;
  let testDir: string;

  beforeEach(() => {
    // Reset mock file system
    mockFileSystem.reset();
    testDir = '/test';
    mockFileSystem.mkdir(testDir);

    // Create file service
    fileService = new FileSystemService('/');
    
    // Create transaction manager
    transactionManager = new TransactionManager(fileService, {
      snapshotDirectory: path.join(testDir, 'snapshots'),
      maxSnapshots: 100
    });
  });

  afterEach(async () => {
    await transactionManager.destroy();
    mockFileSystem.reset();
  });

  describe('Transaction Lifecycle', () => {
    it('should begin a new transaction', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'edit', edits: [{ file: '/test/file1.txt', changes: [] }] }
      ];

      const txId = await transactionManager.beginTransaction(operations);

      expect(txId).toMatch(/^tx-\d+-[a-f0-9]+$/);
      
      const status = transactionManager.getTransactionStatus(txId);
      expect(status).toBeDefined();
      expect(status?.state).toBe('active');
      expect(status?.operations).toEqual(operations);
    });

    it('should track multiple active transactions', async () => {
      const ops1: Operation[] = [{ id: 'op1', type: 'analyze', paths: ['/test/file1.txt'] }];
      const ops2: Operation[] = [{ id: 'op2', type: 'analyze', paths: ['/test/file2.txt'] }];

      const tx1 = await transactionManager.beginTransaction(ops1);
      const tx2 = await transactionManager.beginTransaction(ops2);

      const activeTransactions = transactionManager.getActiveTransactions();
      expect(activeTransactions).toContain(tx1);
      expect(activeTransactions).toContain(tx2);
      expect(activeTransactions).toHaveLength(2);
    });

    it('should emit transaction events', async () => {
      const events: TransactionEvent[] = [];
      transactionManager.onEvent(event => events.push(event));

      const operations: Operation[] = [
        { id: 'op1', type: 'create', files: [{ path: '/test/new.txt', content: 'test' }] }
      ];

      const txId = await transactionManager.beginTransaction(operations);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('started');
      expect(events[0].transactionId).toBe(txId);
    });
  });

  describe('Snapshot Creation', () => {
    it('should create snapshots for existing files', async () => {
      // Create test file
      mockFileSystem.writeFile('/test/existing.txt', 'original content');

      const operations: Operation[] = [
        { id: 'op1', type: 'edit', edits: [{ file: '/test/existing.txt', changes: [] }] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      const snapshots = await transactionManager.createSnapshots(txId, operations);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].originalPath).toBe('/test/existing.txt');
      expect(snapshots[0].exists).toBe(true);
      expect(snapshots[0].content).toBe('original content');
      expect(snapshots[0].hash).toBeDefined();
    });

    it('should create snapshots for non-existent files', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'create', files: [{ path: '/test/new.txt', content: 'new' }] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      const snapshots = await transactionManager.createSnapshots(txId, operations);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].originalPath).toBe('/test/new.txt');
      expect(snapshots[0].exists).toBe(false);
    });

    it('should handle multiple files in operations', async () => {
      mockFileSystem.writeFile('/test/file1.txt', 'content1');
      mockFileSystem.writeFile('/test/file2.txt', 'content2');

      const operations: Operation[] = [
        { 
          id: 'op1', 
          type: 'edit', 
          edits: [
            { file: '/test/file1.txt', changes: [] },
            { file: '/test/file2.txt', changes: [] }
          ] 
        }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      const snapshots = await transactionManager.createSnapshots(txId, operations);

      expect(snapshots).toHaveLength(2);
      expect(snapshots.map(s => s.originalPath).sort()).toEqual([
        '/test/file1.txt',
        '/test/file2.txt'
      ]);
    });

    it('should respect snapshot limit', async () => {
      const manager = new TransactionManager(fileService, {
        snapshotDirectory: path.join(testDir, 'snapshots'),
        maxSnapshots: 2
      });

      const operations: Operation[] = [
        { 
          id: 'op1', 
          type: 'edit', 
          edits: [
            { file: '/test/file1.txt', changes: [] },
            { file: '/test/file2.txt', changes: [] },
            { file: '/test/file3.txt', changes: [] }
          ] 
        }
      ];

      const txId = await manager.beginTransaction(operations);
      
      await expect(manager.createSnapshots(txId, operations))
        .rejects.toThrow('Snapshot limit exceeded');

      await manager.destroy();
    });
  });

  describe('Commit Operations', () => {
    it('should commit transaction successfully', async () => {
      mockFileSystem.writeFile('/test/file.txt', 'content');

      const operations: Operation[] = [
        { id: 'op1', type: 'edit', edits: [{ file: '/test/file.txt', changes: [] }] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.createSnapshots(txId, operations);

      // Record some results
      const result: OperationResult = {
        operationId: 'op1',
        status: 'success',
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 100
      };
      transactionManager.recordResult(txId, result);

      await transactionManager.commit(txId);

      const status = transactionManager.getTransactionStatus(txId);
      expect(status?.state).toBe('committed');
      expect(status?.endTime).toBeDefined();
      expect(transactionManager.getActiveTransactions()).not.toContain(txId);
    });

    it('should emit commit event', async () => {
      const events: TransactionEvent[] = [];
      transactionManager.onEvent(event => events.push(event));

      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: ['/test/file.txt'] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.commit(txId);

      const commitEvent = events.find(e => e.type === 'committed');
      expect(commitEvent).toBeDefined();
      expect(commitEvent?.transactionId).toBe(txId);
    });

    it('should fail to commit non-existent transaction', async () => {
      await expect(transactionManager.commit('non-existent'))
        .rejects.toThrow('Transaction non-existent not found');
    });

    it('should fail to commit non-active transaction', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.commit(txId);

      // Try to commit again
      await expect(transactionManager.commit(txId))
        .rejects.toThrow('is not active');
    });
  });

  describe('Rollback Operations', () => {
    it('should rollback file edits', async () => {
      // Create original file
      mockFileSystem.writeFile('/test/file.txt', 'original content');

      const operations: Operation[] = [
        { id: 'op1', type: 'edit', edits: [{ file: '/test/file.txt', changes: [] }] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.createSnapshots(txId, operations);

      // Modify file (simulating operation execution)
      mockFileSystem.writeFile('/test/file.txt', 'modified content');

      // Rollback
      const result = await transactionManager.rollback(txId);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain('/test/file.txt');
      
      // Check file was restored
      const content = mockFileSystem.readFile('/test/file.txt');
      expect(content).toBe('original content');
    });

    it('should rollback file creation', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'create', files: [{ path: '/test/new.txt', content: 'new' }] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.createSnapshots(txId, operations);

      // Create file (simulating operation execution)
      mockFileSystem.writeFile('/test/new.txt', 'created content');

      // Rollback
      const result = await transactionManager.rollback(txId);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain('/test/new.txt');
      
      // Check file was removed
      expect(mockFileSystem.exists('/test/new.txt')).toBe(false);
    });

    it('should rollback file deletion', async () => {
      // Create original file
      mockFileSystem.writeFile('/test/to-delete.txt', 'will be deleted');

      const operations: Operation[] = [
        { id: 'op1', type: 'delete', paths: ['/test/to-delete.txt'] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.createSnapshots(txId, operations);

      // Delete file (simulating operation execution)
      mockFileSystem.unlink('/test/to-delete.txt');

      // Rollback
      const result = await transactionManager.rollback(txId);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain('/test/to-delete.txt');
      
      // Check file was restored
      const content = mockFileSystem.readFile('/test/to-delete.txt');
      expect(content).toBe('will be deleted');
    });

    it('should emit rollback event', async () => {
      const events: TransactionEvent[] = [];
      transactionManager.onEvent(event => events.push(event));

      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.rollback(txId);

      const rollbackEvent = events.find(e => e.type === 'rolled-back');
      expect(rollbackEvent).toBeDefined();
      expect(rollbackEvent?.transactionId).toBe(txId);
    });

    it('should not rollback committed transaction', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      await transactionManager.commit(txId);

      await expect(transactionManager.rollback(txId))
        .rejects.toThrow('cannot be rolled back');
    });
  });

  describe('Transaction Boundaries', () => {
    it('should create boundaries for non-conflicting operations', () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'edit', edits: [{ file: '/test/file1.txt', changes: [] }] },
        { id: 'op2', type: 'edit', edits: [{ file: '/test/file2.txt', changes: [] }] },
        { id: 'op3', type: 'edit', edits: [{ file: '/test/file3.txt', changes: [] }] }
      ];

      const boundaries = transactionManager.getTransactionBoundaries(operations);

      // Each operation affects different files, so could be separate transactions
      expect(boundaries.length).toBeGreaterThan(0);
      expect(boundaries.every(b => b.operations.length > 0)).toBe(true);
    });

    it('should group operations affecting same files', () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: ['/test/shared.txt'] },
        { id: 'op2', type: 'edit', edits: [{ file: '/test/shared.txt', changes: [] }] },
        { id: 'op3', type: 'validate', files: ['/test/shared.txt'] }
      ];

      const boundaries = transactionManager.getTransactionBoundaries(operations);

      // All operations affect the same file, should be in same boundary
      const sharedBoundary = boundaries.find(b => 
        b.operations.some(op => op.id === 'op1') &&
        b.operations.some(op => op.id === 'op2') &&
        b.operations.some(op => op.id === 'op3')
      );

      expect(sharedBoundary).toBeDefined();
    });
  });

  describe('Cleanup Operations', () => {
    it('should clean up abandoned transactions', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);

      // Mock transaction as old
      const status = transactionManager.getTransactionStatus(txId);
      if (status) {
        status.startTime = Date.now() - 7200000; // 2 hours ago
      }

      const cleaned = await transactionManager.cleanupAbandonedTransactions(3600000); // 1 hour max age

      expect(cleaned).toBe(1);
      
      const finalStatus = transactionManager.getTransactionStatus(txId);
      expect(finalStatus?.state).toBe('rolled-back');
    });

    it('should emit cleanup event', async () => {
      const events: TransactionEvent[] = [];
      transactionManager.onEvent(event => events.push(event));

      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);

      // Mock transaction as old
      const status = transactionManager.getTransactionStatus(txId);
      if (status) {
        status.startTime = Date.now() - 7200000; // 2 hours ago
      }

      await transactionManager.cleanupAbandonedTransactions(3600000);

      const cleanupEvent = events.find(e => e.type === 'cleaned-up');
      expect(cleanupEvent).toBeDefined();
      expect(cleanupEvent?.transactionId).toBe(txId);
    });

    it('should not clean up recent transactions', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      await transactionManager.beginTransaction(operations);

      const cleaned = await transactionManager.cleanupAbandonedTransactions(3600000); // 1 hour max age

      expect(cleaned).toBe(0);
    });
  });

  describe('Event Handling', () => {
    it('should add and remove event handlers', async () => {
      let eventCount = 0;
      const handler = (_event: TransactionEvent) => eventCount++;

      transactionManager.onEvent(handler);

      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      await transactionManager.beginTransaction(operations);
      expect(eventCount).toBe(1);

      transactionManager.offEvent(handler);
      await transactionManager.beginTransaction(operations);
      expect(eventCount).toBe(1); // Should not increase
    });

    it('should handle errors in event handlers', async () => {
      const errorHandler = () => {
        throw new Error('Handler error');
      };

      transactionManager.onEvent(errorHandler);

      // Should not throw
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      await expect(transactionManager.beginTransaction(operations))
        .resolves.toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle operations with no file paths', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] },
        { id: 'op2', type: 'edit', edits: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      const snapshots = await transactionManager.createSnapshots(txId, operations);

      expect(snapshots).toHaveLength(0);
    });

    it('should handle concurrent modifications', async () => {
      mockFileSystem.writeFile('/test/concurrent.txt', 'original');

      const operations: Operation[] = [
        { id: 'op1', type: 'edit', edits: [{ file: '/test/concurrent.txt', changes: [] }] }
      ];

      const tx1 = await transactionManager.beginTransaction(operations);
      const tx2 = await transactionManager.beginTransaction(operations);

      await transactionManager.createSnapshots(tx1, operations);
      await transactionManager.createSnapshots(tx2, operations);

      // Both transactions should have independent snapshots
      const status1 = transactionManager.getTransactionStatus(tx1);
      const status2 = transactionManager.getTransactionStatus(tx2);

      expect(status1?.snapshots).toHaveLength(1);
      expect(status2?.snapshots).toHaveLength(1);
      expect(status1?.snapshots[0].path).not.toBe(status2?.snapshots[0].path);
    });

    it('should handle transaction state transitions', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      
      let status = transactionManager.getTransactionStatus(txId);
      expect(status?.state).toBe('active');

      // Start rollback
      const rollbackPromise = transactionManager.rollback(txId);
      
      // Check state during rollback
      status = transactionManager.getTransactionStatus(txId);
      expect(['active', 'rolling-back']).toContain(status?.state);

      await rollbackPromise;

      status = transactionManager.getTransactionStatus(txId);
      expect(status?.state).toBe('rolled-back');
    });
  });

  describe('Destroy', () => {
    it('should rollback active transactions on destroy', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      const txId = await transactionManager.beginTransaction(operations);
      
      await transactionManager.destroy();

      const status = transactionManager.getTransactionStatus(txId);
      expect(status?.state).toBe('rolled-back');
    });

    it('should clean up resources on destroy', async () => {
      const operations: Operation[] = [
        { id: 'op1', type: 'analyze', paths: [] }
      ];

      await transactionManager.beginTransaction(operations);
      
      await transactionManager.destroy();

      // Should not have active transactions
      expect(transactionManager.getActiveTransactions()).toHaveLength(0);
    });
  });
});