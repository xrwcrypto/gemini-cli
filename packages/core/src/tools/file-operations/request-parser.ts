/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FileOperationRequest,
  Operation,
  AnalyzeOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  ValidateOperation,
} from './file-operations-types.js';

/**
 * Simple request parser for FileOperations
 */
export class RequestParser {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory;
  }

  /**
   * Parse and validate a FileOperation request
   */
  async parseRequest(params: any): Promise<FileOperationRequest> {
    // Debug logging
    console.log('[RequestParser] Received params:', JSON.stringify(params, null, 2));

    // Basic validation
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid request parameters');
    }

    if (!Array.isArray(params.operations)) {
      throw new Error('Operations must be an array');
    }

    // Parse operations
    const operations: Operation[] = params.operations.map((op: any, index: number) => {
      if (!op || typeof op !== 'object') {
        throw new Error(`Operation ${index} is invalid`);
      }

      if (!op.type || typeof op.type !== 'string') {
        throw new Error(`Operation ${index} missing or invalid type`);
      }

      // Add ID if not present
      if (!op.id) {
        op.id = `${op.type}-${Date.now()}-${index}`;
      }

      // Transform AI's format to our expected format
      const transformedOp = this.transformOperation(op, index);
      console.log(`[RequestParser] Transformed operation ${index}:`, JSON.stringify(transformedOp, null, 2));

      return transformedOp as Operation;
    });

    // Parse options
    const options = params.options || {};

    return {
      operations,
      options: {
        parallel: options.parallel !== false, // Default to true
        transaction: options.transaction === true, // Default to false
        returnFormat: options.returnFormat || 'structured',
        ...options,
      },
    };
  }

  /**
   * Transform AI's operation format to our expected format
   */
  private transformOperation(op: any, index: number): any {
    const transformed = { ...op };

    switch (op.type) {
      case 'create':
        // AI might send: { type: "create", path: "file.js", content: "..." }
        // We expect: { type: "create", files: [{ path: "file.js", content: "..." }] }
        if (op.path || op.file_path || op.content) {
          transformed.files = [{
            path: op.path || op.file_path || `file-${index}.txt`,
            content: op.content || '',
            template: op.template,
            templateVars: op.templateVars,
            mode: op.mode,
          }];
          // Clean up old properties
          delete transformed.path;
          delete transformed.file_path;
          delete transformed.content;
          delete transformed.template;
          delete transformed.templateVars;
          delete transformed.mode;
        } else if (!op.files) {
          // Default empty files array
          transformed.files = [];
        }
        break;

      case 'edit':
        // AI might send: { type: "edit", file: "file.js", changes: [...] }
        // We expect: { type: "edit", edits: [{ file: "file.js", changes: [...] }] }
        if (op.file || op.file_path || op.changes) {
          transformed.edits = [{
            file: op.file || op.file_path || `file-${index}.txt`,
            changes: op.changes || [],
          }];
          // Clean up old properties
          delete transformed.file;
          delete transformed.file_path;
          delete transformed.changes;
        } else if (!op.edits) {
          // Default empty edits array
          transformed.edits = [];
        }
        break;

      case 'analyze':
        // AI might send: { type: "analyze", path: "*.js" }
        // We expect: { type: "analyze", paths: ["*.js"] }
        if (op.path && !op.paths) {
          transformed.paths = [op.path];
          delete transformed.path;
        } else if (!op.paths) {
          transformed.paths = ['**/*'];
        }
        break;

      case 'delete':
        // AI might send: { type: "delete", path: "file.js" }
        // We expect: { type: "delete", paths: ["file.js"] }
        if (op.path && !op.paths) {
          transformed.paths = [op.path];
          delete transformed.path;
        } else if (!op.paths) {
          transformed.paths = [];
        }
        break;

      case 'validate':
        // AI might send: { type: "validate", command: "npm test" }
        // We expect: { type: "validate", commands: ["npm test"] }
        if (op.command && !op.commands) {
          transformed.commands = [op.command];
          delete transformed.command;
        } else if (!op.commands) {
          transformed.commands = [];
        }
        break;
    }

    return transformed;
  }

  /**
   * Validate operation dependencies
   */
  validateDependencies(operations: Operation[]): void {
    const operationIds = new Set(operations.map(op => op.id).filter(Boolean));
    
    for (const operation of operations) {
      if (operation.dependsOn) {
        for (const depId of operation.dependsOn) {
          if (!operationIds.has(depId)) {
            throw new Error(`Operation ${operation.id} depends on non-existent operation ${depId}`);
          }
        }
      }
    }
  }
}