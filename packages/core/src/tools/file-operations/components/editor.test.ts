/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Editor } from './editor.js';
import { FileSystemService } from '../services/file-system-service.js';
import { CacheManager } from '../services/cache-manager.js';
import { ASTParserService } from '../services/ast-parser.js';
import { EditOperation } from '../file-operations-types.js';

describe('Editor', () => {
  let editor: Editor;
  let fileService: FileSystemService;
  let cacheManager: CacheManager;
  let astParser: ASTParserService;

  beforeEach(() => {
    // Create mock services
    fileService = new FileSystemService('/test');
    cacheManager = new CacheManager(fileService, {
      maxSizeBytes: 1000000,
      maxEntries: 100,
      enableWatching: false
    });
    astParser = new ASTParserService(cacheManager);

    // Create editor
    editor = new Editor(fileService, astParser);

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('Find and Replace', () => {
    it('should perform literal string replacement', async () => {
      const content = 'const foo = "bar";\nconst baz = "foo";\n';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.ts', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: 'foo',
            replace: 'qux',
            replaceAll: false
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.ts']).toBe(1);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.ts');
      expect(newContent).toBe('const qux = "bar";\nconst baz = "foo";\n');
    });

    it('should perform replace all for literal strings', async () => {
      const content = 'const foo = "bar";\nconst baz = "foo";\nfoo();\n';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.ts', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: 'foo',
            replace: 'qux',
            replaceAll: true
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.ts']).toBe(3);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.ts');
      expect(newContent).toBe('const qux = "bar";\nconst baz = "qux";\nqux();\n');
    });

    it('should perform regex replacement', async () => {
      const content = 'const foo123 = "bar";\nconst foo456 = "baz";\n';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.ts', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: 'foo\\d+',
            replace: 'bar',
            regex: true,
            replaceAll: true
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.ts']).toBe(2);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.ts');
      expect(newContent).toBe('const bar = "bar";\nconst bar = "baz";\n');
    });

    it('should handle no matches gracefully', async () => {
      const content = 'const foo = "bar";\n';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(new Map());

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: 'notfound',
            replace: 'replacement'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(0);
      expect(result.changes).toEqual({});
      expect(fileService.writeFiles).not.toHaveBeenCalled();
    });
  });

  describe('Line-based Operations', () => {
    it('should insert a line', async () => {
      const content = 'line 1\nline 2\nline 3';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.txt', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.txt',
          changes: [{
            type: 'line',
            line: 2,
            operation: 'insert',
            content: 'inserted line'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.txt']).toBe(1);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.txt');
      expect(newContent).toBe('line 1\ninserted line\nline 2\nline 3');
    });

    it('should replace a line', async () => {
      const content = 'line 1\nline 2\nline 3';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.txt', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.txt',
          changes: [{
            type: 'line',
            line: 2,
            operation: 'replace',
            content: 'replaced line'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.txt']).toBe(1);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.txt');
      expect(newContent).toBe('line 1\nreplaced line\nline 3');
    });

    it('should delete a line', async () => {
      const content = 'line 1\nline 2\nline 3';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.txt', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.txt',
          changes: [{
            type: 'line',
            line: 2,
            operation: 'delete'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.txt']).toBe(1);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.txt');
      expect(newContent).toBe('line 1\nline 3');
    });

    it('should handle invalid line numbers', async () => {
      const content = 'line 1\nline 2';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(new Map());

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.txt',
          changes: [{
            type: 'line',
            line: 10,
            operation: 'replace',
            content: 'new line'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(0);
      expect(result.changes).toEqual({});
      expect(fileService.writeFiles).not.toHaveBeenCalled();
    });
  });

  describe('Position-based Operations', () => {
    it('should replace content at position', async () => {
      const content = 'Hello, World!';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.txt', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.txt',
          changes: [{
            type: 'position',
            start: 7,
            end: 12,
            content: 'Universe'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.txt']).toBe(1);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.txt');
      expect(newContent).toBe('Hello, Universe!');
    });

    it('should handle invalid positions', async () => {
      const content = 'Hello';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(new Map());

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.txt',
          changes: [{
            type: 'position',
            start: 10,
            end: 20,
            content: 'replacement'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(0);
      expect(result.changes).toEqual({});
      expect(fileService.writeFiles).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Changes', () => {
    it('should apply multiple changes to a file', async () => {
      const content = 'const foo = "bar";\nfunction test() {\n  return foo;\n}';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.ts', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.ts',
          changes: [
            {
              type: 'find-replace',
              find: 'foo',
              replace: 'baz',
              replaceAll: true
            },
            {
              type: 'line',
              line: 3,
              operation: 'insert',
              content: '  console.log(baz);'
            }
          ]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.ts']).toBe(3); // 2 replacements + 1 insert
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.ts');
      expect(newContent).toContain('const baz = "bar"');
      expect(newContent).toContain('console.log(baz);');
    });
  });

  describe('File Creation', () => {
    it('should create file if missing with createIfMissing flag', async () => {
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: '',
        returnDisplay: 'Error',
        error: 'File not found'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/newfile.ts', { success: true }]])
      );

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/newfile.ts',
          createIfMissing: true,
          changes: [{
            type: 'find-replace',
            find: '',
            replace: 'const greeting = "Hello, World!";'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/newfile.ts']).toBe(1);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/newfile.ts');
      expect(newContent).toBe('const greeting = "Hello, World!";');
    });

    it('should fail if file missing without createIfMissing flag', async () => {
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: '',
        returnDisplay: 'Error',
        error: 'File not found'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(new Map());

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/missing.ts',
          changes: [{
            type: 'find-replace',
            find: 'foo',
            replace: 'bar'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(0);
      expect(result.changes).toEqual({});
      expect(fileService.writeFiles).not.toHaveBeenCalled();
    });
  });

  describe('Syntax Validation', () => {
    it('should validate syntax when requested', async () => {
      const content = 'const foo = "bar"';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.ts', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [],
        errors: [],
        language: 'typescript'
      });

      const operation: EditOperation = {
        type: 'edit',
        validateSyntax: true,
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: 'bar',
            replace: 'baz'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.syntaxErrors).toBeUndefined();
      expect(astParser.parseFile).toHaveBeenCalled();
    });

    it('should report syntax errors', async () => {
      const content = 'const foo = "bar"';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.ts', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      vi.spyOn(astParser, 'detectLanguage').mockReturnValue('typescript');
      vi.spyOn(astParser, 'parseFile').mockResolvedValue({
        imports: [],
        exports: [],
        symbols: [],
        errors: [{ message: 'Unterminated string literal' }],
        language: 'typescript'
      });

      const operation: EditOperation = {
        type: 'edit',
        validateSyntax: true,
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: '"bar"',
            replace: '"baz'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      expect(result.syntaxErrors).toEqual(['/test/file.ts']);
    });
  });

  describe('Dry Run Mode', () => {
    it('should preview changes without writing', async () => {
      const content = 'const foo = "bar";';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(new Map());
      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: 'foo',
            replace: 'baz'
          }]
        }]
      };

      editor = new Editor(fileService, astParser);
      const editOptions = { dryRun: true };
      const result = await editor.editOperation(operation, editOptions);

      expect(result.filesEdited).toBe(1);
      expect(result.changes['/test/file.ts']).toBe(1);
      expect(fileService.writeFiles).not.toHaveBeenCalled();
      expect(cacheManager.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('Batch Operations', () => {
    it('should edit multiple files in batch', async () => {
      vi.spyOn(cacheManager, 'get')
        .mockResolvedValueOnce({
          llmContent: 'file1 content',
          returnDisplay: 'File 1'
        })
        .mockResolvedValueOnce({
          llmContent: 'file2 content',
          returnDisplay: 'File 2'
        });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([
          ['/test/file1.txt', { success: true }],
          ['/test/file2.txt', { success: true }]
        ])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const results = await editor.batchEdit([
        {
          file: '/test/file1.txt',
          changes: [{
            type: 'find-replace',
            find: 'content',
            replace: 'data'
          }]
        },
        {
          file: '/test/file2.txt',
          changes: [{
            type: 'find-replace',
            find: 'content',
            replace: 'data'
          }]
        }
      ]);

      expect(results.size).toBe(2);
      expect(results.get('/test/file1.txt')?.success).toBe(true);
      expect(results.get('/test/file2.txt')?.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle write failures', async () => {
      const content = 'const foo = "bar";';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.ts', { success: false, error: 'Permission denied' }]])
      );

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/file.ts',
          changes: [{
            type: 'find-replace',
            find: 'foo',
            replace: 'baz'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(0);
      expect(result.changes).toEqual({});
    });

    it('should handle binary files', async () => {
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: Buffer.from([0xFF, 0xD8, 0xFF]) as any,
        returnDisplay: 'Binary file'
      });

      const operation: EditOperation = {
        type: 'edit',
        edits: [{
          file: '/test/image.jpg',
          changes: [{
            type: 'find-replace',
            find: 'foo',
            replace: 'bar'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(0);
      expect(result.changes).toEqual({});
    });
  });

  describe('Formatting Preservation', () => {
    it('should preserve line endings', async () => {
      const content = 'line1\r\nline2\r\nline3';
      vi.spyOn(cacheManager, 'get').mockResolvedValue({
        llmContent: content,
        returnDisplay: 'File content'
      });

      vi.spyOn(fileService, 'writeFiles').mockResolvedValue(
        new Map([['/test/file.txt', { success: true }]])
      );

      vi.spyOn(cacheManager, 'invalidate').mockResolvedValue();

      const operation: EditOperation = {
        type: 'edit',
        preserveFormatting: true,
        edits: [{
          file: '/test/file.txt',
          changes: [{
            type: 'line',
            line: 2,
            operation: 'replace',
            content: 'new line'
          }]
        }]
      };

      const result = await editor.editOperation(operation);

      expect(result.filesEdited).toBe(1);
      
      const writeCall = vi.mocked(fileService.writeFiles).mock.calls[0][0];
      const newContent = writeCall.get('/test/file.txt');
      expect(newContent).toContain('\r\n');
    });
  });
});