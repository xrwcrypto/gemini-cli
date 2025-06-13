/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AnalyzeOperation as BaseAnalyzeOperation,
  ValidateOperation as BaseValidateOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  Operation,
  Change,
} from '../file-operations-types.js';

/**
 * Extended AnalyzeOperation for security validation
 */
export interface SecurityAnalyzeOperation extends BaseAnalyzeOperation {
  files?: string[]; // For backward compatibility
  analyses?: Array<{
    type: string;
    options?: {
      pattern?: string;
      query?: string;
    };
  }>;
}

/**
 * Extended ValidateOperation for security validation
 */
export interface SecurityValidateOperation extends BaseValidateOperation {
  validators?: Array<{
    type: string;
    options?: {
      validator?: string;
    };
  }>;
}

/**
 * Extended Change for security validation
 */
export interface SecurityChange extends Omit<Change, 'type'> {
  type: string;
  pattern?: string;
  replacement?: string;
  find?: string;
  replace?: string;
  content?: string;
  line?: number;
  operation?: string;
}

/**
 * Helper to normalize operation for security processing
 */
export function normalizeOperationForSecurity(operation: Operation): Operation & Record<string, any> {
  switch (operation.type) {
    case 'analyze': {
      const analyzeOp = operation as BaseAnalyzeOperation;
      return {
        ...analyzeOp,
        files: analyzeOp.paths, // Map paths to files for compatibility
        analyses: analyzeOp.patterns?.map(p => ({
          type: 'pattern',
          options: { pattern: p }
        })) || [],
      };
    }
    case 'validate': {
      const validateOp = operation as BaseValidateOperation;
      return {
        ...validateOp,
        files: validateOp.files || [],
        validators: validateOp.checks?.map(c => ({
          type: c,
          options: {}
        })) || [],
      };
    }
    default:
      return operation as any;
  }
}