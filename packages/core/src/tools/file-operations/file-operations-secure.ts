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
  EditOperation,
  CreateOperation,
  DeleteOperation,
} from './file-operations-types.js';
import { fileOperationsSchema } from './file-operations-schema.js';
import { FileOperationsValidator } from './file-operations-validator.js';
import { RequestParser } from './request-parser.js';
import { ResponseBuilder } from './response-builder.js';
import { ExecutionEngine } from './execution-engine.js';
import { SecureExecutionEngine } from './services/secure-execution-engine.js';
import { SecurityConfig } from './services/security-service.js';
import { recordToolCallMetrics } from '../../telemetry/metrics.js';

/**
 * Security-enhanced FileOperations mega tool
 */
export class SecureFileOperationsTool extends BaseTool<FileOperationRequest, ToolResult> {
  static readonly Name = 'file_operations';
  private readonly validator: FileOperationsValidator;
  private readonly requestParser: RequestParser;
  private readonly executionEngine: ExecutionEngine | SecureExecutionEngine;
  private readonly enableSecurity: boolean;
  
  constructor(
    private readonly config: Config,
    private readonly rootDirectory: string,
    private readonly securityConfig?: Partial<SecurityConfig>
  ) {
    super(
      SecureFileOperationsTool.Name,
      'FileOperations',
      'Batch file operations with parallel execution, transaction support, and enhanced security. Combines multiple file operations (read, write, edit, analyze) into a single efficient request.',
      fileOperationsSchema
    );
    
    this.validator = new FileOperationsValidator(rootDirectory);
    this.requestParser = new RequestParser(rootDirectory);
    
    // Use secure execution engine if security config is provided
    this.enableSecurity = securityConfig !== undefined;
    this.executionEngine = this.enableSecurity
      ? new SecureExecutionEngine(rootDirectory, securityConfig)
      : new ExecutionEngine(rootDirectory);
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
    if (this.enableSecurity) {
      description += ' [SECURE MODE]';
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
      return false;
    }
    
    // Check approval mode
    const approvalMode = (this.config as any).approvalMode || ApprovalMode.CREATE_AND_MODIFY;
    if (approvalMode === 'none') {
      return false;
    }
    
    // Get file details for confirmation
    const files: string[] = [];
    for (const operation of params.operations) {
      switch (operation.type) {
        case 'edit':
          files.push(...(operation as EditOperation).edits.map(e => e.file));
          break;
        case 'create':
          files.push(...(operation as CreateOperation).files.map(f => f.path));
          break;
        case 'delete':
          files.push(...(operation as DeleteOperation).paths);
          break;
      }
    }
    
    const uniqueFiles = [...new Set(files)];
    
    return {
      toolName: this.displayName,
      args: params,
      message: `This will modify ${uniqueFiles.length} file(s):\n${uniqueFiles.slice(0, 10).join('\n')}${
        uniqueFiles.length > 10 ? `\n... and ${uniqueFiles.length - 10} more` : ''
      }${this.enableSecurity ? '\n\n[Security checks enabled]' : ''}`,
    };
  }
  
  async execute(
    params: FileOperationRequest,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    // Extract userId from signal if available
    const userId = (signal as any).userId;
    const metricsStartTime = Date.now();
    
    try {
      // Create progress callback
      const progressCallback = updateOutput ? (info: any) => {
        const message = `Processing: ${info.message || info.operation || 'operation'}...`;
        if (message) {
          updateOutput(message);
        }
      } : undefined;

      // Execute operations with security if enabled
      const response = await (this.executionEngine as any).execute(params, {
        abortSignal: signal,
        progressCallback,
        ...(this.enableSecurity && userId ? { userId } : {}),
      });

      // Record metrics
      await recordToolCallMetrics({
        toolName: this.name,
        success: response.success,
        duration: Date.now() - metricsStartTime,
        inputSize: JSON.stringify(params).length,
        outputSize: JSON.stringify(response).length,
        metadata: {
          operationCount: params.operations.length,
          operationTypes: [...new Set(params.operations.map(op => op.type))],
          parallel: params.options?.parallel !== false,
          transaction: params.options?.transaction === true,
          secure: this.enableSecurity,
          ...(response.metadata || {}),
        },
      });

      // Build final result
      const responseBuilder = new ResponseBuilder(this.rootDirectory);
      return responseBuilder.buildToolResult(response, params.options?.returnFormat);
    } catch (error) {
      // Record error metrics
      await recordToolCallMetrics({
        toolName: this.name,
        success: false,
        duration: Date.now() - metricsStartTime,
        inputSize: JSON.stringify(params).length,
        outputSize: 0,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          operationCount: params.operations.length,
          operationTypes: [...new Set(params.operations.map(op => op.type))],
          secure: this.enableSecurity,
        },
      });

      throw error;
    }
  }
  
  /**
   * Get security service if available
   */
  getSecurityService() {
    if (this.executionEngine instanceof SecureExecutionEngine) {
      return this.executionEngine.getSecurityService();
    }
    return null;
  }
  
  /**
   * Generate security report if security is enabled
   */
  generateSecurityReport() {
    if (this.executionEngine instanceof SecureExecutionEngine) {
      return this.executionEngine.generateSecurityReport();
    }
    return null;
  }
  
  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.executionEngine instanceof SecureExecutionEngine) {
      await this.executionEngine.cleanup();
    }
  }
}