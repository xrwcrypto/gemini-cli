/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Migration rollout phases for FileOperations
 */
export enum MigrationPhase {
  /** FileOperations disabled, use legacy tools only */
  DISABLED = 'disabled',
  /** Use FileOperations adapters as proxy to new system */
  ADAPTERS = 'adapters',
  /** Full FileOperations rollout, legacy tools disabled */
  FULL = 'full',
}

/**
 * Per-tool migration control
 */
export interface ToolMigrationConfig {
  /** Whether this tool should use FileOperations */
  enabled: boolean;
  /** Override global migration phase for this tool */
  phase?: MigrationPhase;
  /** Percentage rollout (0-100) */
  rolloutPercentage?: number;
  /** User IDs or identifiers to include in rollout */
  includeUsers?: string[];
  /** User IDs or identifiers to exclude from rollout */
  excludeUsers?: string[];
}

/**
 * Comprehensive FileOperations migration configuration
 */
export interface FileOperationsMigrationConfig {
  /** Global migration phase */
  phase: MigrationPhase;
  
  /** Percentage of users to include in migration (0-100) */
  rolloutPercentage: number;
  
  /** Per-tool migration configuration */
  tools: {
    readFile?: ToolMigrationConfig;
    writeFile?: ToolMigrationConfig;
    editTool?: ToolMigrationConfig;
    globTool?: ToolMigrationConfig;
    grepTool?: ToolMigrationConfig;
  };
  
  /** Performance monitoring configuration */
  monitoring: {
    /** Enable performance comparison tracking */
    enabled: boolean;
    /** Sample rate for performance metrics (0-1) */
    sampleRate: number;
    /** Include detailed timing breakdowns */
    includeDetailedTimings: boolean;
  };
  
  /** Usage metrics configuration */
  metrics: {
    /** Enable usage tracking */
    enabled: boolean;
    /** Track success/failure rates */
    trackSuccessRates: boolean;
    /** Track operation counts */
    trackOperationCounts: boolean;
    /** Export metrics to external systems */
    exportEnabled: boolean;
  };
  
  /** Rollback configuration */
  rollback: {
    /** Enable automatic rollback on high error rates */
    autoRollback: boolean;
    /** Error rate threshold for automatic rollback (0-1) */
    errorThreshold: number;
    /** Performance degradation threshold for rollback (multiplier) */
    performanceThreshold: number;
    /** Minimum sample size before considering rollback */
    minSampleSize: number;
  };
  
  /** Feature flags for specific functionality */
  features: {
    /** Enable predictive caching */
    predictiveCaching: boolean;
    /** Enable parallel execution */
    parallelExecution: boolean;
    /** Enable transaction management */
    transactionManagement: boolean;
    /** Enable security hardening */
    securityHardening: boolean;
    /** Enable advanced analytics */
    advancedAnalytics: boolean;
  };
  
  /** Debug and development settings */
  debug: {
    /** Enable debug logging for migration */
    enabled: boolean;
    /** Log adapter usage decisions */
    logAdapterDecisions: boolean;
    /** Log performance comparisons */
    logPerformanceComparisons: boolean;
    /** Enable dry-run mode (log decisions but don't execute) */
    dryRun: boolean;
  };
}

/**
 * Default migration configuration
 */
export const DEFAULT_MIGRATION_CONFIG: FileOperationsMigrationConfig = {
  phase: MigrationPhase.DISABLED,
  rolloutPercentage: 0,
  tools: {},
  monitoring: {
    enabled: true,
    sampleRate: 0.1, // 10% sampling
    includeDetailedTimings: false,
  },
  metrics: {
    enabled: true,
    trackSuccessRates: true,
    trackOperationCounts: true,
    exportEnabled: false,
  },
  rollback: {
    autoRollback: false,
    errorThreshold: 0.05, // 5% error rate
    performanceThreshold: 2.0, // 2x performance degradation
    minSampleSize: 100,
  },
  features: {
    predictiveCaching: false,
    parallelExecution: true,
    transactionManagement: true,
    securityHardening: true,
    advancedAnalytics: false,
  },
  debug: {
    enabled: false,
    logAdapterDecisions: false,
    logPerformanceComparisons: false,
    dryRun: false,
  },
};

/**
 * Migration configuration presets for common scenarios
 */
export const MIGRATION_PRESETS = {
  /** Safe development preset */
  DEVELOPMENT: {
    ...DEFAULT_MIGRATION_CONFIG,
    phase: MigrationPhase.ADAPTERS,
    rolloutPercentage: 100,
    debug: {
      enabled: true,
      logAdapterDecisions: true,
      logPerformanceComparisons: true,
      dryRun: false,
    },
  } as FileOperationsMigrationConfig,
  
  /** Conservative production rollout */
  PRODUCTION_CANARY: {
    ...DEFAULT_MIGRATION_CONFIG,
    phase: MigrationPhase.ADAPTERS,
    rolloutPercentage: 5,
    monitoring: {
      enabled: true,
      sampleRate: 1.0, // 100% sampling during canary
      includeDetailedTimings: true,
    },
    rollback: {
      autoRollback: true,
      errorThreshold: 0.02, // 2% error rate
      performanceThreshold: 1.5, // 1.5x performance degradation
      minSampleSize: 50,
    },
  } as FileOperationsMigrationConfig,
  
  /** Full production rollout */
  PRODUCTION_FULL: {
    ...DEFAULT_MIGRATION_CONFIG,
    phase: MigrationPhase.FULL,
    rolloutPercentage: 100,
    features: {
      predictiveCaching: true,
      parallelExecution: true,
      transactionManagement: true,
      securityHardening: true,
      advancedAnalytics: true,
    },
  } as FileOperationsMigrationConfig,
};

/**
 * Migration decision result
 */
export interface MigrationDecision {
  /** Whether to use FileOperations for this request */
  useFileOperations: boolean;
  /** The migration phase being used */
  phase: MigrationPhase;
  /** Reason for the decision */
  reason: string;
  /** Tool-specific configuration applied */
  toolConfig?: ToolMigrationConfig;
}

/**
 * User context for migration decisions
 */
export interface MigrationUserContext {
  /** User identifier for rollout decisions */
  userId?: string;
  /** Session identifier */
  sessionId?: string;
  /** Additional context properties */
  properties?: Record<string, any>;
}