/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import {
  Operation,
  OperationResult,
  FileOperationResponse,
  AnalyzeOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  ValidateOperation,
  AnalyzeResult,
  EditResult,
  CreateResult,
  DeleteResult,
  ValidateResult,
  OperationError,
} from './file-operations-types.js';
import { Analyzer } from './components/analyzer.js';
import { Editor } from './components/editor.js';
import { Validator } from './components/validator.js';
import { FileSystemService } from './services/file-system-service.js';
import { CacheManager } from './services/cache-manager.js';
import { TransactionManager } from './services/transaction-manager.js';
import { ASTParserService } from './services/ast-parser.js';
import { ResponseBuilder, ProgressCallback } from './response-builder.js';
import { recordToolCallMetrics } from '../../telemetry/metrics.js';
import { FileOperationError } from './file-operations-errors.js';

/**
 * Execution context for operations
 */
interface ExecutionContext {
  fileSystemService: FileSystemService;
  cacheManager: CacheManager;
  transactionManager: TransactionManager;
  astParser: ASTParserService;
  analyzer: Analyzer;
  editor: Editor;
  validator: Validator;
  responseBuilder: ResponseBuilder;
  abortSignal?: AbortSignal;
  progressCallback?: ProgressCallback;
  isTransaction: boolean;
}

/**
 * The execution engine orchestrates the execution of file operations
 * by coordinating all components and handling operation dispatch
 */
export class ExecutionEngine {
  private readonly rootDirectory: string;
  private readonly fileSystemService: FileSystemService;
  private readonly cacheManager: CacheManager;
  private readonly astParser: ASTParserService;
  private readonly analyzer: Analyzer;
  private readonly editor: Editor;
  private readonly validator: Validator;

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory;
    
    // Initialize services
    this.fileSystemService = new FileSystemService(rootDirectory);
    this.cacheManager = new CacheManager(this.fileSystemService, {
      maxSizeBytes: 100 * 1024 * 1024, // 100MB
      maxEntries: 1000,
      ttlMs: 15 * 60 * 1000, // 15 minutes
    });
    this.astParser = new ASTParserService(this.cacheManager);
    
    // Initialize components
    this.analyzer = new Analyzer(this.fileSystemService, this.astParser);
    this.editor = new Editor(this.fileSystemService, this.astParser);
    this.validator = new Validator(this.fileSystemService, this.astParser);
  }

  /**
   * Execute a single operation
   */
  async executeOperation(
    operation: Operation,
    context: ExecutionContext
  ): Promise<OperationResult> {
    const operationId = operation.id || `${operation.type}-${Date.now()}`;
    const startTime = Date.now();

    try {
      // Check abort signal
      if (context.abortSignal?.aborted) {
        return {
          operationId,
          type: operation.type,
          status: 'cancelled',
          error: {
            message: 'Operation was cancelled',
            code: 'CANCELLED',
          },
        };
      }

      // Report progress
      context.progressCallback?.(`Starting ${operation.type} operation: ${operationId}`);

      // Dispatch to appropriate handler
      let data;
      switch (operation.type) {
        case 'analyze':
          data = await this.executeAnalyze(operation as AnalyzeOperation, context);
          break;
        case 'edit':
          data = await this.executeEdit(operation as EditOperation, context);
          break;
        case 'create':
          data = await this.executeCreate(operation as CreateOperation, context);
          break;
        case 'delete':
          data = await this.executeDelete(operation as DeleteOperation, context);
          break;
        case 'validate':
          data = await this.executeValidate(operation as ValidateOperation, context);
          break;
        default:
          throw new Error(`Unknown operation type: ${(operation as { type: string }).type}`);
      }

      const duration = Date.now() - startTime;

      // Record metrics
      recordToolCallMetrics(`file_operations_${operation.type}`, duration, true);

      // Report completion
      context.progressCallback?.(`Completed ${operation.type} operation: ${operationId}`);

      return {
        operationId,
        type: operation.type,
        status: 'success',
        data,
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record metrics
      recordToolCallMetrics(`file_operations_${operation.type}`, duration, false);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof FileOperationError ? error.code : 'UNKNOWN_ERROR';

      // Report error
      context.progressCallback?.(`Failed ${operation.type} operation: ${operationId} - ${errorMessage}`);

      return {
        operationId,
        type: operation.type,
        status: 'failed',
        error: {
          message: errorMessage,
          code: errorCode,
          details: error instanceof FileOperationError ? error.details : undefined,
        },
        duration,
      };
    }
  }

  /**
   * Execute analyze operation
   */
  private async executeAnalyze(
    operation: AnalyzeOperation,
    context: ExecutionContext
  ): Promise<AnalyzeResult> {
    const result: AnalyzeResult = {
      filesAnalyzed: 0,
      results: {},
    };

    for (const filePath of operation.paths) {
      const absolutePath = this.resolvePath(filePath);

      // Check cache first
      const cacheKey = `analyze:${absolutePath}:${JSON.stringify(operation)}`;
      const cached = await context.cacheManager.get(cacheKey);
      if (cached) {
        result.results[filePath] = cached;
        result.filesAnalyzed++;
        continue;
      }

      // Perform analysis
      const fileResult = await context.analyzer.analyze(absolutePath, {
        search: operation.search,
        patterns: operation.patterns,
        extract: operation.extract,
      });

      result.results[filePath] = fileResult;
      result.filesAnalyzed++;

      // Cache the result
      await context.cacheManager.set(cacheKey, fileResult);

      // Accumulate matches
      if (fileResult.matches) {
        if (!result.matches) result.matches = [];
        result.matches.push(...fileResult.matches);
      }

      // Accumulate extracted data
      if (fileResult.extracted) {
        if (!result.extracted) result.extracted = {};
        result.extracted[filePath] = fileResult.extracted;
      }
    }

    return result;
  }

  /**
   * Execute edit operation
   */
  private async executeEdit(
    operation: EditOperation,
    context: ExecutionContext
  ): Promise<EditResult> {
    const result: EditResult = {
      filesEdited: 0,
      changes: {},
      details: {},
    };

    // Track file changes for transaction support
    const modifiedFiles: string[] = [];

    try {
      for (const edit of operation.edits) {
        const absolutePath = this.resolvePath(edit.file);
        modifiedFiles.push(absolutePath);

        // Read original content (for tracking changes)
        const originalContent = await context.fileSystemService.readFile(absolutePath);

        // Apply edits
        const editResult = await context.editor.edit(absolutePath, edit.changes, {
          dryRun: operation.dryRun,
          createBackup: operation.createBackup,
        });

        result.filesEdited++;
        result.changes[edit.file] = editResult.changeCount;
        result.details[edit.file] = editResult;

        // Track file change for response builder
        if (!operation.dryRun) {
          const newContent = await context.fileSystemService.readFile(absolutePath);
          context.responseBuilder.trackFileChange({
            path: absolutePath,
            type: 'modified',
            oldContent: originalContent,
            newContent: newContent,
          });
        }

        // Collect syntax errors
        if (editResult.syntaxErrors?.length > 0) {
          if (!result.syntaxErrors) result.syntaxErrors = [];
          result.syntaxErrors.push(...editResult.syntaxErrors);
        }
      }

      return result;

    } catch (error) {
      // Rollback changes if in transaction mode
      if (context.isTransaction && modifiedFiles.length > 0) {
        context.progressCallback?.('Rolling back edit operation due to error');
        for (const file of modifiedFiles) {
          try {
            await context.transactionManager.rollback(file);
          } catch (rollbackError) {
            // Log rollback error but continue
            console.error('Rollback failed for file:', file, rollbackError);
          }
        }
      }
      throw error;
    }
  }

  /**
   * Execute create operation
   */
  private async executeCreate(
    operation: CreateOperation,
    context: ExecutionContext
  ): Promise<CreateResult> {
    const result: CreateResult = {
      filesCreated: 0,
      paths: [],
    };

    const createdFiles: string[] = [];

    try {
      for (const file of operation.files) {
        const absolutePath = this.resolvePath(file.path);

        // Check if file exists
        const exists = await context.fileSystemService.exists(absolutePath);
        if (exists && !operation.overwrite) {
          if (!result.alreadyExisted) result.alreadyExisted = [];
          result.alreadyExisted.push(file.path);
          continue;
        }

        // Create file
        await context.fileSystemService.writeFile(
          absolutePath,
          file.content || '',
          file.encoding
        );

        // Set permissions if specified
        if (file.mode) {
          await context.fileSystemService.chmod(absolutePath, file.mode);
        }

        result.filesCreated++;
        result.paths.push(file.path);
        createdFiles.push(absolutePath);

        // Track file change
        context.responseBuilder.trackFileChange({
          path: absolutePath,
          type: 'created',
          newContent: file.content || '',
        });
      }

      return result;

    } catch (error) {
      // Clean up created files if in transaction mode
      if (context.isTransaction && createdFiles.length > 0) {
        context.progressCallback?.('Rolling back create operation due to error');
        for (const file of createdFiles) {
          try {
            await context.fileSystemService.unlink(file);
          } catch (cleanupError) {
            console.error('Cleanup failed for file:', file, cleanupError);
          }
        }
      }
      throw error;
    }
  }

  /**
   * Execute delete operation
   */
  private async executeDelete(
    operation: DeleteOperation,
    context: ExecutionContext
  ): Promise<DeleteResult> {
    const result: DeleteResult = {
      filesDeleted: 0,
      paths: [],
    };

    const deletedFiles: Array<{ path: string; content: string }> = [];

    try {
      for (const pattern of operation.paths) {
        // Resolve files matching pattern
        const files = await context.fileSystemService.glob(pattern);

        for (const file of files) {
          const absolutePath = this.resolvePath(file);

          // Check if file exists
          const exists = await context.fileSystemService.exists(absolutePath);
          if (!exists) {
            if (!result.notFound) result.notFound = [];
            result.notFound.push(file);
            continue;
          }

          // Save content for potential rollback
          if (context.isTransaction) {
            const content = await context.fileSystemService.readFile(absolutePath);
            deletedFiles.push({ path: absolutePath, content });
          }

          // Delete file
          await context.fileSystemService.unlink(absolutePath);

          result.filesDeleted++;
          result.paths.push(file);

          // Track file change
          context.responseBuilder.trackFileChange({
            path: absolutePath,
            type: 'deleted',
          });
        }
      }

      // Remove empty directories if specified
      if (operation.removeEmptyDirs) {
        const directories = new Set<string>();
        for (const file of result.paths) {
          directories.add(path.dirname(this.resolvePath(file)));
        }

        for (const dir of directories) {
          const isEmpty = await this.isDirectoryEmpty(dir, context);
          if (isEmpty) {
            await context.fileSystemService.rmdir(dir);
            if (!result.directoriesRemoved) result.directoriesRemoved = [];
            result.directoriesRemoved.push(dir);
          }
        }
      }

      return result;

    } catch (error) {
      // Restore deleted files if in transaction mode
      if (context.isTransaction && deletedFiles.length > 0) {
        context.progressCallback?.('Rolling back delete operation due to error');
        for (const { path: filePath, content } of deletedFiles) {
          try {
            await context.fileSystemService.writeFile(filePath, content);
          } catch (restoreError) {
            console.error('Restore failed for file:', filePath, restoreError);
          }
        }
      }
      throw error;
    }
  }

  /**
   * Execute validate operation
   */
  private async executeValidate(
    operation: ValidateOperation,
    context: ExecutionContext
  ): Promise<ValidateResult> {
    const result = await context.validator.validate({
      files: operation.files?.map(f => this.resolvePath(f)),
      commands: operation.commands,
      checks: operation.checks,
      fix: operation.fix,
    });

    // Track fixed files
    if (result.fixed && result.fixed.length > 0) {
      for (const file of result.fixed) {
        context.responseBuilder.trackFileChange({
          path: file,
          type: 'modified',
        });
      }
    }

    return result;
  }

  /**
   * Resolve file path relative to root directory
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.rootDirectory, filePath);
  }

  /**
   * Check if directory is empty
   */
  private async isDirectoryEmpty(dirPath: string, context: ExecutionContext): Promise<boolean> {
    try {
      const entries = await context.fileSystemService.readdir(dirPath);
      return entries.length === 0;
    } catch {
      return false;
    }
  }

  /**
   * Create execution context
   */
  createExecutionContext(
    responseBuilder: ResponseBuilder,
    abortSignal?: AbortSignal,
    progressCallback?: ProgressCallback,
    isTransaction: boolean = false
  ): ExecutionContext {
    return {
      fileSystemService: this.fileSystemService,
      cacheManager: this.cacheManager,
      transactionManager: new TransactionManager(this.fileSystemService),
      astParser: this.astParser,
      analyzer: this.analyzer,
      editor: this.editor,
      validator: this.validator,
      responseBuilder,
      abortSignal,
      progressCallback,
      isTransaction,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // CacheManager doesn't need explicit cleanup
    // Just clear the cache
    this.cacheManager.clear();
  }
}