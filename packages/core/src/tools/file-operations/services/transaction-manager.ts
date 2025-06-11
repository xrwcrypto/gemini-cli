/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { FileSystemService } from './file-system-service.js';
import { Operation } from '../file-operations-types.js';
import { OperationResult } from './parallel-execution-engine.js';
import { isNodeError } from '../../../utils/errors.js';

/**
 * Transaction state
 */
export type TransactionState = 'pending' | 'active' | 'committing' | 'committed' | 'rolling-back' | 'rolled-back' | 'failed';

/**
 * File snapshot information
 */
export interface FileSnapshot {
  path: string;
  originalPath: string;
  exists: boolean;
  content?: string;
  stats?: {
    mode: number;
    size: number;
    mtime: Date;
  };
  hash?: string;
}

/**
 * Transaction metadata
 */
export interface TransactionMetadata {
  id: string;
  startTime: number;
  endTime?: number;
  state: TransactionState;
  operations: Operation[];
  snapshots: FileSnapshot[];
  results: OperationResult[];
  error?: string;
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  isolationLevel?: 'read-uncommitted' | 'read-committed' | 'repeatable-read' | 'serializable';
  timeout?: number;
  maxSnapshots?: number;
  snapshotDirectory?: string;
}

/**
 * Transaction boundary
 */
export interface TransactionBoundary {
  transactionId: string;
  operations: Operation[];
  startTime: number;
}

/**
 * Rollback result
 */
export interface RollbackResult {
  success: boolean;
  restoredFiles: string[];
  failedFiles: string[];
  error?: string;
}

/**
 * Transaction event
 */
export interface TransactionEvent {
  transactionId: string;
  type: 'started' | 'snapshot-created' | 'committed' | 'rolled-back' | 'failed' | 'cleaned-up';
  timestamp: number;
  details?: unknown;
}

/**
 * Transaction Manager
 * Manages atomic file operations with snapshot creation and rollback capabilities
 */
export class TransactionManager {
  private readonly fileService: FileSystemService;
  private readonly transactions: Map<string, TransactionMetadata> = new Map();
  private readonly activeTransactions: Set<string> = new Set();
  private readonly snapshotDir: string;
  private readonly maxSnapshots: number;
  private cleanupInterval?: NodeJS.Timeout;
  private eventHandlers: Array<(event: TransactionEvent) => void> = [];

  constructor(
    fileService: FileSystemService,
    options: TransactionOptions = {}
  ) {
    this.fileService = fileService;
    this.snapshotDir = options.snapshotDirectory || path.join(os.tmpdir(), 'gemini-transactions');
    this.maxSnapshots = options.maxSnapshots || 1000;

    // Start cleanup interval for abandoned transactions
    this.startCleanupInterval();
  }

  /**
   * Begin a new transaction
   */
  async beginTransaction(operations: Operation[]): Promise<string> {
    const transactionId = this.generateTransactionId();
    
    // Create transaction metadata
    const metadata: TransactionMetadata = {
      id: transactionId,
      startTime: Date.now(),
      state: 'pending',
      operations,
      snapshots: [],
      results: []
    };

    this.transactions.set(transactionId, metadata);
    this.activeTransactions.add(transactionId);

    // Create transaction snapshot directory
    const txSnapshotDir = path.join(this.snapshotDir, transactionId);
    await fs.mkdir(txSnapshotDir, { recursive: true });

    // Update state to active
    metadata.state = 'active';
    
    this.emitEvent({
      transactionId,
      type: 'started',
      timestamp: Date.now(),
      details: { operationCount: operations.length }
    });

    return transactionId;
  }

  /**
   * Create snapshots for files affected by operations
   */
  async createSnapshots(transactionId: string, operations: Operation[]): Promise<FileSnapshot[]> {
    const metadata = this.transactions.get(transactionId);
    if (!metadata) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (metadata.state !== 'active') {
      throw new Error(`Transaction ${transactionId} is not active`);
    }

    const affectedFiles = this.extractAffectedFiles(operations);
    const snapshots: FileSnapshot[] = [];
    const txSnapshotDir = path.join(this.snapshotDir, transactionId);

    for (const filePath of affectedFiles) {
      // Check snapshot limit before creating
      if (metadata.snapshots.length + snapshots.length >= this.maxSnapshots) {
        throw new Error(`Snapshot limit exceeded (max: ${this.maxSnapshots})`);
      }
      
      try {
        const snapshot = await this.createFileSnapshot(filePath, txSnapshotDir);
        snapshots.push(snapshot);
      } catch (error) {
        // Log error but continue with other files
        console.error(`Failed to create snapshot for ${filePath}:`, error);
      }
    }

    metadata.snapshots.push(...snapshots);
    
    this.emitEvent({
      transactionId,
      type: 'snapshot-created',
      timestamp: Date.now(),
      details: { snapshotCount: snapshots.length }
    });

    return snapshots;
  }

  /**
   * Record operation result
   */
  recordResult(transactionId: string, result: OperationResult): void {
    const metadata = this.transactions.get(transactionId);
    if (!metadata) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    metadata.results.push(result);
  }

  /**
   * Commit transaction
   */
  async commit(transactionId: string): Promise<void> {
    const metadata = this.transactions.get(transactionId);
    if (!metadata) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (metadata.state !== 'active') {
      throw new Error(`Transaction ${transactionId} is not active`);
    }

    try {
      metadata.state = 'committing';

      // Clean up snapshots
      await this.cleanupSnapshots(transactionId);

      // Update metadata
      metadata.state = 'committed';
      metadata.endTime = Date.now();
      this.activeTransactions.delete(transactionId);

      this.emitEvent({
        transactionId,
        type: 'committed',
        timestamp: Date.now(),
        details: { duration: metadata.endTime - metadata.startTime }
      });
    } catch (error) {
      metadata.state = 'failed';
      metadata.error = isNodeError(error) ? error.message : 'Unknown error during commit';
      throw error;
    }
  }

  /**
   * Rollback transaction
   */
  async rollback(transactionId: string): Promise<RollbackResult> {
    const metadata = this.transactions.get(transactionId);
    if (!metadata) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (metadata.state === 'committed' || metadata.state === 'rolled-back') {
      throw new Error(`Transaction ${transactionId} cannot be rolled back (state: ${metadata.state})`);
    }

    const result: RollbackResult = {
      success: true,
      restoredFiles: [],
      failedFiles: []
    };

    try {
      metadata.state = 'rolling-back';

      // Restore files from snapshots in reverse order
      for (let i = metadata.snapshots.length - 1; i >= 0; i--) {
        const snapshot = metadata.snapshots[i];
        try {
          await this.restoreSnapshot(snapshot);
          result.restoredFiles.push(snapshot.originalPath);
        } catch (error) {
          result.success = false;
          result.failedFiles.push(snapshot.originalPath);
          console.error(`Failed to restore ${snapshot.originalPath}:`, error);
        }
      }

      // Clean up snapshots
      await this.cleanupSnapshots(transactionId);

      // Update metadata
      metadata.state = 'rolled-back';
      metadata.endTime = Date.now();
      this.activeTransactions.delete(transactionId);

      this.emitEvent({
        transactionId,
        type: 'rolled-back',
        timestamp: Date.now(),
        details: result
      });

    } catch (error) {
      metadata.state = 'failed';
      metadata.error = isNodeError(error) ? error.message : 'Unknown error during rollback';
      result.success = false;
      result.error = metadata.error;
    }

    return result;
  }

  /**
   * Get transaction boundaries for concurrent operations
   */
  getTransactionBoundaries(operations: Operation[]): TransactionBoundary[] {
    const boundaries: TransactionBoundary[] = [];
    const fileGroups = new Map<string, Operation[]>();

    // Group operations by files they affect
    for (const operation of operations) {
      const files = this.extractAffectedFiles([operation]);
      for (const file of files) {
        if (!fileGroups.has(file)) {
          fileGroups.set(file, []);
        }
        fileGroups.get(file)!.push(operation);
      }
    }

    // Create boundaries for operations that affect the same files
    const processedOps = new Set<Operation>();
    
    for (const [_file, ops] of fileGroups) {
      const boundaryOps: Operation[] = [];
      
      for (const op of ops) {
        if (!processedOps.has(op)) {
          boundaryOps.push(op);
          processedOps.add(op);
        }
      }

      if (boundaryOps.length > 0) {
        boundaries.push({
          transactionId: this.generateTransactionId(),
          operations: boundaryOps,
          startTime: Date.now()
        });
      }
    }

    return boundaries;
  }

  /**
   * Clean up abandoned transactions
   */
  async cleanupAbandonedTransactions(maxAge: number = 3600000): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [transactionId, metadata] of this.transactions) {
      const age = now - metadata.startTime;
      
      if (age > maxAge && this.activeTransactions.has(transactionId)) {
        try {
          // Attempt rollback
          await this.rollback(transactionId);
          cleanedCount++;
        } catch (_error) {
          // If rollback fails, just clean up snapshots
          try {
            await this.cleanupSnapshots(transactionId);
            this.activeTransactions.delete(transactionId);
            metadata.state = 'failed';
            metadata.error = 'Transaction abandoned';
            cleanedCount++;
          } catch (cleanupError) {
            console.error(`Failed to clean up transaction ${transactionId}:`, cleanupError);
          }
        }

        this.emitEvent({
          transactionId,
          type: 'cleaned-up',
          timestamp: Date.now(),
          details: { reason: 'abandoned', age }
        });
      }
    }

    return cleanedCount;
  }

  /**
   * Get transaction status
   */
  getTransactionStatus(transactionId: string): TransactionMetadata | undefined {
    return this.transactions.get(transactionId);
  }

  /**
   * Get active transactions
   */
  getActiveTransactions(): string[] {
    return Array.from(this.activeTransactions);
  }

  /**
   * Add event handler
   */
  onEvent(handler: (event: TransactionEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove event handler
   */
  offEvent(handler: (event: TransactionEvent) => void): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Destroy transaction manager
   */
  async destroy(): Promise<void> {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Rollback all active transactions
    for (const transactionId of this.activeTransactions) {
      try {
        await this.rollback(transactionId);
      } catch (error) {
        console.error(`Failed to rollback transaction ${transactionId} during destroy:`, error);
      }
    }

    // Clean up snapshot directory
    try {
      await fs.rm(this.snapshotDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to clean up snapshot directory:', error);
    }
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `tx-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Extract affected files from operations
   */
  private extractAffectedFiles(operations: Operation[]): Set<string> {
    const files = new Set<string>();

    for (const operation of operations) {
      switch (operation.type) {
        case 'analyze':
          if ('paths' in operation && Array.isArray(operation.paths)) {
            operation.paths.forEach(p => files.add(p));
          }
          break;
        case 'edit':
          if ('edits' in operation && Array.isArray(operation.edits)) {
            for (const edit of operation.edits) {
              if (typeof edit === 'object' && edit !== null && 'file' in edit && typeof edit.file === 'string') {
                files.add(edit.file);
              }
            }
          }
          break;
        case 'create':
          if ('files' in operation && Array.isArray(operation.files)) {
            for (const file of operation.files) {
              if (typeof file === 'object' && file !== null && 'path' in file && typeof file.path === 'string') {
                files.add(file.path);
              }
            }
          }
          break;
        case 'delete':
          if ('paths' in operation && Array.isArray(operation.paths)) {
            operation.paths.forEach(p => files.add(p));
          }
          break;
        case 'validate':
          if ('files' in operation && Array.isArray(operation.files)) {
            for (const file of operation.files) {
              if (typeof file === 'string') {
                files.add(file);
              }
            }
          }
          break;
        default:
          // Unknown operation type, ignore
          break;
      }
    }

    return files;
  }

  /**
   * Create snapshot of a file
   */
  private async createFileSnapshot(filePath: string, snapshotDir: string): Promise<FileSnapshot> {
    const snapshotId = crypto.randomBytes(8).toString('hex');
    const snapshotPath = path.join(snapshotDir, `${snapshotId}.snapshot`);

    const snapshot: FileSnapshot = {
      path: snapshotPath,
      originalPath: filePath,
      exists: false
    };

    try {
      // Check if file exists
      const stats = await fs.stat(filePath);
      snapshot.exists = true;
      snapshot.stats = {
        mode: typeof stats.mode === 'number' ? stats.mode : 0o644,
        size: typeof stats.size === 'number' ? stats.size : 0,
        mtime: stats.mtime instanceof Date ? stats.mtime : new Date()
      };

      // Read and save content
      const content = await fs.readFile(filePath, 'utf-8');
      snapshot.content = content;
      snapshot.hash = crypto.createHash('sha256').update(content).digest('hex');

      // Write snapshot
      const snapshotData = JSON.stringify(snapshot);
      await fs.writeFile(snapshotPath, snapshotData, 'utf-8');

    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        // File doesn't exist, which is valid for create operations
        snapshot.exists = false;
        const snapshotData = JSON.stringify(snapshot);
        await fs.writeFile(snapshotPath, snapshotData, 'utf-8');
      } else {
        throw error;
      }
    }

    return snapshot;
  }

  /**
   * Restore file from snapshot
   */
  private async restoreSnapshot(snapshot: FileSnapshot): Promise<void> {
    if (!snapshot.exists) {
      // File didn't exist originally, so delete it
      try {
        await fs.unlink(snapshot.originalPath);
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
    } else if (snapshot.content !== undefined) {
      // Restore file content
      await fs.writeFile(snapshot.originalPath, snapshot.content, 'utf-8');
      
      // Restore file permissions if available
      if (snapshot.stats) {
        try {
          await fs.chmod(snapshot.originalPath, snapshot.stats.mode);
          await fs.utimes(snapshot.originalPath, new Date(), snapshot.stats.mtime);
        } catch (error) {
          // Non-critical, log but continue
          console.warn(`Failed to restore file metadata for ${snapshot.originalPath}:`, error);
        }
      }
    }
  }

  /**
   * Clean up transaction snapshots
   */
  private async cleanupSnapshots(transactionId: string): Promise<void> {
    const txSnapshotDir = path.join(this.snapshotDir, transactionId);
    
    try {
      await fs.rm(txSnapshotDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up snapshots for transaction ${transactionId}:`, error);
    }
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupAbandonedTransactions().catch(error => {
        console.error('Failed to clean up abandoned transactions:', error);
      });
    }, 300000);
  }

  /**
   * Emit transaction event
   */
  private emitEvent(event: TransactionEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in transaction event handler:', error);
      }
    }
  }
}