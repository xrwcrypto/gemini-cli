/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import * as child_process from 'child_process';
import { Validator, ValidationRule, ValidationContext, ValidationFix } from './validator.js';
import { ASTParserService, ParseResult } from '../services/ast-parser.js';
import { FileSystemService } from '../services/file-system-service.js';
import { CacheManager } from '../services/cache-manager.js';
import { ValidateOperation, ValidationIssue } from '../file-operations-types.js';

// Use vi.hoisted to ensure mocks are set up before imports
const { execAsyncMock } = vi.hoisted(() => {
  const execAsyncMock = vi.fn();
  return { execAsyncMock };
});

// Mock child_process module
vi.mock('child_process');

// Mock util.promisify to return our mock
vi.mock('util', () => ({
  promisify: vi.fn(() => execAsyncMock)
}));

// Helper to create mock fs.Stats
function createMockStats(overrides: Partial<any> = {}): any {
  return {
    size: 100,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
    mode: 0o644,
    nlink: 1,
    uid: 1000,
    gid: 1000,
    rdev: 0,
    ino: 12345,
    atimeMs: Date.now(),
    mtimeMs: Date.now(),
    ctimeMs: Date.now(),
    birthtimeMs: Date.now(),
    dev: 16777220,
    blksize: 4096,
    blocks: 8,
    ...overrides
  };
}

describe('Validator', () => {
  let validator: Validator;
  let astParser: ASTParserService;
  let fileService: FileSystemService;
  let cacheManager: CacheManager;
  // execAsyncMock is already defined globally

  beforeEach(() => {
    // Create mock services
    fileService = new FileSystemService('/test');
    cacheManager = new CacheManager(fileService, {
      maxSizeBytes: 1000000,
      maxEntries: 100,
      enableWatching: false
    });
    astParser = new ASTParserService(cacheManager);

    // Create validator
    validator = new Validator(astParser, fileService, cacheManager);

    // Reset all mocks
    vi.clearAllMocks();
    execAsyncMock.mockReset();
  });

  describe('File Validation', () => {
    it('should validate files with no issues', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'export function test() {\n  return true;\n}',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [{ name: 'test', type: 'function' }],
        symbols: [{
          name: 'test',
          type: 'function',
          position: { line: 1, column: 17 },
          scope: 'module',
          exported: true
        }],
        errors: [],
        language: 'typescript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.ts']
      };

      const result = await validator.validate(operation);

      expect(result.valid).toBe(true);
      expect(result.filesValidated).toBe(1);
      expect(result.totalIssues).toBe(0);
      expect(result.fileResults[0].valid).toBe(true);
      expect(result.fileResults[0].issues).toHaveLength(0);
    });

    it('should detect syntax errors', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'export function test( {\n  return true;\n}',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser with syntax error
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [],
        errors: [{
          message: 'Unexpected token',
          position: { line: 1, column: 22 }
        }],
        language: 'typescript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.ts']
      };

      const result = await validator.validate(operation);

      expect(result.valid).toBe(false);
      expect(result.totalIssues).toBe(1);
      expect(result.issuesBySeverity.error).toBe(1);
      expect(result.fileResults[0].issues[0]).toMatchObject({
        file: '/test/src/index.ts',
        line: 1,
        column: 22,
        severity: 'error',
        message: 'Unexpected token',
        rule: 'syntax'
      });
    });

    it('should detect console statements', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'export function test() {\n  console.log("test");\n  return true;\n}',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [{ name: 'test', type: 'function' }],
        symbols: [{
          name: 'test',
          type: 'function',
          position: { line: 1, column: 17 },
          scope: 'module',
          exported: true
        }],
        errors: [],
        language: 'typescript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.ts']
      };

      const result = await validator.validate(operation);

      expect(result.valid).toBe(true); // Warnings don't make it invalid
      expect(result.totalIssues).toBe(1);
      expect(result.issuesBySeverity.warning).toBe(1);
      expect(result.fileResults[0].issues[0]).toMatchObject({
        file: '/test/src/index.ts',
        line: 2,
        column: 2,
        severity: 'warning',
        message: 'Unexpected console statement',
        rule: 'no-console'
      });
    });

    it('should detect debugger statements', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'export function test() {\n  debugger;\n  return true;\n}',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [{ name: 'test', type: 'function' }],
        symbols: [{
          name: 'test',
          type: 'function',
          position: { line: 1, column: 17 },
          scope: 'module',
          exported: true
        }],
        errors: [],
        language: 'typescript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.ts']
      };

      const result = await validator.validate(operation);

      expect(result.valid).toBe(false); // Errors make it invalid
      expect(result.totalIssues).toBe(1);
      expect(result.issuesBySeverity.error).toBe(1);
      expect(result.fileResults[0].issues[0]).toMatchObject({
        file: '/test/src/index.ts',
        line: 2,
        column: 2,
        severity: 'error',
        message: 'Unexpected debugger statement',
        rule: 'no-debugger'
      });
    });

    it('should check naming conventions', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'export function TestFunction() {}\nexport class myClass {}',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [
          { name: 'TestFunction', type: 'function' },
          { name: 'myClass', type: 'class' }
        ],
        symbols: [
          {
            name: 'TestFunction',
            type: 'function',
            position: { line: 1, column: 17 },
            scope: 'module',
            exported: true
          },
          {
            name: 'myClass',
            type: 'class',
            position: { line: 2, column: 14 },
            scope: 'module',
            exported: true
          }
        ],
        errors: [],
        language: 'typescript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.ts']
      };

      const result = await validator.validate(operation);

      expect(result.totalIssues).toBe(2);
      expect(result.issuesBySeverity.warning).toBe(2);
      
      const issues = result.fileResults[0].issues;
      expect(issues[0]).toMatchObject({
        severity: 'warning',
        message: "Function name 'TestFunction' should be in camelCase",
        rule: 'consistent-naming'
      });
      expect(issues[1]).toMatchObject({
        severity: 'warning',
        message: "Class name 'myClass' should be in PascalCase",
        rule: 'consistent-naming'
      });
    });
  });

  describe('Auto-fix', () => {
    it('should generate fixes for console statements', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'function test() {\n  console.log("test");\n  return true;\n}',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.js', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('javascript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [{
          name: 'test',
          type: 'function',
          position: { line: 1, column: 10 },
          scope: 'module',
          exported: false
        }],
        errors: [],
        language: 'javascript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.js']
      };

      const result = await validator.validate(operation, { enableAutoFix: true });

      expect(result.fileResults[0].fixes).toBeDefined();
      expect(result.fileResults[0].fixes).toHaveLength(1);
      expect(result.fileResults[0].fixes![0]).toMatchObject({
        description: 'Remove console statement',
        changes: [{
          start: 18,
          end: 41,
          replacement: ''
        }]
      });
    });

    it('should apply fixes to file', async () => {
      const filePath = '/test/src/index.js';
      const originalContent = 'function test() {\n  debugger;\n  return true;\n}';
      const expectedContent = 'function test() {\n  \n  return true;\n}';

      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: originalContent,
        returnDisplay: 'File content'
      });

      // Mock file service write
      const writeFilesMap = new Map([[filePath, { success: true }]]);
      const writeFilesSpy = vi.spyOn(fileService, 'writeFiles').mockResolvedValue(writeFilesMap);

      const fixes: ValidationFix[] = [{
        description: 'Remove debugger statement',
        changes: [{
          start: 20,
          end: 29,
          replacement: ''
        }]
      }];

      const result = await validator.applyFixes(filePath, fixes);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(1);
      const expectedMap = new Map([[filePath, expectedContent]]);
      expect(writeFilesSpy).toHaveBeenCalledWith(expectedMap);
    });
  });

  describe('External Validators', () => {
    it('should run TypeScript compiler', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'export const test: string = 123;',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [{ name: 'test', type: 'variable' }],
        symbols: [],
        errors: [],
        language: 'typescript'
      });

      // Mock execAsync for tsc
      execAsyncMock.mockRejectedValueOnce((() => {
        const error = new Error('Command failed') as any;
        error.stdout = '';
        error.stderr = '/test/src/index.ts(1,29): error TS2322: Type \'number\' is not assignable to type \'string\'.';
        return error;
      })());

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.ts'],
        commands: ['tsc --noEmit']
      };

      const result = await validator.validate(operation, { includeExternalValidators: true });

      expect(result.externalValidatorResults).toBeDefined();
      // Filter to find the TypeScript compiler result
      const tscResult = result.externalValidatorResults!.find(r => r.validator === 'TypeScript Compiler');
      expect(tscResult).toBeDefined();
      expect(tscResult).toMatchObject({
        validator: 'TypeScript Compiler',
        success: false,
        issues: [{
          file: '/test/src/index.ts',
          line: 1,
          column: 29,
          severity: 'error',
          message: "Type 'number' is not assignable to type 'string'.",
          rule: 'tsc'
        }]
      });
    });

    it('should run ESLint', async () => {
      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'var x = 1',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('javascript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [],
        errors: [],
        language: 'javascript'
      });

      // Mock exec for eslint
      const eslintOutput = JSON.stringify([{
        filePath: '/test/src/index.js',
        messages: [{
          line: 1,
          column: 1,
          severity: 2,
          message: 'Unexpected var, use let or const instead.',
          ruleId: 'no-var'
        }]
      }]);

      // Mock execAsync for eslint
      execAsyncMock.mockResolvedValueOnce({
        stdout: eslintOutput,
        stderr: ''
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.js'],
        commands: [] // Ensure external validators run
      };

      const result = await validator.validate(operation, {
        externalValidators: [{
          name: 'ESLint',
          command: 'eslint',
          args: ['--format', 'json'],
          fileExtensions: ['.js'],
          parseOutput: (output) => {
            try {
              const results = JSON.parse(output);
              const issues: ValidationIssue[] = [];
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
              return issues;
            } catch {
              return [];
            }
          }
        }]
      });

      expect(result.externalValidatorResults).toBeDefined();
      // Find the ESLint result
      const eslintResult = result.externalValidatorResults!.find(r => r.validator === 'ESLint');
      expect(eslintResult).toBeDefined();
      expect(eslintResult).toMatchObject({
        validator: 'ESLint',
        success: true,
        issues: [{
          file: '/test/src/index.js',
          line: 1,
          column: 1,
          severity: 'error',
          message: 'Unexpected var, use let or const instead.',
          rule: 'no-var'
        }]
      });
    });
  });

  describe('Custom Rules', () => {
    it('should register and run custom rules', async () => {
      const customRule: ValidationRule = {
        id: 'custom-rule',
        name: 'Custom Rule',
        description: 'Test custom rule',
        severity: 'warning',
        check: async (context: ValidationContext) => {
          const issues: ValidationIssue[] = [];
          if (context.content.includes('TODO')) {
            issues.push({
              file: context.filePath,
              line: 1,
              severity: 'warning',
              message: 'Found TODO comment',
              rule: 'custom-rule'
            });
          }
          return issues;
        }
      };

      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: '// TODO: Implement this\nfunction test() {}',
        returnDisplay: 'File content'
      });

      // Mock file service
      const mockStatsMap = new Map([['/test/src/index.js', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('javascript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [],
        errors: [],
        language: 'javascript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files: ['/test/src/index.js']
      };

      const result = await validator.validate(operation, {
        customRules: [customRule]
      });

      expect(result.totalIssues).toBe(1);
      expect(result.fileResults[0].issues[0]).toMatchObject({
        severity: 'warning',
        message: 'Found TODO comment',
        rule: 'custom-rule'
      });
    });

    it('should unregister rules', async () => {
      const rules = validator.getRules();
      const initialCount = rules.length;

      validator.unregisterRule('no-console');
      
      const updatedRules = validator.getRules();
      expect(updatedRules.length).toBe(initialCount - 1);
      expect(updatedRules.find(r => r.id === 'no-console')).toBeUndefined();
    });
  });

  describe('Syntax Validation', () => {
    it('should validate syntax for specific content', async () => {
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [],
        errors: [{
          message: 'Missing closing brace',
          position: { line: 3, column: 1 }
        }],
        language: 'typescript'
      });

      const issues = await validator.validateSyntax(
        '/test/file.ts',
        'function test() {\n  return true;\n'
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        file: '/test/file.ts',
        line: 3,
        column: 1,
        severity: 'error',
        message: 'Missing closing brace',
        rule: 'syntax'
      });
    });
  });

  describe('Import Resolution', () => {
    it('should check relative import resolution', async () => {
      const mockCheckFilesExist = vi.spyOn(fileService, 'checkFilesExist').mockImplementation(async (paths) => {
        const results = new Map<string, boolean>();
        for (const path of paths) {
          results.set(path, path === '/test/src/utils.ts');
        }
        return results;
      });

      const issues = await validator.checkImportResolution(
        '/test/src/index.ts',
        [
          { from: './utils', items: ['helper'] },
          { from: './missing', items: ['notFound'] }
        ]
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        file: '/test/src/index.ts',
        severity: 'error',
        message: "Cannot resolve module './missing'",
        rule: 'import-resolution'
      });
    });

    it('should skip external imports', async () => {
      const issues = await validator.checkImportResolution(
        '/test/src/index.ts',
        [
          { from: 'react', items: ['useState'] },
          { from: '@testing-library/react', items: ['render'] }
        ]
      );

      expect(issues).toHaveLength(0);
    });
  });

  describe('Parallel Processing', () => {
    it('should process files in parallel with concurrency limit', async () => {
      const files = Array.from({ length: 10 }, (_, i) => `/test/file${i}.js`);
      
      // Track concurrent executions
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      // Mock cache manager with delay
      vi.spyOn(cacheManager, 'get').mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        currentConcurrent--;
        
        return {
          llmContent: 'function test() {}',
          returnDisplay: 'File content'
        };
      });

      // Mock other services
      const mockStatsMap = new Map([['/test/src/index.ts', createMockStats()]]);
      vi.spyOn(fileService, 'getFileStats').mockResolvedValue(mockStatsMap);

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('javascript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [],
        errors: [],
        language: 'javascript'
      });

      const operation: ValidateOperation = {
        type: 'validate',
        files
      };

      await validator.validate(operation, { maxConcurrency: 4 });

      expect(maxConcurrent).toBeLessThanOrEqual(4);
    });
  });
});