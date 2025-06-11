/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from '../tools.js';
import { Config } from '../../config/config.js';
import {
  FileOperationRequest,
  FileOperationResponse,
  OperationResult,
} from './file-operations-types.js';
import { fileOperationsSchema } from './file-operations-schema.js';
import { FileOperationsValidator } from './file-operations-validator.js';

/**
 * FileOperations mega tool for batch file operations with parallel execution and transaction support
 */
export class FileOperationsTool extends BaseTool<FileOperationRequest, ToolResult> {
  static readonly Name = 'file_operations';
  private readonly validator: FileOperationsValidator;
  
  constructor(
    private readonly config: Config,
    private readonly rootDirectory: string
  ) {
    super(
      FileOperationsTool.Name,
      'FileOperations',
      'Batch file operations with parallel execution and transaction support. Combines multiple file operations (read, write, edit, analyze) into a single efficient request.',
      fileOperationsSchema
    );
    this.validator = new FileOperationsValidator(rootDirectory);
  }
  
  validateToolParams(params: FileOperationRequest): string | null {
    return this.validator.validateRequest(params);
  }
  
  getDescription(params: FileOperationRequest): string {
    const operationCount = params.operations.length;
    const operationTypes = [...new Set(params.operations.map(op => op.type))];
    const isParallel = params.options?.parallel !== false;
    const isTransaction = params.options?.transaction === true;
    
    let description = `Execute ${operationCount} file operation${operationCount > 1 ? 's' : ''} `;
    description += `(${operationTypes.join(', ')}) `;
    description += isParallel ? 'in parallel' : 'sequentially';
    if (isTransaction) {
      description += ' with transaction support';
    }
    
    return description;
  }
  
  async execute(
    params: FileOperationRequest,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const startTime = Date.now();
    
    // Initialize response
    const response: FileOperationResponse = {
      success: true,
      results: [],
      summary: {
        totalOperations: params.operations.length,
        successful: 0,
        failed: 0,
        duration: 0,
        filesAffected: []
      },
      errors: []
    };
    
    try {
      // TODO: Implement execution engine in next phase
      updateOutput?.('FileOperations tool execution started...');
      
      // Placeholder for now
      for (const operation of params.operations) {
        const result: OperationResult = {
          operationId: operation.id || `op-${params.operations.indexOf(operation)}`,
          type: operation.type,
          status: 'success',
          data: undefined // Will be implemented with actual operation results
        };
        response.results.push(result);
        response.summary.successful++;
      }
      
      response.summary.duration = Date.now() - startTime;
      
    } catch (error) {
      response.success = false;
      response.errors?.push({
        operationId: 'system',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
    
    return {
      llmContent: JSON.stringify(response, null, 2),
      returnDisplay: this.formatDisplay(response)
    };
  }
  
  private formatDisplay(response: FileOperationResponse): string {
    let display = '## FileOperations Execution Summary\n\n';
    
    display += `**Total Operations:** ${response.summary.totalOperations}\n`;
    display += `**Successful:** ${response.summary.successful}\n`;
    display += `**Failed:** ${response.summary.failed}\n`;
    display += `**Duration:** ${response.summary.duration}ms\n\n`;
    
    if (response.results.length > 0) {
      display += '### Results\n\n';
      for (const result of response.results) {
        display += `- **${result.operationId}** (${result.type}): ${result.status}\n`;
      }
    }
    
    if (response.errors && response.errors.length > 0) {
      display += '\n### Errors\n\n';
      for (const error of response.errors) {
        display += `- **${error.operationId}**: ${error.message}\n`;
      }
    }
    
    return display;
  }
}