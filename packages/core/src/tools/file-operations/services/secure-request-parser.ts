/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RequestParser } from '../request-parser.js';
import { SecurityService, SecurityConfig } from './security-service.js';
import { SandboxService } from './sandbox-service.js';
import {
  FileOperationRequest,
  Operation,
  ValidateOperation,
  AnalyzeOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
} from '../file-operations-types.js';
import { ValidationError } from '../file-operations-errors.js';
import { normalizeOperationForSecurity } from './security-types.js';

/**
 * Enhanced request parser with security features
 */
export class SecureRequestParser extends RequestParser {
  private readonly securityService: SecurityService;
  private readonly sandboxService: SandboxService;

  constructor(
    rootDirectory: string,
    securityConfig?: Partial<SecurityConfig>
  ) {
    super(rootDirectory);
    this.securityService = new SecurityService(rootDirectory, securityConfig);
    this.sandboxService = new SandboxService({
      timeout: securityConfig?.sandboxTimeout || 30000,
      memoryLimit: 50,
      allowNetwork: false,
      allowFileSystem: false,
    });
  }

  /**
   * Parse request with enhanced security validation
   */
  async parseRequest(
    params: unknown,
    userId?: string
  ): Promise<FileOperationRequest> {
    try {
      // Check rate limits first
      if (!this.securityService.checkRateLimit(userId)) {
        throw new ValidationError('Rate limit exceeded. Please try again later.');
      }

      // Parse using parent class
      const request = await super.parseRequest(params);

      // Perform additional security validation
      await this.validateSecureRequest(request, userId);

      // Log successful operation
      request.operations.forEach(op => {
        this.securityService.logOperation(op, 'allowed', undefined, userId);
      });

      return request;
    } catch (error) {
      // Log denied operations
      if (params && typeof params === 'object' && 'operations' in params) {
        const ops = (params as any).operations as Operation[];
        if (Array.isArray(ops)) {
          ops.forEach(op => {
            this.securityService.logOperation(
              op,
              'denied',
              error instanceof Error ? error.message : String(error),
              userId
            );
          });
        }
      }
      throw error;
    }
  }

  /**
   * Perform enhanced security validation
   */
  private async validateSecureRequest(
    request: FileOperationRequest,
    userId?: string
  ): Promise<void> {
    // Estimate memory usage
    const estimatedMemory = this.estimateMemoryUsage(request);
    if (!this.securityService.checkMemoryUsage(estimatedMemory, userId)) {
      throw new ValidationError('Memory limit exceeded for this operation');
    }

    // Validate each operation
    for (const operation of request.operations) {
      await this.validateSecureOperation(operation);
    }

    // Validate custom validators in sandbox
    await this.validateCustomValidators(request);
  }

  /**
   * Validate individual operation with security checks
   */
  private async validateSecureOperation(operation: Operation): Promise<void> {
    const normalizedOp = normalizeOperationForSecurity(operation);
    
    switch (operation.type) {
      case 'analyze':
        await this.validateAnalyzeOperation(normalizedOp as any);
        break;
      case 'edit':
        await this.validateEditOperation(operation as EditOperation);
        break;
      case 'create':
        await this.validateCreateOperation(operation as CreateOperation);
        break;
      case 'delete':
        await this.validateDeleteOperation(operation as DeleteOperation);
        break;
      case 'validate':
        await this.validateValidateOperation(normalizedOp as any);
        break;
    }
  }

  /**
   * Validate analyze operation
   */
  private async validateAnalyzeOperation(operation: any): Promise<void> {
    // Validate file paths
    const files = operation.files || operation.paths || [];
    for (const file of files) {
      const result = await this.securityService.validatePath(
        file,
        'analyze',
        { allowGlob: true }
      );
      if (!result.isValid) {
        throw new ValidationError(
          `Invalid file path in analyze operation: ${file} - ${result.reason}`
        );
      }
    }

    // Validate analysis options
    if (operation.analyses) {
      for (const analysis of operation.analyses) {
        // Validate regex patterns
        if (analysis.type === 'pattern' && analysis.options?.pattern) {
          const sanitized = this.securityService.sanitizeInput(
            String(analysis.options.pattern),
            'regex'
          );
          if (sanitized !== analysis.options.pattern) {
            analysis.options.pattern = sanitized;
          }
        }

        // Validate AST queries
        if (analysis.type === 'ast' && analysis.options?.query) {
          const sanitized = this.securityService.sanitizeInput(
            String(analysis.options.query),
            'code'
          );
          if (sanitized !== analysis.options.query) {
            analysis.options.query = sanitized;
          }
        }
      }
    }
  }

  /**
   * Validate edit operation
   */
  private async validateEditOperation(operation: EditOperation): Promise<void> {
    // Validate file paths in edits
    for (const edit of operation.edits) {
      const result = await this.securityService.validatePath(
        edit.file,
        'edit',
        { allowGlob: false, checkExists: true }
      );
      if (!result.isValid) {
        throw new ValidationError(
          `Invalid file path in edit operation: ${edit.file} - ${result.reason}`
        );
      }

      // Sanitize change content
      for (const change of edit.changes) {
        if ('pattern' in change && change.pattern) {
          change.pattern = this.securityService.sanitizeInput(change.pattern, 'regex');
        }
        if ('replacement' in change && change.replacement) {
          change.replacement = this.securityService.sanitizeInput(change.replacement, 'code');
        }
        if ('content' in change && change.content) {
          change.content = this.securityService.sanitizeInput(change.content, 'code');
        }
      }
    }
  }

  /**
   * Validate create operation
   */
  private async validateCreateOperation(operation: CreateOperation): Promise<void> {
    // Validate file paths
    for (const file of operation.files) {
      const result = await this.securityService.validatePath(
        file.path,
        'create',
        { allowGlob: false }
      );
      if (!result.isValid) {
        throw new ValidationError(
          `Invalid file path in create operation: ${file.path} - ${result.reason}`
        );
      }

      // Sanitize file content
      if (file.content) {
        file.content = this.securityService.sanitizeInput(file.content, 'code');
      }

      // Validate file mode
      if (file.mode) {
        // Ensure no executable permissions for security
        const modeInt = parseInt(file.mode, 8);
        if ((modeInt & 0o111) !== 0) {
          throw new ValidationError(
            `Executable permissions not allowed: ${file.mode}`
          );
        }
      }
    }
  }

  /**
   * Validate delete operation
   */
  private async validateDeleteOperation(operation: DeleteOperation): Promise<void> {
    // Validate paths
    for (const pathToDelete of operation.paths) {
      const result = await this.securityService.validatePath(
        pathToDelete,
        'delete',
        { allowGlob: true }
      );
      if (!result.isValid) {
        throw new ValidationError(
          `Invalid path in delete operation: ${pathToDelete} - ${result.reason}`
        );
      }
    }

    // Prevent deletion of critical files
    const criticalPatterns = [
      /^\.git\//,
      /^node_modules\//,
      /package\.json$/,
      /tsconfig\.json$/,
      /\.env$/,
    ];

    for (const pathToDelete of operation.paths) {
      for (const pattern of criticalPatterns) {
        if (pattern.test(pathToDelete)) {
          throw new ValidationError(
            `Cannot delete critical file: ${pathToDelete}`
          );
        }
      }
    }
  }

  /**
   * Validate validate operation
   */
  private async validateValidateOperation(operation: any): Promise<void> {
    // Validate file paths
    const files = operation.files || [];
    for (const file of files) {
      const result = await this.securityService.validatePath(
        file,
        'validate',
        { allowGlob: true }
      );
      if (!result.isValid) {
        throw new ValidationError(
          `Invalid file path in validate operation: ${file} - ${result.reason}`
        );
      }
    }

    // Validate custom validators in sandbox
    if (operation.validators) {
      for (const validator of operation.validators) {
        if (validator.type === 'custom' && validator.options?.validator) {
          // Validate the validator code
          const validatorCode = String(validator.options.validator);
          const result = await this.sandboxService.execute(
            `
            // Test if validator function is valid
            const validator = ${validatorCode};
            if (typeof validator !== 'function') {
              throw new Error('Validator must be a function');
            }
            return true;
            `,
            [],
            { timeout: 1000 }
          );

          if (!result.success) {
            throw new ValidationError(
              `Invalid custom validator: ${result.error}`
            );
          }
        }
      }
    }
  }

  /**
   * Validate custom validators in sandbox
   */
  private async validateCustomValidators(request: FileOperationRequest): Promise<void> {
    const validateOps = request.operations.filter(
      op => op.type === 'validate'
    ) as ValidateOperation[];

    for (const op of validateOps) {
      if (!op.validators) continue;

      for (const validator of op.validators) {
        if (validator.type === 'custom' && validator.options?.validator) {
          const validatorCode = String(validator.options.validator);
          
          // Test validator with sample content
          const testResult = await this.sandboxService.execute(
            `
            const validator = ${validatorCode};
            const testContent = 'const x = 1;';
            const testPath = 'test.js';
            
            try {
              const result = validator(testContent, testPath);
              if (!Array.isArray(result)) {
                throw new Error('Validator must return an array');
              }
              return true;
            } catch (error) {
              throw new Error('Validator execution failed: ' + error.message);
            }
            `,
            [],
            { timeout: 2000 }
          );

          if (!testResult.success) {
            throw new ValidationError(
              `Custom validator validation failed: ${testResult.error}`
            );
          }
        }
      }
    }
  }

  /**
   * Estimate memory usage for operations
   */
  private estimateMemoryUsage(request: FileOperationRequest): number {
    let totalSize = 0;

    for (const operation of request.operations) {
      switch (operation.type) {
        case 'analyze':
          // Estimate 10KB per file for analysis
          totalSize += operation.files.length * 10 * 1024;
          break;
        case 'edit':
          // Estimate 5KB per edit
          totalSize += operation.edits.length * 5 * 1024;
          break;
        case 'create':
          // Sum of content sizes
          operation.files.forEach(file => {
            if (file.content) {
              totalSize += Buffer.byteLength(file.content, 'utf8');
            }
          });
          break;
        case 'delete':
          // Minimal memory for delete
          totalSize += operation.paths.length * 1024;
          break;
        case 'validate':
          // Estimate 20KB per file for validation
          totalSize += operation.files.length * 20 * 1024;
          break;
      }
    }

    return totalSize;
  }

  /**
   * Get security service for external access
   */
  getSecurityService(): SecurityService {
    return this.securityService;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.sandboxService.cleanup();
  }
}