/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { 
  FileOperationsMigrationConfig, 
  MigrationPhase, 
  MIGRATION_PRESETS 
} from './migration-config.js';
import { Config } from '../../../config/config.js';
import { createToolRegistry } from '../../../config/config.js';
import { LegacyToolCompatibility } from '../adapters/legacy-compatibility.js';
import { ReadFileTool } from '../../read-file.js';
import { WriteFileTool } from '../../write-file.js';
import { EditTool } from '../../edit.js';
import { GlobTool } from '../../glob.js';
import { GrepTool } from '../../grep.js';

describe('Migration Validation Tests - No Breaking Changes', () => {
  let tmpDir: string;
  let mockConfig: Config;
  let legacyCompatibility: LegacyToolCompatibility;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'migration-validation-test-'));
    
    mockConfig = {
      getFileOperationsMigration: vi.fn().mockReturnValue(MIGRATION_PRESETS.DEVELOPMENT),
      getTargetDir: vi.fn().mockReturnValue(tmpDir),
      getCoreTools: vi.fn().mockReturnValue(['read_file', 'write_file', 'replace', 'glob', 'search_file_content']),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
      getFileFilteringAllowBuildArtifacts: vi.fn().mockReturnValue(false),
      getGeminiIgnorePatterns: vi.fn().mockReturnValue([]),
    } as any;

    legacyCompatibility = new LegacyToolCompatibility(
      mockConfig,
      tmpDir,
      { useFileOperationsAdapters: true, debugMode: false }
    );

    // Create comprehensive test file structure
    await createTestFileStructure();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  async function createTestFileStructure(): Promise<void> {
    // Create directories
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });

    // Create various file types
    const files = [
      // Text files
      { path: 'README.md', content: '# Test Project\n\nThis is a test project for migration validation.' },
      { path: 'CHANGELOG.md', content: '# Changelog\n\n## v1.0.0\n- Initial release' },
      
      // Source files
      { path: 'src/index.ts', content: 'export * from "./lib";\nexport { default } from "./main";' },
      { path: 'src/lib.ts', content: 'export function add(a: number, b: number): number {\n  return a + b;\n}' },
      { path: 'src/main.ts', content: 'import { add } from "./lib";\n\nconsole.log(add(1, 2));' },
      
      // Test files
      { path: 'tests/lib.test.ts', content: 'import { add } from "../src/lib";\n\ntest("add function", () => {\n  expect(add(1, 2)).toBe(3);\n});' },
      
      // Config files
      { path: 'config/app.json', content: '{\n  "name": "test-app",\n  "version": "1.0.0"\n}' },
      { path: 'package.json', content: '{\n  "name": "migration-test",\n  "version": "1.0.0",\n  "scripts": {\n    "test": "vitest"\n  }\n}' },
      
      // Documentation
      { path: 'docs/api.md', content: '# API Documentation\n\n## Functions\n\n### add(a, b)\nAdds two numbers.' },
      
      // Various text formats
      { path: 'data.csv', content: 'name,age,city\nJohn,30,NYC\nJane,25,LA' },
      { path: 'config.xml', content: '<?xml version="1.0"?>\n<config>\n  <setting name="debug" value="true"/>\n</config>' },
      { path: 'styles.css', content: '.container {\n  max-width: 1200px;\n  margin: 0 auto;\n}' },
    ];

    for (const file of files) {
      await fs.writeFile(path.join(tmpDir, file.path), file.content);
    }
  }

  describe('API Compatibility Validation', () => {
    it('should maintain exact API compatibility for ReadFile tool', async () => {
      const originalTool = new ReadFileTool(tmpDir, mockConfig);
      const adapterTool = legacyCompatibility.getTool('read_file');

      expect(adapterTool).toBeTruthy();

      const testFiles = [
        'README.md',
        'src/index.ts',
        'config/app.json',
        'data.csv',
      ];

      for (const fileName of testFiles) {
        const filePath = path.join(tmpDir, fileName);
        
        // Test with original tool
        const originalResult = await originalTool.execute({ file_path: filePath });
        
        // Test with adapter
        const adapterResult = await adapterTool!.execute({ file_path: filePath });

        // Verify same success status
        expect(adapterResult.success).toBe(originalResult.success);
        
        if (originalResult.success && adapterResult.success) {
          // Verify same content
          expect(adapterResult.toolResult?.data?.content).toBe(originalResult.toolResult?.data?.content);
          
          // Verify same metadata structure
          expect(adapterResult.toolResult?.data?.metadata).toBeTruthy();
          expect(adapterResult.toolResult?.data?.metadata?.size).toBe(originalResult.toolResult?.data?.metadata?.size);
        }
      }
    });

    it('should maintain exact API compatibility for WriteFile tool', async () => {
      const originalTool = new WriteFileTool(mockConfig);
      const adapterTool = legacyCompatibility.getTool('write_file');

      expect(adapterTool).toBeTruthy();

      const testCases = [
        { fileName: 'new-file.txt', content: 'Simple text content' },
        { fileName: 'new-json.json', content: '{\n  "test": true,\n  "value": 42\n}' },
        { fileName: 'new-code.ts', content: 'export const greeting = "Hello, World!";' },
        { fileName: 'unicode-test.txt', content: 'Unicode: 🚀 ñoño café résumé' },
      ];

      for (const testCase of testCases) {
        const filePath = path.join(tmpDir, `original-${testCase.fileName}`);
        const adapterPath = path.join(tmpDir, `adapter-${testCase.fileName}`);
        
        // Test with original tool
        const originalResult = await originalTool.execute({
          file_path: filePath,
          content: testCase.content,
        });
        
        // Test with adapter
        const adapterResult = await adapterTool!.execute({
          file_path: adapterPath,
          content: testCase.content,
        });

        // Verify same success status
        expect(adapterResult.success).toBe(originalResult.success);
        
        if (originalResult.success && adapterResult.success) {
          // Verify files were created with same content
          const originalContent = await fs.readFile(filePath, 'utf-8');
          const adapterContent = await fs.readFile(adapterPath, 'utf-8');
          expect(adapterContent).toBe(originalContent);
          expect(adapterContent).toBe(testCase.content);
        }
      }
    });

    it('should maintain exact API compatibility for EditTool', async () => {
      const originalTool = new EditTool(mockConfig);
      const adapterTool = legacyCompatibility.getTool('replace');

      expect(adapterTool).toBeTruthy();

      const testCases = [
        {
          file: 'src/lib.ts',
          oldString: 'function add',
          newString: 'function addNumbers',
        },
        {
          file: 'README.md',
          oldString: '# Test Project',
          newString: '# Updated Test Project',
        },
        {
          file: 'config/app.json',
          oldString: '"version": "1.0.0"',
          newString: '"version": "1.0.1"',
        },
      ];

      for (const testCase of testCases) {
        // Create separate files for original and adapter testing
        const originalFile = path.join(tmpDir, `original-${testCase.file}`);
        const adapterFile = path.join(tmpDir, `adapter-${testCase.file}`);
        
        const sourceFile = path.join(tmpDir, testCase.file);
        const sourceContent = await fs.readFile(sourceFile, 'utf-8');
        
        await fs.writeFile(originalFile, sourceContent);
        await fs.writeFile(adapterFile, sourceContent);
        
        // Test with original tool
        const originalResult = await originalTool.execute({
          file_path: originalFile,
          old_string: testCase.oldString,
          new_string: testCase.newString,
        });
        
        // Test with adapter
        const adapterResult = await adapterTool!.execute({
          file_path: adapterFile,
          old_string: testCase.oldString,
          new_string: testCase.newString,
        });

        // Verify same success status
        expect(adapterResult.success).toBe(originalResult.success);
        
        if (originalResult.success && adapterResult.success) {
          // Verify files have same content after edit
          const originalContent = await fs.readFile(originalFile, 'utf-8');
          const adapterContent = await fs.readFile(adapterFile, 'utf-8');
          expect(adapterContent).toBe(originalContent);
          
          // Verify the edit was applied correctly
          expect(originalContent).toContain(testCase.newString);
          expect(originalContent).not.toContain(testCase.oldString);
        }
      }
    });

    it('should maintain exact API compatibility for GlobTool', async () => {
      const originalTool = new GlobTool(tmpDir, mockConfig);
      const adapterTool = legacyCompatibility.getTool('glob');

      expect(adapterTool).toBeTruthy();

      const testPatterns = [
        '*.md',
        'src/**/*.ts',
        '**/*.json',
        'tests/**/*',
        'config/*',
      ];

      for (const pattern of testPatterns) {
        // Test with original tool
        const originalResult = await originalTool.execute({ pattern });
        
        // Test with adapter
        const adapterResult = await adapterTool!.execute({ pattern });

        // Verify same success status
        expect(adapterResult.success).toBe(originalResult.success);
        
        if (originalResult.success && adapterResult.success) {
          // Verify same files found
          const originalFiles = originalResult.toolResult?.data?.files || [];
          const adapterFiles = adapterResult.toolResult?.data?.files || [];
          
          expect(adapterFiles.length).toBe(originalFiles.length);
          
          // Sort both arrays to ensure consistent comparison
          const sortedOriginal = [...originalFiles].sort();
          const sortedAdapter = [...adapterFiles].sort();
          
          expect(sortedAdapter).toEqual(sortedOriginal);
        }
      }
    });

    it('should maintain exact API compatibility for GrepTool', async () => {
      const originalTool = new GrepTool(tmpDir);
      const adapterTool = legacyCompatibility.getTool('search_file_content');

      expect(adapterTool).toBeTruthy();

      const testCases = [
        { pattern: 'function', file_path: 'src/lib.ts' },
        { pattern: 'export', file_path: 'src/index.ts' },
        { pattern: 'test', file_path: 'tests/lib.test.ts' },
        { pattern: 'version', file_path: 'package.json' },
        { pattern: '\\d+\\.\\d+\\.\\d+', file_path: 'package.json' }, // Version regex
      ];

      for (const testCase of testCases) {
        const filePath = path.join(tmpDir, testCase.file_path);
        
        // Test with original tool
        const originalResult = await originalTool.execute({
          pattern: testCase.pattern,
          file_path: filePath,
        });
        
        // Test with adapter
        const adapterResult = await adapterTool!.execute({
          pattern: testCase.pattern,
          file_path: filePath,
        });

        // Verify same success status
        expect(adapterResult.success).toBe(originalResult.success);
        
        if (originalResult.success && adapterResult.success) {
          // Verify same matches found
          const originalMatches = originalResult.toolResult?.data?.matches || [];
          const adapterMatches = adapterResult.toolResult?.data?.matches || [];
          
          expect(adapterMatches.length).toBe(originalMatches.length);
          
          // Verify match details are consistent
          for (let i = 0; i < originalMatches.length; i++) {
            expect(adapterMatches[i]?.line).toBe(originalMatches[i]?.line);
            expect(adapterMatches[i]?.lineNumber).toBe(originalMatches[i]?.lineNumber);
            expect(adapterMatches[i]?.match).toBe(originalMatches[i]?.match);
          }
        }
      }
    });
  });

  describe('Error Handling Compatibility', () => {
    it('should handle file not found errors consistently', async () => {
      const nonExistentFile = path.join(tmpDir, 'does-not-exist.txt');
      
      const tools = [
        { name: 'read_file', params: { file_path: nonExistentFile } },
        { name: 'replace', params: { file_path: nonExistentFile, old_string: 'test', new_string: 'test2' } },
        { name: 'search_file_content', params: { pattern: 'test', file_path: nonExistentFile } },
      ];

      for (const tool of tools) {
        const adapterTool = legacyCompatibility.getTool(tool.name);
        expect(adapterTool).toBeTruthy();

        const result = await adapterTool!.execute(tool.params);
        
        // Should fail gracefully
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
        expect(result.error?.toLowerCase()).toContain('not found');
      }
    });

    it('should handle permission errors consistently', async () => {
      // Skip this test on Windows as permission handling is different
      if (process.platform === 'win32') {
        return;
      }

      const restrictedFile = path.join(tmpDir, 'restricted.txt');
      await fs.writeFile(restrictedFile, 'content');
      await fs.chmod(restrictedFile, 0o000); // No permissions

      try {
        const tools = [
          { name: 'read_file', params: { file_path: restrictedFile } },
          { name: 'write_file', params: { file_path: restrictedFile, content: 'new content' } },
        ];

        for (const tool of tools) {
          const adapterTool = legacyCompatibility.getTool(tool.name);
          expect(adapterTool).toBeTruthy();

          const result = await adapterTool!.execute(tool.params);
          
          // Should fail gracefully
          expect(result.success).toBe(false);
          expect(result.error).toBeTruthy();
        }
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(restrictedFile, 0o644);
      }
    });

    it('should handle invalid parameters consistently', async () => {
      const testCases = [
        { tool: 'read_file', params: { file_path: '' } },
        { tool: 'write_file', params: { file_path: '', content: 'test' } },
        { tool: 'replace', params: { file_path: 'src/lib.ts', old_string: '', new_string: 'test' } },
        { tool: 'glob', params: { pattern: '' } },
        { tool: 'search_file_content', params: { pattern: '', file_path: 'src/lib.ts' } },
      ];

      for (const testCase of testCases) {
        const adapterTool = legacyCompatibility.getTool(testCase.tool);
        expect(adapterTool).toBeTruthy();

        const result = await adapterTool!.execute(testCase.params);
        
        // Should handle invalid parameters gracefully
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      }
    });
  });

  describe('Tool Registry Compatibility', () => {
    it('should maintain tool registry behavior with migration enabled', async () => {
      const registry = await createToolRegistry(mockConfig);
      
      // Verify all expected tools are available
      const expectedTools = ['read_file', 'write_file', 'replace', 'glob', 'search_file_content', 'file_operations'];
      
      for (const toolName of expectedTools) {
        const tool = registry.getTool(toolName);
        expect(tool).toBeTruthy();
        expect(tool?.name).toBe(toolName);
      }
    });

    it('should maintain tool registry behavior with migration disabled', async () => {
      const disabledConfig = {
        ...mockConfig,
        getFileOperationsMigration: vi.fn().mockReturnValue({
          phase: MigrationPhase.DISABLED,
          rolloutPercentage: 0,
          tools: {},
          monitoring: { enabled: false, sampleRate: 0, includeDetailedTimings: false },
          metrics: { enabled: false, trackSuccessRates: false, trackOperationCounts: false, exportEnabled: false },
          rollback: { autoRollback: false, errorThreshold: 0.1, performanceThreshold: 2.0, minSampleSize: 100 },
          features: { predictiveCaching: false, parallelExecution: false, transactionManagement: false, securityHardening: false, advancedAnalytics: false },
          debug: { enabled: false, logAdapterDecisions: false, logPerformanceComparisons: false, dryRun: false },
        }),
      };

      const registry = await createToolRegistry(disabledConfig);
      
      // Verify all tools are still available when migration is disabled
      const expectedTools = ['read_file', 'write_file', 'replace', 'glob', 'search_file_content', 'file_operations'];
      
      for (const toolName of expectedTools) {
        const tool = registry.getTool(toolName);
        expect(tool).toBeTruthy();
        expect(tool?.name).toBe(toolName);
      }
    });
  });

  describe('Response Format Compatibility', () => {
    it('should maintain response format structure for all tools', async () => {
      const testCases = [
        {
          tool: 'read_file',
          params: { file_path: path.join(tmpDir, 'README.md') },
          expectedKeys: ['success', 'toolResult', 'error'],
          successKeys: ['data'],
        },
        {
          tool: 'write_file',
          params: { file_path: path.join(tmpDir, 'test-output.txt'), content: 'test content' },
          expectedKeys: ['success', 'toolResult', 'error'],
          successKeys: ['data'],
        },
        {
          tool: 'glob',
          params: { pattern: '*.md' },
          expectedKeys: ['success', 'toolResult', 'error'],
          successKeys: ['data'],
        },
      ];

      for (const testCase of testCases) {
        const adapterTool = legacyCompatibility.getTool(testCase.tool);
        expect(adapterTool).toBeTruthy();

        const result = await adapterTool!.execute(testCase.params);
        
        // Verify response structure
        expect(result).toBeTruthy();
        for (const key of testCase.expectedKeys) {
          expect(result).toHaveProperty(key);
        }

        if (result.success && testCase.successKeys) {
          for (const key of testCase.successKeys) {
            expect(result.toolResult).toHaveProperty(key);
          }
        }
      }
    });

    it('should maintain consistent error format across tools', async () => {
      const nonExistentFile = path.join(tmpDir, 'does-not-exist.txt');
      
      const errorCases = [
        { tool: 'read_file', params: { file_path: nonExistentFile } },
        { tool: 'replace', params: { file_path: nonExistentFile, old_string: 'a', new_string: 'b' } },
      ];

      for (const errorCase of errorCases) {
        const adapterTool = legacyCompatibility.getTool(errorCase.tool);
        expect(adapterTool).toBeTruthy();

        const result = await adapterTool!.execute(errorCase.params);
        
        // Verify error format
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
        expect(typeof result.error).toBe('string');
        expect(result.error!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Performance Regression Tests', () => {
    it('should not introduce significant performance regressions', async () => {
      const testFile = path.join(tmpDir, 'performance-test.txt');
      const content = 'Performance test content\n'.repeat(1000);
      await fs.writeFile(testFile, content);

      const iterations = 50;
      const tools = [
        { name: 'read_file', params: { file_path: testFile } },
        { name: 'write_file', params: { file_path: path.join(tmpDir, 'perf-write.txt'), content: 'test' } },
      ];

      for (const tool of tools) {
        const adapterTool = legacyCompatibility.getTool(tool.name);
        expect(adapterTool).toBeTruthy();

        const start = Date.now();
        for (let i = 0; i < iterations; i++) {
          const params = tool.name === 'write_file' 
            ? { ...tool.params, file_path: path.join(tmpDir, `perf-write-${i}.txt`) }
            : tool.params;
            
          const result = await adapterTool!.execute(params);
          expect(result.success).toBe(true);
        }
        const duration = Date.now() - start;
        const avgTime = duration / iterations;

        console.log(`${tool.name} average time: ${avgTime.toFixed(2)}ms`);
        
        // Should complete operations in reasonable time
        expect(avgTime).toBeLessThan(100); // Less than 100ms per operation
      }
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle empty files consistently', async () => {
      const emptyFile = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(emptyFile, '');

      const readTool = legacyCompatibility.getTool('read_file');
      const result = await readTool!.execute({ file_path: emptyFile });
      
      expect(result.success).toBe(true);
      expect(result.toolResult?.data?.content).toBe('');
    });

    it('should handle large files consistently', async () => {
      const largeFile = path.join(tmpDir, 'large.txt');
      const largeContent = 'Large file content\n'.repeat(10000);
      await fs.writeFile(largeFile, largeContent);

      const readTool = legacyCompatibility.getTool('read_file');
      const result = await readTool!.execute({ file_path: largeFile });
      
      expect(result.success).toBe(true);
      expect(result.toolResult?.data?.content).toBe(largeContent);
    });

    it('should handle unicode content consistently', async () => {
      const unicodeFile = path.join(tmpDir, 'unicode.txt');
      const unicodeContent = '🚀 Unicode test: ñoño café résumé 中文 العربية русский';
      await fs.writeFile(unicodeFile, unicodeContent);

      const readTool = legacyCompatibility.getTool('read_file');
      const result = await readTool!.execute({ file_path: unicodeFile });
      
      expect(result.success).toBe(true);
      expect(result.toolResult?.data?.content).toBe(unicodeContent);
    });

    it('should handle complex glob patterns consistently', async () => {
      const globTool = legacyCompatibility.getTool('glob');
      
      const complexPatterns = [
        '**/*.{ts,js}',
        'src/**/*',
        '{tests,docs}/**/*.md',
        '!(node_modules)/**/*',
      ];

      for (const pattern of complexPatterns) {
        const result = await globTool!.execute({ pattern });
        
        // Should not crash on complex patterns
        expect(result.success).toBe(true);
        expect(Array.isArray(result.toolResult?.data?.files)).toBe(true);
      }
    });
  });
});