/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Configuration and types
export {
  MigrationPhase,
  FileOperationsMigrationConfig,
  ToolMigrationConfig,
  MigrationDecision,
  MigrationUserContext,
  DEFAULT_MIGRATION_CONFIG,
  MIGRATION_PRESETS,
} from './migration-config.js';

// Core migration management
export { MigrationManager } from './migration-manager.js';

// Metrics and monitoring
export {
  MigrationMetrics,
  ToolStats,
  PerformanceComparison,
  DecisionRecord,
  RollbackRecord,
} from './migration-metrics.js';

// Usage comparison and analysis
export {
  UsageMetricsCollector,
  UsageComparison,
  AggregatedUsageMetrics,
} from './usage-metrics.js';

// Rollback and safety mechanisms
export {
  RollbackManager,
  RollbackTrigger,
  RollbackAction,
  RollbackState,
} from './rollback-manager.js';

// Enhanced tool registry
export {
  MigrationAwareToolRegistry,
  createMigrationAwareToolRegistry,
  updateCreateToolRegistry,
} from './migration-tool-registry.js';