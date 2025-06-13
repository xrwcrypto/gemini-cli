# FileOperations Migration System

This comprehensive migration system enables safe, gradual adoption of the FileOperations tool while maintaining backward compatibility and providing rollback mechanisms.

## Architecture

The migration system consists of several key components:

- **MigrationManager**: Core decision-making logic for tool selection
- **MigrationMetrics**: Performance and usage tracking
- **UsageMetricsCollector**: Comparative analysis between legacy and FileOperations
- **RollbackManager**: Automatic and manual rollback capabilities
- **MigrationAwareToolRegistry**: Enhanced tool registry with migration support

## Configuration

### Basic Configuration

Add to your Gemini CLI config:

```typescript
import { MIGRATION_PRESETS } from './migration/migration-config.js';

const config = new Config({
  // ... other config
  fileOperationsMigration: MIGRATION_PRESETS.DEVELOPMENT, // or custom config
});
```

### Custom Configuration

```typescript
const customMigrationConfig = {
  phase: MigrationPhase.ADAPTERS,
  rolloutPercentage: 25,
  tools: {
    readFile: { 
      enabled: true, 
      rolloutPercentage: 50 
    },
    writeFile: { 
      enabled: false 
    },
  },
  monitoring: {
    enabled: true,
    sampleRate: 1.0,
  },
  rollback: {
    autoRollback: true,
    errorThreshold: 0.05,
    performanceThreshold: 2.0,
  },
  debug: {
    enabled: true,
    logAdapterDecisions: true,
  },
};
```

## Usage

### Phases of Migration

1. **DISABLED**: Migration is off, use legacy tools only
2. **ADAPTERS**: Use FileOperations adapters as proxy to new system
3. **FULL**: Full FileOperations rollout, legacy tools disabled

### Rollout Strategy

#### Phase 1: Development and Testing (ADAPTERS + 100%)

```typescript
fileOperationsMigration: {
  phase: MigrationPhase.ADAPTERS,
  rolloutPercentage: 100,
  debug: { enabled: true, logAdapterDecisions: true },
}
```

#### Phase 2: Canary Rollout (ADAPTERS + 5%)

```typescript
fileOperationsMigration: {
  phase: MigrationPhase.ADAPTERS,
  rolloutPercentage: 5,
  monitoring: { enabled: true, sampleRate: 1.0 },
  rollback: { autoRollback: true, errorThreshold: 0.02 },
}
```

#### Phase 3: Gradual Increase (ADAPTERS + 25%, 50%, 75%)

```typescript
fileOperationsMigration: {
  phase: MigrationPhase.ADAPTERS,
  rolloutPercentage: 50, // Increase gradually
  tools: {
    readFile: { rolloutPercentage: 75 }, // Per-tool override
    writeFile: { rolloutPercentage: 25 }, // Slower rollout for writes
  },
}
```

#### Phase 4: Full Rollout (FULL + 100%)

```typescript
fileOperationsMigration: {
  phase: MigrationPhase.FULL,
  rolloutPercentage: 100,
  features: {
    predictiveCaching: true,
    parallelExecution: true,
    advancedAnalytics: true,
  },
}
```

## Monitoring and Metrics

### Real-time Monitoring

```typescript
import { MigrationManager, MigrationMetrics } from './migration/index.js';

const metrics = new MigrationMetrics();
const manager = new MigrationManager(config, metrics);

// Check migration stats
console.log(manager.getMigrationStats());

// Get adoption metrics
console.log(metrics.getAdoptionMetrics());

// Get performance comparison
console.log(metrics.getPerformanceSummary());
```

### Usage Comparison

```typescript
import { UsageMetricsCollector } from './migration/index.js';

const usageMetrics = new UsageMetricsCollector(migrationMetrics);

// Record legacy tool usage
usageMetrics.recordLegacyUsage('ReadFileTool', 150, true, 1024);

// Record A/B comparison
usageMetrics.recordABComparison('ReadFileTool', 150, 75, 1024);

// Generate progress report
const report = usageMetrics.generateProgressReport();
console.log(`Migration status: ${report.status}`);
console.log(`Recommendations: ${report.recommendations.join(', ')}`);
```

## Rollback Mechanisms

### Automatic Rollback

Automatically triggered when:
- Error rate exceeds threshold (default: 5%)
- Performance degrades beyond threshold (default: 2x slower)
- Circuit breaker trips (5 consecutive failures)

```typescript
import { RollbackManager } from './migration/index.js';

const rollbackManager = new RollbackManager(config, metrics, usageMetrics);

// Rollback is automatic based on thresholds
rollbackManager.checkRollbackConditions();
```

### Manual Rollback

```typescript
// Global rollback (disable all FileOperations)
const rollbackState = rollbackManager.triggerManualRollback(
  'global', 
  undefined, 
  'Critical issue detected'
);

// Tool-specific rollback
rollbackManager.triggerManualRollback(
  'tool', 
  'ReadFileTool', 
  'ReadFile performance issues'
);

// User-specific rollback
rollbackManager.triggerManualRollback(
  'user', 
  'user-123', 
  'User experiencing issues'
);
```

### Emergency Rollback

For critical situations:

```typescript
// Get emergency rollback plan
const plan = rollbackManager.createEmergencyRollbackPlan();

// Execute immediate actions
plan.immediate.forEach(action => {
  console.log(`Execute: ${action.command}`);
  // Apply configuration changes
});
```

## Configuration Options

### Migration Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `phase` | Migration phase (disabled/adapters/full) | `disabled` |
| `rolloutPercentage` | Global rollout percentage (0-100) | `0` |
| `tools.{tool}.enabled` | Enable migration for specific tool | `true` |
| `tools.{tool}.rolloutPercentage` | Tool-specific rollout override | - |
| `tools.{tool}.includeUsers` | Users to include in migration | `[]` |
| `tools.{tool}.excludeUsers` | Users to exclude from migration | `[]` |

### Monitoring Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `monitoring.enabled` | Enable performance monitoring | `true` |
| `monitoring.sampleRate` | Sample rate for metrics (0-1) | `0.1` |
| `monitoring.includeDetailedTimings` | Include detailed timing data | `false` |

### Rollback Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `rollback.autoRollback` | Enable automatic rollback | `false` |
| `rollback.errorThreshold` | Error rate threshold (0-1) | `0.05` |
| `rollback.performanceThreshold` | Performance degradation threshold | `2.0` |
| `rollback.minSampleSize` | Minimum samples before rollback | `100` |

### Debug Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `debug.enabled` | Enable debug logging | `false` |
| `debug.logAdapterDecisions` | Log adapter usage decisions | `false` |
| `debug.logPerformanceComparisons` | Log performance data | `false` |
| `debug.dryRun` | Log decisions without execution | `false` |

## Best Practices

### 1. Gradual Rollout

- Start with development environment (100% rollout)
- Move to canary (5% rollout) with monitoring
- Gradually increase percentage based on metrics
- Monitor each phase for at least 24-48 hours

### 2. Per-Tool Migration

- Start with read-only operations (analyze)
- Move to create operations
- Finally migrate edit and delete operations
- Consider different rollout speeds per tool

### 3. Monitoring

- Enable comprehensive monitoring during rollout
- Set up alerts for error rate and performance
- Review metrics daily during active migration
- Collect user feedback

### 4. Safety Measures

- Always enable automatic rollback in production
- Set conservative thresholds initially
- Have manual rollback procedures ready
- Test rollback mechanisms before migration

### 5. User Communication

- Notify users about migration timeline
- Provide migration guide for LLM prompts
- Set up feedback channels
- Communicate rollback procedures

## Troubleshooting

### High Error Rates

1. Check FileOperations implementation for bugs
2. Review adapter compatibility
3. Verify configuration validity
4. Check for resource constraints

### Performance Degradation

1. Enable detailed timing analysis
2. Check for cache effectiveness
3. Review parallel execution settings
4. Monitor resource usage

### Low Adoption Rates

1. Verify rollout percentage configuration
2. Check user inclusion/exclusion lists
3. Review decision logging for patterns
4. Validate user context setup

### Rollback Issues

1. Verify rollback thresholds are appropriate
2. Check circuit breaker state
3. Review rollback history for patterns
4. Validate configuration backup

## Migration Checklist

### Pre-Migration
- [ ] Test FileOperations thoroughly
- [ ] Configure monitoring systems
- [ ] Set up rollback procedures
- [ ] Train team on migration system
- [ ] Prepare user communication

### During Migration
- [ ] Monitor metrics continuously
- [ ] Review error logs daily
- [ ] Collect user feedback
- [ ] Adjust rollout percentage as needed
- [ ] Document issues and resolutions

### Post-Migration
- [ ] Validate full functionality
- [ ] Disable legacy tools
- [ ] Clean up migration code
- [ ] Document lessons learned
- [ ] Celebrate success!

## Support

For issues with the migration system:

1. Enable debug logging
2. Check migration metrics
3. Review rollback status
4. Consult this documentation
5. Contact the development team

The migration system is designed to be safe and reversible. When in doubt, use the rollback mechanisms to maintain system stability.