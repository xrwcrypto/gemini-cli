/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from '../tools.js';
import { Config } from '../../config/config.js';
import { SchemaValidator } from '../../utils/schemaValidator.js';

/**
 * Parameters for the FileOperations mega tool
 */
export interface FileOperationRequest {
  operations: Operation[];
  options?: {
    parallel?: boolean;          // Default: true
    transaction?: boolean;       // Default: false
    continueOnError?: boolean;   // Default: false
    returnFormat?: 'raw' | 'structured' | 'minimal';
    cacheStrategy?: 'none' | 'session' | 'persistent';
  };
}

export interface Operation {
  id?: string;                   // For referencing in dependencies
  type: 'analyze' | 'edit' | 'create' | 'delete' | 'validate';
  dependsOn?: string[];          // Operation IDs that must complete first
}

export interface FileOperationResponse {
  success: boolean;
  results: OperationResult[];
  summary: {
    totalOperations: number;
    successful: number;
    failed: number;
    duration: number;
    filesAffected: string[];
  };
  errors?: OperationError[];
}

export interface OperationResult {
  operationId: string;
  type: string;
  status: 'success' | 'failed' | 'skipped';
  data?: unknown;
  error?: OperationError;
}

export interface OperationError {
  operationId: string;
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * FileOperations mega tool for batch file operations with parallel execution and transaction support
 */
export class FileOperationsTool extends BaseTool<FileOperationRequest, ToolResult> {
  static readonly Name = 'file_operations';
  
  constructor(
    private readonly config: Config,
    private readonly rootDirectory: string
  ) {
    super(
      FileOperationsTool.Name,
      'FileOperations',
      'Batch file operations with parallel execution and transaction support. Combines multiple file operations (read, write, edit, analyze) into a single efficient request.',
      {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            description: 'Array of operations to execute',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Optional unique identifier for the operation (used for dependencies)'
                },
                type: {
                  type: 'string',
                  enum: ['analyze', 'edit', 'create', 'delete', 'validate'],
                  description: 'Type of operation to perform'
                },
                dependsOn: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of operation IDs that must complete before this operation'
                }
                // Type-specific properties will be added in next phase
              },
              required: ['type']
            }
          },
          options: {
            type: 'object',
            description: 'Execution options',
            properties: {
              parallel: {
                type: 'boolean',
                description: 'Execute independent operations in parallel (default: true)',
                default: true
              },
              transaction: {
                type: 'boolean',
                description: 'Execute all operations in a transaction with rollback on failure (default: false)',
                default: false
              },
              continueOnError: {
                type: 'boolean',
                description: 'Continue executing remaining operations if one fails (default: false)',
                default: false
              },
              returnFormat: {
                type: 'string',
                enum: ['raw', 'structured', 'minimal'],
                description: 'Format of the response data',
                default: 'structured'
              },
              cacheStrategy: {
                type: 'string',
                enum: ['none', 'session', 'persistent'],
                description: 'Caching strategy for file contents and analysis',
                default: 'session'
              }
            }
          }
        },
        required: ['operations']
      }
    );
  }
  
  validateToolParams(params: FileOperationRequest): string | null {
    if (
      this.schema.parameters &&
      !SchemaValidator.validate(
        this.schema.parameters as Record<string, unknown>,
        params,
      )
    ) {
      return 'Parameters failed schema validation.';
    }
    
    // Validate operations array is not empty
    if (!params.operations || params.operations.length === 0) {
      return 'At least one operation must be specified';
    }
    
    // Validate operation dependencies
    const operationIds = new Set(params.operations
      .filter(op => op.id)
      .map(op => op.id!));
    
    for (const operation of params.operations) {
      if (operation.dependsOn) {
        for (const dep of operation.dependsOn) {
          if (!operationIds.has(dep)) {
            return `Operation dependency '${dep}' not found in operations list`;
          }
        }
      }
    }
    
    // Check for circular dependencies
    const hasCycle = this.hasCircularDependencies(params.operations);
    if (hasCycle) {
      return 'Circular dependencies detected in operations';
    }
    
    return null;
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
          data: { placeholder: true }
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
}