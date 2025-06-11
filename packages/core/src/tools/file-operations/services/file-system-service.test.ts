/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileSystemService } from './file-system-service.js';
import { vol } from 'memfs';
import * as path from 'path';
import { FileSystemError } from '../file-operations-errors.js';

// Mock fs module with memfs
vi.mock('fs', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs');
  return {
    default: memfs.fs,
    ...memfs.fs
  };
});

vi.mock('fs/promises', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs');
  return memfs.fs.promises;
});

describe('FileSystemService', () => {
  let service: FileSystemService;
  const rootDir = '/test-root';

  beforeEach(() => {
    // Reset memfs
    vol.reset();
    
    // Create root directory
    vol.mkdirSync(rootDir, { recursive: true });
    
    // Create service instance
    service = new FileSystemService(rootDir);
  });

  afterEach(() => {
    // Clean up watchers
    service.closeAllWatchers();
    vol.reset();
  });

  describe('readFiles', () => {
    it('should read multiple files in batch', async () => {
      // Create test files
      vol.writeFileSync('/test-root/file1.txt', 'Content of file 1');
      vol.writeFileSync('/test-root/file2.txt', 'Content of file 2');
      vol.mkdirSync('/test-root/subdir', { recursive: true });
      vol.writeFileSync('/test-root/subdir/file3.txt', 'Content of file 3');
      
      const results = await service.readFiles([
        'file1.txt',
        'file2.txt',
        'subdir/file3.txt'
      ]);
      
      expect(results.size).toBe(3);
      expect(results.get('file1.txt')?.llmContent).toContain('Content of file 1');
      expect(results.get('file2.txt')?.llmContent).toContain('Content of file 2');
      expect(results.get('subdir/file3.txt')?.llmContent).toContain('Content of file 3');
    });

    it('should handle non-existent files', async () => {
      const results = await service.readFiles(['missing.txt']);
      
      expect(results.size).toBe(1);
      const result = results.get('missing.txt');
      expect(result?.error).toContain('File not found');
      expect(result?.returnDisplay).toBe('File not found.');
    });

    it('should reject files outside root directory', async () => {
      const results = await service.readFiles(['../outside.txt']);
      
      expect(results.size).toBe(1);
      const result = results.get('../outside.txt');
      expect(result?.error).toContain('File path must be within root directory');
    });

    it('should handle binary files', async () => {
      // Create a binary file
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF]);
      vol.writeFileSync('/test-root/binary.bin', binaryContent);
      
      const results = await service.readFiles(['binary.bin']);
      
      expect(results.size).toBe(1);
      const result = results.get('binary.bin');
      expect(result?.llmContent).toContain('Cannot display content of binary file');
      expect(result?.returnDisplay).toContain('Skipped binary file');
    });
  });

  describe('writeFiles', () => {
    it('should write multiple files atomically', async () => {
      const writes = new Map([
        ['new1.txt', 'Content 1'],
        ['subdir/new2.txt', 'Content 2']
      ]);
      
      const results = await service.writeFiles(writes);
      
      expect(results.size).toBe(2);
      expect(results.get('new1.txt')?.success).toBe(true);
      expect(results.get('subdir/new2.txt')?.success).toBe(true);
      
      // Verify files were written
      expect(vol.readFileSync('/test-root/new1.txt', 'utf8')).toBe('Content 1');
      expect(vol.readFileSync('/test-root/subdir/new2.txt', 'utf8')).toBe('Content 2');
    });

    it('should rollback all writes if any fail', async () => {
      // Make one path unwritable by creating it as a directory
      vol.mkdirSync('/test-root/badfile.txt');
      
      const writes = new Map([
        ['goodfile.txt', 'Good content'],
        ['badfile.txt', 'This will fail']
      ]);
      
      const results = await service.writeFiles(writes);
      
      expect(results.get('goodfile.txt')?.success).toBe(false);
      expect(results.get('goodfile.txt')?.error).toContain('rolled back');
      expect(results.get('badfile.txt')?.success).toBe(false);
      
      // Good file should NOT exist due to rollback
      expect(vol.existsSync('/test-root/goodfile.txt')).toBe(false);
    });

    it('should reject files outside root directory', async () => {
      const writes = new Map([
        ['../outside.txt', 'Content']
      ]);
      
      const results = await service.writeFiles(writes);
      
      expect(results.size).toBe(1);
      expect(results.get('../outside.txt')?.success).toBe(false);
      expect(results.get('../outside.txt')?.error).toContain('File path must be within root directory');
    });

    it('should create parent directories if needed', async () => {
      const writes = new Map([
        ['deep/nested/dir/file.txt', 'Content']
      ]);
      
      const results = await service.writeFiles(writes);
      
      expect(results.get('deep/nested/dir/file.txt')?.success).toBe(true);
      expect(vol.existsSync('/test-root/deep/nested/dir/file.txt')).toBe(true);
    });
  });

  describe('deleteFiles', () => {
    it('should delete multiple files', async () => {
      // Create files to delete
      vol.writeFileSync('/test-root/delete1.txt', 'Content 1');
      vol.writeFileSync('/test-root/delete2.txt', 'Content 2');
      
      const results = await service.deleteFiles(['delete1.txt', 'delete2.txt']);
      
      expect(results.size).toBe(2);
      expect(results.get('delete1.txt')?.success).toBe(true);
      expect(results.get('delete2.txt')?.success).toBe(true);
      
      // Verify files were deleted
      expect(vol.existsSync('/test-root/delete1.txt')).toBe(false);
      expect(vol.existsSync('/test-root/delete2.txt')).toBe(false);
    });

    it('should handle non-existent files', async () => {
      const results = await service.deleteFiles(['missing.txt']);
      
      expect(results.size).toBe(1);
      expect(results.get('missing.txt')?.success).toBe(false);
      expect(results.get('missing.txt')?.error).toBe('File not found');
    });

    it('should reject files outside root directory', async () => {
      const results = await service.deleteFiles(['../outside.txt']);
      
      expect(results.size).toBe(1);
      expect(results.get('../outside.txt')?.success).toBe(false);
      expect(results.get('../outside.txt')?.error).toContain('File path must be within root directory');
    });
  });

  describe('checkFilesExist', () => {
    it('should check existence of multiple files', async () => {
      vol.writeFileSync('/test-root/exists.txt', 'Content');
      
      const results = await service.checkFilesExist(['exists.txt', 'missing.txt']);
      
      expect(results.size).toBe(2);
      expect(results.get('exists.txt')).toBe(true);
      expect(results.get('missing.txt')).toBe(false);
    });

    it('should return false for files outside root', async () => {
      const results = await service.checkFilesExist(['../outside.txt']);
      
      expect(results.get('../outside.txt')).toBe(false);
    });
  });

  describe('getFileStats', () => {
    it('should get stats for multiple files', async () => {
      vol.writeFileSync('/test-root/file.txt', 'Content');
      vol.mkdirSync('/test-root/dir');
      
      const results = await service.getFileStats(['file.txt', 'dir', 'missing.txt']);
      
      expect(results.size).toBe(3);
      expect(results.get('file.txt')?.isFile()).toBe(true);
      expect(results.get('dir')?.isDirectory()).toBe(true);
      expect(results.get('missing.txt')).toBeNull();
    });
  });

  describe('watchFile', () => {
    it('should watch files for changes', async () => {
      vol.writeFileSync('/test-root/watch.txt', 'Initial content');
      
      let callbackCalled = false;
      service.watchFile('watch.txt', (event, filename) => {
        callbackCalled = true;
        expect(event).toBeDefined();
        expect(filename).toBeDefined();
      });
      
      // Trigger a change
      vol.writeFileSync('/test-root/watch.txt', 'Updated content');
      
      // Wait a bit for the event to be triggered
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(callbackCalled).toBe(true);
      service.unwatchFile('watch.txt');
    });

    it('should support multiple callbacks for same file', async () => {
      vol.writeFileSync('/test-root/watch.txt', 'Initial content');
      
      let callback1Called = false;
      let callback2Called = false;
      
      const callback1 = () => {
        callback1Called = true;
      };
      
      const callback2 = () => {
        callback2Called = true;
      };
      
      service.watchFile('watch.txt', callback1);
      service.watchFile('watch.txt', callback2);
      
      // Trigger a change
      vol.writeFileSync('/test-root/watch.txt', 'Updated content');
      
      // Wait a bit for the events to be triggered
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(callback1Called).toBe(true);
      expect(callback2Called).toBe(true);
      service.unwatchFile('watch.txt');
    });

    it('should throw for files outside root', () => {
      expect(() => {
        service.watchFile('../outside.txt', () => {});
      }).toThrow(FileSystemError);
    });
  });

  describe('createDirectory', () => {
    it('should create directory with parents', async () => {
      await service.createDirectory('new/nested/dir');
      
      expect(vol.existsSync('/test-root/new/nested/dir')).toBe(true);
      expect(vol.statSync('/test-root/new/nested/dir').isDirectory()).toBe(true);
    });

    it('should handle existing directories', async () => {
      vol.mkdirSync('/test-root/existing', { recursive: true });
      
      await expect(service.createDirectory('existing')).resolves.not.toThrow();
    });

    it('should reject paths outside root', async () => {
      await expect(service.createDirectory('../outside')).rejects.toThrow(FileSystemError);
    });
  });

  describe('removeEmptyDirectories', () => {
    it('should remove empty directories', async () => {
      vol.mkdirSync('/test-root/empty1', { recursive: true });
      vol.mkdirSync('/test-root/nested/empty2', { recursive: true });
      
      const results = await service.removeEmptyDirectories(['empty1', 'nested/empty2']);
      
      expect(results.get('empty1')?.success).toBe(true);
      expect(results.get('nested/empty2')?.success).toBe(true);
      expect(vol.existsSync('/test-root/empty1')).toBe(false);
      expect(vol.existsSync('/test-root/nested/empty2')).toBe(false);
    });

    it('should not remove non-empty directories', async () => {
      vol.mkdirSync('/test-root/nonempty', { recursive: true });
      vol.writeFileSync('/test-root/nonempty/file.txt', 'Content');
      
      const results = await service.removeEmptyDirectories(['nonempty']);
      
      expect(results.get('nonempty')?.success).toBe(false);
      expect(results.get('nonempty')?.error).toBe('Directory is not empty');
      expect(vol.existsSync('/test-root/nonempty')).toBe(true);
    });

    it('should handle nested empty directories in correct order', async () => {
      vol.mkdirSync('/test-root/parent/child', { recursive: true });
      
      const results = await service.removeEmptyDirectories(['parent/child', 'parent']);
      
      expect(results.get('parent/child')?.success).toBe(true);
      expect(results.get('parent')?.success).toBe(true);
      expect(vol.existsSync('/test-root/parent')).toBe(false);
    });
  });

  describe('listDirectory', () => {
    it('should list files in directory', async () => {
      vol.mkdirSync('/test-root/dir', { recursive: true });
      vol.writeFileSync('/test-root/dir/file1.txt', 'Content');
      vol.writeFileSync('/test-root/dir/file2.txt', 'Content');
      vol.mkdirSync('/test-root/dir/subdir');
      
      const files = await service.listDirectory('dir');
      
      expect(files).toHaveLength(2);
      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
    });

    it('should list files recursively', async () => {
      vol.mkdirSync('/test-root/dir/subdir', { recursive: true });
      vol.writeFileSync('/test-root/dir/file1.txt', 'Content');
      vol.writeFileSync('/test-root/dir/subdir/file2.txt', 'Content');
      
      const files = await service.listDirectory('dir', { recursive: true });
      
      expect(files).toHaveLength(2);
      expect(files).toContain('file1.txt');
      expect(files).toContain(path.join('subdir', 'file2.txt'));
    });

    it('should reject paths outside root', async () => {
      await expect(service.listDirectory('../outside')).rejects.toThrow(FileSystemError);
    });
  });

  describe('copyFile', () => {
    it('should copy file', async () => {
      vol.writeFileSync('/test-root/source.txt', 'Content to copy');
      
      await service.copyFile('source.txt', 'destination.txt');
      
      expect(vol.readFileSync('/test-root/destination.txt', 'utf8')).toBe('Content to copy');
      expect(vol.existsSync('/test-root/source.txt')).toBe(true); // Original still exists
    });

    it('should create destination directory if needed', async () => {
      vol.writeFileSync('/test-root/source.txt', 'Content');
      
      await service.copyFile('source.txt', 'new/dir/dest.txt');
      
      expect(vol.existsSync('/test-root/new/dir/dest.txt')).toBe(true);
    });

    it('should reject paths outside root', async () => {
      await expect(service.copyFile('../outside.txt', 'dest.txt')).rejects.toThrow(FileSystemError);
      await expect(service.copyFile('source.txt', '../outside.txt')).rejects.toThrow(FileSystemError);
    });
  });

  describe('moveFile', () => {
    it('should move file', async () => {
      vol.writeFileSync('/test-root/source.txt', 'Content to move');
      
      await service.moveFile('source.txt', 'destination.txt');
      
      expect(vol.readFileSync('/test-root/destination.txt', 'utf8')).toBe('Content to move');
      expect(vol.existsSync('/test-root/source.txt')).toBe(false); // Original removed
    });

    it('should create destination directory if needed', async () => {
      vol.writeFileSync('/test-root/source.txt', 'Content');
      
      await service.moveFile('source.txt', 'new/dir/dest.txt');
      
      expect(vol.existsSync('/test-root/new/dir/dest.txt')).toBe(true);
      expect(vol.existsSync('/test-root/source.txt')).toBe(false);
    });

    it('should reject paths outside root', async () => {
      await expect(service.moveFile('../outside.txt', 'dest.txt')).rejects.toThrow(FileSystemError);
      await expect(service.moveFile('source.txt', '../outside.txt')).rejects.toThrow(FileSystemError);
    });
  });
});