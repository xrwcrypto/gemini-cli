/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { 
  FileOperationsMigrationConfig, 
  MigrationPhase, 
  MIGRATION_PRESETS 
} from './migration-config.js';
import { MigrationManager } from './migration-manager.js';
import { MigrationMetrics } from './migration-metrics.js';
import { UsageMetricsCollector } from './usage-metrics.js';
import { RollbackManager } from './rollback-manager.js';
import { FileOperationsTool } from '../file-operations.js';
import { ReadFileTool } from '../../read-file.js';
import { WriteFileTool } from '../../write-file.js';
import { EditTool } from '../../edit.js';
import { Config } from '../../../config/config.js';

describe('Migration Performance Benchmarks', () => {
  let tmpDir: string;
  let mockConfig: Config;
  let migrationManager: MigrationManager;
  let migrationMetrics: MigrationMetrics;
  let fileOpsTool: FileOperationsTool;
  let readFileTool: ReadFileTool;
  let writeFileTool: WriteFileTool;
  let editTool: EditTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'migration-perf-test-'));
    
    mockConfig = {
      getFileOperationsMigration: vi.fn().mockReturnValue(MIGRATION_PRESETS.DEVELOPMENT),
      getTargetDir: vi.fn().mockReturnValue(tmpDir),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
      getFileFilteringAllowBuildArtifacts: vi.fn().mockReturnValue(false),
      getGeminiIgnorePatterns: vi.fn().mockReturnValue([]),
    } as any;

    migrationMetrics = new MigrationMetrics();
    migrationManager = new MigrationManager(
      mockConfig.getFileOperationsMigration(),
      migrationMetrics
    );

    // Initialize tools
    fileOpsTool = new FileOperationsTool(mockConfig, tmpDir);
    readFileTool = new ReadFileTool(tmpDir, mockConfig);
    writeFileTool = new WriteFileTool(mockConfig);
    editTool = new EditTool(mockConfig);

    // Create test files of various sizes
    await createTestFiles();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  async function createTestFiles(): Promise<void> {
    // Small files (< 1KB)
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(
        path.join(tmpDir, `small-${i}.txt`),
        `Small file ${i}\n`.repeat(10)
      );
    }

    // Medium files (1-10KB)
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(
        path.join(tmpDir, `medium-${i}.txt`),
        `Medium file ${i} content\n`.repeat(500)
      );
    }

    // Large files (50-100KB)
    for (let i = 0; i < 3; i++) {
      await fs.writeFile(
        path.join(tmpDir, `large-${i}.txt`),
        `Large file ${i} with substantial content\n`.repeat(2000)
      );
    }

    // Source code files
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    for (let i = 0; i < 20; i++) {
      await fs.writeFile(
        path.join(tmpDir, 'src', `component-${i}.ts`),
        `
export interface Component${i} {
  id: number;
  name: string;
  props: Record<string, any>;
}

export class Component${i}Service {
  private data: Component${i}[] = [];

  create(item: Component${i}): Component${i} {
    this.data.push(item);
    return item;
  }

  findById(id: number): Component${i} | null {
    return this.data.find(item => item.id === id) || null;
  }

  update(id: number, updates: Partial<Component${i}>): Component${i} | null {
    const item = this.findById(id);
    if (item) {
      Object.assign(item, updates);
    }
    return item;
  }

  delete(id: number): boolean {
    const index = this.data.findIndex(item => item.id === id);
    if (index >= 0) {
      this.data.splice(index, 1);
      return true;
    }
    return false;
  }
}
`
      );
    }
  }

  describe('Single Operation Performance', () => {
    it('should benchmark read operations: FileOperations vs ReadFile', async () => {
      const iterations = 100;
      const testFiles = [
        'small-0.txt',
        'medium-0.txt',
        'large-0.txt',
        'src/component-0.ts',
      ];

      const results: Record<string, { fileOps: number; legacy: number; improvement: number }> = {};

      for (const fileName of testFiles) {
        const filePath = path.join(tmpDir, fileName);

        // Benchmark FileOperations
        const fileOpsStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          const result = await fileOpsTool.execute({
            operations: [
              {
                type: 'analyze',
                path: filePath,
                options: { includeContent: true },
              },
            ],
          });
          expect(result.success).toBe(true);
        }
        const fileOpsTime = performance.now() - fileOpsStart;

        // Benchmark legacy ReadFile
        const legacyStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          const result = await readFileTool.execute({ file_path: filePath });
          expect(result.success).toBe(true);
        }
        const legacyTime = performance.now() - legacyStart;

        const improvement = ((legacyTime - fileOpsTime) / legacyTime) * 100;
        results[fileName] = {
          fileOps: fileOpsTime,
          legacy: legacyTime,
          improvement,
        };

        console.log(`Read ${fileName}:`);
        console.log(`  FileOperations: ${fileOpsTime.toFixed(2)}ms`);
        console.log(`  Legacy ReadFile: ${legacyTime.toFixed(2)}ms`);
        console.log(`  Improvement: ${improvement.toFixed(1)}%`);
      }

      // Verify that FileOperations is competitive (within 50% of legacy performance)
      for (const [fileName, result] of Object.entries(results)) {
        expect(result.improvement).toBeGreaterThan(-50); // No more than 50% slower
      }
    });

    it('should benchmark write operations: FileOperations vs WriteFile', async () => {
      const iterations = 50;
      const testContents = [
        'Small content',
        'Medium content\n'.repeat(100),
        'Large content\n'.repeat(1000),
      ];

      const results: Record<string, { fileOps: number; legacy: number; improvement: number }> = {};

      for (let contentIndex = 0; contentIndex < testContents.length; contentIndex++) {
        const content = testContents[contentIndex];
        const contentType = ['small', 'medium', 'large'][contentIndex];

        // Benchmark FileOperations
        const fileOpsStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          const result = await fileOpsTool.execute({
            operations: [
              {
                type: 'create',
                path: path.join(tmpDir, `fileops-write-${contentType}-${i}.txt`),
                content,
              },
            ],
          });
          expect(result.success).toBe(true);
        }
        const fileOpsTime = performance.now() - fileOpsStart;

        // Benchmark legacy WriteFile
        const legacyStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          const result = await writeFileTool.execute({
            file_path: path.join(tmpDir, `legacy-write-${contentType}-${i}.txt`),
            content,
          });
          expect(result.success).toBe(true);
        }
        const legacyTime = performance.now() - legacyStart;

        const improvement = ((legacyTime - fileOpsTime) / legacyTime) * 100;
        results[contentType] = {
          fileOps: fileOpsTime,
          legacy: legacyTime,
          improvement,
        };

        console.log(`Write ${contentType}:`);
        console.log(`  FileOperations: ${fileOpsTime.toFixed(2)}ms`);
        console.log(`  Legacy WriteFile: ${legacyTime.toFixed(2)}ms`);
        console.log(`  Improvement: ${improvement.toFixed(1)}%`);
      }

      // Verify reasonable performance
      for (const result of Object.values(results)) {
        expect(result.improvement).toBeGreaterThan(-50);
      }
    });

    it('should benchmark edit operations: FileOperations vs EditTool', async () => {
      const iterations = 30;
      const testFile = path.join(tmpDir, 'src/component-0.ts');

      // Benchmark FileOperations
      const fileOpsStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const result = await fileOpsTool.execute({
          operations: [
            {
              type: 'edit',
              path: testFile,
              edits: [
                {
                  type: 'replace',
                  search: `Component0`,
                  replace: `Component0Modified${i}`,
                },
              ],
            },
          ],
        });
        expect(result.success).toBe(true);

        // Revert change
        await fileOpsTool.execute({
          operations: [
            {
              type: 'edit',
              path: testFile,
              edits: [
                {
                  type: 'replace',
                  search: `Component0Modified${i}`,
                  replace: `Component0`,
                },
              ],
            },
          ],
        });
      }
      const fileOpsTime = performance.now() - fileOpsStart;

      // Benchmark legacy EditTool
      const legacyStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const result = await editTool.execute({
          file_path: testFile,
          old_string: `Component0`,
          new_string: `Component0Modified${i}`,
        });
        expect(result.success).toBe(true);

        // Revert change
        await editTool.execute({
          file_path: testFile,
          old_string: `Component0Modified${i}`,
          new_string: `Component0`,
        });
      }
      const legacyTime = performance.now() - legacyStart;

      const improvement = ((legacyTime - fileOpsTime) / legacyTime) * 100;

      console.log(`Edit operations:`);
      console.log(`  FileOperations: ${fileOpsTime.toFixed(2)}ms`);
      console.log(`  Legacy EditTool: ${legacyTime.toFixed(2)}ms`);
      console.log(`  Improvement: ${improvement.toFixed(1)}%`);

      expect(improvement).toBeGreaterThan(-50);
    });
  });

  describe('Batch Operation Performance', () => {
    it('should benchmark batch read operations vs sequential legacy calls', async () => {
      const allFiles = [];
      for (let i = 0; i < 10; i++) {
        allFiles.push(path.join(tmpDir, `small-${i}.txt`));
      }
      for (let i = 0; i < 5; i++) {
        allFiles.push(path.join(tmpDir, `medium-${i}.txt`));
      }

      // Benchmark FileOperations batch
      const fileOpsStart = performance.now();
      const result = await fileOpsTool.execute({
        operations: allFiles.map(filePath => ({
          type: 'analyze' as const,
          path: filePath,
          options: { includeContent: true },
        })),
      });
      const fileOpsTime = performance.now() - fileOpsStart;
      expect(result.success).toBe(true);

      // Benchmark sequential legacy calls
      const legacyStart = performance.now();
      for (const filePath of allFiles) {
        const result = await readFileTool.execute({ file_path: filePath });
        expect(result.success).toBe(true);
      }
      const legacyTime = performance.now() - legacyStart;

      const improvement = ((legacyTime - fileOpsTime) / legacyTime) * 100;

      console.log(`Batch read (${allFiles.length} files):`);
      console.log(`  FileOperations: ${fileOpsTime.toFixed(2)}ms`);
      console.log(`  Sequential Legacy: ${legacyTime.toFixed(2)}ms`);
      console.log(`  Improvement: ${improvement.toFixed(1)}%`);

      // Batch operations should be significantly faster
      expect(improvement).toBeGreaterThan(0); // Should show improvement
    });

    it('should benchmark complex multi-operation workflows', async () => {
      const workflows = [
        {
          name: 'Simple workflow (3 operations)',
          operations: [
            { type: 'analyze' as const, path: path.join(tmpDir, 'small-0.txt'), options: { includeContent: true } },
            { type: 'create' as const, path: path.join(tmpDir, 'workflow-1.txt'), content: 'Workflow test' },
            { type: 'edit' as const, path: path.join(tmpDir, 'workflow-1.txt'), edits: [{ type: 'append' as const, content: '\nAppended content' }] },
          ],
        },
        {
          name: 'Complex workflow (10 operations)',
          operations: [
            { type: 'analyze' as const, path: path.join(tmpDir, 'src/component-*.ts'), options: { patternMatching: true } },
            { type: 'create' as const, path: path.join(tmpDir, 'new-module.ts'), content: 'export class NewModule {}' },
            { type: 'edit' as const, path: path.join(tmpDir, 'src/component-0.ts'), edits: [{ type: 'replace' as const, search: 'Component0', replace: 'UpdatedComponent0' }] },
            { type: 'create' as const, path: path.join(tmpDir, 'config.json'), content: '{"version": "2.0.0"}' },
            { type: 'validate' as const, path: path.join(tmpDir, '**/*.ts'), rules: ['syntax'] },
          ],
        },
      ];

      for (const workflow of workflows) {
        const iterations = 10;

        // Benchmark FileOperations
        const fileOpsStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          // Modify operations to avoid conflicts
          const modifiedOps = workflow.operations.map((op, index) => {
            if (op.type === 'create') {
              return {
                ...op,
                path: op.path.replace(/\.(txt|ts|json)$/, `-${i}.$1`),
              };
            }
            return op;
          });

          const result = await fileOpsTool.execute({
            operations: modifiedOps,
          });
          expect(result.success).toBe(true);
        }
        const fileOpsTime = performance.now() - fileOpsStart;

        console.log(`${workflow.name}:`);
        console.log(`  FileOperations (${iterations} iterations): ${fileOpsTime.toFixed(2)}ms`);
        console.log(`  Average per workflow: ${(fileOpsTime / iterations).toFixed(2)}ms`);

        // Verify reasonable performance (should complete workflows quickly)
        expect(fileOpsTime / iterations).toBeLessThan(1000); // Less than 1 second per workflow
      }
    });
  });

  describe('Migration Decision Performance', () => {
    it('should benchmark migration decision making under load', async () => {
      const decisionCounts = [1000, 5000, 10000];
      const tools = ['ReadFileTool', 'WriteFileTool', 'EditTool', 'GlobTool', 'GrepTool'];

      for (const count of decisionCounts) {
        const start = performance.now();
        
        for (let i = 0; i < count; i++) {
          const tool = tools[i % tools.length];
          const userId = `user-${Math.floor(i / 100)}`;
          
          const decision = migrationManager.shouldUseFileOperations(tool, { userId });
          expect(decision).toBeTruthy();
          expect(typeof decision.useFileOperations).toBe('boolean');
        }
        
        const duration = performance.now() - start;
        const decisionsPerSecond = count / (duration / 1000);

        console.log(`Migration decisions (${count} decisions):`);
        console.log(`  Duration: ${duration.toFixed(2)}ms`);
        console.log(`  Rate: ${decisionsPerSecond.toFixed(0)} decisions/second`);

        // Should handle at least 1000 decisions per second
        expect(decisionsPerSecond).toBeGreaterThan(1000);
      }
    });

    it('should benchmark metrics collection performance', async () => {
      const operationCounts = [1000, 5000, 10000];
      const tools = ['ReadFileTool', 'WriteFileTool', 'EditTool'];

      for (const count of operationCounts) {
        const start = performance.now();
        
        for (let i = 0; i < count; i++) {
          const tool = tools[i % tools.length];
          const executionTime = 50 + Math.random() * 100;
          const success = Math.random() > 0.02;
          
          migrationMetrics.recordOperation(tool, success, executionTime);
          
          if (i % 10 === 0) {
            migrationMetrics.recordPerformanceComparison(tool, executionTime * 1.2, executionTime);
          }
          
          if (i % 50 === 0) {
            migrationMetrics.recordDecision(tool, 
              { useFileOperations: true, phase: MigrationPhase.ADAPTERS, reason: 'test' },
              { userId: `user-${i}` }
            );
          }
        }
        
        // Test metrics retrieval
        const retrievalStart = performance.now();
        const stats = migrationMetrics.getAllStats();
        const comparisons = migrationMetrics.getPerformanceComparisons();
        const decisions = migrationMetrics.getDecisionRecords();
        const retrievalTime = performance.now() - retrievalStart;
        
        const totalTime = performance.now() - start;

        console.log(`Metrics collection (${count} operations):`);
        console.log(`  Recording time: ${(totalTime - retrievalTime).toFixed(2)}ms`);
        console.log(`  Retrieval time: ${retrievalTime.toFixed(2)}ms`);
        console.log(`  Total time: ${totalTime.toFixed(2)}ms`);
        console.log(`  Operations/second: ${(count / (totalTime / 1000)).toFixed(0)}`);

        expect(Object.keys(stats)).toHaveLength(tools.length);
        expect(comparisons.length).toBeGreaterThan(0);
        expect(decisions.length).toBeGreaterThan(0);

        // Should handle at least 500 operations per second
        expect(count / (totalTime / 1000)).toBeGreaterThan(500);
      }
    });
  });

  describe('Memory Usage Benchmarks', () => {
    it('should monitor memory usage during high-volume operations', async () => {
      const initialMemory = process.memoryUsage();

      // Perform high-volume operations
      const operationCount = 5000;
      for (let i = 0; i < operationCount; i++) {
        migrationMetrics.recordOperation('ReadFileTool', true, 100);
        migrationMetrics.recordDecision('ReadFileTool',
          { useFileOperations: true, phase: MigrationPhase.ADAPTERS, reason: 'test' },
          { userId: `user-${i}` }
        );

        // Force garbage collection periodically if available
        if (global.gc && i % 1000 === 0) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024; // MB

      console.log(`Memory usage after ${operationCount} operations:`);
      console.log(`  Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Increase: ${memoryIncrease.toFixed(2)} MB`);

      // Memory increase should be reasonable (less than 50MB for 5000 operations)
      expect(memoryIncrease).toBeLessThan(50);
    });

    it('should test memory cleanup after metrics reset', async () => {
      const initialMemory = process.memoryUsage();

      // Fill up metrics
      for (let i = 0; i < 10000; i++) {
        migrationMetrics.recordOperation('ReadFileTool', true, 100);
        migrationMetrics.recordPerformanceComparison('ReadFileTool', 120, 100);
        migrationMetrics.recordDecision('ReadFileTool',
          { useFileOperations: true, phase: MigrationPhase.ADAPTERS, reason: 'test' },
          { userId: `user-${i}` }
        );
      }

      const beforeResetMemory = process.memoryUsage();

      // Reset metrics
      migrationMetrics.reset();

      if (global.gc) {
        global.gc(); // Force garbage collection
      }

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      const afterResetMemory = process.memoryUsage();

      const memoryReduction = (beforeResetMemory.heapUsed - afterResetMemory.heapUsed) / 1024 / 1024; // MB

      console.log(`Memory cleanup after reset:`);
      console.log(`  Before reset: ${(beforeResetMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  After reset: ${(afterResetMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Reduction: ${memoryReduction.toFixed(2)} MB`);

      // Should see some memory reduction after reset
      expect(afterResetMemory.heapUsed).toBeLessThanOrEqual(beforeResetMemory.heapUsed);
    });
  });

  describe('Scalability Tests', () => {
    it('should handle increasing user loads efficiently', async () => {
      const userCounts = [100, 500, 1000, 2000];
      const operationsPerUser = 10;

      for (const userCount of userCounts) {
        const start = performance.now();

        // Simulate concurrent users
        const promises = Array.from({ length: userCount }, async (_, userIndex) => {
          const userId = `load-test-user-${userIndex}`;
          
          for (let op = 0; op < operationsPerUser; op++) {
            const tool = ['ReadFileTool', 'WriteFileTool', 'EditTool'][op % 3];
            const decision = migrationManager.shouldUseFileOperations(tool, { userId });
            migrationMetrics.recordOperation(tool, true, 50 + Math.random() * 50);
          }
        });

        await Promise.all(promises);
        const duration = performance.now() - start;
        const totalOperations = userCount * operationsPerUser;
        const operationsPerSecond = totalOperations / (duration / 1000);

        console.log(`User load test (${userCount} users, ${totalOperations} total operations):`);
        console.log(`  Duration: ${duration.toFixed(2)}ms`);
        console.log(`  Operations/second: ${operationsPerSecond.toFixed(0)}`);

        // Should maintain reasonable performance even with high user count
        expect(operationsPerSecond).toBeGreaterThan(1000);
        expect(duration).toBeLessThan(10000); // Less than 10 seconds
      }
    });

    it('should handle large file operations efficiently', async () => {
      // Create very large files for testing
      const largeFileContent = 'Large file content line\n'.repeat(10000); // ~250KB
      const veryLargeFileContent = 'Very large file content line\n'.repeat(50000); // ~1.25MB

      await fs.writeFile(path.join(tmpDir, 'large-test.txt'), largeFileContent);
      await fs.writeFile(path.join(tmpDir, 'very-large-test.txt'), veryLargeFileContent);

      const fileSizes = [
        { name: 'large-test.txt', size: '~250KB' },
        { name: 'very-large-test.txt', size: '~1.25MB' },
      ];

      for (const fileInfo of fileSizes) {
        const filePath = path.join(tmpDir, fileInfo.name);
        
        // Test read performance
        const readStart = performance.now();
        const readResult = await fileOpsTool.execute({
          operations: [
            {
              type: 'analyze',
              path: filePath,
              options: { includeContent: true },
            },
          ],
        });
        const readTime = performance.now() - readStart;

        expect(readResult.success).toBe(true);

        // Test edit performance
        const editStart = performance.now();
        const editResult = await fileOpsTool.execute({
          operations: [
            {
              type: 'edit',
              path: filePath,
              edits: [
                {
                  type: 'append',
                  content: '\n// Appended content',
                },
              ],
            },
          ],
        });
        const editTime = performance.now() - editStart;

        expect(editResult.success).toBe(true);

        console.log(`Large file operations (${fileInfo.size}):`);
        console.log(`  Read time: ${readTime.toFixed(2)}ms`);
        console.log(`  Edit time: ${editTime.toFixed(2)}ms`);

        // Large files should still be processed in reasonable time
        expect(readTime).toBeLessThan(5000); // Less than 5 seconds
        expect(editTime).toBeLessThan(5000); // Less than 5 seconds
      }
    });
  });
});