/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { Analyzer } from './analyzer.js';
import { ASTParserService } from '../services/ast-parser.js';
import { FileSystemService } from '../services/file-system-service.js';
import { CacheManager } from '../services/cache-manager.js';
import { AnalyzeOperation } from '../file-operations-types.js';

// Mock globby
vi.mock('globby', () => ({
  globby: vi.fn()
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn()
}));

import { globby } from 'globby';
const mockGlobby = globby as unknown as ReturnType<typeof vi.fn>;
const mockFsStat = fs.stat as unknown as ReturnType<typeof vi.fn>;

describe('Analyzer', () => {
  let analyzer: Analyzer;
  let astParser: ASTParserService;
  let fileService: FileSystemService;
  let cacheManager: CacheManager;

  beforeEach(() => {
    // Create mock services
    fileService = new FileSystemService('/test');
    cacheManager = new CacheManager(fileService, {
      maxSizeBytes: 1000000,
      maxEntries: 100,
      enableWatching: false
    });
    astParser = new ASTParserService(cacheManager);

    // Create analyzer
    analyzer = new Analyzer(astParser, fileService, cacheManager);

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('File Analysis', () => {
    it('should analyze files matching patterns', async () => {
      // Mock globby to return test files
      mockGlobby.mockResolvedValue([
        '/test/src/index.ts',
        '/test/src/utils.ts'
      ]);

      // Mock cache manager
      vi.spyOn(cacheManager, 'get').mockImplementation(async (path) => ({
        llmContent: `// ${path}\nexport function test() {\n  return true;\n}`,
        returnDisplay: 'File content'
      }));

      // Mock file stats
      mockFsStat.mockResolvedValue({
        size: 100,
        isFile: true,
        isDirectory: false,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0o644
      });

      // Mock AST parser
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [{ name: 'test', type: 'function' }],
        symbols: [{
          name: 'test',
          type: 'function',
          position: { line: 2, column: 17 },
          scope: 'module',
          exported: true
        }],
        errors: [],
        language: 'typescript'
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['src/**/*.ts']
      };

      const result = await analyzer.analyze(operation);

      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe('/test/src/index.ts');
      expect(result.files[0].language).toBe('typescript');
      expect(result.files[0].exports).toContain('test');
      expect(result.summary.totalFiles).toBe(2);
      expect(result.summary.languages.typescript).toBe(2);
    });

    it('should handle files without language support', async () => {
      mockGlobby.mockResolvedValue(['/test/data.json']);

      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: '{"key": "value"}',
        returnDisplay: 'JSON content'
      });

      mockFsStat.mockResolvedValue({
        size: 16,
        isFile: true,
        isDirectory: false,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0o644
      });

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('unknown');

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['data.json']
      };

      const result = await analyzer.analyze(operation);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].language).toBe('unknown');
      expect(result.files[0].symbols).toHaveLength(0);
    });

    it('should calculate complexity when requested', async () => {
      mockGlobby.mockResolvedValue(['/test/complex.ts']);

      const complexCode = `
function complexFunction(x: number) {
  if (x > 0) {
    for (let i = 0; i < x; i++) {
      if (i % 2 === 0) {
        console.log(i);
      } else {
        console.error(i);
      }
    }
  } else if (x < 0) {
    while (x < 0) {
      x++;
    }
  } else {
    switch (x) {
      case 0:
        return 'zero';
      default:
        return 'unknown';
    }
  }
}`;

      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: complexCode,
        returnDisplay: 'Complex code'
      });

      mockFsStat.mockResolvedValue({
        size: complexCode.length,
        isFile: true,
        isDirectory: false,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0o644
      });

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [{
          name: 'complexFunction',
          type: 'function',
          position: { line: 2, column: 9 },
          scope: 'module',
          exported: false
        }],
        errors: [],
        language: 'typescript'
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['complex.ts']
      };

      const result = await analyzer.analyze(operation, { calculateComplexity: true });

      expect(result.files[0].complexity).toBeDefined();
      expect(result.files[0].complexity).toBeGreaterThan(0);
      expect(result.summary.averageComplexity).toBeDefined();
    });
  });

  describe('Pattern Matching', () => {
    it('should find pattern matches in files', async () => {
      mockGlobby.mockResolvedValue(['/test/src/api.ts']);

      const content = `
import { Request, Response } from 'express';

export function handleRequest(req: Request, res: Response) {
  // TODO: Add authentication
  const data = req.body;
  
  // FIXME: Validate input
  res.json({ success: true, data });
}

// TODO: Add error handling
`;

      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'API file'
      });

      mockFsStat.mockResolvedValue({
        size: content.length,
        isFile: true,
        isDirectory: false,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0o644
      });

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [{ from: 'express', items: ['Request', 'Response'] }],
        exports: [{ name: 'handleRequest', type: 'function' }],
        symbols: [],
        errors: [],
        language: 'typescript'
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['src/**/*.ts'],
        patterns: ['TODO:', 'FIXME:']
      };

      const result = await analyzer.analyze(operation);

      expect(result.patterns).toBeDefined();
      expect(result.patterns).toHaveLength(3);
      
      const todoMatches = result.patterns!.filter(m => m.match.includes('TODO:'));
      expect(todoMatches).toHaveLength(2);
      
      const fixmeMatches = result.patterns!.filter(m => m.match.includes('FIXME:'));
      expect(fixmeMatches).toHaveLength(1);
      
      // Check context is included
      expect(result.patterns![0].context).toBeDefined();
      expect(result.patterns![0].line).toBeGreaterThan(0);
      expect(result.patterns![0].column).toBeGreaterThan(0);
    });

    it('should handle regex patterns', async () => {
      mockGlobby.mockResolvedValue(['/test/config.ts']);

      const content = `
export const API_KEY = 'sk-1234567890';
export const SECRET = 'super-secret-value';
const password = 'hardcoded-password';
`;

      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'Config file'
      });

      mockFsStat.mockResolvedValue({
        size: content.length,
        isFile: true,
        isDirectory: false,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0o644
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['config.ts'],
        patterns: ['(API_KEY|SECRET|password)\\s*=\\s*[\'"]([^\'"]+)[\'"]']
      };

      const result = await analyzer.analyze(operation);

      expect(result.patterns).toBeDefined();
      expect(result.patterns).toHaveLength(3);
      expect(result.patterns!.some(m => m.match.includes('API_KEY'))).toBe(true);
      expect(result.patterns!.some(m => m.match.includes('SECRET'))).toBe(true);
      expect(result.patterns!.some(m => m.match.includes('password'))).toBe(true);
    });
  });

  describe('Dependency Graph', () => {
    it('should build dependency graph from imports', async () => {
      mockGlobby.mockResolvedValue([
        '/test/src/index.ts',
        '/test/src/utils.ts',
        '/test/src/api.ts'
      ]);

      // Mock file contents and dependencies
      const fileContents: Record<string, string> = {
        '/test/src/index.ts': 'import "./utils";\nimport "./api";',
        '/test/src/utils.ts': 'export function util() {}',
        '/test/src/api.ts': 'import "./utils";'
      };

      vi.spyOn(cacheManager, 'get').mockImplementation(async (path) => ({
        llmContent: fileContents[path] || '',
        returnDisplay: 'File content'
      }));

      mockFsStat.mockResolvedValue({
        size: 100,
        isFile: true,
        isDirectory: false,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0o644
      });

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockImplementation(async (path) => {
        if (path === '/test/src/index.ts') {
          return {
            imports: [{ from: './utils', items: ['*'] }, { from: './api', items: ['*'] }],
            exports: [],
            symbols: [],
            errors: [],
            language: 'typescript'
          };
        } else if (path === '/test/src/api.ts') {
          return {
            imports: [{ from: './utils', items: ['*'] }],
            exports: [],
            symbols: [],
            errors: [],
            language: 'typescript'
          };
        } else {
          return {
            imports: [],
            exports: [{ name: 'util', type: 'function' }],
            symbols: [],
            errors: [],
            language: 'typescript'
          };
        }
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['src/**/*.ts']
      };

      const result = await analyzer.analyze(operation, { analyzeDependencies: true });

      expect(result.dependencyGraph).toBeDefined();
      
      const graph = result.dependencyGraph!;
      expect(graph.nodes.size).toBe(3);
      
      // Check roots (files with no dependencies)
      expect(graph.roots).toContain('/test/src/utils.ts');
      
      // Check leaves (files with no dependents)
      expect(graph.leaves).toContain('/test/src/index.ts');
      
      // Check dependencies
      const indexNode = graph.nodes.get('/test/src/index.ts');
      expect(indexNode?.dependencies).toHaveLength(2);
      
      const utilsNode = graph.nodes.get('/test/src/utils.ts');
      expect(utilsNode?.dependents).toHaveLength(2);
    });

    it('should detect circular dependencies', async () => {
      mockGlobby.mockResolvedValue([
        '/test/src/a.ts',
        '/test/src/b.ts',
        '/test/src/c.ts'
      ]);

      // Create circular dependency: a -> b -> c -> a
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'import cycle',
        returnDisplay: 'File'
      });

      mockFsStat.mockResolvedValue({
        size: 100,
        isFile: true,
        isDirectory: false,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0o644
      });

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockImplementation(async (path) => {
        if (path === '/test/src/a.ts') {
          return { imports: [{ from: './b', items: ['*'] }], exports: [], symbols: [], errors: [], language: 'typescript' };
        } else if (path === '/test/src/b.ts') {
          return { imports: [{ from: './c', items: ['*'] }], exports: [], symbols: [], errors: [], language: 'typescript' };
        } else {
          return { imports: [{ from: './a', items: ['*'] }], exports: [], symbols: [], errors: [], language: 'typescript' };
        }
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['src/**/*.ts']
      };

      const result = await analyzer.analyze(operation, { analyzeDependencies: true });

      expect(result.dependencyGraph?.cycles).toBeDefined();
      expect(result.dependencyGraph?.cycles.length).toBeGreaterThan(0);
      
      const cycle = result.dependencyGraph!.cycles[0];
      expect(cycle).toContain('/test/src/a.ts');
      expect(cycle).toContain('/test/src/b.ts');
      expect(cycle).toContain('/test/src/c.ts');
    });
  });

  describe('Symbol Search', () => {
    it('should search symbols across files', async () => {
      const files = ['/test/src/auth.ts', '/test/src/user.ts'];

      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'export class UserService {}',
        returnDisplay: 'File'
      });

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'searchSymbols').mockImplementation(async (path) => {
        if (path === '/test/src/user.ts') {
          return [{
            name: 'UserService',
            type: 'class',
            position: { line: 1, column: 14 },
            scope: 'module',
            exported: true
          }];
        }
        return [];
      });

      const results = await analyzer.searchSymbols(files, {
        type: 'class',
        namePattern: 'User.*'
      });

      expect(Object.keys(results)).toHaveLength(1);
      expect(results['/test/src/user.ts']).toHaveLength(1);
      expect(results['/test/src/user.ts'][0].name).toBe('UserService');
    });
  });

  describe('File Info Extraction', () => {
    it('should extract file info for validation', async () => {
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: 'file content',
        returnDisplay: 'File'
      });

      const mockStats = {
        size: 1024,
        isFile: true,
        isDirectory: false,
        mtime: new Date('2024-01-01'),
        ctime: new Date('2024-01-01'),
        mode: 0o644
      };

      mockFsStat.mockResolvedValue(mockStats);
      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('javascript');

      const info = await analyzer.extractFileInfo('/test/app.js');

      expect(info).toBeDefined();
      expect(info?.path).toBe('/test/app.js');
      expect(info?.size).toBe(1024);
      expect(info?.modified).toEqual(mockStats.mtime);
      expect(info?.language).toBe('javascript');
    });

    it('should handle missing files', async () => {
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: '',
        returnDisplay: 'Error',
        error: 'File not found'
      });

      const info = await analyzer.extractFileInfo('/test/missing.ts');

      expect(info).toBeNull();
    });
  });

  describe('Options and Configuration', () => {
    it('should respect exclude patterns', async () => {
      mockGlobby.mockImplementation(async (_patterns, options) => {
        expect(options?.ignore).toContain('**/dist/**');
        expect(options?.ignore).toContain('**/*.min.js');
        return ['/test/src/index.ts'];
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['**/*.ts']
      };

      await analyzer.analyze(operation, {
        excludePatterns: ['**/dist/**', '**/*.min.js']
      });

      expect(mockGlobby).toHaveBeenCalled();
    });

    it('should limit search depth', async () => {
      mockGlobby.mockImplementation(async (_patterns, options) => {
        expect(options?.deep).toBe(2);
        return ['/test/src/index.ts'];
      });

      const operation: AnalyzeOperation = {
        type: 'analyze',
        paths: ['**/*.ts']
      };

      await analyzer.analyze(operation, {
        maxDepth: 2
      });

      expect(mockGlobby).toHaveBeenCalled();
    });
  });
});