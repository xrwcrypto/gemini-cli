/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main request interface for FileOperations tool
 */
export interface FileOperationRequest {
  operations: Operation[];
  options?: FileOperationOptions;
}

/**
 * Options for controlling execution behavior
 */
export interface FileOperationOptions {
  /** Execute independent operations in parallel (default: true) */
  parallel?: boolean;
  /** Execute all operations in a transaction with rollback on failure (default: false) */
  transaction?: boolean;
  /** Continue executing remaining operations if one fails (default: false) */
  continueOnError?: boolean;
  /** Format of the response data */
  returnFormat?: 'raw' | 'structured' | 'minimal';
  /** Caching strategy for file contents and analysis */
  cacheStrategy?: 'none' | 'session' | 'persistent';
}

/**
 * Base operation interface
 */
export interface BaseOperation {
  /** Optional unique identifier for the operation (used for dependencies) */
  id?: string;
  /** Type of operation to perform */
  type: 'analyze' | 'edit' | 'create' | 'delete' | 'validate';
  /** Array of operation IDs that must complete before this operation */
  dependsOn?: string[];
}

/**
 * Union type for all operations
 */
export type Operation = 
  | AnalyzeOperation 
  | EditOperation 
  | CreateOperation 
  | DeleteOperation 
  | ValidateOperation;

/**
 * Analyze operation for code analysis and extraction
 */
export interface AnalyzeOperation extends BaseOperation {
  type: 'analyze';
  /** Glob patterns for files to analyze */
  paths: string[];
  /** What to extract from the files */
  extract?: ExtractType[];
  /** Build searchable index for future operations */
  buildIndex?: boolean;
  /** Include complexity, security analysis */
  deepAnalysis?: boolean;
  /** Search for specific patterns */
  search?: SearchOptions;
}

/**
 * Types of data that can be extracted during analysis
 */
export type ExtractType = 
  | 'imports' 
  | 'exports' 
  | 'functions' 
  | 'classes'
  | 'interfaces' 
  | 'types' 
  | 'variables' 
  | 'todos'
  | 'dependencies' 
  | 'complexity' 
  | 'all';

/**
 * Search options for analysis operations
 */
export interface SearchOptions {
  /** Search pattern (regex or literal) */
  pattern: string;
  /** Type of search */
  type: 'regex' | 'literal' | 'ast';
  /** Case sensitive search */
  caseSensitive?: boolean;
  /** Include context lines around matches */
  contextLines?: number;
}

/**
 * Edit operation for modifying files
 */
export interface EditOperation extends BaseOperation {
  type: 'edit';
  /** Array of file edits to perform */
  edits: FileEdit[];
  /** Check syntax after edits */
  validateSyntax?: boolean;
  /** Maintain indentation/style */
  preserveFormatting?: boolean;
}

/**
 * Represents edits to a single file
 */
export interface FileEdit {
  /** File path to edit */
  file: string;
  /** Array of changes to apply to the file */
  changes: Change[];
  /** Create file if it doesn't exist */
  createIfMissing?: boolean;
}

/**
 * Base change interface
 */
export interface BaseChange {
  /** Type of change to apply */
  type: 'find-replace' | 'line' | 'position' | 'ast';
}

/**
 * Union type for all changes
 */
export type Change = 
  | FindReplaceChange 
  | LineChange 
  | PositionChange 
  | ASTChange;

/**
 * Find and replace change
 */
export interface FindReplaceChange extends BaseChange {
  type: 'find-replace';
  /** Text or pattern to find */
  find: string;
  /** Replacement text */
  replace: string;
  /** Use regex for find pattern */
  regex?: boolean;
  /** Replace all occurrences */
  replaceAll?: boolean;
}

/**
 * Line-based change
 */
export interface LineChange extends BaseChange {
  type: 'line';
  /** Line number (1-based) */
  line: number;
  /** Operation to perform */
  operation: 'insert' | 'replace' | 'delete';
  /** Content for insert/replace operations */
  content?: string;
}

/**
 * Position-based change (character offset)
 */
export interface PositionChange extends BaseChange {
  type: 'position';
  /** Start character position */
  start: number;
  /** End character position */
  end: number;
  /** Replacement content */
  content: string;
}

/**
 * AST-based transformation
 */
export interface ASTChange extends BaseChange {
  type: 'ast';
  /** AST query to match nodes */
  query: string;
  /** Transformation to apply */
  transform: ASTTransform;
}

/**
 * AST transformation specification
 */
export interface ASTTransform {
  /** Type of transformation */
  type: 'rename' | 'wrap' | 'unwrap' | 'replace' | 'remove';
  /** Additional parameters for the transformation */
  params?: Record<string, unknown>;
}

/**
 * Create operation for creating new files
 */
export interface CreateOperation extends BaseOperation {
  type: 'create';
  /** Files to create */
  files: FileCreation[];
}

/**
 * File creation specification
 */
export interface FileCreation {
  /** Path for the new file */
  path: string;
  /** Content of the file */
  content?: string;
  /** Template to use for file creation */
  template?: string;
  /** Template variables */
  templateVars?: Record<string, unknown>;
  /** File permissions (Unix-style) */
  mode?: string;
}

/**
 * Delete operation for removing files
 */
export interface DeleteOperation extends BaseOperation {
  type: 'delete';
  /** Glob patterns for files to delete */
  paths: string[];
  /** Delete empty parent directories */
  removeEmptyDirs?: boolean;
  /** Skip files that don't exist */
  skipMissing?: boolean;
}

/**
 * Validate operation for running validation commands
 */
export interface ValidateOperation extends BaseOperation {
  type: 'validate';
  /** Validation commands to run */
  commands?: string[];
  /** Files to validate (if not using commands) */
  files?: string[];
  /** Types of validation to perform */
  checks?: ValidationCheck[];
  /** Auto-fix issues if possible */
  autoFix?: boolean;
}

/**
 * Types of validation checks
 */
export type ValidationCheck = 
  | 'syntax' 
  | 'lint' 
  | 'typecheck' 
  | 'format' 
  | 'imports' 
  | 'tests';

/**
 * Main response interface
 */
export interface FileOperationResponse {
  /** Overall success status */
  success: boolean;
  /** Results for each operation */
  results: OperationResult[];
  /** Summary statistics */
  summary: OperationSummary;
  /** Errors if any occurred */
  errors?: OperationError[];
}

/**
 * Summary of operation execution
 */
export interface OperationSummary {
  /** Total number of operations */
  totalOperations: number;
  /** Number of successful operations */
  successful: number;
  /** Number of failed operations */
  failed: number;
  /** Total execution time in milliseconds */
  duration: number;
  /** List of files that were affected */
  filesAffected: string[];
  /** Additional statistics */
  stats?: OperationStats;
}

/**
 * Detailed operation statistics
 */
export interface OperationStats {
  /** Number of files read */
  filesRead?: number;
  /** Number of files written */
  filesWritten?: number;
  /** Number of files deleted */
  filesDeleted?: number;
  /** Number of lines changed */
  linesChanged?: number;
  /** Cache hit rate */
  cacheHitRate?: number;
}

/**
 * Result for a single operation
 */
export interface OperationResult {
  /** Operation identifier */
  operationId: string;
  /** Operation type */
  type: string;
  /** Execution status */
  status: 'success' | 'failed' | 'skipped';
  /** Operation-specific result data */
  data?: OperationResultData;
  /** Error if operation failed */
  error?: OperationError;
  /** Execution time in milliseconds */
  duration?: number;
}

/**
 * Union type for operation result data
 */
export type OperationResultData = 
  | AnalyzeResult 
  | EditResult 
  | CreateResult 
  | DeleteResult 
  | ValidateResult;

/**
 * Result data for analyze operations
 */
export interface AnalyzeResult {
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Extracted data by file */
  extracted?: Record<string, ExtractedData>;
  /** Search matches if search was performed */
  matches?: SearchMatch[];
  /** Index ID if index was built */
  indexId?: string;
}

/**
 * Extracted data from a file
 */
export interface ExtractedData {
  /** Imported modules/files */
  imports?: ImportInfo[];
  /** Exported symbols */
  exports?: ExportInfo[];
  /** Function definitions */
  functions?: FunctionInfo[];
  /** Class definitions */
  classes?: ClassInfo[];
  /** Interface definitions */
  interfaces?: InterfaceInfo[];
  /** Type definitions */
  types?: TypeInfo[];
  /** Variable declarations */
  variables?: VariableInfo[];
  /** TODO/FIXME comments */
  todos?: TodoInfo[];
  /** Complexity metrics */
  complexity?: ComplexityInfo;
}

/**
 * Import information
 */
export interface ImportInfo {
  /** Import source */
  source: string;
  /** Imported symbols */
  symbols?: string[];
  /** Default import name */
  defaultImport?: string;
  /** Line number */
  line: number;
}

/**
 * Export information
 */
export interface ExportInfo {
  /** Export name */
  name: string;
  /** Export type */
  type: 'default' | 'named' | 'namespace';
  /** Line number */
  line: number;
}

/**
 * Function information
 */
export interface FunctionInfo {
  /** Function name */
  name: string;
  /** Is async */
  async: boolean;
  /** Is generator */
  generator: boolean;
  /** Parameters */
  params: string[];
  /** Line number */
  line: number;
  /** End line number */
  endLine: number;
}

/**
 * Class information
 */
export interface ClassInfo {
  /** Class name */
  name: string;
  /** Extends clause */
  extends?: string;
  /** Implements clauses */
  implements?: string[];
  /** Is abstract */
  abstract: boolean;
  /** Line number */
  line: number;
  /** End line number */
  endLine: number;
}

/**
 * Interface information
 */
export interface InterfaceInfo {
  /** Interface name */
  name: string;
  /** Extends clauses */
  extends?: string[];
  /** Line number */
  line: number;
  /** End line number */
  endLine: number;
}

/**
 * Type information
 */
export interface TypeInfo {
  /** Type name */
  name: string;
  /** Type definition */
  definition: string;
  /** Line number */
  line: number;
}

/**
 * Variable information
 */
export interface VariableInfo {
  /** Variable name */
  name: string;
  /** Declaration kind */
  kind: 'const' | 'let' | 'var';
  /** Type annotation */
  type?: string;
  /** Line number */
  line: number;
}

/**
 * TODO/FIXME information
 */
export interface TodoInfo {
  /** Type of comment */
  type: 'TODO' | 'FIXME' | 'HACK' | 'NOTE';
  /** Comment text */
  text: string;
  /** Line number */
  line: number;
}

/**
 * Complexity information
 */
export interface ComplexityInfo {
  /** Cyclomatic complexity */
  cyclomatic: number;
  /** Cognitive complexity */
  cognitive: number;
  /** Lines of code */
  loc: number;
  /** Source lines of code (excluding comments/blanks) */
  sloc: number;
}

/**
 * Search match information
 */
export interface SearchMatch {
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Matched text */
  match: string;
  /** Context before match */
  contextBefore?: string[];
  /** Context after match */
  contextAfter?: string[];
}

/**
 * Result data for edit operations
 */
export interface EditResult {
  /** Number of files edited */
  filesEdited: number;
  /** Changes applied by file */
  changes: Record<string, number>;
  /** Files that failed syntax validation */
  syntaxErrors?: string[];
}

/**
 * Result data for create operations
 */
export interface CreateResult {
  /** Number of files created */
  filesCreated: number;
  /** Created file paths */
  created: string[];
  /** Files that already existed */
  alreadyExisted?: string[];
}

/**
 * Result data for delete operations
 */
export interface DeleteResult {
  /** Number of files deleted */
  filesDeleted: number;
  /** Deleted file paths */
  deleted: string[];
  /** Files that didn't exist */
  notFound?: string[];
  /** Directories removed */
  directoriesRemoved?: string[];
}

/**
 * Result data for validate operations
 */
export interface ValidateResult {
  /** Overall validation status */
  valid: boolean;
  /** Results by check type */
  checks: Record<string, ValidationCheckResult>;
  /** Files that were auto-fixed */
  fixed?: string[];
}

/**
 * Result for a single validation check
 */
export interface ValidationCheckResult {
  /** Check passed */
  passed: boolean;
  /** Number of issues found */
  issueCount: number;
  /** Issue details */
  issues?: ValidationIssue[];
}

/**
 * Validation issue details
 */
export interface ValidationIssue {
  /** File path */
  file: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
  /** Issue severity */
  severity: 'error' | 'warning' | 'info';
  /** Issue message */
  message: string;
  /** Rule or check that failed */
  rule?: string;
}

/**
 * Operation error information
 */
export interface OperationError {
  /** Operation that failed */
  operationId: string;
  /** Error message */
  message: string;
  /** Error code */
  code?: string;
  /** Additional error details */
  details?: unknown;
  /** Stack trace for debugging */
  stack?: string;
}

/**
 * File snapshot for transaction support
 */
export interface FileSnapshot {
  /** File path */
  path: string;
  /** File content */
  content: string;
  /** File metadata */
  metadata: FileMetadata;
}

/**
 * File metadata
 */
export interface FileMetadata {
  /** File mode/permissions */
  mode: number;
  /** Last modified time */
  mtime: Date;
  /** File size */
  size: number;
}

/**
 * Cache entry for file contents and analysis
 */
export interface CacheEntry {
  /** Cache key */
  key: string;
  /** Cached data */
  data: unknown;
  /** Expiration time */
  expires: number;
  /** Hit count */
  hits: number;
}

/**
 * Execution context passed to operations
 */
export interface OperationContext {
  /** Root directory for operations */
  rootDirectory: string;
  /** Abort signal for cancellation */
  signal: AbortSignal;
  /** Cache instance */
  cache: OperationCache;
  /** Update output callback */
  updateOutput?: (output: string) => void;
  /** Transaction manager */
  transaction?: TransactionContext;
}

/**
 * Cache interface for operations
 */
export interface OperationCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Transaction context for rollback support
 */
export interface TransactionContext {
  /** Transaction ID */
  id: string;
  /** Snapshot files before changes */
  snapshot(paths: string[]): Promise<void>;
  /** Commit changes */
  commit(): Promise<void>;
  /** Rollback changes */
  rollback(): Promise<void>;
}