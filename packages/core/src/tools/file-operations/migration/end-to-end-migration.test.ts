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
  DEFAULT_MIGRATION_CONFIG,
  MIGRATION_PRESETS 
} from './migration-config.js';
import { MigrationManager } from './migration-manager.js';
import { MigrationMetrics } from './migration-metrics.js';
import { UsageMetricsCollector } from './usage-metrics.js';
import { RollbackManager, RollbackTrigger } from './rollback-manager.js';
import { Config } from '../../../config/config.js';
import { createToolRegistry } from '../../../config/config.js';
import { LegacyToolCompatibility } from '../adapters/legacy-compatibility.js';
import { FileOperationsTool } from '../file-operations.js';

describe('End-to-End Migration Tests', () => {
  let tmpDir: string;
  let mockConfig: Config;
  let migrationManager: MigrationManager;
  let migrationMetrics: MigrationMetrics;
  let usageMetrics: UsageMetricsCollector;
  let rollbackManager: RollbackManager;
  let legacyCompatibility: LegacyToolCompatibility;

  beforeEach(async () => {
    // Create temporary directory for testing
    tmpDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'migration-test-'));
    
    // Setup mock config with migration enabled
    mockConfig = {
      getFileOperationsMigration: vi.fn().mockReturnValue({
        ...MIGRATION_PRESETS.DEVELOPMENT,
        debug: { enabled: true, logAdapterDecisions: true, logPerformanceComparisons: true, dryRun: false },
      }),
      getTargetDir: vi.fn().mockReturnValue(tmpDir),
      getCoreTools: vi.fn().mockReturnValue(['read_file', 'write_file', 'replace', 'glob', 'search_file_content']),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
      getFileFilteringAllowBuildArtifacts: vi.fn().mockReturnValue(false),
      getGeminiIgnorePatterns: vi.fn().mockReturnValue([]),
    } as any;

    // Initialize migration system
    migrationMetrics = new MigrationMetrics();
    migrationManager = new MigrationManager(
      mockConfig.getFileOperationsMigration(), 
      migrationMetrics
    );
    usageMetrics = new UsageMetricsCollector(migrationMetrics);
    rollbackManager = new RollbackManager(
      mockConfig.getFileOperationsMigration(),
      migrationMetrics,
      usageMetrics
    );
    legacyCompatibility = new LegacyToolCompatibility(
      mockConfig,
      tmpDir,
      { useFileOperationsAdapters: true, debugMode: true }
    );

    // Create test files
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'Hello, World!');
    await fs.writeFile(path.join(tmpDir, 'config.json'), '{"version": "1.0.0"}');
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'export const greeting = "Hello";');
  });

  afterEach(async () => {
    vi.clearAllMocks();
    migrationMetrics.reset();
    
    // Cleanup temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Complete Migration Lifecycle', () => {
    it('should successfully migrate from disabled to full rollout', async () => {
      // Phase 1: Migration disabled
      let config = { ...DEFAULT_MIGRATION_CONFIG, phase: MigrationPhase.DISABLED };
      migrationManager.updateConfig(config);
      
      let decision = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: 'test-user' });
      expect(decision.useFileOperations).toBe(false);
      expect(decision.phase).toBe(MigrationPhase.DISABLED);

      // Phase 2: Enable adapters with 25% rollout
      config = { 
        ...config, 
        phase: MigrationPhase.ADAPTERS, 
        rolloutPercentage: 25 
      };
      migrationManager.updateConfig(config);

      // Test rollout percentage
      const results25 = [];
      for (let i = 0; i < 100; i++) {
        const result = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: `user-${i}` });
        results25.push(result.useFileOperations);
      }
      const adoption25 = results25.filter(r => r).length / results25.length;
      expect(adoption25).toBeGreaterThan(0.15);
      expect(adoption25).toBeLessThan(0.35);

      // Phase 3: Increase to 75% rollout
      config = { ...config, rolloutPercentage: 75 };
      migrationManager.updateConfig(config);

      const results75 = [];
      for (let i = 0; i < 100; i++) {
        const result = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: `user-${i}` });
        results75.push(result.useFileOperations);
      }
      const adoption75 = results75.filter(r => r).length / results75.length;
      expect(adoption75).toBeGreaterThan(0.65);
      expect(adoption75).toBeLessThan(0.85);

      // Phase 4: Full rollout
      config = { 
        ...config, 
        phase: MigrationPhase.FULL, 
        rolloutPercentage: 100 
      };
      migrationManager.updateConfig(config);

      decision = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: 'test-user' });
      expect(decision.useFileOperations).toBe(true);
      expect(decision.phase).toBe(MigrationPhase.FULL);
    });

    it('should handle selective tool migration', async () => {
      const config: FileOperationsMigrationConfig = {
        ...DEFAULT_MIGRATION_CONFIG,
        phase: MigrationPhase.ADAPTERS,
        rolloutPercentage: 100,
        tools: {
          readFile: { enabled: true },
          writeFile: { enabled: false },
          editTool: { enabled: true, rolloutPercentage: 50 },
          globTool: { enabled: true, includeUsers: ['power-user'] },
          grepTool: { enabled: true, excludeUsers: ['test-user'] },
        },
      };
      migrationManager.updateConfig(config);

      // ReadFile should be fully enabled
      const readDecision = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: 'test-user' });
      expect(readDecision.useFileOperations).toBe(true);

      // WriteFile should be disabled
      const writeDecision = migrationManager.shouldUseFileOperations('WriteFileTool', { userId: 'test-user' });
      expect(writeDecision.useFileOperations).toBe(false);

      // EditTool should have partial rollout
      const editResults = [];
      for (let i = 0; i < 20; i++) {
        const result = migrationManager.shouldUseFileOperations('EditTool', { userId: `user-${i}` });
        editResults.push(result.useFileOperations);
      }
      const editAdoption = editResults.filter(r => r).length / editResults.length;
      expect(editAdoption).toBeGreaterThan(0.3);
      expect(editAdoption).toBeLessThan(0.7);

      // GlobTool should only work for included user
      const globNormal = migrationManager.shouldUseFileOperations('GlobTool', { userId: 'test-user' });
      expect(globNormal.useFileOperations).toBe(false);
      
      const globPower = migrationManager.shouldUseFileOperations('GlobTool', { userId: 'power-user' });
      expect(globPower.useFileOperations).toBe(true);

      // GrepTool should work for everyone except excluded user
      const grepNormal = migrationManager.shouldUseFileOperations('GrepTool', { userId: 'other-user' });
      expect(grepNormal.useFileOperations).toBe(true);
      
      const grepExcluded = migrationManager.shouldUseFileOperations('GrepTool', { userId: 'test-user' });
      expect(grepExcluded.useFileOperations).toBe(false);
    });
  });

  describe('Real-world Migration Scenarios', () => {
    it('should handle production canary rollout scenario', async () => {
      // Start with production canary preset
      migrationManager.updateConfig(MIGRATION_PRESETS.PRODUCTION_CANARY);

      // Simulate realistic user traffic
      const userSessions = [];
      for (let hour = 0; hour < 24; hour++) {
        for (let session = 0; session < 10; session++) {
          const userId = `user-${hour}-${session}`;
          const tools = ['ReadFileTool', 'WriteFileTool', 'EditTool', 'GlobTool', 'GrepTool'];
          
          for (const tool of tools) {
            const decision = migrationManager.shouldUseFileOperations(tool, { 
              userId,
              sessionId: `session-${hour}-${session}` 
            });
            
            userSessions.push({
              hour,
              userId,
              tool,
              useFileOperations: decision.useFileOperations,
              reason: decision.reason,
            });

            // Simulate operation metrics
            const executionTime = 50 + Math.random() * 100;
            const success = Math.random() > 0.02; // 2% error rate
            migrationMetrics.recordOperation(tool, success, executionTime);

            // Simulate some performance comparisons
            if (decision.useFileOperations && Math.random() < 0.1) {
              const legacyTime = executionTime * (1.2 + Math.random() * 0.8); // Legacy 20-100% slower
              usageMetrics.recordABComparison(tool, legacyTime, executionTime);
            }
          }
        }
      }

      // Verify canary rollout percentage (~5%)
      const adoptedSessions = userSessions.filter(s => s.useFileOperations);
      const adoptionRate = adoptedSessions.length / userSessions.length;
      expect(adoptionRate).toBeGreaterThan(0.03);
      expect(adoptionRate).toBeLessThan(0.07);

      // Generate metrics report
      const report = usageMetrics.generateProgressReport();
      expect(report.status).toBe('early');
      expect(report.recommendations).toContain('Consider increasing rollout percentage');

      // Check that auto-rollback hasn't triggered (error rate is low)
      const stats = migrationMetrics.getAllStats();
      expect(Object.keys(stats)).toHaveLength(5); // All tools should have stats
      
      for (const [tool, toolStats] of Object.entries(stats)) {
        expect(toolStats.errorCount / toolStats.totalOperations).toBeLessThan(0.05);
      }
    });

    it('should handle rollback scenario with recovery', async () => {
      // Start with high rollout
      let config: FileOperationsMigrationConfig = {
        ...MIGRATION_PRESETS.DEVELOPMENT,
        rollback: {
          autoRollback: true,
          errorThreshold: 0.1, // 10% error threshold
          performanceThreshold: 2.0, // 2x performance degradation
          minSampleSize: 20,
        },
      };
      migrationManager.updateConfig(config);

      // Simulate normal operations initially
      for (let i = 0; i < 25; i++) {
        migrationMetrics.recordOperation('ReadFileTool', true, 100 + Math.random() * 50);
      }

      // Verify migration is working
      let decision = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: 'test-user' });
      expect(decision.useFileOperations).toBe(true);

      // Simulate a problem - high error rate
      for (let i = 0; i < 10; i++) {
        migrationMetrics.recordOperation('ReadFileTool', false, 200); // High error rate
      }

      // This should trigger auto-rollback
      decision = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: 'test-user' });
      expect(decision.useFileOperations).toBe(false);
      expect(decision.reason).toContain('Automatic rollback triggered');

      // Record rollback metrics
      const rollbackAction = rollbackManager.triggerAutoRollback(
        'ReadFileTool',
        RollbackTrigger.AUTO_ERROR_RATE,
        'High error rate detected',
        { errorRate: 0.15 }
      );
      expect(rollbackAction?.isActive).toBe(true);

      // Simulate recovery - fix the issue and record good operations
      for (let i = 0; i < 30; i++) {
        migrationMetrics.recordOperation('ReadFileTool', true, 80 + Math.random() * 20);
      }

      // Manual recovery - enable the tool again
      migrationManager.enableTool('ReadFileTool');
      
      decision = migrationManager.shouldUseFileOperations('ReadFileTool', { userId: 'test-user' });
      expect(decision.useFileOperations).toBe(true);
    });

    it('should handle mixed workload with different operation types', async () => {
      migrationManager.updateConfig({
        ...MIGRATION_PRESETS.DEVELOPMENT,
        monitoring: { enabled: true, sampleRate: 1.0, includeDetailedTimings: true },
      });

      const operations = [
        { tool: 'ReadFileTool', weight: 0.4 }, // 40% read operations
        { tool: 'WriteFileTool', weight: 0.2 }, // 20% write operations
        { tool: 'EditTool', weight: 0.25 }, // 25% edit operations
        { tool: 'GlobTool', weight: 0.1 }, // 10% glob operations
        { tool: 'GrepTool', weight: 0.05 }, // 5% grep operations
      ];

      // Simulate realistic workload
      const totalOperations = 1000;
      const workloadResults = [];

      for (let i = 0; i < totalOperations; i++) {
        // Select operation type based on weights
        const random = Math.random();
        let cumulative = 0;
        let selectedOp = operations[0];
        
        for (const op of operations) {
          cumulative += op.weight;
          if (random <= cumulative) {
            selectedOp = op;
            break;
          }
        }

        const userId = `user-${Math.floor(i / 10)}`; // 10 operations per user
        const decision = migrationManager.shouldUseFileOperations(selectedOp.tool, { userId });
        
        // Simulate different performance characteristics per tool
        let baseTime = 100;
        if (selectedOp.tool === 'ReadFileTool') baseTime = 50;
        if (selectedOp.tool === 'WriteFileTool') baseTime = 120;
        if (selectedOp.tool === 'EditTool') baseTime = 200;
        if (selectedOp.tool === 'GlobTool') baseTime = 300;
        if (selectedOp.tool === 'GrepTool') baseTime = 150;

        const executionTime = baseTime + Math.random() * 50;
        const success = Math.random() > 0.01; // 1% error rate

        migrationMetrics.recordOperation(selectedOp.tool, success, executionTime);
        
        workloadResults.push({
          tool: selectedOp.tool,
          useFileOperations: decision.useFileOperations,
          executionTime,
          success,
        });

        // Simulate performance comparisons for FileOperations
        if (decision.useFileOperations && Math.random() < 0.2) {
          const legacyTime = executionTime * (1.1 + Math.random() * 0.4); // 10-50% improvement
          usageMetrics.recordABComparison(selectedOp.tool, legacyTime, executionTime);
        }
      }

      // Analyze results
      const aggregatedMetrics = usageMetrics.generateAggregatedMetrics(1);
      expect(aggregatedMetrics.summary.totalFileOperationsCalls).toBeGreaterThan(0);
      expect(aggregatedMetrics.summary.avgPerformanceImprovement).toBeGreaterThan(0);

      // Verify tool distribution matches expected weights
      const toolCounts = workloadResults.reduce((acc, result) => {
        acc[result.tool] = (acc[result.tool] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(toolCounts.ReadFileTool).toBeGreaterThan(350); // ~40% of 1000
      expect(toolCounts.ReadFileTool).toBeLessThan(450);
      expect(toolCounts.WriteFileTool).toBeGreaterThan(150); // ~20% of 1000
      expect(toolCounts.WriteFileTool).toBeLessThan(250);
    });
  });

  describe('Tool Registry Integration', () => {
    it('should properly integrate with tool registry and proxy behavior', async () => {
      // Create a registry with migration enabled
      const registry = await createToolRegistry(mockConfig);
      expect(registry).toBeTruthy();

      // Test that tools are registered
      const readTool = registry.getTool('read_file');
      const writeTool = registry.getTool('write_file');
      const editTool = registry.getTool('replace');
      
      expect(readTool).toBeTruthy();
      expect(writeTool).toBeTruthy();
      expect(editTool).toBeTruthy();

      // Test that FileOperations tool is also registered
      const fileOpsTool = registry.getTool('file_operations');
      expect(fileOpsTool).toBeTruthy();
      expect(fileOpsTool).toBeInstanceOf(FileOperationsTool);

      // Test tool execution with migration enabled
      if (readTool) {
        const result = await readTool.execute({
          file_path: path.join(tmpDir, 'test.txt'),
        });
        expect(result.success).toBe(true);
        expect(result.toolResult?.data?.content).toContain('Hello, World!');
      }
    });

    it('should handle legacy tool compatibility', async () => {
      // Test that legacy compatibility layer works
      const readAdapter = legacyCompatibility.getTool('read_file');
      const writeAdapter = legacyCompatibility.getTool('write_file');
      const editAdapter = legacyCompatibility.getTool('replace');

      expect(readAdapter).toBeTruthy();
      expect(writeAdapter).toBeTruthy();
      expect(editAdapter).toBeTruthy();

      // Test adapter execution
      if (readAdapter) {
        const result = await readAdapter.execute({
          file_path: path.join(tmpDir, 'test.txt'),
        });
        expect(result.success).toBe(true);
      }

      // Test write adapter
      if (writeAdapter) {
        const newFile = path.join(tmpDir, 'new-file.txt');
        const result = await writeAdapter.execute({
          file_path: newFile,
          content: 'New content',
        });
        expect(result.success).toBe(true);
        
        // Verify file was created
        const content = await fs.readFile(newFile, 'utf-8');
        expect(content).toBe('New content');
      }
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-volume operations efficiently', async () => {
      const startTime = Date.now();
      const operationCount = 5000;
      const results = [];

      // Simulate high-volume operations
      for (let i = 0; i < operationCount; i++) {
        const tools = ['ReadFileTool', 'WriteFileTool', 'EditTool'];
        const tool = tools[i % tools.length];
        const userId = `user-${Math.floor(i / 100)}`;

        const decision = migrationManager.shouldUseFileOperations(tool, { userId });
        const executionTime = 50 + Math.random() * 100;
        const success = Math.random() > 0.02;

        migrationMetrics.recordOperation(tool, success, executionTime);
        results.push({ decision, executionTime, success });

        if (i % 100 === 0) {
          // Periodic performance comparison
          usageMetrics.recordABComparison(tool, executionTime * 1.3, executionTime);
        }
      }

      const duration = Date.now() - startTime;
      
      // Should handle 5000 operations in reasonable time
      expect(duration).toBeLessThan(3000); // 3 seconds max
      expect(results).toHaveLength(operationCount);

      // Verify metrics were recorded properly
      const stats = migrationMetrics.getAllStats();
      const totalOps = Object.values(stats).reduce((sum, stat) => sum + stat.totalOperations, 0);
      expect(totalOps).toBe(operationCount);
    });

    it('should handle concurrent migration decisions', async () => {
      const concurrentUsers = 100;
      const operationsPerUser = 50;

      // Simulate concurrent users making decisions
      const promises = Array.from({ length: concurrentUsers }, async (_, userIndex) => {
        const userId = `concurrent-user-${userIndex}`;
        const userResults = [];

        for (let i = 0; i < operationsPerUser; i++) {
          const tool = ['ReadFileTool', 'WriteFileTool', 'EditTool'][i % 3];
          const decision = migrationManager.shouldUseFileOperations(tool, { userId });
          userResults.push(decision);

          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
        }

        return userResults;
      });

      const startTime = Date.now();
      const allResults = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // Should handle concurrent access efficiently
      expect(duration).toBeLessThan(2000); // 2 seconds max
      expect(allResults).toHaveLength(concurrentUsers);
      expect(allResults.flat()).toHaveLength(concurrentUsers * operationsPerUser);

      // Verify consistent decisions for same user
      const firstUserResults = allResults[0];
      const consistentDecisions = firstUserResults.every(
        (decision, index) => {
          const sameToolDecisions = firstUserResults.filter((d, i) => 
            i % 3 === index % 3 // Same tool type
          );
          return sameToolDecisions.every(d => d.useFileOperations === decision.useFileOperations);
        }
      );
      expect(consistentDecisions).toBe(true);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from temporary service disruptions', async () => {
      // Start with normal operations
      migrationManager.updateConfig(MIGRATION_PRESETS.DEVELOPMENT);

      // Simulate normal operations
      for (let i = 0; i < 20; i++) {
        migrationMetrics.recordOperation('ReadFileTool', true, 100);
      }

      let decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(true);

      // Simulate service disruption - high error rate
      for (let i = 0; i < 15; i++) {
        migrationMetrics.recordOperation('ReadFileTool', false, 500); // High latency, failures
      }

      // Should trigger automatic rollback
      decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(false);

      // Simulate service recovery
      for (let i = 0; i < 50; i++) {
        migrationMetrics.recordOperation('ReadFileTool', true, 80); // Good performance
      }

      // Manual recovery
      migrationManager.enableTool('ReadFileTool');
      decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(true);
    });

    it('should handle configuration corruption gracefully', async () => {
      // Start with valid configuration
      migrationManager.updateConfig(MIGRATION_PRESETS.DEVELOPMENT);

      // Simulate configuration corruption
      const corruptConfig = {
        ...MIGRATION_PRESETS.DEVELOPMENT,
        rolloutPercentage: -1, // Invalid value
        tools: null as any, // Corrupted tools config
      };

      // Should not crash on invalid config
      expect(() => {
        migrationManager.updateConfig(corruptConfig);
      }).not.toThrow();

      // Should still make reasonable decisions
      const decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision).toBeTruthy();
      expect(typeof decision.useFileOperations).toBe('boolean');
    });
  });
});

describe('Migration Integration with Real FileOperations', () => {
  let tmpDir: string;
  let mockConfig: Config;
  let fileOpsTool: FileOperationsTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'fileops-migration-test-'));
    
    mockConfig = {
      getFileOperationsMigration: vi.fn().mockReturnValue(MIGRATION_PRESETS.DEVELOPMENT),
      getTargetDir: vi.fn().mockReturnValue(tmpDir),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
      getFileFilteringAllowBuildArtifacts: vi.fn().mockReturnValue(false),
      getGeminiIgnorePatterns: vi.fn().mockReturnValue([]),
    } as any;

    fileOpsTool = new FileOperationsTool(mockConfig, tmpDir);

    // Create test files
    await fs.writeFile(path.join(tmpDir, 'source.ts'), `
export interface User {
  id: number;
  name: string;
  email: string;
}

export class UserService {
  getUser(id: number): User | null {
    return null;
  }
}
`);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should perform complex migration operations using FileOperations', async () => {
    // Test a complex migration scenario using FileOperations
    const result = await fileOpsTool.execute({
      operations: [
        // Analyze the source file
        {
          type: 'analyze',
          path: path.join(tmpDir, 'source.ts'),
          options: {
            includeContent: true,
            astAnalysis: true,
            extractSymbols: true,
          },
        },
        // Create a new API version
        {
          type: 'create',
          path: path.join(tmpDir, 'user-v2.ts'),
          content: `
export interface UserV2 {
  id: string; // Changed to string
  name: string;
  email: string;
  createdAt: Date;
}

export class UserServiceV2 {
  async getUser(id: string): Promise<UserV2 | null> {
    return null;
  }
}
`,
        },
        // Update the original file to add deprecation notice
        {
          type: 'edit',
          path: path.join(tmpDir, 'source.ts'),
          edits: [
            {
              type: 'replace',
              search: 'export interface User {',
              replace: '/** @deprecated Use UserV2 instead */\nexport interface User {',
            },
            {
              type: 'replace',
              search: 'export class UserService {',
              replace: '/** @deprecated Use UserServiceV2 instead */\nexport class UserService {',
            },
          ],
        },
        // Create migration guide
        {
          type: 'create',
          path: path.join(tmpDir, 'MIGRATION.md'),
          content: `# User API Migration Guide

## Changes in V2

- User ID changed from number to string
- Added createdAt timestamp
- Service methods are now async

## Migration Steps

1. Update import statements
2. Change ID handling
3. Add async/await for service calls
`,
        },
        // Validate the changes
        {
          type: 'validate',
          path: path.join(tmpDir, '**/*.ts'),
          rules: ['syntax'],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.toolResult?.data?.summary?.totalOperations).toBe(5);
    expect(result.toolResult?.data?.summary?.successfulOperations).toBe(5);

    // Verify files were created/modified correctly
    const updatedSource = await fs.readFile(path.join(tmpDir, 'source.ts'), 'utf-8');
    expect(updatedSource).toContain('@deprecated Use UserV2 instead');
    expect(updatedSource).toContain('@deprecated Use UserServiceV2 instead');

    const newApi = await fs.readFile(path.join(tmpDir, 'user-v2.ts'), 'utf-8');
    expect(newApi).toContain('UserV2');
    expect(newApi).toContain('id: string');

    const migrationGuide = await fs.readFile(path.join(tmpDir, 'MIGRATION.md'), 'utf-8');
    expect(migrationGuide).toContain('User API Migration Guide');
  });

  it('should handle rollback of complex operations', async () => {
    // Perform operations that should be rolled back
    const result = await fileOpsTool.execute({
      operations: [
        {
          type: 'create',
          path: path.join(tmpDir, 'temp1.txt'),
          content: 'Temporary file 1',
        },
        {
          type: 'create',
          path: path.join(tmpDir, 'temp2.txt'),
          content: 'Temporary file 2',
        },
        {
          type: 'edit',
          path: path.join(tmpDir, 'source.ts'),
          edits: [
            {
              type: 'replace',
              search: 'export interface User',
              replace: 'export interface ModifiedUser',
            },
          ],
        },
        {
          type: 'create',
          path: path.join(tmpDir, 'invalid-path/file.txt'), // This should fail
          content: 'This will fail',
        },
      ],
      options: {
        rollbackOnError: true,
      },
    });

    // Operation should fail and rollback
    expect(result.success).toBe(false);

    // Verify rollback occurred - files should not exist
    expect(await fs.access(path.join(tmpDir, 'temp1.txt')).catch(() => false)).toBe(false);
    expect(await fs.access(path.join(tmpDir, 'temp2.txt')).catch(() => false)).toBe(false);

    // Original file should be unchanged
    const originalContent = await fs.readFile(path.join(tmpDir, 'source.ts'), 'utf-8');
    expect(originalContent).toContain('export interface User');
    expect(originalContent).not.toContain('ModifiedUser');
  });
});