/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage } from '../../utils/errors.js';

/**
 * Base error class for FileOperations tool
 */
export class FileOperationError extends Error {
  readonly code: string;
  readonly operationId?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    operationId?: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'FileOperationError';
    this.code = code;
    this.operationId = operationId;
    this.details = details;
  }
}

/**
 * Error thrown when operation validation fails
 */
export class ValidationError extends FileOperationError {
  constructor(message: string, operationId?: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', operationId, details);
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when operation dependencies are invalid
 */
export class DependencyError extends FileOperationError {
  constructor(message: string, operationId?: string, details?: unknown) {
    super(message, 'DEPENDENCY_ERROR', operationId, details);
    this.name = 'DependencyError';
  }
}

/**
 * Error thrown during transaction operations
 */
export class TransactionError extends FileOperationError {
  constructor(message: string, operationId?: string, details?: unknown) {
    super(message, 'TRANSACTION_ERROR', operationId, details);
    this.name = 'TransactionError';
  }
}

/**
 * Error thrown during file system operations
 */
export class FileSystemError extends FileOperationError {
  constructor(message: string, operationId?: string, details?: unknown) {
    super(message, 'FILESYSTEM_ERROR', operationId, details);
    this.name = 'FileSystemError';
  }
}

/**
 * Error thrown during AST parsing operations
 */
export class ParseError extends FileOperationError {
  constructor(message: string, operationId?: string, details?: unknown) {
    super(message, 'PARSE_ERROR', operationId, details);
    this.name = 'ParseError';
  }
}

/**
 * Error thrown when operation is cancelled
 */
export class CancellationError extends FileOperationError {
  constructor(message: string = 'Operation was cancelled', operationId?: string) {
    super(message, 'CANCELLED', operationId);
    this.name = 'CancellationError';
  }
}

/**
 * Convert any error to FileOperationError
 */
export function toFileOperationError(
  error: unknown,
  code: string = 'UNKNOWN_ERROR',
  operationId?: string
): FileOperationError {
  if (error instanceof FileOperationError) {
    return error;
  }
  
  const message = getErrorMessage(error);
  const details = error instanceof Error ? { 
    stack: error.stack,
    name: error.name,
    ...(error as unknown as Record<string, unknown>)
  } : error;
  
  return new FileOperationError(message, code, operationId, details);
}

/**
 * Check if error is a specific FileOperation error type
 */
export function isFileOperationError(error: unknown): error is FileOperationError {
  return error instanceof FileOperationError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isDependencyError(error: unknown): error is DependencyError {
  return error instanceof DependencyError;
}

export function isTransactionError(error: unknown): error is TransactionError {
  return error instanceof TransactionError;
}

export function isFileSystemError(error: unknown): error is FileSystemError {
  return error instanceof FileSystemError;
}

export function isParseError(error: unknown): error is ParseError {
  return error instanceof ParseError;
}

export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError;
}