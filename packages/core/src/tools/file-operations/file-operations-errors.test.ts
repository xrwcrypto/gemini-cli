/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  FileOperationError,
  ValidationError,
  DependencyError,
  TransactionError,
  FileSystemError,
  ParseError,
  CancellationError,
  toFileOperationError,
  isFileOperationError,
  isValidationError,
  isDependencyError,
  isTransactionError,
  isFileSystemError,
  isParseError,
  isCancellationError,
} from './file-operations-errors.js';

describe('FileOperation Errors', () => {
  describe('FileOperationError', () => {
    it('should create error with all properties', () => {
      const error = new FileOperationError(
        'Test error',
        'TEST_ERROR',
        'op-123',
        { extra: 'data' }
      );
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.operationId).toBe('op-123');
      expect(error.details).toEqual({ extra: 'data' });
      expect(error.name).toBe('FileOperationError');
    });

    it('should be instanceof Error', () => {
      const error = new FileOperationError('Test', 'TEST');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(FileOperationError);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError('Invalid parameter', 'op-1');
      
      expect(error.message).toBe('Invalid parameter');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.operationId).toBe('op-1');
      expect(error.name).toBe('ValidationError');
    });

    it('should be detected by type guard', () => {
      const error = new ValidationError('Test');
      expect(isValidationError(error)).toBe(true);
      expect(isFileOperationError(error)).toBe(true);
      expect(isDependencyError(error)).toBe(false);
    });
  });

  describe('DependencyError', () => {
    it('should create dependency error', () => {
      const error = new DependencyError('Missing dependency', 'op-2', ['op-1']);
      
      expect(error.message).toBe('Missing dependency');
      expect(error.code).toBe('DEPENDENCY_ERROR');
      expect(error.operationId).toBe('op-2');
      expect(error.details).toEqual(['op-1']);
      expect(error.name).toBe('DependencyError');
    });

    it('should be detected by type guard', () => {
      const error = new DependencyError('Test');
      expect(isDependencyError(error)).toBe(true);
      expect(isFileOperationError(error)).toBe(true);
      expect(isValidationError(error)).toBe(false);
    });
  });

  describe('TransactionError', () => {
    it('should create transaction error', () => {
      const error = new TransactionError('Rollback failed', 'op-3');
      
      expect(error.message).toBe('Rollback failed');
      expect(error.code).toBe('TRANSACTION_ERROR');
      expect(error.operationId).toBe('op-3');
      expect(error.name).toBe('TransactionError');
    });

    it('should be detected by type guard', () => {
      const error = new TransactionError('Test');
      expect(isTransactionError(error)).toBe(true);
      expect(isFileOperationError(error)).toBe(true);
    });
  });

  describe('FileSystemError', () => {
    it('should create file system error', () => {
      const error = new FileSystemError('File not found', 'op-4', { path: '/test.txt' });
      
      expect(error.message).toBe('File not found');
      expect(error.code).toBe('FILESYSTEM_ERROR');
      expect(error.operationId).toBe('op-4');
      expect(error.details).toEqual({ path: '/test.txt' });
      expect(error.name).toBe('FileSystemError');
    });

    it('should be detected by type guard', () => {
      const error = new FileSystemError('Test');
      expect(isFileSystemError(error)).toBe(true);
      expect(isFileOperationError(error)).toBe(true);
    });
  });

  describe('ParseError', () => {
    it('should create parse error', () => {
      const error = new ParseError('Syntax error', 'op-5', { line: 10, column: 5 });
      
      expect(error.message).toBe('Syntax error');
      expect(error.code).toBe('PARSE_ERROR');
      expect(error.operationId).toBe('op-5');
      expect(error.details).toEqual({ line: 10, column: 5 });
      expect(error.name).toBe('ParseError');
    });

    it('should be detected by type guard', () => {
      const error = new ParseError('Test');
      expect(isParseError(error)).toBe(true);
      expect(isFileOperationError(error)).toBe(true);
    });
  });

  describe('CancellationError', () => {
    it('should create cancellation error with default message', () => {
      const error = new CancellationError();
      
      expect(error.message).toBe('Operation was cancelled');
      expect(error.code).toBe('CANCELLED');
      expect(error.name).toBe('CancellationError');
    });

    it('should create cancellation error with custom message', () => {
      const error = new CancellationError('User cancelled', 'op-6');
      
      expect(error.message).toBe('User cancelled');
      expect(error.operationId).toBe('op-6');
    });

    it('should be detected by type guard', () => {
      const error = new CancellationError();
      expect(isCancellationError(error)).toBe(true);
      expect(isFileOperationError(error)).toBe(true);
    });
  });

  describe('toFileOperationError', () => {
    it('should return existing FileOperationError unchanged', () => {
      const original = new ValidationError('Test');
      const converted = toFileOperationError(original);
      
      expect(converted).toBe(original);
    });

    it('should convert Error to FileOperationError', () => {
      const error = new Error('Standard error');
      const converted = toFileOperationError(error, 'CUSTOM_ERROR', 'op-7');
      
      expect(converted).toBeInstanceOf(FileOperationError);
      expect(converted.message).toBe('Standard error');
      expect(converted.code).toBe('CUSTOM_ERROR');
      expect(converted.operationId).toBe('op-7');
      expect(converted.details).toHaveProperty('stack');
      expect(converted.details).toHaveProperty('name', 'Error');
    });

    it('should convert string to FileOperationError', () => {
      const converted = toFileOperationError('String error', 'STRING_ERROR');
      
      expect(converted).toBeInstanceOf(FileOperationError);
      expect(converted.message).toBe('String error');
      expect(converted.code).toBe('STRING_ERROR');
      expect(converted.details).toBe('String error');
    });

    it('should convert unknown to FileOperationError', () => {
      const obj = { foo: 'bar' };
      const converted = toFileOperationError(obj);
      
      expect(converted).toBeInstanceOf(FileOperationError);
      expect(converted.message).toBe('[object Object]');
      expect(converted.code).toBe('UNKNOWN_ERROR');
      expect(converted.details).toEqual(obj);
    });

    it('should handle null and undefined', () => {
      const nullError = toFileOperationError(null);
      expect(nullError.message).toBe('null');
      
      const undefinedError = toFileOperationError(undefined);
      expect(undefinedError.message).toBe('undefined');
    });
  });

  describe('Type Guards', () => {
    it('should correctly identify error types', () => {
      const errors = [
        new FileOperationError('Test', 'TEST'),
        new ValidationError('Test'),
        new DependencyError('Test'),
        new TransactionError('Test'),
        new FileSystemError('Test'),
        new ParseError('Test'),
        new CancellationError(),
      ];
      
      // All should be FileOperationError
      errors.forEach(error => {
        expect(isFileOperationError(error)).toBe(true);
      });
      
      // Regular Error should not be FileOperationError
      expect(isFileOperationError(new Error('Test'))).toBe(false);
      expect(isFileOperationError('string')).toBe(false);
      expect(isFileOperationError(null)).toBe(false);
      expect(isFileOperationError(undefined)).toBe(false);
    });
  });
});