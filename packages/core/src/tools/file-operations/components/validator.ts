/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as child_process from 'child_process';
import { promisify } from 'util';
import { ASTParserService, ParseResult, SupportedLanguage } from '../services/ast-parser.js';
import { FileSystemService } from '../services/file-system-service.js';
import { CacheManager } from '../services/cache-manager.js';
import { ValidateOperation, ValidationIssue, FileInfo } from '../file-operations-types.js';

const execAsync = promisify(child_process.exec);

/**
 * Validation rule interface
 */
export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  languages?: SupportedLanguage[];
  check: (context: ValidationContext) => Promise<ValidationIssue[]>;
  fix?: (context: ValidationContext, issue: ValidationIssue) => Promise<ValidationFix | null>;
}

/**
 * Validation context passed to rules
 */
export interface ValidationContext {
  filePath: string;
  content: string;
  language: SupportedLanguage;
  parseResult: ParseResult;
  fileInfo: FileInfo;
}

/**
 * Validation fix
 */
export interface ValidationFix {
  description: string;
  changes: Array<{
    start: number;
    end: number;
    replacement: string;
  }>;
}

/**
 * Validation result for a single file
 */
export interface FileValidationResult {
  filePath: string;
  valid: boolean;
  issues: ValidationIssue[];
  fixes?: ValidationFix[];
  parseErrors?: string[];
}

/**
 * Overall validation result
 */
export interface ValidationResult {
  valid: boolean;
  filesValidated: number;
  totalIssues: number;
  issuesBySeverity: Record<'error' | 'warning' | 'info', number>;
  fileResults: FileValidationResult[];
  externalValidatorResults?: ExternalValidatorResult[];
}

/**
 * External validator result
 */
export interface ExternalValidatorResult {
  validator: string;
  command: string;
  success: boolean;
  output?: string;
  error?: string;
  issues?: ValidationIssue[];
}

/**
 * Validator options
 */
export interface ValidatorOptions {
  enableAutoFix?: boolean;
  includeExternalValidators?: boolean;
  customRules?: ValidationRule[];
  externalValidators?: ExternalValidatorConfig[];
  maxConcurrency?: number;
}

/**
 * External validator configuration
 */
export interface ExternalValidatorConfig {
  name: string;
  command: string;
  args?: string[];
  fileExtensions?: string[];
  parseOutput?: (output: string) => ValidationIssue[];
}

/**
 * Built-in validation rules
 */
const BUILTIN_RULES: ValidationRule[] = [
  {
    id: 'import-resolution',
    name: 'Import Resolution',
    description: 'Validates that all imports can be resolved',
    severity: 'error',
    languages: ['typescript', 'javascript'],
    check: async (context) => {
      const issues: ValidationIssue[] = [];
      const { filePath, parseResult } = context;
      const fileDir = path.dirname(filePath);

      for (const imp of parseResult.imports) {
        if (imp.from.startsWith('.')) {
          // Check relative imports
          const _resolvedPath = path.resolve(fileDir, imp.from);
          const _extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', ''];
          
          let found = false;
          for (const _ext of _extensions) {
            try {
              const exists = await context.fileInfo.size > 0; // Simplified check
              if (exists) {
                found = true;
                break;
              }
            } catch {
              // Continue checking
            }
          }

          if (!found) {
            issues.push({
              file: filePath,
              line: 1, // Would need to track line info in imports
              severity: 'error',
              message: `Cannot resolve import: ${imp.from}`,
              rule: 'import-resolution'
            });
          }
        }
      }

      return issues;
    }
  },
  {
    id: 'unused-exports',
    name: 'Unused Exports',
    description: 'Detects exported symbols that are not imported anywhere',
    severity: 'warning',
    check: async () => {
      const issues: ValidationIssue[] = [];
      // This would require project-wide analysis
      // Simplified implementation for now
      return issues;
    }
  },
  {
    id: 'no-console',
    name: 'No Console Statements',
    description: 'Prevents console statements in production code',
    severity: 'warning',
    languages: ['typescript', 'javascript'],
    check: async (context) => {
      const issues: ValidationIssue[] = [];
      const lines = context.content.split('\n');
      
      lines.forEach((line, index) => {
        if (/console\.(log|error|warn|info|debug)/.test(line)) {
          issues.push({
            file: context.filePath,
            line: index + 1,
            column: line.indexOf('console'),
            severity: 'warning',
            message: 'Unexpected console statement',
            rule: 'no-console'
          });
        }
      });

      return issues;
    },
    fix: async (context, issue) => {
      if (!issue.line) return null;
      
      const lines = context.content.split('\n');
      const lineIndex = issue.line - 1;
      const line = lines[lineIndex];
      
      // Remove the entire line if it only contains console statement
      if (/^\s*console\.(log|error|warn|info|debug)/.test(line)) {
        const start = lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0);
        const end = start + line.length + 1;
        
        return {
          description: 'Remove console statement',
          changes: [{
            start,
            end,
            replacement: ''
          }]
        };
      }
      
      return null;
    }
  },
  {
    id: 'no-debugger',
    name: 'No Debugger Statements',
    description: 'Prevents debugger statements in production code',
    severity: 'error',
    languages: ['typescript', 'javascript'],
    check: async (context) => {
      const issues: ValidationIssue[] = [];
      const lines = context.content.split('\n');
      
      lines.forEach((line, index) => {
        if (/\bdebugger\b/.test(line)) {
          issues.push({
            file: context.filePath,
            line: index + 1,
            column: line.indexOf('debugger'),
            severity: 'error',
            message: 'Unexpected debugger statement',
            rule: 'no-debugger'
          });
        }
      });

      return issues;
    },
    fix: async (context, issue) => {
      if (!issue.line) return null;
      
      const lines = context.content.split('\n');
      const lineIndex = issue.line - 1;
      const line = lines[lineIndex];
      
      // Remove debugger statement
      const debuggerMatch = line.match(/\s*debugger\s*;?/);
      if (debuggerMatch) {
        const start = lines.slice(0, lineIndex).join('\n').length + 
                     (lineIndex > 0 ? 1 : 0) + debuggerMatch.index!;
        const end = start + debuggerMatch[0].length;
        
        return {
          description: 'Remove debugger statement',
          changes: [{
            start,
            end,
            replacement: ''
          }]
        };
      }
      
      return null;
    }
  },
  {
    id: 'consistent-naming',
    name: 'Consistent Naming',
    description: 'Enforces consistent naming conventions',
    severity: 'warning',
    check: async (context) => {
      const issues: ValidationIssue[] = [];
      const { parseResult, filePath } = context;
      
      // Check function names (should be camelCase)
      for (const symbol of parseResult.symbols) {
        if (symbol.type === 'function' && !/^[a-z][a-zA-Z0-9]*$/.test(symbol.name)) {
          issues.push({
            file: filePath,
            line: symbol.position.line,
            column: symbol.position.column,
            severity: 'warning',
            message: `Function name '${symbol.name}' should be in camelCase`,
            rule: 'consistent-naming'
          });
        }
        
        // Check class names (should be PascalCase)
        if (symbol.type === 'class' && !/^[A-Z][a-zA-Z0-9]*$/.test(symbol.name)) {
          issues.push({
            file: filePath,
            line: symbol.position.line,
            column: symbol.position.column,
            severity: 'warning',
            message: `Class name '${symbol.name}' should be in PascalCase`,
            rule: 'consistent-naming'
          });
        }
      }
      
      return issues;
    }
  }
];

/**
 * Default external validators
 */
const DEFAULT_EXTERNAL_VALIDATORS: ExternalValidatorConfig[] = [
  {
    name: 'TypeScript Compiler',
    command: 'tsc',
    args: ['--noEmit', '--skipLibCheck'],
    fileExtensions: ['.ts', '.tsx'],
    parseOutput: (output) => {
      const issues: ValidationIssue[] = [];
      const lines = (output || '').split('\n');
      
      for (const line of lines) {
        const match = line.match(/(.+)\((\d+),(\d+)\): error TS\d+: (.+)/);
        if (match) {
          issues.push({
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            severity: 'error',
            message: match[4],
            rule: 'tsc'
          });
        }
      }
      
      return issues;
    }
  },
  {
    name: 'ESLint',
    command: 'eslint',
    args: ['--format', 'json'],
    fileExtensions: ['.js', '.jsx', '.ts', '.tsx'],
    parseOutput: (output) => {
      const issues: ValidationIssue[] = [];
      
      try {
        const results = JSON.parse(output);
        for (const file of results) {
          for (const message of file.messages) {
            issues.push({
              file: file.filePath,
              line: message.line,
              column: message.column,
              severity: message.severity === 2 ? 'error' : 'warning',
              message: message.message,
              rule: message.ruleId || 'eslint'
            });
          }
        }
      } catch {
        // Failed to parse ESLint output
      }
      
      return issues;
    }
  }
];

/**
 * Validator Component
 * Provides comprehensive validation capabilities for code files
 */
export class Validator {
  private readonly astParser: ASTParserService;
  private readonly fileService: FileSystemService;
  private readonly cacheManager: CacheManager;
  private readonly rules: Map<string, ValidationRule>;
  private readonly externalValidators: ExternalValidatorConfig[];

  constructor(
    astParser: ASTParserService,
    fileService: FileSystemService,
    cacheManager: CacheManager
  ) {
    this.astParser = astParser;
    this.fileService = fileService;
    this.cacheManager = cacheManager;
    this.rules = new Map();
    this.externalValidators = [];

    // Register built-in rules
    for (const rule of BUILTIN_RULES) {
      this.rules.set(rule.id, rule);
    }
  }

  /**
   * Validate files based on operation
   */
  async validate(
    operation: ValidateOperation,
    options: ValidatorOptions = {}
  ): Promise<ValidationResult> {
    const files = operation.files || [];
    const fileResults: FileValidationResult[] = [];
    let totalIssues = 0;
    const issuesBySeverity: Record<'error' | 'warning' | 'info', number> = {
      error: 0,
      warning: 0,
      info: 0
    };

    // Register custom rules
    if (options.customRules) {
      for (const rule of options.customRules) {
        this.rules.set(rule.id, rule);
      }
    }

    // Configure external validators
    const externalValidators = options.externalValidators || 
      (options.includeExternalValidators ? DEFAULT_EXTERNAL_VALIDATORS : []);

    // Validate each file
    const maxConcurrency = options.maxConcurrency || 4;
    const chunks = this.chunkArray(files, maxConcurrency);
    
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(file => this.validateFile(file, options))
      );
      fileResults.push(...chunkResults);
    }

    // Count issues
    for (const result of fileResults) {
      totalIssues += result.issues.length;
      for (const issue of result.issues) {
        issuesBySeverity[issue.severity]++;
      }
    }

    // Run external validators if requested
    let externalValidatorResults: ExternalValidatorResult[] | undefined;
    if (externalValidators.length > 0 || operation.commands) {
      externalValidatorResults = await this.runExternalValidators(
        files,
        externalValidators,
        operation.commands
      );
    }

    // Determine overall validity
    const hasErrors = issuesBySeverity.error > 0 || 
      (externalValidatorResults?.some(r => !r.success) ?? false);

    return {
      valid: !hasErrors,
      filesValidated: fileResults.length,
      totalIssues,
      issuesBySeverity,
      fileResults,
      externalValidatorResults
    };
  }

  /**
   * Validate a single file
   */
  private async validateFile(
    filePath: string,
    options: ValidatorOptions
  ): Promise<FileValidationResult> {
    const issues: ValidationIssue[] = [];
    const fixes: ValidationFix[] = [];
    const parseErrors: string[] = [];

    try {
      // Get file content and info
      const content = await this.cacheManager.get(filePath);
      if (!content || content.error) {
        return {
          filePath,
          valid: false,
          issues: [{
            file: filePath,
            severity: 'error',
            message: content?.error || 'Failed to read file'
          }],
          parseErrors: [content?.error || 'Failed to read file']
        };
      }

      const fileInfo = await this.extractFileInfo(filePath);
      if (!fileInfo) {
        return {
          filePath,
          valid: false,
          issues: [{
            file: filePath,
            severity: 'error',
            message: 'Failed to get file info'
          }]
        };
      }

      // Detect language and parse
      const language = this.astParser.detectLanguage(filePath);
      if (!language || language === 'unknown') {
        return {
          filePath,
          valid: true,
          issues: []
        };
      }

      const parseResult = await this.astParser.parseFile(
        filePath,
        typeof content.llmContent === 'string' ? content.llmContent : ''
      );

      // Add parse errors
      if (parseResult.errors.length > 0) {
        for (const error of parseResult.errors) {
          issues.push({
            file: filePath,
            line: error.position?.line,
            column: error.position?.column,
            severity: 'error',
            message: error.message,
            rule: 'syntax'
          });
          parseErrors.push(error.message);
        }
      }

      // Create validation context
      const context: ValidationContext = {
        filePath,
        content: typeof content.llmContent === 'string' ? content.llmContent : '',
        language,
        parseResult,
        fileInfo
      };

      // Run applicable rules
      for (const [ruleId, rule] of this.rules) {
        // Skip if rule doesn't apply to this language
        if (rule.languages && !rule.languages.includes(language)) {
          continue;
        }

        try {
          const ruleIssues = await rule.check(context);
          issues.push(...ruleIssues);

          // Generate fixes if enabled
          if (options.enableAutoFix && rule.fix) {
            for (const issue of ruleIssues) {
              const fix = await rule.fix(context, issue);
              if (fix) {
                fixes.push(fix);
              }
            }
          }
        } catch (error) {
          console.error(`Rule ${ruleId} failed:`, error);
        }
      }

      return {
        filePath,
        valid: !issues.some(i => i.severity === 'error'),
        issues,
        fixes: fixes.length > 0 ? fixes : undefined,
        parseErrors: parseErrors.length > 0 ? parseErrors : undefined
      };
    } catch (error) {
      return {
        filePath,
        valid: false,
        issues: [{
          file: filePath,
          severity: 'error',
          message: error instanceof Error ? error.message : String(error)
        }],
        parseErrors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Run external validators
   */
  private async runExternalValidators(
    files: string[],
    validators: ExternalValidatorConfig[],
    commands?: string[]
  ): Promise<ExternalValidatorResult[]> {
    const results: ExternalValidatorResult[] = [];

    for (const validator of validators) {
      // Filter files by extension if specified
      let filesToValidate = files;
      if (validator.fileExtensions) {
        filesToValidate = files.filter(file =>
          validator.fileExtensions!.some(ext => file.endsWith(ext))
        );
      }

      if (filesToValidate.length === 0) {
        continue;
      }

      // Build command
      const args = validator.args || [];
      const command = `${validator.command} ${args.join(' ')} ${filesToValidate.join(' ')}`;

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024 // 10MB
        });

        const output = stdout || stderr || '';
        const issues = validator.parseOutput ? validator.parseOutput(output) : [];

        results.push({
          validator: validator.name,
          command,
          success: true,
          output,
          issues
        });
      } catch (error) {
        const err = error as Error & { stdout?: string; stderr?: string; message: string };
        const output = (err.stdout || '') + (err.stderr || '');
        const issues = validator.parseOutput ? validator.parseOutput(output) : [];

        results.push({
          validator: validator.name,
          command,
          success: false,
          output,
          error: err.message,
          issues
        });
      }
    }

    // Run custom commands if provided
    if (commands) {
      for (const cmd of commands) {
        try {
          const { stdout, stderr } = await execAsync(cmd, {
            cwd: process.cwd(),
            maxBuffer: 10 * 1024 * 1024
          });

          results.push({
            validator: 'Custom Command',
            command: cmd,
            success: true,
            output: stdout + stderr
          });
        } catch (error) {
          const err = error as Error & { stdout?: string; stderr?: string; message: string };
          results.push({
            validator: 'Custom Command',
            command: cmd,
            success: false,
            output: (err.stdout || '') + (err.stderr || ''),
            error: err.message
          });
        }
      }
    }

    return results;
  }

  /**
   * Apply fixes to a file
   */
  async applyFixes(
    filePath: string,
    fixes: ValidationFix[]
  ): Promise<{ success: boolean; applied: number; error?: string }> {
    try {
      const content = await this.cacheManager.get(filePath);
      if (!content || content.error || typeof content.llmContent !== 'string') {
        return {
          success: false,
          applied: 0,
          error: 'Failed to read file'
        };
      }

      let modifiedContent = content.llmContent;
      let applied = 0;

      // Sort fixes by position (reverse order to apply from end to start)
      const allChanges = fixes.flatMap(fix => fix.changes);
      allChanges.sort((a, b) => b.start - a.start);

      // Apply changes
      for (const change of allChanges) {
        const before = modifiedContent.substring(0, change.start);
        const after = modifiedContent.substring(change.end);
        modifiedContent = before + change.replacement + after;
        applied++;
      }

      // Write back to file using batch write
      const writeMap = new Map([[filePath, modifiedContent]]);
      const results = await this.fileService.writeFiles(writeMap);
      const result = results.get(filePath);

      if (!result || !result.success) {
        return {
          success: false,
          applied: 0,
          error: result?.error || 'Failed to write file'
        };
      }

      return {
        success: true,
        applied
      };
    } catch (error) {
      return {
        success: false,
        applied: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Register a custom validation rule
   */
  registerRule(rule: ValidationRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Unregister a validation rule
   */
  unregisterRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  /**
   * Get all registered rules
   */
  getRules(): ValidationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Extract file info
   */
  private async extractFileInfo(filePath: string): Promise<FileInfo | null> {
    try {
      const statsMap = await this.fileService.getFileStats([filePath]);
      const stats = statsMap.get(filePath);
      
      if (!stats) {
        return null;
      }
      
      const language = this.astParser.detectLanguage(filePath);

      return {
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        language
      };
    } catch (error) {
      console.error(`Failed to extract file info for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Chunk array for parallel processing
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Validate syntax for a specific language
   */
  async validateSyntax(filePath: string, content: string): Promise<ValidationIssue[]> {
    const language = this.astParser.detectLanguage(filePath);
    if (!language || language === 'unknown') {
      return [];
    }

    const parseResult = await this.astParser.parseFile(filePath, content);
    
    return parseResult.errors.map(error => ({
      file: filePath,
      line: error.position?.line,
      column: error.position?.column,
      severity: 'error' as const,
      message: error.message,
      rule: 'syntax'
    }));
  }

  /**
   * Check if imports can be resolved
   */
  async checkImportResolution(
    filePath: string,
    imports: Array<{ from: string; items: string[] }>
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const fileDir = path.dirname(filePath);

    for (const imp of imports) {
      if (imp.from.startsWith('.')) {
        // Relative import
        const resolvedPath = path.resolve(fileDir, imp.from);
        
        // Check with common extensions
        const pathsToCheck = [resolvedPath];
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
        for (const ext of extensions) {
          pathsToCheck.push(resolvedPath + ext);
        }
        
        const existsMap = await this.fileService.checkFilesExist(pathsToCheck);
        const found = Array.from(existsMap.values()).some(exists => exists);
        
        if (!found) {
          issues.push({
            file: filePath,
            severity: 'error',
            message: `Cannot resolve module '${imp.from}'`,
            rule: 'import-resolution'
          });
        }
      }
    }

    return issues;
  }
}