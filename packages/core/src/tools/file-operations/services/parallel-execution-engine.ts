/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';
import { Operation } from '../file-operations-types.js';
import { OperationPlanner, ExecutionStage } from './operation-planner.js';

/**
 * Operation execution result
 */
export interface OperationResult {
  operationId: string;
  status: 'success' | 'failed' | 'cancelled';
  data?: unknown;
  error?: string;
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Progress tracking information
 */
export interface ProgressInfo {
  totalOperations: number;
  completedOperations: number;
  failedOperations: number;
  cancelledOperations: number;
  currentStage: number;
  totalStages: number;
  estimatedTimeRemaining: number;
  percentComplete: number;
}

/**
 * Resource limits for execution
 */
export interface ResourceLimits {
  maxConcurrentOperations: number;
  maxMemoryUsage: number; // in bytes
  maxExecutionTime: number; // in milliseconds
  maxCpuUsage?: number; // percentage (0-100)
}

/**
 * Execution options
 */
export interface ExecutionOptions {
  abortSignal?: AbortSignal;
  progressCallback?: (progress: ProgressInfo) => void;
  resourceLimits?: ResourceLimits;
  priority?: 'low' | 'normal' | 'high';
  continueOnError?: boolean;
}

/**
 * Worker pool configuration
 */
export interface WorkerPoolConfig {
  maxWorkers: number;
  queueSize: number;
  workerTimeout: number;
}

/**
 * Worker task
 */
interface WorkerTask {
  operation: Operation;
  priority: number;
  resolve: (result: OperationResult) => void;
  reject: (error: Error) => void;
  abortController: AbortController;
}

/**
 * Worker statistics
 */
export interface WorkerStats {
  activeWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
}

/**
 * Worker pool for concurrent operation execution
 */
export class WorkerPool extends EventEmitter {
  private readonly config: WorkerPoolConfig;
  private readonly workers: Set<Promise<void>> = new Set();
  private readonly taskQueue: WorkerTask[] = [];
  private readonly stats: WorkerStats = {
    activeWorkers: 0,
    queuedTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    totalExecutionTime: 0,
    averageExecutionTime: 0
  };
  private isShuttingDown = false;

  constructor(config: WorkerPoolConfig) {
    super();
    this.config = config;
  }

  /**
   * Execute operation with priority
   */
  async execute(
    operation: Operation, 
    priority: number = 0,
    abortSignal?: AbortSignal
  ): Promise<OperationResult> {
    if (this.isShuttingDown) {
      throw new Error('Worker pool is shutting down');
    }

    if (this.taskQueue.length >= this.config.queueSize) {
      throw new Error('Worker pool queue is full');
    }

    const abortController = new AbortController();
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        abortController.abort();
      });
    }

    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        operation,
        priority,
        resolve,
        reject,
        abortController
      };

      // Insert task in priority order (higher priority first)
      let insertIndex = 0;
      while (insertIndex < this.taskQueue.length && this.taskQueue[insertIndex].priority >= priority) {
        insertIndex++;
      }
      this.taskQueue.splice(insertIndex, 0, task);
      this.stats.queuedTasks++;

      this.emit('taskQueued', { operationId: operation.id || 'unknown', priority });
      this.processQueue();
    });
  }

  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    while (this.workers.size < this.config.maxWorkers && this.taskQueue.length > 0 && !this.isShuttingDown) {
      const task = this.taskQueue.shift()!;
      this.stats.queuedTasks--;
      
      const workerPromise = this.executeTask(task);
      this.workers.add(workerPromise);
      
      workerPromise.finally(() => {
        this.workers.delete(workerPromise);
        this.processQueue(); // Try to process more tasks
      });
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: WorkerTask): Promise<void> {
    const { operation, resolve, abortController } = task;
    const operationId = operation.id || `${operation.type}-${Date.now()}`;
    
    this.stats.activeWorkers++;
    this.emit('taskStarted', { operationId });

    const startTime = Date.now();
    
    try {
      // Check if task was cancelled before starting
      if (abortController.signal.aborted) {
        const result: OperationResult = {
          operationId,
          status: 'cancelled',
          startTime,
          endTime: Date.now(),
          duration: 0
        };
        resolve(result);
        return;
      }

      // Execute the operation with timeout
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operation timeout')), this.config.workerTimeout)
      );

      const executionPromise = this.performOperation(operation, abortController.signal);
      const data = await Promise.race([executionPromise, timeoutPromise]);

      const endTime = Date.now();
      const duration = endTime - startTime;

      const result: OperationResult = {
        operationId,
        status: 'success',
        data,
        startTime,
        endTime,
        duration
      };

      this.updateStats(duration, true);
      this.emit('taskCompleted', result);
      resolve(result);

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      const result: OperationResult = {
        operationId,
        status: abortController.signal.aborted ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
        startTime,
        endTime,
        duration
      };

      this.updateStats(duration, false);
      this.emit('taskFailed', result);
      resolve(result); // Don't reject, return failed result instead
    } finally {
      this.stats.activeWorkers--;
    }
  }

  /**
   * Perform the actual operation (placeholder)
   */
  private async performOperation(operation: Operation, abortSignal: AbortSignal): Promise<unknown> {
    // This is a placeholder implementation that simulates operation execution
    // In a full implementation, this would be injected with the actual execution handler
    
    return new Promise((resolve, reject) => {
      // Check if already aborted
      if (abortSignal.aborted) {
        reject(new Error('Operation cancelled'));
        return;
      }

      // Simulate async work with a small delay
      const timeout = setTimeout(() => {
        // Return placeholder data that matches expected operation result structure
        switch (operation.type) {
          case 'analyze':
            resolve({
              filesAnalyzed: 1,
              results: {},
            });
            break;
          case 'edit':
            resolve({
              filesEdited: 1,
              changes: {},
              details: {},
            });
            break;
          case 'create':
            resolve({
              filesCreated: 1,
              paths: [],
            });
            break;
          case 'delete':
            resolve({
              filesDeleted: 1,
              paths: [],
            });
            break;
          case 'validate':
            resolve({
              valid: true,
              checks: {},
            });
            break;
          default:
            reject(new Error(`Unknown operation type: ${(operation as { type: string }).type}`));
        }
      }, Math.random() * 50 + 10); // Simulate work with random delay

      // Handle abort
      const abortHandler = () => {
        clearTimeout(timeout);
        reject(new Error('Operation cancelled'));
      };
      
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    });
  }

  /**
   * Update worker statistics
   */
  private updateStats(duration: number, success: boolean): void {
    if (success) {
      this.stats.completedTasks++;
    } else {
      this.stats.failedTasks++;
    }

    this.stats.totalExecutionTime += duration;
    const totalTasks = this.stats.completedTasks + this.stats.failedTasks;
    this.stats.averageExecutionTime = totalTasks > 0 ? this.stats.totalExecutionTime / totalTasks : 0;
  }

  /**
   * Get current worker statistics
   */
  getStats(): WorkerStats {
    return { ...this.stats };
  }

  /**
   * Shutdown the worker pool
   */
  async shutdown(timeout: number = 30000): Promise<void> {
    this.isShuttingDown = true;

    // Cancel all queued tasks
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      const result: OperationResult = {
        operationId: task.operation.id || 'unknown',
        status: 'cancelled',
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 0
      };
      task.resolve(result);
    }

    // Wait for active workers to complete or timeout
    const shutdownPromise = Promise.all(Array.from(this.workers));
    const timeoutPromise = new Promise<void>((resolve) => 
      setTimeout(resolve, timeout)
    );

    await Promise.race([shutdownPromise, timeoutPromise]);
    
    this.emit('shutdown');
  }
}

/**
 * Resource monitor for tracking system usage
 */
export class ResourceMonitor {
  private readonly limits: ResourceLimits;
  private memoryUsage = 0;
  private startTime = Date.now();

  constructor(limits: ResourceLimits) {
    this.limits = limits;
  }

  /**
   * Check if resource limits are exceeded
   */
  checkLimits(): { exceeded: boolean; reason?: string } {
    // Check execution time
    const elapsedTime = Date.now() - this.startTime;
    if (elapsedTime > this.limits.maxExecutionTime) {
      return { exceeded: true, reason: 'Maximum execution time exceeded' };
    }

    // Check memory usage
    if (this.memoryUsage > this.limits.maxMemoryUsage) {
      return { exceeded: true, reason: 'Maximum memory usage exceeded' };
    }

    // CPU usage would require platform-specific monitoring
    // For now, we'll skip CPU monitoring

    return { exceeded: false };
  }

  /**
   * Update memory usage
   */
  updateMemoryUsage(bytes: number): void {
    this.memoryUsage += bytes;
  }

  /**
   * Get current resource usage
   */
  getUsage() {
    return {
      memoryUsage: this.memoryUsage,
      executionTime: Date.now() - this.startTime,
      limits: this.limits
    };
  }

  /**
   * Reset monitoring
   */
  reset(): void {
    this.memoryUsage = 0;
    this.startTime = Date.now();
  }
}

/**
 * Parallel execution engine
 */
export class ParallelExecutionEngine extends EventEmitter {
  private readonly planner: OperationPlanner;
  private readonly workerPool: WorkerPool;
  private resourceMonitor?: ResourceMonitor;

  constructor(
    planner: OperationPlanner,
    workerPoolConfig: WorkerPoolConfig = {
      maxWorkers: 4,
      queueSize: 100,
      workerTimeout: 30000
    }
  ) {
    super();
    this.planner = planner;
    this.workerPool = new WorkerPool(workerPoolConfig);

    // Forward worker pool events
    this.workerPool.on('taskStarted', (event) => this.emit('operationStarted', event));
    this.workerPool.on('taskCompleted', (event) => this.emit('operationCompleted', event));
    this.workerPool.on('taskFailed', (event) => this.emit('operationFailed', event));
  }

  /**
   * Execute operations using the execution plan
   */
  async execute(
    operations: Operation[],
    options: ExecutionOptions = {}
  ): Promise<OperationResult[]> {
    const { abortSignal, progressCallback, resourceLimits, continueOnError = false } = options;

    // Create execution plan
    const plan = this.planner.createExecutionPlan(operations);
    
    // Initialize resource monitoring
    if (resourceLimits) {
      this.resourceMonitor = new ResourceMonitor(resourceLimits);
    }

    // Initialize progress tracking
    const progress: ProgressInfo = {
      totalOperations: operations.length,
      completedOperations: 0,
      failedOperations: 0,
      cancelledOperations: 0,
      currentStage: 0,
      totalStages: plan.stages.length,
      estimatedTimeRemaining: plan.totalEstimatedDuration,
      percentComplete: 0
    };

    const results: OperationResult[] = [];
    const startTime = Date.now();

    try {
      // Execute stages sequentially, operations within stages in parallel
      for (let stageIndex = 0; stageIndex < plan.stages.length; stageIndex++) {
        const stage = plan.stages[stageIndex];
        progress.currentStage = stageIndex + 1;

        // Check abort signal
        if (abortSignal?.aborted) {
          break;
        }

        // Check resource limits
        if (this.resourceMonitor) {
          const limitCheck = this.resourceMonitor.checkLimits();
          if (limitCheck.exceeded) {
            throw new Error(limitCheck.reason);
          }
        }

        // Execute stage operations
        const stageResults = await this.executeStage(stage, abortSignal);
        results.push(...stageResults);

        // Update progress
        for (const result of stageResults) {
          switch (result.status) {
            case 'success':
              progress.completedOperations++;
              break;
            case 'failed':
              progress.failedOperations++;
              if (!continueOnError) {
                throw new Error(`Operation ${result.operationId} failed: ${result.error}`);
              }
              break;
            case 'cancelled':
              progress.cancelledOperations++;
              break;
            default:
              // Handle any unexpected status values
              break;
          }
        }

        // Calculate progress
        const totalProcessed = progress.completedOperations + progress.failedOperations + progress.cancelledOperations;
        progress.percentComplete = Math.round((totalProcessed / progress.totalOperations) * 100);
        
        // Estimate remaining time
        const elapsedTime = Date.now() - startTime;
        const averageTimePerOperation = totalProcessed > 0 ? elapsedTime / totalProcessed : 0;
        const remainingOperations = progress.totalOperations - totalProcessed;
        progress.estimatedTimeRemaining = Math.round(remainingOperations * averageTimePerOperation);

        // Report progress
        if (progressCallback) {
          progressCallback(progress);
        }
        this.emit('progress', progress);
      }

      return results;

    } catch (error) {
      // Cancel remaining operations
      for (const result of results) {
        if (result.status === 'success') {
          continue; // Don't cancel completed operations
        }
      }

      throw error;
    }
  }

  /**
   * Execute a single stage (operations in parallel)
   */
  private async executeStage(
    stage: ExecutionStage<Operation>,
    abortSignal?: AbortSignal
  ): Promise<OperationResult[]> {
    if (stage.canRunInParallel && stage.operations.length > 1) {
      // Execute operations in parallel
      const promises = stage.operations.map(operation => 
        this.workerPool.execute(operation, this.getOperationPriority(operation), abortSignal)
      );
      return Promise.all(promises);
    } else {
      // Execute operations sequentially
      const results: OperationResult[] = [];
      for (const operation of stage.operations) {
        if (abortSignal?.aborted) {
          break;
        }
        const result = await this.workerPool.execute(operation, this.getOperationPriority(operation), abortSignal);
        results.push(result);

        // Stop if operation failed and not continuing on error
        if (result.status === 'failed') {
          break;
        }
      }
      return results;
    }
  }

  /**
   * Get operation priority based on type
   */
  private getOperationPriority(operation: Operation): number {
    const priorities: Record<string, number> = {
      'analyze': 3,
      'validate': 2,
      'edit': 1,
      'create': 1,
      'delete': 0
    };
    return priorities[operation.type] || 1;
  }

  /**
   * Get worker pool statistics
   */
  getStats(): WorkerStats {
    return this.workerPool.getStats();
  }

  /**
   * Get resource usage information
   */
  getResourceUsage() {
    return this.resourceMonitor?.getUsage() || null;
  }

  /**
   * Shutdown the execution engine
   */
  async shutdown(timeout?: number): Promise<void> {
    await this.workerPool.shutdown(timeout);
    this.emit('shutdown');
  }
}