/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExecutionEngine } from '../execution-engine.js';
import { SecureRequestParser } from './secure-request-parser.js';
import { SecurityService, SecurityConfig } from './security-service.js';
import { SandboxService } from './sandbox-service.js';
import {
  FileOperationRequest,
  FileOperationResponse,
  ValidateOperation,
  ValidationIssue,
} from '../file-operations-types.js';
import { ProgressCallback } from '../response-builder.js';
import { SecurityFileOperationResponse } from './security-response.js';

/**
 * Enhanced execution engine with security features
 */
export class SecureExecutionEngine extends ExecutionEngine {
  private readonly securityService: SecurityService;
  private readonly sandboxService: SandboxService;
  private readonly secureRequestParser: SecureRequestParser;

  constructor(rootDirectory: string, securityConfig?: Partial<SecurityConfig>) {
    super(rootDirectory);
    
    this.securityService = new SecurityService(rootDirectory, securityConfig);
    this.sandboxService = new SandboxService({
      timeout: securityConfig?.sandboxTimeout || 30000,
      memoryLimit: 50,
      allowNetwork: false,
      allowFileSystem: false,
    });
    this.secureRequestParser = new SecureRequestParser(rootDirectory, securityConfig);
  }

  /**
   * Execute operations with enhanced security
   */
  async execute(
    request: FileOperationRequest,
    options: {
      abortSignal?: AbortSignal;
      progressCallback?: ProgressCallback;
      userId?: string;
    } = {}
  ): Promise<SecurityFileOperationResponse> {
    try {
      // Use secure request parser for validation
      const validatedRequest = await this.secureRequestParser.parseRequest(
        request,
        options.userId
      );

      // Execute with parent class
      const response = await super.execute(validatedRequest, options);

      // Log successful execution
      this.securityService.logOperation(
        { type: 'batch', id: 'batch_complete' } as any,
        'allowed',
        `Completed ${validatedRequest.operations.length} operations`,
        options.userId
      );

      // Add security metadata to response
      const securityReport = this.securityService.generateSecurityReport();
      const secureResponse: SecurityFileOperationResponse = {
        ...response,
        metadata: {
          ...((response as any).metadata || {}),
          security: {
            operationsAllowed: securityReport.summary.allowedOperations,
            operationsDenied: securityReport.summary.deniedOperations,
            sessionId: (this.securityService as any).sessionId,
          },
        },
      };

      return secureResponse;
    } catch (error) {
      // Log failed execution
      this.securityService.logOperation(
        { type: 'batch', id: 'batch_failed' } as any,
        'error',
        error instanceof Error ? error.message : String(error),
        options.userId
      );
      throw error;
    }
  }

  /**
   * Override validator execution to use sandbox
   */
  protected async executeValidateOperation(
    operation: ValidateOperation,
    context: any
  ): Promise<any> {
    // Check if there are custom validators
    const customValidators = operation.validators?.filter(v => v.type === 'custom') || [];
    
    if (customValidators.length > 0) {
      // Create a modified operation with sandboxed validators
      const sandboxedOperation: ValidateOperation = {
        ...operation,
        validators: await Promise.all(
          operation.validators!.map(async validator => {
            if (validator.type === 'custom' && validator.options?.validator) {
              // Wrap the validator in a sandbox
              const sandboxedValidator = await this.createSandboxedValidator(
                String(validator.options.validator)
              );
              
              return {
                ...validator,
                options: {
                  ...validator.options,
                  validator: sandboxedValidator,
                },
              };
            }
            return validator;
          })
        ),
      };

      return super.executeValidateOperation(sandboxedOperation, context);
    }

    // No custom validators, use parent implementation
    return super.executeValidateOperation(operation, context);
  }

  /**
   * Create a sandboxed validator function
   */
  private async createSandboxedValidator(
    validatorCode: string
  ): Promise<(content: string, filePath: string) => ValidationIssue[]> {
    // Return a function that executes the validator in sandbox
    return async (content: string, filePath: string): Promise<ValidationIssue[]> => {
      const result = await this.sandboxService.execute(
        `
        const validator = ${validatorCode};
        const content = args[0];
        const filePath = args[1];
        
        const issues = validator(content, filePath);
        
        // Validate the result
        if (!Array.isArray(issues)) {
          throw new Error('Validator must return an array');
        }
        
        // Validate each issue
        issues.forEach((issue, index) => {
          if (typeof issue !== 'object') {
            throw new Error(\`Issue at index \${index} must be an object\`);
          }
          if (typeof issue.line !== 'number') {
            throw new Error(\`Issue at index \${index} must have a line number\`);
          }
          if (typeof issue.message !== 'string') {
            throw new Error(\`Issue at index \${index} must have a message\`);
          }
        });
        
        return issues;
        `,
        [content, filePath],
        { timeout: 5000 }
      );

      if (!result.success) {
        throw new Error(`Validator execution failed: ${result.error}`);
      }

      return result.result as ValidationIssue[];
    };
  }

  /**
   * Get security service for external access
   */
  getSecurityService(): SecurityService {
    return this.securityService;
  }

  /**
   * Get sandbox service for external access
   */
  getSandboxService(): SandboxService {
    return this.sandboxService;
  }

  /**
   * Generate security report
   */
  generateSecurityReport() {
    return this.securityService.generateSecurityReport();
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.sandboxService.cleanup();
  }
}