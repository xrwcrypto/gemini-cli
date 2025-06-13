# FileOperations Legacy Tool Adapters

This directory contains adapter implementations that provide 100% backward compatibility between the original file manipulation tools and the new FileOperations mega tool.

## Overview

The adapters ensure seamless migration from individual tools to the unified FileOperations tool by:
- Maintaining identical API signatures
- Preserving exact output formats
- Supporting all original parameters and behaviors
- Providing configuration-based tool selection

## Adapters

### ReadFileAdapter
Maps `ReadFileTool` operations to FileOperations `analyze` operations.

**Features:**
- Full support for offset/limit parameters
- Image and PDF file handling (through analyze)
- Line number formatting preservation
- Error message compatibility

**Limitations:**
- Currently returns extracted metadata instead of raw content
- Full content reconstruction would require FileOperations enhancement

### WriteFileAdapter
Maps `WriteFileTool` operations to FileOperations `create` or `edit` operations.

**Features:**
- Automatic detection of new vs existing files
- Diff generation for approval mode
- File creation with directory auto-creation
- Transaction support compatibility

### EditToolAdapter
Maps `EditTool` operations to FileOperations `edit` or `create` operations.

**Features:**
- Find/replace with occurrence counting
- Multiple replacement support
- New file creation with empty old_string
- Context-aware error messages
- Line ending normalization

### GlobToolAdapter
Maps `GlobTool` operations to FileOperations `analyze` operations.

**Features:**
- Glob pattern matching
- Case sensitivity options
- Git ignore support
- Modification time sorting (when available)
- Path filtering and validation

### GrepToolAdapter
Maps `GrepTool` operations to FileOperations `analyze` with search.

**Features:**
- Regex pattern searching
- File include patterns
- Line number and context preservation
- Grouped output by file
- Multi-strategy fallback compatibility

## Usage

### Basic Usage

```typescript
import { LegacyToolCompatibility } from './adapters/legacy-compatibility.js';

// Create compatibility layer
const compat = new LegacyToolCompatibility(config, rootDirectory, {
  useFileOperationsAdapters: true,
  debugMode: true
});

// Get adapter for specific tool
const readTool = compat.getTool('read_file'); // Returns ReadFileAdapter

// Get all tools
const allTools = compat.getAllTools(); // Map of all adapted tools
```

### Configuration Options

```typescript
interface LegacyCompatibilityConfig {
  // Enable FileOperations adapters
  useFileOperationsAdapters?: boolean;
  
  // Exclude specific tools from adaptation
  excludeTools?: string[];
  
  // Enable debug logging
  debugMode?: boolean;
}
```

### Tool Registry Integration

```typescript
// Create registry shim for automatic adapter usage
const shimmedRegistry = LegacyToolCompatibility.createRegistryShim(
  originalRegistry,
  config,
  rootDirectory,
  { useFileOperationsAdapters: true }
);

// Now all tool lookups will use adapters automatically
const tool = shimmedRegistry.getTool('read_file'); // Returns adapter
```

### Gradual Migration

Enable adapters for specific tools while testing:

```typescript
const compat = new LegacyToolCompatibility(config, rootDirectory, {
  useFileOperationsAdapters: true,
  excludeTools: ['write_file', 'edit'] // Keep these as original
});
```

## Testing

Run adapter tests to verify compatibility:

```bash
npm test -- adapters.test.ts
```

The test suite ensures:
- Output format compatibility
- Parameter handling correctness
- Error behavior consistency
- Edge case handling
- Performance characteristics

## Migration Guide

### Phase 1: Testing
1. Enable adapters in development/staging
2. Monitor for any behavioral differences
3. Compare outputs between original and adapted tools

### Phase 2: Gradual Rollout
1. Enable adapters for read-only tools first (read_file, glob, grep)
2. Test write operations thoroughly (write_file, edit)
3. Monitor performance and error rates

### Phase 3: Full Migration
1. Enable adapters for all tools
2. Remove original tool implementations
3. Simplify codebase to use FileOperations directly

## Known Differences

While adapters maintain 100% API compatibility, some internal differences exist:

1. **Caching**: FileOperations uses session caching for better performance
2. **Parallelization**: Multiple operations may execute in parallel internally
3. **Transaction Support**: FileOperations provides transaction capabilities
4. **Error Details**: Error messages may include additional context

## Future Enhancements

1. **Raw Content Support**: Enhance FileOperations analyze to return raw file content
2. **Streaming**: Add streaming support for large file operations
3. **Metrics**: Detailed performance comparisons between implementations
4. **Auto-Migration**: Tools to automatically convert tool calls to FileOperations