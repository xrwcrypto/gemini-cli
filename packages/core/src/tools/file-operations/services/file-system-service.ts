/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { 
  isWithinRoot, 
  processSingleFileContent,
  ProcessedFileReadResult
} from '../../../utils/fileUtils.js';
import { FileSystemError } from '../file-operations-errors.js';

const fsPromises = fs.promises;

/**
 * File system service for batch file operations
 */
export class FileSystemService {
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private watchCallbacks: Map<string, Set<(event: string, filename: string) => void>> = new Map();
  
  constructor(private readonly rootDirectory: string) {}

  /**
   * Read multiple files in batch
   */
  async readFiles(filePaths: string[]): Promise<Map<string, ProcessedFileReadResult>> {
    const results = new Map<string, ProcessedFileReadResult>();
    
    // Process files in parallel
    const promises = filePaths.map(async (filePath) => {
      const absolutePath = path.resolve(this.rootDirectory, filePath);
      
      if (!isWithinRoot(absolutePath, this.rootDirectory)) {
        results.set(filePath, {
          llmContent: '',
          returnDisplay: 'File path must be within root directory',
          error: `File path must be within root directory: ${filePath}`
        });
        return;
      }
      
      const result = await processSingleFileContent(
        absolutePath,
        this.rootDirectory
      );
      results.set(filePath, result);
    });
    
    await Promise.all(promises);
    return results;
  }

  /**
   * Write a single file
   */
  async writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
    const absolutePath = path.resolve(this.rootDirectory, filePath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`File path must be within root directory: ${filePath}`);
    }
    
    // Ensure directory exists
    await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
    
    await fsPromises.writeFile(absolutePath, content, encoding);
  }

  /**
   * Read a single file
   */
  async readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const absolutePath = path.resolve(this.rootDirectory, filePath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`File path must be within root directory: ${filePath}`);
    }
    
    return await fsPromises.readFile(absolutePath, encoding);
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    const absolutePath = path.resolve(this.rootDirectory, filePath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      return false;
    }
    
    try {
      await fsPromises.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a single file
   */
  async unlink(filePath: string): Promise<void> {
    const absolutePath = path.resolve(this.rootDirectory, filePath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`File path must be within root directory: ${filePath}`);
    }
    
    await fsPromises.unlink(absolutePath);
  }

  /**
   * Change file permissions
   */
  async chmod(filePath: string, mode: string): Promise<void> {
    const absolutePath = path.resolve(this.rootDirectory, filePath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`File path must be within root directory: ${filePath}`);
    }
    
    const modeNum = parseInt(mode, 8);
    await fsPromises.chmod(absolutePath, modeNum);
  }

  /**
   * Read directory contents
   */
  async readdir(dirPath: string): Promise<string[]> {
    const absolutePath = path.resolve(this.rootDirectory, dirPath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`Directory path must be within root directory: ${dirPath}`);
    }
    
    return await fsPromises.readdir(absolutePath);
  }

  /**
   * Remove directory
   */
  async rmdir(dirPath: string): Promise<void> {
    const absolutePath = path.resolve(this.rootDirectory, dirPath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`Directory path must be within root directory: ${dirPath}`);
    }
    
    await fsPromises.rmdir(absolutePath);
  }

  /**
   * Glob files matching pattern
   */
  async glob(pattern: string): Promise<string[]> {
    const glob = (await import('glob')).glob;
    const absolutePattern = path.join(this.rootDirectory, pattern);
    
    const files = await glob(absolutePattern, {
      cwd: this.rootDirectory,
      nodir: true,
    });
    
    // Convert to relative paths
    return files.map(f => path.relative(this.rootDirectory, f));
  }

  /**
   * Write multiple files atomically
   */
  async writeFiles(writes: Map<string, string>): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();
    const tempFiles = new Map<string, string>();
    
    try {
      // First, write all files to temporary locations
      for (const [filePath, content] of writes) {
        const absolutePath = path.resolve(this.rootDirectory, filePath);
        
        if (!isWithinRoot(absolutePath, this.rootDirectory)) {
          results.set(filePath, {
            success: false,
            error: `File path must be within root directory: ${filePath}`
          });
          continue;
        }
        
        try {
          // Check if the target exists and is a directory
          try {
            const stats = await fsPromises.stat(absolutePath);
            if (stats.isDirectory()) {
              results.set(filePath, {
                success: false,
                error: `Cannot write to ${filePath}: path is a directory`
              });
              continue;
            }
          } catch {
            // File doesn't exist, which is fine
          }
          
          const tempPath = await this.createTempFile(absolutePath, content);
          tempFiles.set(absolutePath, tempPath);
          results.set(filePath, { success: true });
        } catch (error) {
          results.set(filePath, {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      // Check if all files were written successfully
      const allSuccessful = Array.from(results.values()).every(r => r.success);
      
      if (allSuccessful) {
        // Move all temp files to final locations
        for (const [finalPath, tempPath] of tempFiles) {
          await fsPromises.rename(tempPath, finalPath);
        }
      } else {
        // Rollback: clean up all temp files if any writes failed
        for (const tempPath of tempFiles.values()) {
          try {
            await fsPromises.unlink(tempPath);
          } catch {
            // Ignore cleanup errors
          }
        }
        
        // Mark all operations as failed due to rollback
        for (const [filePath, result] of results) {
          if (result.success) {
            results.set(filePath, {
              success: false,
              error: 'Operation rolled back due to batch failure'
            });
          }
        }
      }
    } catch (error) {
      // Clean up any temp files on error
      for (const tempPath of tempFiles.values()) {
        try {
          await fsPromises.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      
      throw new FileSystemError(
        `Batch write operation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    
    return results;
  }

  /**
   * Create a temporary file with content
   */
  private async createTempFile(targetPath: string, content: string): Promise<string> {
    const dir = path.dirname(targetPath);
    const basename = path.basename(targetPath);
    
    // Ensure directory exists
    await fsPromises.mkdir(dir, { recursive: true });
    
    // Create temp file in same directory for atomic rename
    const tempName = `.${basename}.${randomBytes(6).toString('hex')}.tmp`;
    const tempPath = path.join(dir, tempName);
    
    await fsPromises.writeFile(tempPath, content, 'utf8');
    return tempPath;
  }

  /**
   * Delete multiple files
   */
  async deleteFiles(filePaths: string[]): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();
    
    const promises = filePaths.map(async (filePath) => {
      const absolutePath = path.resolve(this.rootDirectory, filePath);
      
      if (!isWithinRoot(absolutePath, this.rootDirectory)) {
        results.set(filePath, {
          success: false,
          error: `File path must be within root directory: ${filePath}`
        });
        return;
      }
      
      try {
        await fsPromises.unlink(absolutePath);
        results.set(filePath, { success: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          results.set(filePath, {
            success: false,
            error: 'File not found'
          });
        } else {
          results.set(filePath, {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });
    
    await Promise.all(promises);
    return results;
  }

  /**
   * Check if files exist
   */
  async checkFilesExist(filePaths: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    const promises = filePaths.map(async (filePath) => {
      const absolutePath = path.resolve(this.rootDirectory, filePath);
      
      if (!isWithinRoot(absolutePath, this.rootDirectory)) {
        results.set(filePath, false);
        return;
      }
      
      try {
        await fsPromises.access(absolutePath, fs.constants.F_OK);
        results.set(filePath, true);
      } catch {
        results.set(filePath, false);
      }
    });
    
    await Promise.all(promises);
    return results;
  }

  /**
   * Get file stats for multiple files
   */
  async getFileStats(filePaths: string[]): Promise<Map<string, fs.Stats | null>> {
    const results = new Map<string, fs.Stats | null>();
    
    const promises = filePaths.map(async (filePath) => {
      const absolutePath = path.resolve(this.rootDirectory, filePath);
      
      if (!isWithinRoot(absolutePath, this.rootDirectory)) {
        results.set(filePath, null);
        return;
      }
      
      try {
        const stats = await fsPromises.stat(absolutePath);
        results.set(filePath, stats);
      } catch {
        results.set(filePath, null);
      }
    });
    
    await Promise.all(promises);
    return results;
  }

  /**
   * Watch files for changes
   */
  watchFile(filePath: string, callback: (event: string, filename: string) => void): void {
    const absolutePath = path.resolve(this.rootDirectory, filePath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`File path must be within root directory: ${filePath}`);
    }
    
    // Check if already watching
    if (!this.fileWatchers.has(absolutePath)) {
      try {
        const watcher = fs.watch(absolutePath, (event, filename) => {
          const callbacks = this.watchCallbacks.get(absolutePath);
          if (callbacks) {
            callbacks.forEach(cb => cb(event, filename || ''));
          }
        });
        
        this.fileWatchers.set(absolutePath, watcher);
        this.watchCallbacks.set(absolutePath, new Set());
      } catch (error) {
        throw new FileSystemError(
          `Failed to watch file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    
    // Add callback
    const callbacks = this.watchCallbacks.get(absolutePath)!;
    callbacks.add(callback);
  }

  /**
   * Stop watching a file
   */
  unwatchFile(filePath: string, callback?: (event: string, filename: string) => void): void {
    const absolutePath = path.resolve(this.rootDirectory, filePath);
    
    const callbacks = this.watchCallbacks.get(absolutePath);
    if (!callbacks) return;
    
    if (callback) {
      callbacks.delete(callback);
    } else {
      callbacks.clear();
    }
    
    // If no more callbacks, close the watcher
    if (callbacks.size === 0) {
      const watcher = this.fileWatchers.get(absolutePath);
      if (watcher) {
        watcher.close();
        this.fileWatchers.delete(absolutePath);
        this.watchCallbacks.delete(absolutePath);
      }
    }
  }

  /**
   * Stop all file watchers
   */
  closeAllWatchers(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }
    this.fileWatchers.clear();
    this.watchCallbacks.clear();
  }

  /**
   * Create directory with parents
   */
  async createDirectory(dirPath: string): Promise<void> {
    const absolutePath = path.resolve(this.rootDirectory, dirPath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`Directory path must be within root directory: ${dirPath}`);
    }
    
    await fsPromises.mkdir(absolutePath, { recursive: true });
  }

  /**
   * Remove empty directories
   */
  async removeEmptyDirectories(dirPaths: string[]): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();
    
    // Sort paths by depth (deepest first) to remove child dirs before parents
    const sortedPaths = [...dirPaths].sort((a, b) => {
      const depthA = a.split(path.sep).length;
      const depthB = b.split(path.sep).length;
      return depthB - depthA;
    });
    
    for (const dirPath of sortedPaths) {
      const absolutePath = path.resolve(this.rootDirectory, dirPath);
      
      if (!isWithinRoot(absolutePath, this.rootDirectory)) {
        results.set(dirPath, {
          success: false,
          error: `Directory path must be within root directory: ${dirPath}`
        });
        continue;
      }
      
      try {
        // Check if directory is empty
        const files = await fsPromises.readdir(absolutePath);
        if (files.length === 0) {
          await fsPromises.rmdir(absolutePath);
          results.set(dirPath, { success: true });
        } else {
          results.set(dirPath, {
            success: false,
            error: 'Directory is not empty'
          });
        }
      } catch (error) {
        results.set(dirPath, {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return results;
  }

  /**
   * List files in directory
   */
  async listDirectory(dirPath: string, options?: { recursive?: boolean }): Promise<string[]> {
    const absolutePath = path.resolve(this.rootDirectory, dirPath);
    
    if (!isWithinRoot(absolutePath, this.rootDirectory)) {
      throw new FileSystemError(`Directory path must be within root directory: ${dirPath}`);
    }
    
    const files: string[] = [];
    
    async function walk(dir: string): Promise<void> {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && options?.recursive) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          files.push(path.relative(absolutePath, fullPath));
        }
      }
    }
    
    await walk(absolutePath);
    return files;
  }

  /**
   * Copy file
   */
  async copyFile(source: string, destination: string): Promise<void> {
    const sourcePath = path.resolve(this.rootDirectory, source);
    const destPath = path.resolve(this.rootDirectory, destination);
    
    if (!isWithinRoot(sourcePath, this.rootDirectory) || !isWithinRoot(destPath, this.rootDirectory)) {
      throw new FileSystemError('File paths must be within root directory');
    }
    
    // Ensure destination directory exists
    await this.createDirectory(path.dirname(destination));
    
    await fsPromises.copyFile(sourcePath, destPath);
  }

  /**
   * Move/rename file
   */
  async moveFile(source: string, destination: string): Promise<void> {
    const sourcePath = path.resolve(this.rootDirectory, source);
    const destPath = path.resolve(this.rootDirectory, destination);
    
    if (!isWithinRoot(sourcePath, this.rootDirectory) || !isWithinRoot(destPath, this.rootDirectory)) {
      throw new FileSystemError('File paths must be within root directory');
    }
    
    // Ensure destination directory exists
    await this.createDirectory(path.dirname(destination));
    
    await fsPromises.rename(sourcePath, destPath);
  }
}