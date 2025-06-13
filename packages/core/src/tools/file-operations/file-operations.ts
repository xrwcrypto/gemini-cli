/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  BaseTool, 
  ToolResult, 
  ToolCallConfirmationDetails
} from '../tools.js';
import { Config, ApprovalMode } from '../../config/config.js';
import {
  FileOperationRequest,
  FileOperationResponse,
  OperationResult,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  Operation,
} from './file-operations-types.js';
import { fileOperationsSchema } from './file-operations-schema.js';
import { FileOperationsValidator } from './file-operations-validator.js';
import { RequestParser } from './request-parser.js';
import { ResponseBuilder } from './response-builder.js';
import { ExecutionEngine } from './execution-engine.js';
import { OperationPlanner } from './services/operation-planner.js';
import { recordToolCallMetrics } from '../../telemetry/metrics.js';

/**
 * FileOperations mega tool for batch file operations with parallel execution and transaction support
 */
export class FileOperationsTool extends BaseTool<FileOperationRequest, ToolResult> {
  static readonly Name = 'file_operations';
  private readonly validator: FileOperationsValidator;
  private readonly requestParser: RequestParser;
  private readonly executionEngine: ExecutionEngine;
  
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
    this.requestParser = new RequestParser(rootDirectory);
    this.executionEngine = new ExecutionEngine(rootDirectory);
  }
  
  validateToolParams(params: FileOperationRequest): string | null {
    // Basic validation using validator (sync)
    const basicError = this.validator.validateRequest(params);
    if (basicError) return basicError;
    
    // Additional path validation for security
    for (const operation of params.operations) {
      if (operation.type === 'create') {
        const createOp = operation as CreateOperation;
        for (const file of createOp.files) {
          if (file.path.includes('../') || file.path.startsWith('/')) {
            return `Path is outside root directory in create operation: ${file.path}`;
          }
        }
      }
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
  
  async shouldConfirmExecute(
    params: FileOperationRequest,
    _abortSignal: AbortSignal
  ): Promise<ToolCallConfirmationDetails | false> {
    // Check if any operations require confirmation
    const hasModifyingOperations = params.operations.some(op => 
      op.type === 'edit' || op.type === 'create' || op.type === 'delete'
    );
    
    if (!hasModifyingOperations) {
      // Read-only operations don't need confirmation
      return false;
    }
    
    // Check approval mode
    const approvalMode = this.config.getApprovalMode();
    if (approvalMode === ApprovalMode.YOLO) {
      return false;
    }
    
    // For now, create a simple confirmation for all modifying operations
    // In future phases, we'll create more detailed confirmations
    const modifyingOps = params.operations.filter(op => 
      op.type === 'edit' || op.type === 'create' || op.type === 'delete'
    ) as Array<EditOperation | CreateOperation | DeleteOperation>;
    
    const fileCount = this.countAffectedFiles(modifyingOps);
    const operationSummary = this.summarizeOperations(modifyingOps);
    
    return {
      type: 'exec',
      title: `FileOperations: ${operationSummary}`,
      command: `Modify ${fileCount} file${fileCount > 1 ? 's' : ''}`,
      rootCommand: 'file_operations',
      onConfirm: async () => {
        // Confirmation will be handled by the framework
      }
    };
  }
  
  private countAffectedFiles(operations: Array<EditOperation | CreateOperation | DeleteOperation>): number {
    const files = new Set<string>();
    
    for (const op of operations) {
      switch (op.type) {
        case 'edit':
          op.edits.forEach(edit => files.add(edit.file));
          break;
        case 'create':
          op.files.forEach(file => files.add(file.path));
          break;
        case 'delete':
          // Delete uses glob patterns, so we can't count exact files
          // Just count the number of patterns
          return op.paths.length;
        default:
          // Should never reach here due to filter
          break;
      }
    }
    
    return files.size;
  }
  
  private summarizeOperations(operations: Array<EditOperation | CreateOperation | DeleteOperation>): string {
    const counts: Record<string, number> = {};
    
    for (const op of operations) {
      counts[op.type] = (counts[op.type] || 0) + 1;
    }
    
    const parts = Object.entries(counts).map(([type, count]) => 
      `${count} ${type}${count > 1 ? 's' : ''}`
    );
    
    return parts.join(', ');
  }
  
  async execute(
    params: FileOperationRequest,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const startTime = Date.now();
    
    try {
      // Record telemetry
      const telemetryStartTime = Date.now();
      
      // Parse and validate request
      updateOutput?.('Parsing and validating request...');
      const parsedRequest = await this.requestParser.parseRequest(params);
      
      // Initialize response builder
      const responseBuilder = new ResponseBuilder(this.rootDirectory);
      const progressCallback = responseBuilder.createProgressCallback(updateOutput);
      
      // Create execution context
      const context = this.executionEngine.createExecutionContext(
        responseBuilder,
        signal,
        progressCallback,
        parsedRequest.options?.transaction === true
      );
      
      // Determine execution strategy
      const isParallel = parsedRequest.options?.parallel !== false;
      const operations = parsedRequest.operations;
      
      let results: OperationResult[];
      
      if (isParallel && operations.length > 1) {
        // Use parallel execution engine
        progressCallback('Executing operations in parallel...');
        
        const executionOptions: ExecutionOptions = {
          abortSignal: signal,
          progressCallback: (progress) => {
            progressCallback(`Progress: ${progress.percentComplete}% (${progress.completedOperations}/${progress.totalOperations})`);
          },
          continueOnError: !parsedRequest.options?.transaction,
        };
        
        // Execute operations in parallel batches based on dependencies
        const plan = new OperationPlanner().createExecutionPlan(operations);
        results = [];
        
        for (const stage of plan.stages) {
          progressCallback(`Executing stage ${plan.stages.indexOf(stage) + 1}/${plan.stages.length}`);
          
          if (stage.canRunInParallel && stage.operations.length > 1) {
            // Execute operations in parallel
            const stagePromises = stage.operations.map(op => 
              this.executionEngine.executeOperation(op, context)
            );
            const stageResults = await Promise.all(stagePromises);
            results.push(...stageResults);
          } else {
            // Execute operations sequentially
            for (const op of stage.operations) {
              if (signal.aborted) break;
              const result = await this.executionEngine.executeOperation(op, context);
              results.push(result);
              
              // Stop on error if in transaction mode
              if (result.status === 'failed' && parsedRequest.options?.transaction) {
                progressCallback('Stopping execution due to error in transaction mode');
                break;
              }
            }
          }
          
          // Check if we should continue after this stage
          if (results.some(r => r.status === 'failed') && parsedRequest.options?.transaction) {
            break;
          }
        }
        
      } else {
        // Execute sequentially
        progressCallback('Executing operations sequentially...');
        results = [];
        
        for (const operation of operations) {
          if (signal.aborted) {
            break;
          }
          
          const result = await this.executionEngine.executeOperation(operation, context);
          results.push(result);
          
          // Stop on error if in transaction mode
          if (result.status === 'failed' && parsedRequest.options?.transaction) {
            progressCallback('Stopping execution due to error in transaction mode');
            break;
          }
        }
      }
      
      // Build response
      const response = this.buildResponse(results, operations, startTime);
      
      // Record success metrics
      const duration = Date.now() - telemetryStartTime;
      recordToolCallMetrics('file_operations', duration, true);
      
      // Build final tool result
      return responseBuilder.buildToolResult(response, parsedRequest.options);
      
    } catch (error) {
      // Record error metrics
      const duration = Date.now() - startTime;
      recordToolCallMetrics('file_operations', duration, false);
      
      // Build error response
      const errorResponse: FileOperationResponse = {
        success: false,
        results: [],
        summary: {
          totalOperations: params.operations.length,
          successful: 0,
          failed: params.operations.length,
          duration,
          filesAffected: []
        },
        errors: [{
          operationId: 'system',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          code: 'SYSTEM_ERROR'
        }]
      };
      
      return {
        llmContent: JSON.stringify(errorResponse, null, 2),
        returnDisplay: this.formatDisplay(errorResponse)
      };
    } finally {
      // Cleanup resources
      await this.executionEngine.cleanup();
    }
  }
  
  
  /**
   * Build response from operation results
   */
  private buildResponse(
    results: OperationResult[],
    operations: Operation[],
    startTime: number
  ): FileOperationResponse {
    let successful = 0;
    let failed = 0;
    const filesAffected = new Set<string>();
    const errors: any[] = [];
    
    for (const result of results) {
      if (result.status === 'success') {
        successful++;
        // Extract affected files from result data
        if (result.data) {
          const files = this.extractAffectedFiles(result);
          files.forEach(f => filesAffected.add(f));
        }
      } else {
        failed++;
        if (result.error) {
          errors.push({
            operationId: result.operationId,
            message: result.error.message,
            code: result.error.code
          });
        }
      }
    }
    
    return {
      success: failed === 0,
      results,
      summary: {
        totalOperations: operations.length,
        successful,
        failed,
        duration: Date.now() - startTime,
        filesAffected: Array.from(filesAffected)
      },
      errors: errors.length > 0 ? errors : undefined
    };
  }
  
  /**
   * Extract affected files from operation result
   */
  private extractAffectedFiles(result: OperationResult): string[] {
    const files: string[] = [];
    
    if (!result.data) return files;
    
    switch (result.type) {
      case 'analyze':
        if ('results' in result.data) {
          files.push(...Object.keys(result.data.results));
        }
        break;
      case 'edit':
        if ('details' in result.data) {
          files.push(...Object.keys(result.data.details));
        }
        break;
      case 'create':
        if ('paths' in result.data) {
          files.push(...result.data.paths);
        }
        break;
      case 'delete':
        if ('paths' in result.data) {
          files.push(...result.data.paths);
        }
        break;
      case 'validate':
        if ('fixed' in result.data && result.data.fixed) {
          files.push(...result.data.fixed);
        }
        break;
    }
    
    return files;
  }
  
  private formatDisplay(response: FileOperationResponse): string {
    // Simple fallback display for error cases where ResponseBuilder wasn't used
    const status = response.success ? 'Success' : 'Failed';
    return `FileOperations ${status}: ${response.summary.successful}/${response.summary.totalOperations} operations completed in ${response.summary.duration}ms`;
  }
}