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
  ValidationIssue,
  Change,
  FindReplaceChange,
  LineChange,
  PositionChange,
} from './file-operations-types.js';
import { Analyzer } from './components/analyzer.js';
// Editor component removed - functionality integrated into FileSystemService
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
  private readonly validator: Validator;

  constructor(rootDirectory: string, enablePredictiveCache: boolean = true) {
    this.rootDirectory = rootDirectory;
    
    // Initialize services
    this.fileSystemService = new FileSystemService(rootDirectory);
    this.cacheManager = new CacheManager(this.fileSystemService, {
      maxSizeBytes: 100 * 1024 * 1024, // 100MB
      maxEntries: 1000,
      ttlMs: 15 * 60 * 1000, // 15 minutes,
      predictiveCache: enablePredictiveCache ? {
        enabled: true,
        maxPredictions: 5,
        predictionThreshold: 0.6,
        backgroundLoadingConcurrency: 2,
        patternWindowMs: 1000 * 60 * 60 * 24, // 24 hours
        warmingStrategies: [
          {
            name: 'startup',
            priority: 10,
            enabled: true,
            trigger: 'startup',
            maxFiles: 10,
            patterns: ['**/*.ts', '**/*.js', '**/*.json']
          },
          {
            name: 'pattern',
            priority: 5,
            enabled: true,
            trigger: 'pattern',
            maxFiles: 5,
            patterns: ['**/*']
          }
        ],
        modelUpdateInterval: 1000 * 60 * 10, // 10 minutes
        enableOnlineLearning: true
      } : undefined
    });
    this.astParser = new ASTParserService(this.cacheManager);
    
    // Initialize components
    this.analyzer = new Analyzer(this.astParser, this.fileSystemService, this.cacheManager);
    this.validator = new Validator(this.astParser, this.fileSystemService, this.cacheManager);
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
            operationId,
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
          operationId,
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
    };

    // Record access patterns for predictive caching
    operation.paths.forEach(filePath => {
      context.cacheManager.recordAccess(filePath, 'analyze', operation.id);
    });

    // Analyze all paths
    const analysisResult = await context.analyzer.analyze(operation);

    // Convert AnalysisResult to AnalyzeResult
    result.filesAnalyzed = analysisResult.files.length;

    // Convert pattern matches to search matches
    if (analysisResult.patterns && analysisResult.patterns.length > 0) {
      result.matches = analysisResult.patterns.map(pm => ({
        file: pm.file,
        line: pm.line,
        column: pm.column,
        match: pm.match,
        contextBefore: pm.context ? [pm.context] : undefined,
        contextAfter: undefined,
      }));
    }

    // Convert file analysis to extracted data if requested
    if (operation.extract && operation.extract.length > 0) {
      result.extracted = {};
      for (const file of analysisResult.files) {
        const extractedData: any = {};
        
        if (operation.extract.includes('imports') || operation.extract.includes('all')) {
          extractedData.imports = file.imports.map(imp => ({
            source: imp,
            line: 1, // Would need to be extracted from AST
          }));
        }
        
        if (operation.extract.includes('exports') || operation.extract.includes('all')) {
          extractedData.exports = file.exports.map(exp => ({
            name: exp,
            type: 'named' as const,
            line: 1, // Would need to be extracted from AST
          }));
        }
        
        if (operation.extract.includes('functions') || operation.extract.includes('all')) {
          extractedData.functions = file.symbols
            .filter(s => s.type === 'function')
            .map(s => ({
              name: s.name,
              async: false, // Would need to be extracted from AST
              generator: false,
              params: [],
              line: s.position.line,
              endLine: s.position.line,
            }));
        }
        
        if (operation.extract.includes('classes') || operation.extract.includes('all')) {
          extractedData.classes = file.symbols
            .filter(s => s.type === 'class')
            .map(s => ({
              name: s.name,
              abstract: false,
              line: s.position.line,
              endLine: s.position.line,
            }));
        }
        
        if (Object.keys(extractedData).length > 0) {
          result.extracted[file.path] = extractedData;
        }
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
    };

    // Record access patterns for predictive caching
    operation.edits.forEach(edit => {
      context.cacheManager.recordAccess(edit.file, 'edit', operation.id);
    });

    // Track file changes for transaction support
    const modifiedFiles: string[] = [];

    try {
      for (const edit of operation.edits) {
        const absolutePath = this.resolvePath(edit.file);
        modifiedFiles.push(absolutePath);

        // Read original content (for tracking changes)
        const originalContent = await context.fileSystemService.readFile(absolutePath);

        // Apply edits
        const editResult = await this.applyEdits(absolutePath, edit.changes, {
          validateSyntax: operation.validateSyntax,
          preserveFormatting: operation.preserveFormatting,
          fileSystemService: context.fileSystemService,
          astParser: context.astParser,
        });

        if (editResult.changeCount > 0) {
          result.filesEdited++;
          result.changes[edit.file] = editResult.changeCount;
        }

        // Track file change for response builder
        if (editResult.changeCount > 0) {
          const newContent = await context.fileSystemService.readFile(absolutePath);
          context.responseBuilder.trackFileChange({
            path: absolutePath,
            type: 'modified',
            oldContent: originalContent,
            newContent: newContent,
          });
        }

        // Collect syntax errors
        if (editResult.syntaxErrors && editResult.syntaxErrors.length > 0) {
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
      created: [],
    };

    // Record access patterns for predictive caching
    operation.files.forEach(file => {
      context.cacheManager.recordAccess(file.path, 'create', operation.id);
    });

    const createdFiles: string[] = [];

    try {
      for (const file of operation.files) {
        const absolutePath = this.resolvePath(file.path);

        // Check if file exists
        const exists = await context.fileSystemService.exists(absolutePath);
        if (exists) {
          if (!result.alreadyExisted) result.alreadyExisted = [];
          result.alreadyExisted.push(file.path);
          continue;
        }

        // Create file
        await context.fileSystemService.writeFile(
          absolutePath,
          file.content || ''
        );

        // Set permissions if specified
        if (file.mode) {
          await context.fileSystemService.chmod(absolutePath, file.mode);
        }

        result.filesCreated++;
        result.created.push(file.path);
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
      deleted: [],
    };

    // Record access patterns for predictive caching
    operation.paths.forEach(filePath => {
      context.cacheManager.recordAccess(filePath, 'delete', operation.id);
    });

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
          result.deleted.push(file);

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
        for (const file of result.deleted) {
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
    // Record access patterns for predictive caching
    operation.files?.forEach((filePath: string) => {
      context.cacheManager.recordAccess(filePath, 'validate', operation.id);
    });

    // Map paths to absolute paths
    const mappedOperation: ValidateOperation = {
      ...operation,
      files: operation.files?.map(f => this.resolvePath(f))
    };

    const validationResult = await context.validator.validate(mappedOperation, {
      enableAutoFix: operation.autoFix
    });

    // Convert ValidationResult to ValidateResult
    const checks: Record<string, { passed: boolean; issueCount: number; issues?: ValidationIssue[] }> = {};
    
    // Group issues by check type
    for (const fileResult of validationResult.fileResults) {
      for (const issue of fileResult.issues) {
        const checkType = issue.rule || 'general';
        if (!checks[checkType]) {
          checks[checkType] = { passed: true, issueCount: 0, issues: [] };
        }
        checks[checkType].issueCount++;
        checks[checkType].passed = false;
        checks[checkType].issues?.push(issue);
      }
    }

    // Add external validator results
    if (validationResult.externalValidatorResults) {
      for (const result of validationResult.externalValidatorResults) {
        checks[result.validator] = {
          passed: result.success,
          issueCount: result.issues?.length || 0,
          issues: result.issues
        };
      }
    }

    const result: ValidateResult = {
      valid: validationResult.valid,
      checks
    };

    // Track fixed files if any (placeholder for now)
    // In a real implementation, we'd track which files were auto-fixed
    if (operation.autoFix) {
      // Track files that were modified by auto-fix
      // This would require the validator to return fixed file paths
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
      validator: this.validator,
      responseBuilder,
      abortSignal,
      progressCallback,
      isTransaction,
    };
  }

  /**
   * Apply edits to a file (replacement for Editor component)
   */
  private async applyEdits(
    filePath: string,
    changes: Change[],
    options: {
      validateSyntax?: boolean;
      preserveFormatting?: boolean;
      fileSystemService: FileSystemService;
      astParser: ASTParserService;
    }
  ): Promise<{ success: boolean; changeCount: number; errors: string[]; syntaxErrors?: string[] }> {
    try {
      const content = await options.fileSystemService.readFile(filePath);
      let modifiedContent = content;
      let changeCount = 0;
      const errors: string[] = [];

      // Apply changes
      for (const change of changes) {
        try {
          switch (change.type) {
            case 'find-replace':
              const findReplaceChange = change as FindReplaceChange;
              const pattern = findReplaceChange.regex 
                ? new RegExp(findReplaceChange.find, findReplaceChange.replaceAll ? 'g' : '')
                : findReplaceChange.find;
              
              const beforeContent = modifiedContent;
              if (findReplaceChange.regex) {
                modifiedContent = modifiedContent.replace(pattern as RegExp, findReplaceChange.replace);
              } else {
                if (findReplaceChange.replaceAll) {
                  modifiedContent = modifiedContent.split(findReplaceChange.find).join(findReplaceChange.replace);
                } else {
                  modifiedContent = modifiedContent.replace(findReplaceChange.find, findReplaceChange.replace);
                }
              }
              // Count change if content actually changed
              if (modifiedContent !== beforeContent) {
                changeCount++;
              }
              break;

            case 'line':
              const lineChange = change as LineChange;
              const lines = modifiedContent.split('\n');
              if (lineChange.line > 0 && lineChange.line <= lines.length) {
                if (lineChange.operation === 'replace') {
                  lines[lineChange.line - 1] = lineChange.content || '';
                  changeCount++;
                } else if (lineChange.operation === 'insert') {
                  lines.splice(lineChange.line - 1, 0, lineChange.content || '');
                  changeCount++;
                } else if (lineChange.operation === 'delete') {
                  lines.splice(lineChange.line - 1, 1);
                  changeCount++;
                }
                modifiedContent = lines.join('\n');
              }
              break;

            case 'position':
              const posChange = change as PositionChange;
              if (posChange.start >= 0 && posChange.start <= modifiedContent.length) {
                const before = modifiedContent.substring(0, posChange.start);
                const after = modifiedContent.substring(posChange.end || posChange.start);
                modifiedContent = before + posChange.content + after;
                changeCount++;
              }
              break;

            default:
              errors.push(`Unsupported change type: ${change.type}`);
          }
        } catch (error) {
          errors.push(`Error applying change: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Write modified content
      if (changeCount > 0) {
        await options.fileSystemService.writeFile(filePath, modifiedContent);
      }

      return { success: errors.length === 0, changeCount, errors, syntaxErrors: [] };
    } catch (error) {
      return { 
        success: false, 
        changeCount: 0, 
        errors: [`Failed to apply edits: ${error instanceof Error ? error.message : String(error)}`],
        syntaxErrors: []
      };
    }
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