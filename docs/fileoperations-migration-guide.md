# FileOperations Migration Guide

This guide provides comprehensive instructions for migrating from legacy file tools to the new FileOperations system, including how to update LLM prompts and best practices for batch operations.

## Table of Contents

1. [Overview](#overview)
2. [Migration Phases](#migration-phases)
3. [Configuration](#configuration)
4. [Tool Mapping](#tool-mapping)
5. [Prompt Migration](#prompt-migration)
6. [Batch Operations](#batch-operations)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting](#troubleshooting)

## Overview

The FileOperations system replaces individual file tools with a unified, high-performance file management system that provides:

- **Batch Operations**: Process multiple files in a single operation
- **Transaction Management**: Atomic operations with rollback capabilities
- **Parallel Execution**: Concurrent file processing for better performance
- **Security Hardening**: Enhanced validation and permission checking
- **Predictive Caching**: Intelligent caching for frequently accessed files

## Migration Phases

The migration is designed to be gradual and safe:

### Phase 1: Disabled (Default)
- FileOperations is completely disabled
- All legacy tools work as before
- No changes required

### Phase 2: Adapters
- FileOperations adapters proxy requests to the new system
- Legacy tool interfaces remain unchanged
- Performance metrics are collected for comparison
- Gradual rollout with automatic rollback on errors

### Phase 3: Full
- Complete migration to FileOperations
- Legacy tools are disabled
- Full feature set available
- Maximum performance benefits

## Configuration

### User Settings (`~/.gemini/settings.json`)

```json
{
  "fileOperationsMigration": {
    "phase": "adapters",
    "rolloutPercentage": 10,
    "monitoring": {
      "enabled": true,
      "sampleRate": 0.5
    },
    "rollback": {
      "autoRollback": true,
      "errorThreshold": 0.05
    },
    "debug": {
      "enabled": false,
      "logAdapterDecisions": true
    }
  }
}
```

### Workspace Settings (`.gemini/settings.json`)

```json
{
  "fileOperationsMigration": {
    "phase": "full",
    "tools": {
      "readFile": {
        "enabled": true,
        "rolloutPercentage": 100
      },
      "writeFile": {
        "enabled": true
      }
    },
    "features": {
      "parallelExecution": true,
      "transactionManagement": true,
      "predictiveCaching": true
    }
  }
}
```

## Tool Mapping

### Legacy Tool → FileOperations Mapping

| Legacy Tool | FileOperations Operation | Migration Status |
|-------------|-------------------------|------------------|
| `ReadFileTool` | `read` operation | ✅ Full support |
| `WriteFileTool` | `create` operation | ✅ Full support |
| `EditTool` | `modify` operation | ✅ Full support |
| `GlobTool` | `search` with patterns | ✅ Full support |
| `GrepTool` | `search` with content | ✅ Full support |

## Prompt Migration

### Single File Operations

#### Legacy Approach
```typescript
// OLD: Individual tool calls
const files = await globTool.execute({ pattern: "**/*.ts" });
for (const file of files) {
  const content = await readFileTool.execute({ path: file });
  const modified = content.replace(/oldPattern/g, 'newPattern');
  await writeFileTool.execute({ path: file, content: modified });
}
```

#### FileOperations Approach
```typescript
// NEW: Single batch operation
await fileOperations.execute({
  operations: [{
    type: "modify",
    targets: [{ pattern: "**/*.ts" }],
    changes: [{
      type: "find-replace",
      find: "oldPattern",
      replace: "newPattern"
    }]
  }]
});
```

### Reading Multiple Files

#### Legacy Approach
```typescript
// OLD: Multiple tool calls
const readFiles = async (paths: string[]) => {
  const results = [];
  for (const path of paths) {
    const content = await readFileTool.execute({ path });
    results.push({ path, content });
  }
  return results;
};
```

#### FileOperations Approach
```typescript
// NEW: Single batch read
const result = await fileOperations.execute({
  operations: [{
    type: "read",
    targets: paths.map(path => ({ path }))
  }]
});
```

### Complex File Modifications

#### Legacy Approach
```typescript
// OLD: Sequential operations
const config = await readFileTool.execute({ path: "config.json" });
const parsed = JSON.parse(config);
parsed.newFeature = true;

await writeFileTool.execute({ 
  path: "config.json", 
  content: JSON.stringify(parsed, null, 2) 
});

// Update multiple related files
for (const file of relatedFiles) {
  const content = await readFileTool.execute({ path: file });
  const updated = updateImports(content);
  await writeFileTool.execute({ path: file, content: updated });
}
```

#### FileOperations Approach
```typescript
// NEW: Atomic transaction
await fileOperations.execute({
  operations: [
    {
      type: "modify",
      targets: [{ path: "config.json" }],
      changes: [{
        type: "json-update",
        path: "$.newFeature",
        value: true
      }]
    },
    {
      type: "modify",
      targets: relatedFiles.map(path => ({ path })),
      changes: [{
        type: "find-replace",
        find: /import.*from ['"]\.\.\/old/g,
        replace: 'import from "../new'
      }]
    }
  ],
  transaction: true
});
```

## Batch Operations

### Best Practices

#### 1. Batch Related Operations
```typescript
// GOOD: Batch related file changes
await fileOperations.execute({
  operations: [
    {
      type: "create",
      targets: [
        { path: "src/components/NewComponent.tsx" },
        { path: "src/components/NewComponent.test.tsx" },
        { path: "src/components/index.ts" }
      ]
    },
    {
      type: "modify",
      targets: [{ path: "src/components/index.ts" }],
      changes: [{
        type: "append",
        content: "export { NewComponent } from './NewComponent';\n"
      }]
    }
  ],
  transaction: true
});
```

#### 2. Use Patterns for Bulk Operations
```typescript
// GOOD: Use patterns for bulk operations
await fileOperations.execute({
  operations: [{
    type: "modify",
    targets: [{ pattern: "src/**/*.{ts,tsx}" }],
    changes: [{
      type: "find-replace",
      find: "deprecatedFunction",
      replace: "newFunction"
    }]
  }]
});
```

#### 3. Validate Before Executing
```typescript
// GOOD: Validate operations before execution
await fileOperations.execute({
  operations: [
    {
      type: "validate",
      targets: [{ pattern: "**/*.ts" }],
      validators: ["typescript", "eslint"]
    },
    {
      type: "modify",
      targets: [{ pattern: "**/*.ts" }],
      changes: [{ type: "format", formatter: "prettier" }]
    }
  ]
});
```

## Performance Considerations

### Parallel Execution

FileOperations automatically parallelizes operations when safe:

```typescript
// These operations run in parallel automatically
await fileOperations.execute({
  operations: [
    {
      type: "read",
      targets: [
        { path: "file1.ts" },
        { path: "file2.ts" },
        { path: "file3.ts" }
      ]
    }
  ]
});
```

### Caching

Enable predictive caching for frequently accessed files:

```json
{
  "fileOperationsMigration": {
    "features": {
      "predictiveCaching": true
    }
  }
}
```

### Memory Management

For large file operations, use streaming:

```typescript
await fileOperations.execute({
  operations: [{
    type: "read",
    targets: [{ pattern: "**/*.large" }],
    options: {
      streaming: true,
      maxMemory: "500MB"
    }
  }]
});
```

## Error Handling and Rollback

### Transaction Rollback

```typescript
try {
  await fileOperations.execute({
    operations: [
      { type: "create", targets: [{ path: "new-file.ts" }] },
      { type: "modify", targets: [{ path: "existing-file.ts" }] }
    ],
    transaction: true
  });
} catch (error) {
  // Automatic rollback - no manual cleanup needed
  console.log('Operation failed, all changes rolled back');
}
```

### Partial Failure Handling

```typescript
const result = await fileOperations.execute({
  operations: [{
    type: "modify",
    targets: [{ pattern: "**/*.ts" }],
    changes: [{ type: "format" }],
    continueOnError: true
  }]
});

// Check for partial failures
if (result.partialFailures?.length > 0) {
  console.log('Some files failed to format:', result.partialFailures);
}
```

## Migration Strategies

### Gradual Migration

1. **Start with adapters phase**:
   ```json
   {
     "fileOperationsMigration": {
       "phase": "adapters",
       "rolloutPercentage": 10
     }
   }
   ```

2. **Monitor performance**:
   ```json
   {
     "monitoring": {
       "enabled": true,
       "sampleRate": 1.0,
       "includeDetailedTimings": true
     }
   }
   ```

3. **Gradually increase rollout**:
   ```json
   {
     "rolloutPercentage": 50
   }
   ```

4. **Move to full migration**:
   ```json
   {
     "phase": "full",
     "rolloutPercentage": 100
   }
   ```

### Tool-Specific Migration

Enable migration for specific tools:

```json
{
  "fileOperationsMigration": {
    "phase": "adapters",
    "tools": {
      "readFile": {
        "enabled": true,
        "rolloutPercentage": 100
      },
      "writeFile": {
        "enabled": false
      }
    }
  }
}
```

## Troubleshooting

### Common Issues

#### 1. Performance Regression

**Symptoms**: Operations are slower than legacy tools
**Solutions**:
- Enable parallel execution: `"parallelExecution": true`
- Increase cache size: `"cacheSize": "1GB"`
- Check if operations can be batched

#### 2. Memory Usage

**Symptoms**: High memory consumption
**Solutions**:
- Enable streaming for large files: `"streaming": true`
- Reduce batch size: `"maxBatchSize": 50`
- Configure memory limits: `"maxMemory": "500MB"`

#### 3. Permission Errors

**Symptoms**: Security validation failures
**Solutions**:
- Check file permissions
- Verify target directory access
- Review security hardening settings

### Debug Mode

Enable comprehensive debugging:

```json
{
  "fileOperationsMigration": {
    "debug": {
      "enabled": true,
      "logAdapterDecisions": true,
      "logPerformanceComparisons": true,
      "dryRun": false
    }
  }
}
```

### Rollback Procedures

#### Automatic Rollback

The system automatically rolls back on:
- Error rate > 5% (configurable)
- Performance degradation > 2x (configurable)

#### Manual Rollback

Force rollback via configuration:

```json
{
  "fileOperationsMigration": {
    "phase": "disabled"
  }
}
```

Or programmatically:

```typescript
const toolRegistry = await config.getToolRegistry();
if (toolRegistry instanceof MigrationAwareToolRegistry) {
  toolRegistry.rollbackTool('ReadFileTool', 'Manual rollback requested');
}
```

## Migration Checklist

### Pre-Migration
- [ ] Review current file operation patterns
- [ ] Identify batch operation opportunities
- [ ] Set up monitoring configuration
- [ ] Plan rollback procedures

### During Migration
- [ ] Start with adapters phase
- [ ] Monitor performance metrics
- [ ] Watch for error rates
- [ ] Gradually increase rollout percentage

### Post-Migration
- [ ] Update prompts to use batch operations
- [ ] Enable advanced features (caching, parallel execution)
- [ ] Remove legacy tool dependencies
- [ ] Update documentation and examples

## Examples Repository

For more examples and templates, see:
- `/docs/examples/fileoperations-examples.md`
- `/examples/migration/` directory
- Unit tests in `/packages/core/src/tools/file-operations/`

## Support

For migration support:
1. Check debug logs with `"debug.enabled": true`
2. Review performance metrics in the monitoring dashboard
3. Consult the troubleshooting section above
4. Open an issue with detailed logs and configuration