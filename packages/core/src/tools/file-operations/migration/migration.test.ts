/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('FileOperations Migration System', () => {
  let mockConfig: Partial<Config>;
  let migrationConfig: FileOperationsMigrationConfig;
  let migrationManager: MigrationManager;
  let migrationMetrics: MigrationMetrics;
  let usageMetrics: UsageMetricsCollector;
  let rollbackManager: RollbackManager;

  beforeEach(() => {
    // Setup mock config
    mockConfig = {
      getFileOperationsMigration: vi.fn().mockReturnValue(DEFAULT_MIGRATION_CONFIG),
      getTargetDir: vi.fn().mockReturnValue('/test'),
      getCoreTools: vi.fn().mockReturnValue(undefined),
    } as any;

    migrationConfig = { ...DEFAULT_MIGRATION_CONFIG };
    migrationMetrics = new MigrationMetrics();
    migrationManager = new MigrationManager(migrationConfig, migrationMetrics);
    usageMetrics = new UsageMetricsCollector(migrationMetrics);
    rollbackManager = new RollbackManager(migrationConfig, migrationMetrics, usageMetrics);
  });

  afterEach(() => {
    vi.clearAllMocks();
    migrationMetrics.reset();
  });

  describe('Migration Configuration', () => {
    it('should use default configuration when none provided', () => {
      const manager = new MigrationManager();
      const decision = manager.shouldUseFileOperations('ReadFileTool');
      
      expect(decision.useFileOperations).toBe(false);
      expect(decision.phase).toBe(MigrationPhase.DISABLED);
    });

    it('should support preset configurations', () => {
      expect(MIGRATION_PRESETS.DEVELOPMENT.phase).toBe(MigrationPhase.ADAPTERS);
      expect(MIGRATION_PRESETS.DEVELOPMENT.rolloutPercentage).toBe(100);
      expect(MIGRATION_PRESETS.PRODUCTION_CANARY.rolloutPercentage).toBe(5);
      expect(MIGRATION_PRESETS.PRODUCTION_FULL.phase).toBe(MigrationPhase.FULL);
    });

    it('should validate migration phase transitions', () => {
      // Start with disabled
      migrationConfig.phase = MigrationPhase.DISABLED;
      migrationManager.updateConfig(migrationConfig);
      
      let decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(false);
      
      // Move to adapters
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 100;
      migrationManager.updateConfig(migrationConfig);
      
      decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(true);
      expect(decision.phase).toBe(MigrationPhase.ADAPTERS);
    });
  });

  describe('Rollout Strategy', () => {
    it('should respect percentage-based rollout', () => {
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 50;
      migrationManager.updateConfig(migrationConfig);

      const results = [];
      for (let i = 0; i < 100; i++) {
        const decision = migrationManager.shouldUseFileOperations('ReadFileTool', {
          userId: `user-${i}`,
        });
        results.push(decision.useFileOperations);
      }

      const adoptionRate = results.filter(r => r).length / results.length;
      expect(adoptionRate).toBeGreaterThan(0.3); // Allow some variance
      expect(adoptionRate).toBeLessThan(0.7);
    });

    it('should handle user inclusion/exclusion lists', () => {
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 0; // Nobody should be included by default
      migrationConfig.tools.readFile = {
        enabled: true,
        includeUsers: ['user-1'],
        excludeUsers: ['user-2'],
      };
      migrationManager.updateConfig(migrationConfig);

      // Included user should get FileOperations
      let decision = migrationManager.shouldUseFileOperations('ReadFileTool', {
        userId: 'user-1',
      });
      expect(decision.useFileOperations).toBe(true);
      expect(decision.reason).toContain('explicitly included');

      // Excluded user should not get FileOperations even with 100% rollout
      migrationConfig.rolloutPercentage = 100;
      migrationManager.updateConfig(migrationConfig);
      
      decision = migrationManager.shouldUseFileOperations('ReadFileTool', {
        userId: 'user-2',
      });
      expect(decision.useFileOperations).toBe(false);
      expect(decision.reason).toContain('excluded');
    });

    it('should support per-tool configuration', () => {
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 100;
      migrationConfig.tools.readFile = { enabled: true };
      migrationConfig.tools.writeFile = { enabled: false };
      migrationManager.updateConfig(migrationConfig);

      const readDecision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(readDecision.useFileOperations).toBe(true);

      const writeDecision = migrationManager.shouldUseFileOperations('WriteFileTool');
      expect(writeDecision.useFileOperations).toBe(false);
      expect(writeDecision.reason).toContain('migration disabled');
    });
  });

  describe('Metrics Collection', () => {
    it('should record migration decisions', () => {
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 100;
      migrationManager.updateConfig(migrationConfig);

      migrationManager.shouldUseFileOperations('ReadFileTool', { userId: 'test-user' });
      migrationManager.shouldUseFileOperations('WriteFileTool', { userId: 'test-user' });

      const decisions = migrationMetrics.getDecisionRecords();
      expect(decisions).toHaveLength(2);
      expect(decisions[0].toolName).toBe('ReadFileTool');
      expect(decisions[1].toolName).toBe('WriteFileTool');
    });

    it('should track tool operation performance', () => {
      migrationMetrics.recordOperation('ReadFileTool', true, 100, 1024);
      migrationMetrics.recordOperation('ReadFileTool', false, 200, 0);
      
      const stats = migrationMetrics.getToolStats('ReadFileTool');
      expect(stats).toBeTruthy();
      expect(stats?.totalOperations).toBe(2);
      expect(stats?.successCount).toBe(1);
      expect(stats?.errorCount).toBe(1);
      expect(stats?.successRate).toBe(0.5);
      expect(stats?.avgExecutionTime).toBe(150);
      expect(stats?.totalBytesProcessed).toBe(1024);
    });

    it('should record performance comparisons', () => {
      migrationMetrics.recordPerformanceComparison('ReadFileTool', 200, 100, 1024);
      migrationMetrics.recordPerformanceComparison('ReadFileTool', 150, 120, 512);

      const comparisons = migrationMetrics.getPerformanceComparisons('ReadFileTool');
      expect(comparisons).toHaveLength(2);
      expect(comparisons[0].performanceRatio).toBe(0.5); // 2x improvement
      expect(comparisons[1].performanceRatio).toBe(0.8); // 1.25x improvement
    });

    it('should generate adoption metrics', () => {
      // Record some decisions
      migrationMetrics.recordDecision('ReadFileTool', 
        { useFileOperations: true, phase: MigrationPhase.ADAPTERS, reason: 'test' }, 
        { userId: 'user1' }
      );
      migrationMetrics.recordDecision('ReadFileTool',
        { useFileOperations: false, phase: MigrationPhase.ADAPTERS, reason: 'test' },
        { userId: 'user2' }
      );

      const adoption = migrationMetrics.getAdoptionMetrics();
      expect(adoption.totalDecisions).toBe(2);
      expect(adoption.fileOperationsUsage).toBe(1);
      expect(adoption.legacyUsage).toBe(1);
      expect(adoption.adoptionRate).toBe(0.5);
      expect(adoption.byTool.ReadFileTool.rate).toBe(0.5);
    });
  });

  describe('Usage Metrics Comparison', () => {
    it('should track legacy tool usage', () => {
      usageMetrics.recordLegacyUsage('ReadFileTool', 100, true, 1024);
      usageMetrics.recordLegacyUsage('ReadFileTool', 150, false, 0);

      const comparison = usageMetrics.generateToolComparison('ReadFileTool', 1);
      expect(comparison).toBeTruthy();
      expect(comparison?.legacy.totalCalls).toBe(2);
      expect(comparison?.legacy.successfulCalls).toBe(1);
      expect(comparison?.legacy.avgExecutionTime).toBe(125);
    });

    it('should perform A/B comparisons', () => {
      usageMetrics.recordABComparison('ReadFileTool', 200, 100, 1024);
      usageMetrics.recordABComparison('ReadFileTool', 150, 120, 512);

      const comparisons = migrationMetrics.getPerformanceComparisons('ReadFileTool');
      expect(comparisons).toHaveLength(2);
      
      const performance = migrationMetrics.getPerformanceSummary();
      expect(performance.totalComparisons).toBe(2);
      expect(performance.improvements).toBe(2); // Both comparisons show improvement
    });

    it('should generate progress reports', () => {
      // Simulate some adoption
      for (let i = 0; i < 10; i++) {
        migrationMetrics.recordDecision('ReadFileTool',
          { useFileOperations: i < 3, phase: MigrationPhase.ADAPTERS, reason: 'test' },
          { userId: `user${i}` }
        );
      }

      const report = usageMetrics.generateProgressReport();
      expect(report.status).toBe('early'); // 30% adoption = early stage
      expect(report.recommendations).toContain('Consider increasing rollout percentage');
    });
  });

  describe('Automatic Rollback', () => {
    beforeEach(() => {
      migrationConfig.rollback.autoRollback = true;
      migrationConfig.rollback.errorThreshold = 0.1; // 10%
      migrationConfig.rollback.performanceThreshold = 2.0; // 2x degradation
      migrationConfig.rollback.minSampleSize = 5;
      migrationManager.updateConfig(migrationConfig);
    });

    it('should trigger rollback on high error rate', () => {
      // Record operations with high error rate
      for (let i = 0; i < 10; i++) {
        migrationMetrics.recordOperation('ReadFileTool', i < 7, 100); // 70% success = 30% error
      }

      const decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(false);
      expect(decision.reason).toContain('Automatic rollback triggered');
    });

    it('should trigger rollback on performance degradation', () => {
      // Record operations with good success rate but poor performance
      for (let i = 0; i < 10; i++) {
        migrationMetrics.recordOperation('ReadFileTool', true, 100);
        migrationMetrics.recordPerformanceComparison('ReadFileTool', 100, 250); // 2.5x degradation
      }

      const decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(false);
      expect(decision.reason).toContain('Automatic rollback triggered');
    });

    it('should not trigger rollback with insufficient sample size', () => {
      // Record just a few operations with high error rate
      for (let i = 0; i < 3; i++) {
        migrationMetrics.recordOperation('ReadFileTool', false, 100); // 100% error but small sample
      }

      const decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(true); // Should not rollback due to small sample
    });
  });

  describe('Manual Rollback', () => {
    it('should support manual global rollback', () => {
      migrationConfig.phase = MigrationPhase.FULL;
      migrationConfig.rolloutPercentage = 100;
      migrationManager.updateConfig(migrationConfig);

      // Verify FileOperations is enabled
      let decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(true);

      // Trigger manual rollback
      const rollbackState = rollbackManager.triggerManualRollback('global', undefined, 'Test rollback');
      expect(rollbackState.isActive).toBe(true);
      expect(rollbackState.scope).toBe('global');

      // Verify rollback is applied (would need to reinitialize manager with updated config)
      const rollbackStatus = rollbackManager.getRollbackStatus();
      expect(rollbackStatus.activeRollbacks).toHaveLength(1);
    });

    it('should support tool-specific rollback', () => {
      const rollbackState = rollbackManager.triggerManualRollback(
        'tool', 
        'ReadFileTool', 
        'ReadFile tool issues'
      );
      
      expect(rollbackState.isActive).toBe(true);
      expect(rollbackState.scope).toBe('tool');
      expect(rollbackState.targets).toContain('ReadFileTool');
    });

    it('should support rollback reversion', () => {
      const rollbackState = rollbackManager.triggerManualRollback('global', undefined, 'Test');
      const rollbackStatus = rollbackManager.getRollbackStatus();
      const rollbackId = Object.keys(Object.fromEntries(
        rollbackStatus.activeRollbacks.map((r, i) => [`rollback_global_global_${r.startTime.getTime()}`, r])
      ))[0];

      const reverted = rollbackManager.revertRollback(rollbackId);
      expect(reverted).toBe(true);
      
      const updatedStatus = rollbackManager.getRollbackStatus();
      expect(updatedStatus.activeRollbacks).toHaveLength(0);
    });
  });

  describe('Circuit Breaker', () => {
    it('should trip circuit breaker on repeated failures', () => {
      // Simulate repeated failures
      for (let i = 0; i < 6; i++) {
        migrationMetrics.recordOperation('ReadFileTool', false, 100);
      }

      // Check rollback conditions (would trigger circuit breaker)
      rollbackManager.checkRollbackConditions();
      
      const status = rollbackManager.getRollbackStatus();
      const circuitState = status.circuitBreakerStates.ReadFileTool;
      expect(circuitState?.failureCount).toBeGreaterThan(0);
    });
  });

  describe('Tool Registry Integration', () => {
    it('should create migration-aware tool registry when enabled', async () => {
      const migrationEnabledConfig = {
        ...mockConfig,
        getFileOperationsMigration: vi.fn().mockReturnValue({
          ...MIGRATION_PRESETS.DEVELOPMENT,
        }),
      } as any;

      const registry = await createToolRegistry(migrationEnabledConfig);
      expect(registry).toBeTruthy();
      
      // Would need to test tool registration and proxy behavior
      // This requires more integration with the actual tool classes
    });

    it('should use standard registry when migration disabled', async () => {
      const registry = await createToolRegistry(mockConfig as Config);
      expect(registry).toBeTruthy();
    });
  });

  describe('End-to-End Migration Scenarios', () => {
    it('should handle complete migration lifecycle', () => {
      // Phase 1: Start with migration disabled
      migrationConfig.phase = MigrationPhase.DISABLED;
      migrationManager.updateConfig(migrationConfig);
      
      let decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(false);

      // Phase 2: Enable adapters with 10% rollout
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 10;
      migrationManager.updateConfig(migrationConfig);

      // Phase 3: Increase rollout to 50%
      migrationConfig.rolloutPercentage = 50;
      migrationManager.updateConfig(migrationConfig);

      // Phase 4: Full rollout
      migrationConfig.phase = MigrationPhase.FULL;
      migrationConfig.rolloutPercentage = 100;
      migrationManager.updateConfig(migrationConfig);

      decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(true);
      expect(decision.phase).toBe(MigrationPhase.FULL);
    });

    it('should handle rollback during migration', () => {
      // Start with enabled migration
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 100;
      migrationConfig.rollback.autoRollback = true;
      migrationManager.updateConfig(migrationConfig);

      // Simulate high error rate
      for (let i = 0; i < 10; i++) {
        migrationMetrics.recordOperation('ReadFileTool', i < 5, 100); // 50% error rate
      }

      // This should trigger auto-rollback
      const decision = migrationManager.shouldUseFileOperations('ReadFileTool');
      expect(decision.useFileOperations).toBe(false);
      expect(decision.reason).toContain('rollback');
    });

    it('should support gradual tool-by-tool migration', () => {
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 100;
      migrationConfig.tools = {
        readFile: { enabled: true },
        writeFile: { enabled: false },
        editTool: { enabled: true, rolloutPercentage: 50 },
      };
      migrationManager.updateConfig(migrationConfig);

      // ReadFile should be enabled
      expect(migrationManager.shouldUseFileOperations('ReadFileTool').useFileOperations).toBe(true);
      
      // WriteFile should be disabled
      expect(migrationManager.shouldUseFileOperations('WriteFileTool').useFileOperations).toBe(false);
      
      // EditTool should have partial rollout
      const editDecisions = [];
      for (let i = 0; i < 100; i++) {
        const decision = migrationManager.shouldUseFileOperations('EditTool', { userId: `user-${i}` });
        editDecisions.push(decision.useFileOperations);
      }
      const editAdoptionRate = editDecisions.filter(d => d).length / editDecisions.length;
      expect(editAdoptionRate).toBeGreaterThan(0.3);
      expect(editAdoptionRate).toBeLessThan(0.7);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing tool configuration gracefully', () => {
      const decision = migrationManager.shouldUseFileOperations('NonExistentTool');
      expect(decision).toBeTruthy();
      expect(decision.useFileOperations).toBe(false);
    });

    it('should handle invalid user context', () => {
      migrationConfig.phase = MigrationPhase.ADAPTERS;
      migrationConfig.rolloutPercentage = 100;
      migrationManager.updateConfig(migrationConfig);

      const decision = migrationManager.shouldUseFileOperations('ReadFileTool', {});
      expect(decision.useFileOperations).toBe(true);
    });

    it('should handle concurrent rollback attempts', () => {
      const state1 = rollbackManager.triggerManualRollback('tool', 'ReadFileTool', 'First rollback');
      const state2 = rollbackManager.triggerAutoRollback('ReadFileTool', RollbackTrigger.AUTO_ERROR_RATE, 'Second rollback', {});
      
      expect(state1.isActive).toBe(true);
      expect(state2).toBeNull(); // Should not allow concurrent rollbacks
    });
  });
});

describe('Migration Performance Tests', () => {
  let migrationManager: MigrationManager;
  let migrationMetrics: MigrationMetrics;

  beforeEach(() => {
    migrationMetrics = new MigrationMetrics();
    migrationManager = new MigrationManager({
      ...DEFAULT_MIGRATION_CONFIG,
      phase: MigrationPhase.ADAPTERS,
      rolloutPercentage: 50,
    }, migrationMetrics);
  });

  it('should handle high-volume decision making efficiently', () => {
    const startTime = Date.now();
    const decisions = [];

    // Make 10,000 migration decisions
    for (let i = 0; i < 10000; i++) {
      const decision = migrationManager.shouldUseFileOperations('ReadFileTool', {
        userId: `user-${i}`,
      });
      decisions.push(decision);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(decisions).toHaveLength(10000);
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    
    // Verify adoption rate is approximately 50%
    const adopted = decisions.filter(d => d.useFileOperations).length;
    const adoptionRate = adopted / decisions.length;
    expect(adoptionRate).toBeGreaterThan(0.4);
    expect(adoptionRate).toBeLessThan(0.6);
  });

  it('should handle large metrics datasets efficiently', () => {
    const startTime = Date.now();

    // Record 10,000 operations
    for (let i = 0; i < 10000; i++) {
      migrationMetrics.recordOperation('ReadFileTool', Math.random() > 0.1, Math.random() * 1000);
      
      if (i % 10 === 0) {
        migrationMetrics.recordPerformanceComparison('ReadFileTool', 200, 100 + Math.random() * 50);
      }
    }

    const stats = migrationMetrics.getToolStats('ReadFileTool');
    const comparisons = migrationMetrics.getPerformanceComparisons('ReadFileTool');
    
    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(stats?.totalOperations).toBe(10000);
    expect(comparisons).toHaveLength(1000);
    expect(duration).toBeLessThan(2000); // Should complete in under 2 seconds
  });
});