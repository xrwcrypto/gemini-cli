/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config } from '../../../config/config.js';
import { ReadFileTool } from '../../read-file.js';
import { WriteFileTool } from '../../write-file.js';
import { EditTool } from '../../edit.js';
import { GlobTool } from '../../glob.js';
import { GrepTool } from '../../grep.js';
import { ReadFileAdapter } from './read-file-adapter.js';
import { WriteFileAdapter } from './write-file-adapter.js';
import { EditToolAdapter } from './edit-tool-adapter.js';
import { GlobToolAdapter } from './glob-tool-adapter.js';
import { GrepToolAdapter } from './grep-tool-adapter.js';
import { LegacyToolCompatibility } from './legacy-compatibility.js';

describe('FileOperations Legacy Tool Adapters', () => {
  let tempDir: string;
  let config: Config;
  let abortController: AbortController;
  
  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'adapter-test-'));
    
    // Create mock config
    config = {
      getTargetDir: () => tempDir,
      getGeminiIgnorePatterns: () => [],
      getApprovalMode: () => 'auto',
      setApprovalMode: vi.fn(),
      getGeminiClient: () => ({} as any),
      getFileService: async () => ({
        isGitRepository: () => false,
        filterFiles: (files: string[]) => files
      } as any),
      getFileFilteringRespectGitIgnore: () => false
    } as any;
    
    abortController = new AbortController();
  });
  
  afterEach(async () => {
    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });
  
  describe('ReadFileAdapter', () => {
    it('should maintain identical output format with ReadFileTool', async () => {
      // Create test file
      const testFile = path.join(tempDir, 'test.txt');
      const testContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      await fs.promises.writeFile(testFile, testContent);
      
      // Test with original tool
      const originalTool = new ReadFileTool(tempDir, config);
      const originalResult = await originalTool.execute(
        { path: testFile },
        abortController.signal
      );
      
      // Test with adapter
      const adapter = new ReadFileAdapter(tempDir, config);
      const adapterResult = await adapter.execute(
        { path: testFile },
        abortController.signal
      );
      
      // Compare results - they should be similar in structure
      expect(adapterResult).toHaveProperty('llmContent');
      expect(adapterResult).toHaveProperty('returnDisplay');
      
      // Both should successfully read the file
      expect(originalResult.llmContent).toContain('Line 1');
      expect(originalResult.llmContent).toContain('Line 5');
    });
    
    it('should handle offset and limit parameters', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
      await fs.promises.writeFile(testFile, lines.join('\n'));
      
      const adapter = new ReadFileAdapter(tempDir, config);
      const result = await adapter.execute(
        { path: testFile, offset: 2, limit: 3 },
        abortController.signal
      );
      
      // Should read lines 3-5 (0-based offset)
      expect(result.llmContent).toContain('3');
      expect(result.llmContent).toContain('5');
      expect(result.llmContent).not.toContain('1');
      expect(result.llmContent).not.toContain('6');
    });
    
    it('should handle non-existent files', async () => {
      const adapter = new ReadFileAdapter(tempDir, config);
      const result = await adapter.execute(
        { path: path.join(tempDir, 'nonexistent.txt') },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Error');
      expect(result.returnDisplay).toContain('Error');
    });
  });
  
  describe('WriteFileAdapter', () => {
    it('should create new files like WriteFileTool', async () => {
      const testFile = path.join(tempDir, 'new-file.txt');
      const content = 'Hello, World!';
      
      const adapter = new WriteFileAdapter(config);
      const result = await adapter.execute(
        { file_path: testFile, content },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Successfully created');
      expect(await fs.promises.readFile(testFile, 'utf8')).toBe(content);
    });
    
    it('should overwrite existing files', async () => {
      const testFile = path.join(tempDir, 'existing.txt');
      await fs.promises.writeFile(testFile, 'Old content');
      
      const adapter = new WriteFileAdapter(config);
      const result = await adapter.execute(
        { file_path: testFile, content: 'New content' },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Successfully overwrote');
      expect(await fs.promises.readFile(testFile, 'utf8')).toBe('New content');
    });
    
    it('should generate file diffs in returnDisplay', async () => {
      const testFile = path.join(tempDir, 'diff-test.txt');
      await fs.promises.writeFile(testFile, 'Original');
      
      const adapter = new WriteFileAdapter(config);
      const result = await adapter.execute(
        { file_path: testFile, content: 'Modified' },
        abortController.signal
      );
      
      expect(result.returnDisplay).toHaveProperty('fileDiff');
      expect(result.returnDisplay).toHaveProperty('fileName');
      expect((result.returnDisplay as any).fileDiff).toContain('Original');
      expect((result.returnDisplay as any).fileDiff).toContain('Modified');
    });
  });
  
  describe('EditToolAdapter', () => {
    it('should perform find-replace operations', async () => {
      const testFile = path.join(tempDir, 'edit-test.js');
      const originalContent = `function oldName() {
  console.log('Hello');
}

oldName();`;
      await fs.promises.writeFile(testFile, originalContent);
      
      const adapter = new EditToolAdapter(config);
      const result = await adapter.execute(
        {
          file_path: testFile,
          old_string: 'oldName',
          new_string: 'newName',
          expected_replacements: 2
        },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Successfully modified');
      expect(result.llmContent).toContain('2 replacements');
      
      const newContent = await fs.promises.readFile(testFile, 'utf8');
      expect(newContent).toContain('newName');
      expect(newContent).not.toContain('oldName');
    });
    
    it('should create new files with empty old_string', async () => {
      const testFile = path.join(tempDir, 'new-from-edit.txt');
      const content = 'Brand new file';
      
      const adapter = new EditToolAdapter(config);
      const result = await adapter.execute(
        {
          file_path: testFile,
          old_string: '',
          new_string: content
        },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Created new file');
      expect(await fs.promises.readFile(testFile, 'utf8')).toBe(content);
    });
    
    it('should fail when old_string not found', async () => {
      const testFile = path.join(tempDir, 'fail-test.txt');
      await fs.promises.writeFile(testFile, 'Some content');
      
      const adapter = new EditToolAdapter(config);
      const result = await adapter.execute(
        {
          file_path: testFile,
          old_string: 'nonexistent',
          new_string: 'replacement'
        },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('0 occurrences found');
      expect(result.returnDisplay).toContain('could not find the string to replace');
    });
  });
  
  describe('GlobToolAdapter', () => {
    beforeEach(async () => {
      // Create test file structure
      await fs.promises.mkdir(path.join(tempDir, 'src'), { recursive: true });
      await fs.promises.mkdir(path.join(tempDir, 'test'), { recursive: true });
      await fs.promises.writeFile(path.join(tempDir, 'src', 'index.ts'), '');
      await fs.promises.writeFile(path.join(tempDir, 'src', 'utils.ts'), '');
      await fs.promises.writeFile(path.join(tempDir, 'test', 'index.test.ts'), '');
      await fs.promises.writeFile(path.join(tempDir, 'README.md'), '');
    });
    
    it('should find files matching glob patterns', async () => {
      const adapter = new GlobToolAdapter(tempDir, config);
      const result = await adapter.execute(
        { pattern: '**/*.ts' },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Found 3 file(s)');
      expect(result.llmContent).toContain('index.ts');
      expect(result.llmContent).toContain('utils.ts');
      expect(result.llmContent).toContain('index.test.ts');
      expect(result.llmContent).not.toContain('README.md');
    });
    
    it('should respect path parameter', async () => {
      const adapter = new GlobToolAdapter(tempDir, config);
      const result = await adapter.execute(
        { pattern: '*.ts', path: 'src' },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Found 2 file(s)');
      expect(result.llmContent).not.toContain('test');
    });
    
    it('should handle no matches', async () => {
      const adapter = new GlobToolAdapter(tempDir, config);
      const result = await adapter.execute(
        { pattern: '*.nonexistent' },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('No files found');
      expect(result.returnDisplay).toBe('No files found');
    });
  });
  
  describe('GrepToolAdapter', () => {
    beforeEach(async () => {
      // Create test files with content
      await fs.promises.writeFile(
        path.join(tempDir, 'file1.js'),
        `function hello() {
  console.log('Hello, World!');
}

function goodbye() {
  console.log('Goodbye!');
}`
      );
      
      await fs.promises.writeFile(
        path.join(tempDir, 'file2.js'),
        `const message = 'Hello';
console.log(message);`
      );
    });
    
    it('should find pattern matches across files', async () => {
      const adapter = new GrepToolAdapter(tempDir, config);
      const result = await adapter.execute(
        { pattern: 'console\\.log' },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Found');
      expect(result.llmContent).toContain('match(es)');
      expect(result.llmContent).toContain('file1.js');
      expect(result.llmContent).toContain('file2.js');
      expect(result.llmContent).toMatch(/L\d+:/); // Line number format
    });
    
    it('should filter by include pattern', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'test.txt'), 'console.log test');
      
      const adapter = new GrepToolAdapter(tempDir, config);
      const result = await adapter.execute(
        { pattern: 'console', include: '*.js' },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('file1.js');
      expect(result.llmContent).toContain('file2.js');
      expect(result.llmContent).not.toContain('test.txt');
    });
    
    it('should handle invalid regex patterns', async () => {
      const adapter = new GrepToolAdapter(tempDir, config);
      const result = await adapter.execute(
        { pattern: '[invalid regex' },
        abortController.signal
      );
      
      expect(result.llmContent).toContain('Invalid regular expression');
      expect(result.returnDisplay).toContain('invalid parameters');
    });
  });
  
  describe('LegacyToolCompatibility', () => {
    it('should return original tools when adapters disabled', () => {
      const compat = new LegacyToolCompatibility(config, tempDir, {
        useFileOperationsAdapters: false
      });
      
      const readTool = compat.getTool('read_file');
      expect(readTool).toBeInstanceOf(ReadFileTool);
      expect(readTool).not.toBeInstanceOf(ReadFileAdapter);
    });
    
    it('should return adapters when enabled', () => {
      const compat = new LegacyToolCompatibility(config, tempDir, {
        useFileOperationsAdapters: true
      });
      
      const readTool = compat.getTool('read_file');
      expect(readTool).toBeInstanceOf(ReadFileAdapter);
      
      const writeTool = compat.getTool('write_file');
      expect(writeTool).toBeInstanceOf(WriteFileAdapter);
      
      const editTool = compat.getTool('replace');
      expect(editTool).toBeInstanceOf(EditToolAdapter);
    });
    
    it('should respect tool exclusions', () => {
      const compat = new LegacyToolCompatibility(config, tempDir, {
        useFileOperationsAdapters: true,
        excludeTools: ['read_file', 'glob']
      });
      
      const readTool = compat.getTool('read_file');
      expect(readTool).toBeInstanceOf(ReadFileTool);
      
      const globTool = compat.getTool('glob');
      expect(globTool).toBeInstanceOf(GlobTool);
      
      const editTool = compat.getTool('replace');
      expect(editTool).toBeInstanceOf(EditToolAdapter);
    });
    
    it('should return all tools with correct types', () => {
      const compat = new LegacyToolCompatibility(config, tempDir, {
        useFileOperationsAdapters: true
      });
      
      const allTools = compat.getAllTools();
      expect(allTools.size).toBe(5);
      expect(allTools.has('read_file')).toBe(true);
      expect(allTools.has('write_file')).toBe(true);
      expect(allTools.has('replace')).toBe(true);
      expect(allTools.has('glob')).toBe(true);
      expect(allTools.has('search_file_content')).toBe(true);
    });
  });
});