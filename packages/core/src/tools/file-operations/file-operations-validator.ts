/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SchemaValidator } from '../../utils/schemaValidator.js';
import {
  FileOperationRequest,
  Operation,
  AnalyzeOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  ValidateOperation,
} from './file-operations-types.js';
// Validation is handled within this class, errors are imported for type consistency
import { fileOperationsSchema } from './file-operations-schema.js';
import path from 'path';

/**
 * Validates FileOperation requests
 */
export class FileOperationsValidator {
  constructor(private readonly rootDirectory: string) {}

  /**
   * Validate the entire request
   */
  validateRequest(params: FileOperationRequest): string | null {
    // First validate against schema
    if (!SchemaValidator.validate(fileOperationsSchema as Record<string, unknown>, params)) {
      return 'Parameters failed schema validation.';
    }

    // Validate operations array is not empty
    if (!params.operations || params.operations.length === 0) {
      return 'At least one operation must be specified';
    }

    // Validate individual operations
    for (const operation of params.operations) {
      const operationError = this.validateOperation(operation);
      if (operationError) {
        return operationError;
      }
    }

    // Validate dependencies
    const dependencyError = this.validateDependencies(params.operations);
    if (dependencyError) {
      return dependencyError;
    }

    return null;
  }

  /**
   * Validate a single operation
   */
  private validateOperation(operation: Operation): string | null {
    const operationId = operation.id || 'unnamed';

    switch (operation.type) {
      case 'analyze':
        return this.validateAnalyzeOperation(operation as AnalyzeOperation, operationId);
      case 'edit':
        return this.validateEditOperation(operation as EditOperation, operationId);
      case 'create':
        return this.validateCreateOperation(operation as CreateOperation, operationId);
      case 'delete':
        return this.validateDeleteOperation(operation as DeleteOperation, operationId);
      case 'validate':
        return this.validateValidateOperation(operation as ValidateOperation, operationId);
      default:
        return `Unknown operation type: ${(operation as Record<string, unknown>).type}`;
    }
  }

  /**
   * Validate analyze operation
   */
  private validateAnalyzeOperation(operation: AnalyzeOperation, operationId: string): string | null {
    if (!operation.paths || operation.paths.length === 0) {
      return `Analyze operation ${operationId} must specify at least one path`;
    }

    // Validate search options if present
    if (operation.search) {
      if (!operation.search.pattern) {
        return `Search pattern cannot be empty in operation ${operationId}`;
      }
      if (operation.search.type === 'regex') {
        try {
          new RegExp(operation.search.pattern);
        } catch (_e) {
          return `Invalid regex pattern in operation ${operationId}: ${operation.search.pattern}`;
        }
      }
    }

    return null;
  }

  /**
   * Validate edit operation
   */
  private validateEditOperation(operation: EditOperation, operationId: string): string | null {
    if (!operation.edits || operation.edits.length === 0) {
      return `Edit operation ${operationId} must specify at least one edit`;
    }

    for (const edit of operation.edits) {
      if (!edit.file) {
        return `Edit in operation ${operationId} must specify a file`;
      }
      
      if (!edit.changes || edit.changes.length === 0) {
        return `Edit for file ${edit.file} in operation ${operationId} must specify at least one change`;
      }

      // Validate changes
      for (const change of edit.changes) {
        const changeError = this.validateChange(change, edit.file, operationId);
        if (changeError) {
          return changeError;
        }
      }
    }

    return null;
  }

  /**
   * Validate a single change
   */
  private validateChange(change: unknown, file: string, operationId: string): string | null {
    const changeObj = change as Record<string, unknown>;
    switch (changeObj.type) {
      case 'find-replace':
        if (!changeObj.find || !changeObj.replace) {
          return `Find-replace change in ${file} (operation ${operationId}) must specify find and replace`;
        }
        if (changeObj.regex) {
          try {
            new RegExp(changeObj.find as string);
          } catch (_e) {
            return `Invalid regex in find-replace for ${file} (operation ${operationId}): ${changeObj.find}`;
          }
        }
        break;
      
      case 'line':
        if (!changeObj.line || (changeObj.line as number) < 1) {
          return `Line change in ${file} (operation ${operationId}) must specify a positive line number`;
        }
        if (changeObj.operation !== 'delete' && !changeObj.content) {
          return `Line ${changeObj.operation} in ${file} (operation ${operationId}) must specify content`;
        }
        break;
      
      case 'position':
        if ((changeObj.start as number) < 0 || (changeObj.end as number) < 0 || (changeObj.start as number) > (changeObj.end as number)) {
          return `Invalid position range in ${file} (operation ${operationId})`;
        }
        if (changeObj.content === undefined) {
          return `Position change in ${file} (operation ${operationId}) must specify content`;
        }
        break;
      
      case 'ast':
        if (!changeObj.query || !changeObj.transform) {
          return `AST change in ${file} (operation ${operationId}) must specify query and transform`;
        }
        break;
      
      default:
        return `Unknown change type ${changeObj.type} in ${file} (operation ${operationId})`;
    }

    return null;
  }

  /**
   * Validate create operation
   */
  private validateCreateOperation(operation: CreateOperation, operationId: string): string | null {
    if (!operation.files || operation.files.length === 0) {
      return `Create operation ${operationId} must specify at least one file`;
    }

    for (const file of operation.files) {
      if (!file.path) {
        return `File creation in operation ${operationId} must specify a path`;
      }
      
      if (!file.content && !file.template) {
        return `File ${file.path} in operation ${operationId} must specify either content or template`;
      }

      if (file.mode && !/^[0-7]{3,4}$/.test(file.mode)) {
        return `Invalid file mode ${file.mode} for ${file.path} in operation ${operationId}`;
      }
    }

    return null;
  }

  /**
   * Validate delete operation
   */
  private validateDeleteOperation(operation: DeleteOperation, operationId: string): string | null {
    if (!operation.paths || operation.paths.length === 0) {
      return `Delete operation ${operationId} must specify at least one path`;
    }

    return null;
  }

  /**
   * Validate validate operation
   */
  private validateValidateOperation(operation: ValidateOperation, operationId: string): string | null {
    // Validate operation is valid with no commands, files, or checks
    // At least one should be specified for it to be useful though
    if (!operation.commands?.length && !operation.files?.length && !operation.checks?.length) {
      return `Validate operation ${operationId} should specify at least one of: commands, files, or checks`;
    }

    return null;
  }

  /**
   * Validate operation dependencies
   */
  private validateDependencies(operations: Operation[]): string | null {
    const operationIds = new Set(operations
      .filter(op => op.id)
      .map(op => op.id!));

    // Check all dependencies exist
    for (const operation of operations) {
      if (operation.dependsOn) {
        for (const dep of operation.dependsOn) {
          if (!operationIds.has(dep)) {
            return `Operation dependency '${dep}' not found in operations list`;
          }
        }
      }
    }

    // Check for circular dependencies
    if (this.hasCircularDependencies(operations)) {
      return 'Circular dependencies detected in operations';
    }

    return null;
  }

  /**
   * Check for circular dependencies using DFS
   */
  private hasCircularDependencies(operations: Operation[]): boolean {
    const graph = new Map<string, string[]>();
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    // Build dependency graph
    for (const op of operations) {
      if (op.id) {
        graph.set(op.id, op.dependsOn || []);
      }
    }

    // DFS to detect cycles
    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const dependencies = graph.get(nodeId) || [];
      for (const dep of dependencies) {
        if (!visited.has(dep) && hasCycle(dep)) {
          return true;
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    // Check all nodes
    for (const [nodeId] of graph) {
      if (!visited.has(nodeId) && hasCycle(nodeId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate file paths are within root directory
   */
  validateFilePath(filePath: string): boolean {
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(this.rootDirectory);
    return resolvedPath.startsWith(resolvedRoot);
  }
}