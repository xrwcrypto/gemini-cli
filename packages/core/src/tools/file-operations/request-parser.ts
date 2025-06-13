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

      return op as Operation;
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