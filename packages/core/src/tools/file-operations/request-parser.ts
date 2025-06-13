/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { SchemaValidator } from '../../utils/schemaValidator.js';
import { isWithinRoot } from '../../utils/fileUtils.js';
import {
  FileOperationRequest,
  Operation,
  AnalyzeOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  ValidateOperation,
  FileEdit,
  Change,
  FindReplaceChange,
  LineChange,
  PositionChange,
  ASTChange,
  FileCreation,
} from './file-operations-types.js';
import { fileOperationsSchema } from './file-operations-schema.js';
import { ValidationError, DependencyError } from './file-operations-errors.js';

/**
 * Operation dependency info for validation and optimization
 */
interface OperationNode {
  operation: Operation;
  dependencies: Set<string>;
  dependents: Set<string>;
}

/**
 * Optimization result for operations
 */
interface OptimizedOperations {
  operations: Operation[];
  optimizations: string[];
}

/**
 * Parses and validates FileOperation requests with comprehensive validation
 * and optimization capabilities
 */
export class RequestParser {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  /**
   * Parse and validate a FileOperation request
   * @param params The request parameters to parse
   * @returns The validated and optimized request
   * @throws ValidationError if validation fails
   */
  async parseRequest(params: unknown): Promise<FileOperationRequest> {
    // Step 1: Schema validation
    this.validateSchema(params);
    const request = params as FileOperationRequest;

    // Step 2: Deep validation
    this.validateRequest(request);

    // Step 3: Validate and resolve dependencies
    this.validateAndResolveDependencies(request.operations);

    // Step 4: Optimize operations
    const optimized = this.optimizeOperations(request.operations);
    
    // Return the validated and optimized request
    return {
      ...request,
      operations: optimized.operations,
    };
  }

  /**
   * Validate request against schema
   */
  private validateSchema(params: unknown): void {
    if (!SchemaValidator.validate(fileOperationsSchema as Record<string, unknown>, params)) {
      throw new ValidationError('Request failed schema validation');
    }
  }

  /**
   * Perform deep validation beyond schema
   */
  private validateRequest(request: FileOperationRequest): void {
    // Validate operations array
    if (!request.operations || request.operations.length === 0) {
      throw new ValidationError('At least one operation must be specified');
    }

    // Validate each operation
    const operationIds = new Set<string>();
    request.operations.forEach((operation, index) => {
      const operationId = operation.id || `operation_${index}`;
      
      // Check for duplicate IDs
      if (operation.id) {
        if (operationIds.has(operation.id)) {
          throw new ValidationError(`Duplicate operation ID: ${operation.id}`);
        }
        operationIds.add(operation.id);
      }

      // Validate specific operation type
      this.validateOperation(operation, operationId);
    });

    // Validate options
    if (request.options) {
      this.validateOptions(request.options);
    }
  }

  /**
   * Validate a single operation
   */
  private validateOperation(operation: Operation, operationId: string): void {
    switch (operation.type) {
      case 'analyze':
        this.validateAnalyzeOperation(operation as AnalyzeOperation, operationId);
        break;
      case 'edit':
        this.validateEditOperation(operation as EditOperation, operationId);
        break;
      case 'create':
        this.validateCreateOperation(operation as CreateOperation, operationId);
        break;
      case 'delete':
        this.validateDeleteOperation(operation as DeleteOperation, operationId);
        break;
      case 'validate':
        this.validateValidateOperation(operation as ValidateOperation, operationId);
        break;
      default:
        throw new ValidationError(
          `Unknown operation type: ${(operation as any).type}`,
          operationId
        );
    }
  }

  /**
   * Validate analyze operation
   */
  private validateAnalyzeOperation(operation: AnalyzeOperation, operationId: string): void {
    // Validate paths
    if (!operation.paths || operation.paths.length === 0) {
      throw new ValidationError(
        'Analyze operation must specify at least one path',
        operationId
      );
    }

    // Validate paths are safe
    operation.paths.forEach(filePath => {
      this.validatePath(filePath, operationId, 'analyze');
    });

    // Validate search options
    if (operation.search) {
      if (!operation.search.pattern || operation.search.pattern.trim() === '') {
        throw new ValidationError(
          'Search pattern cannot be empty',
          operationId
        );
      }

      if (operation.search.type === 'regex') {
        try {
          new RegExp(operation.search.pattern);
        } catch (e) {
          throw new ValidationError(
            `Invalid regex pattern: ${operation.search.pattern}`,
            operationId,
            { error: e }
          );
        }
      }

      if (operation.search.contextLines !== undefined) {
        if (operation.search.contextLines < 0 || operation.search.contextLines > 100) {
          throw new ValidationError(
            'Context lines must be between 0 and 100',
            operationId
          );
        }
      }
    }

    // Validate patterns (simplified search)
    if (operation.patterns) {
      operation.patterns.forEach((pattern, index) => {
        if (!pattern || pattern.trim() === '') {
          throw new ValidationError(
            `Pattern at index ${index} cannot be empty`,
            operationId
          );
        }
      });
    }

    // Validate extract types
    if (operation.extract) {
      const validExtractTypes = new Set([
        'imports', 'exports', 'functions', 'classes',
        'interfaces', 'types', 'variables', 'todos',
        'dependencies', 'complexity', 'all'
      ]);

      operation.extract.forEach(extractType => {
        if (!validExtractTypes.has(extractType)) {
          throw new ValidationError(
            `Invalid extract type: ${extractType}`,
            operationId
          );
        }
      });
    }
  }

  /**
   * Validate edit operation
   */
  private validateEditOperation(operation: EditOperation, operationId: string): void {
    if (!operation.edits || operation.edits.length === 0) {
      throw new ValidationError(
        'Edit operation must specify at least one edit',
        operationId
      );
    }

    operation.edits.forEach((edit, editIndex) => {
      this.validateFileEdit(edit, operationId, editIndex);
    });
  }

  /**
   * Validate a file edit
   */
  private validateFileEdit(edit: FileEdit, operationId: string, editIndex: number): void {
    if (!edit.file || edit.file.trim() === '') {
      throw new ValidationError(
        `Edit at index ${editIndex} must specify a file`,
        operationId
      );
    }

    // Validate file path
    this.validatePath(edit.file, operationId, 'edit');

    if (!edit.changes || edit.changes.length === 0) {
      throw new ValidationError(
        `Edit for file ${edit.file} must specify at least one change`,
        operationId
      );
    }

    // Validate changes
    edit.changes.forEach((change, changeIndex) => {
      this.validateChange(change, edit.file, operationId, changeIndex);
    });
  }

  /**
   * Validate a single change
   */
  private validateChange(
    change: Change,
    file: string,
    operationId: string,
    changeIndex: number
  ): void {
    switch (change.type) {
      case 'find-replace':
        this.validateFindReplaceChange(change as FindReplaceChange, file, operationId, changeIndex);
        break;
      case 'line':
        this.validateLineChange(change as LineChange, file, operationId, changeIndex);
        break;
      case 'position':
        this.validatePositionChange(change as PositionChange, file, operationId, changeIndex);
        break;
      case 'ast':
        this.validateASTChange(change as ASTChange, file, operationId, changeIndex);
        break;
      default:
        throw new ValidationError(
          `Unknown change type: ${(change as any).type} at index ${changeIndex}`,
          operationId
        );
    }
  }

  /**
   * Validate find-replace change
   */
  private validateFindReplaceChange(
    change: FindReplaceChange,
    file: string,
    operationId: string,
    changeIndex: number
  ): void {
    if (!change.find) {
      throw new ValidationError(
        `Find-replace change at index ${changeIndex} in ${file} must specify 'find'`,
        operationId
      );
    }

    if (change.replace === undefined) {
      throw new ValidationError(
        `Find-replace change at index ${changeIndex} in ${file} must specify 'replace'`,
        operationId
      );
    }

    if (change.regex) {
      try {
        new RegExp(change.find);
      } catch (e) {
        throw new ValidationError(
          `Invalid regex in find-replace at index ${changeIndex}: ${change.find}`,
          operationId,
          { error: e }
        );
      }
    }
  }

  /**
   * Validate line change
   */
  private validateLineChange(
    change: LineChange,
    file: string,
    operationId: string,
    changeIndex: number
  ): void {
    if (!change.line || change.line < 1) {
      throw new ValidationError(
        `Line change at index ${changeIndex} in ${file} must specify a positive line number`,
        operationId
      );
    }

    if (!['insert', 'replace', 'delete'].includes(change.operation)) {
      throw new ValidationError(
        `Invalid line operation at index ${changeIndex}: ${change.operation}`,
        operationId
      );
    }

    if (change.operation !== 'delete' && change.content === undefined) {
      throw new ValidationError(
        `Line ${change.operation} at index ${changeIndex} in ${file} must specify content`,
        operationId
      );
    }
  }

  /**
   * Validate position change
   */
  private validatePositionChange(
    change: PositionChange,
    file: string,
    operationId: string,
    changeIndex: number
  ): void {
    if (change.start < 0) {
      throw new ValidationError(
        `Position change at index ${changeIndex} in ${file}: start must be non-negative`,
        operationId
      );
    }

    if (change.end < 0) {
      throw new ValidationError(
        `Position change at index ${changeIndex} in ${file}: end must be non-negative`,
        operationId
      );
    }

    if (change.start > change.end) {
      throw new ValidationError(
        `Position change at index ${changeIndex} in ${file}: start must not exceed end`,
        operationId
      );
    }

    if (change.content === undefined) {
      throw new ValidationError(
        `Position change at index ${changeIndex} in ${file} must specify content`,
        operationId
      );
    }
  }

  /**
   * Validate AST change
   */
  private validateASTChange(
    change: ASTChange,
    file: string,
    operationId: string,
    changeIndex: number
  ): void {
    if (!change.query || change.query.trim() === '') {
      throw new ValidationError(
        `AST change at index ${changeIndex} in ${file} must specify a query`,
        operationId
      );
    }

    if (!change.transform) {
      throw new ValidationError(
        `AST change at index ${changeIndex} in ${file} must specify a transform`,
        operationId
      );
    }

    const validTransformTypes = ['rename', 'wrap', 'unwrap', 'replace', 'remove'];
    if (!validTransformTypes.includes(change.transform.type)) {
      throw new ValidationError(
        `Invalid AST transform type at index ${changeIndex}: ${change.transform.type}`,
        operationId
      );
    }
  }

  /**
   * Validate create operation
   */
  private validateCreateOperation(operation: CreateOperation, operationId: string): void {
    if (!operation.files || operation.files.length === 0) {
      throw new ValidationError(
        'Create operation must specify at least one file',
        operationId
      );
    }

    operation.files.forEach((file, index) => {
      this.validateFileCreation(file, operationId, index);
    });
  }

  /**
   * Validate file creation
   */
  private validateFileCreation(
    file: FileCreation,
    operationId: string,
    index: number
  ): void {
    if (!file.path || file.path.trim() === '') {
      throw new ValidationError(
        `File creation at index ${index} must specify a path`,
        operationId
      );
    }

    // Validate path
    this.validatePath(file.path, operationId, 'create');

    // Must have either content or template
    if (file.content === undefined && !file.template) {
      throw new ValidationError(
        `File ${file.path} must specify either content or template`,
        operationId
      );
    }

    // Validate mode if specified
    if (file.mode && !/^[0-7]{3,4}$/.test(file.mode)) {
      throw new ValidationError(
        `Invalid file mode ${file.mode} for ${file.path}`,
        operationId
      );
    }
  }

  /**
   * Validate delete operation
   */
  private validateDeleteOperation(operation: DeleteOperation, operationId: string): void {
    if (!operation.paths || operation.paths.length === 0) {
      throw new ValidationError(
        'Delete operation must specify at least one path',
        operationId
      );
    }

    operation.paths.forEach(filePath => {
      this.validatePath(filePath, operationId, 'delete');
    });
  }

  /**
   * Validate validate operation
   */
  private validateValidateOperation(operation: ValidateOperation, operationId: string): void {
    // Must have at least one validation method
    if (!operation.commands?.length && !operation.files?.length && !operation.checks?.length) {
      throw new ValidationError(
        'Validate operation must specify at least one of: commands, files, or checks',
        operationId
      );
    }

    // Validate files if specified
    if (operation.files) {
      operation.files.forEach(file => {
        this.validatePath(file, operationId, 'validate');
      });
    }

    // Validate checks
    if (operation.checks) {
      const validChecks = new Set(['syntax', 'lint', 'typecheck', 'format', 'imports', 'tests']);
      operation.checks.forEach(check => {
        if (!validChecks.has(check)) {
          throw new ValidationError(
            `Invalid validation check: ${check}`,
            operationId
          );
        }
      });
    }

    // Validate commands - basic check for non-empty
    if (operation.commands) {
      operation.commands.forEach((command, index) => {
        if (!command || command.trim() === '') {
          throw new ValidationError(
            `Command at index ${index} cannot be empty`,
            operationId
          );
        }
      });
    }
  }

  /**
   * Validate options
   */
  private validateOptions(options: any): void {
    if (options.returnFormat && !['raw', 'structured', 'minimal'].includes(options.returnFormat)) {
      throw new ValidationError(`Invalid return format: ${options.returnFormat}`);
    }

    if (options.cacheStrategy && !['none', 'session', 'persistent'].includes(options.cacheStrategy)) {
      throw new ValidationError(`Invalid cache strategy: ${options.cacheStrategy}`);
    }
  }

  /**
   * Validate and sanitize file path
   */
  private validatePath(filePath: string, operationId: string, operationType: string): void {
    if (!filePath || filePath.trim() === '') {
      throw new ValidationError(
        `Empty path in ${operationType} operation`,
        operationId
      );
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /\.\.[\/\\]\.\./, // Multiple parent directory traversals
      /^\/dev\//, // Device files
      /^\/proc\//, // Process files
      /^\/sys\//, // System files
      /\0/, // Null bytes
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filePath)) {
        throw new ValidationError(
          `Potentially dangerous path pattern in ${operationType} operation: ${filePath}`,
          operationId
        );
      }
    }

    // For non-glob patterns, validate path is within root
    if (!this.isGlobPattern(filePath)) {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.rootDirectory, filePath);
      if (!isWithinRoot(absolutePath, this.rootDirectory)) {
        throw new ValidationError(
          `Path is outside root directory in ${operationType} operation: ${filePath}`,
          operationId
        );
      }
    }
  }

  /**
   * Check if a path is a glob pattern
   */
  private isGlobPattern(filePath: string): boolean {
    return filePath.includes('*') || filePath.includes('?') || filePath.includes('[') || filePath.includes('{');
  }

  /**
   * Validate and resolve operation dependencies
   */
  private validateAndResolveDependencies(operations: Operation[]): void {
    const operationMap = new Map<string, OperationNode>();
    
    // Build operation graph
    operations.forEach((op, index) => {
      const id = op.id || `operation_${index}`;
      operationMap.set(id, {
        operation: op,
        dependencies: new Set(op.dependsOn || []),
        dependents: new Set(),
      });
    });

    // Validate all dependencies exist and build dependents
    operationMap.forEach((node, id) => {
      node.dependencies.forEach(depId => {
        if (!operationMap.has(depId)) {
          throw new DependencyError(
            `Operation '${id}' depends on non-existent operation '${depId}'`,
            id
          );
        }
        operationMap.get(depId)!.dependents.add(id);
      });
    });

    // Check for circular dependencies
    this.checkCircularDependencies(operationMap);

    // Validate dependency logic
    this.validateDependencyLogic(operationMap);
  }

  /**
   * Check for circular dependencies using DFS
   */
  private checkCircularDependencies(operationMap: Map<string, OperationNode>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = operationMap.get(nodeId)!;
      for (const depId of node.dependencies) {
        if (!visited.has(depId) && hasCycle(depId)) {
          return true;
        } else if (recursionStack.has(depId)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const [nodeId] of operationMap) {
      if (!visited.has(nodeId) && hasCycle(nodeId)) {
        throw new DependencyError('Circular dependencies detected in operations');
      }
    }
  }

  /**
   * Validate dependency logic (e.g., can't delete a file that another operation will edit)
   */
  private validateDependencyLogic(operationMap: Map<string, OperationNode>): void {
    operationMap.forEach((node, id) => {
      const operation = node.operation;

      // Check for logical conflicts with dependencies
      if (operation.type === 'delete') {
        const deleteOp = operation as DeleteOperation;
        const deletePaths = new Set(deleteOp.paths);

        // Check if any dependent operations reference the deleted files
        node.dependents.forEach(depId => {
          const depOp = operationMap.get(depId)!.operation;
          
          if (depOp.type === 'edit') {
            const editOp = depOp as EditOperation;
            editOp.edits.forEach(edit => {
              if (deletePaths.has(edit.file)) {
                throw new DependencyError(
                  `Operation '${depId}' attempts to edit file '${edit.file}' that will be deleted by operation '${id}'`,
                  depId
                );
              }
            });
          }

          if (depOp.type === 'analyze') {
            const analyzeOp = depOp as AnalyzeOperation;
            analyzeOp.paths.forEach(path => {
              if (deletePaths.has(path)) {
                throw new DependencyError(
                  `Operation '${depId}' attempts to analyze file '${path}' that will be deleted by operation '${id}'`,
                  depId
                );
              }
            });
          }
        });
      }
    });
  }

  /**
   * Optimize operations for better performance
   */
  private optimizeOperations(operations: Operation[]): OptimizedOperations {
    const optimizations: string[] = [];
    let optimizedOps = [...operations];

    // Optimization 1: Group edits by file
    optimizedOps = this.groupEditsByFile(optimizedOps, optimizations);

    // Optimization 2: Merge sequential edits on the same file
    optimizedOps = this.mergeSequentialEdits(optimizedOps, optimizations);

    // Optimization 3: Reorder independent operations for parallelism
    optimizedOps = this.reorderForParallelism(optimizedOps, optimizations);

    // Optimization 4: Remove redundant operations
    optimizedOps = this.removeRedundantOperations(optimizedOps, optimizations);

    return {
      operations: optimizedOps,
      optimizations,
    };
  }

  /**
   * Group edit operations by file
   */
  private groupEditsByFile(operations: Operation[], optimizations: string[]): Operation[] {
    // Check if any operations have dependencies - if so, skip optimization
    const hasDependencies = operations.some(op => 
      (op.dependsOn && op.dependsOn.length > 0) || 
      operations.some(other => other.dependsOn?.includes(op.id || ''))
    );
    
    if (hasDependencies) {
      return operations;
    }

    const editGroups = new Map<string, FileEdit[]>();
    const nonEditOps: Operation[] = [];
    const editOpIds: string[] = [];

    operations.forEach((op, index) => {
      if (op.type === 'edit') {
        const editOp = op as EditOperation;
        editOpIds.push(op.id || `operation_${index}`);
        
        editOp.edits.forEach(edit => {
          if (!editGroups.has(edit.file)) {
            editGroups.set(edit.file, []);
          }
          editGroups.get(edit.file)!.push(edit);
        });
      } else {
        nonEditOps.push(op);
      }
    });

    if (editGroups.size > 0 && editGroups.size < editOpIds.length) {
      optimizations.push(`Grouped ${editOpIds.length} edit operations by file into ${editGroups.size} operations`);
      
      // Create new grouped edit operations
      const groupedEditOps: EditOperation[] = Array.from(editGroups.entries()).map(([file, edits], index) => ({
        type: 'edit',
        id: `grouped_edit_${index}`,
        edits: [{
          file,
          changes: edits.flatMap(edit => edit.changes),
        }],
      }));

      return [...nonEditOps, ...groupedEditOps];
    }

    return operations;
  }

  /**
   * Merge sequential edits on the same file
   */
  private mergeSequentialEdits(operations: Operation[], optimizations: string[]): Operation[] {
    // This is a simplified implementation
    // In a real implementation, you would analyze the changes to see if they can be merged
    return operations;
  }

  /**
   * Reorder operations for better parallelism
   */
  private reorderForParallelism(operations: Operation[], optimizations: string[]): Operation[] {
    // This would use topological sort to maximize parallelism
    // For now, return as-is
    return operations;
  }

  /**
   * Remove redundant operations
   */
  private removeRedundantOperations(operations: Operation[], optimizations: string[]): Operation[] {
    // Example: Remove analyze operations on files that will be deleted
    const deleteTargets = new Set<string>();
    
    operations.forEach(op => {
      if (op.type === 'delete') {
        const deleteOp = op as DeleteOperation;
        deleteOp.paths.forEach(path => deleteTargets.add(path));
      }
    });

    if (deleteTargets.size === 0) {
      return operations;
    }

    const filtered = operations.filter(op => {
      if (op.type === 'analyze') {
        const analyzeOp = op as AnalyzeOperation;
        const hasDeletedPath = analyzeOp.paths.some(path => deleteTargets.has(path));
        if (hasDeletedPath) {
          optimizations.push(`Removed analyze operation on files that will be deleted`);
          return false;
        }
      }
      return true;
    });

    return filtered;
  }
}