# FileOperations Migration Guide for LLM Prompts

This guide helps users and LLMs migrate from individual file manipulation tools to the unified FileOperations tool, providing examples and best practices for optimal performance.

## Overview

The FileOperations tool combines the functionality of multiple legacy tools into a single, optimized interface that supports:

- **Batch Operations**: Process multiple files in a single request
- **Dependency Management**: Automatic operation ordering and optimization
- **Transaction Safety**: Rollback support for failed operations
- **Performance Optimization**: Parallel execution and caching
- **Advanced Analysis**: AST parsing and semantic understanding

## Migration Path

### Phase 1: Individual Tool Replacement

Replace individual tool calls with equivalent FileOperations requests:

#### ReadFile → Analyze Operation

**Before (Legacy):**
```json
{
  "tool": "read_file",
  "parameters": {
    "file_path": "/path/to/file.ts"
  }
}
```

**After (FileOperations):**
```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "analyze",
        "path": "/path/to/file.ts",
        "options": {
          "includeContent": true
        }
      }
    ]
  }
}
```

#### WriteFile → Create Operation

**Before (Legacy):**
```json
{
  "tool": "write_file",
  "parameters": {
    "file_path": "/path/to/new-file.ts",
    "content": "export const greeting = 'Hello, World!';"
  }
}
```

**After (FileOperations):**
```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "create",
        "path": "/path/to/new-file.ts",
        "content": "export const greeting = 'Hello, World!';"
      }
    ]
  }
}
```

#### EditTool → Edit Operation

**Before (Legacy):**
```json
{
  "tool": "replace",
  "parameters": {
    "file_path": "/path/to/file.ts",
    "old_string": "const oldValue = 42;",
    "new_string": "const newValue = 100;"
  }
}
```

**After (FileOperations):**
```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "edit",
        "path": "/path/to/file.ts",
        "edits": [
          {
            "type": "replace",
            "search": "const oldValue = 42;",
            "replace": "const newValue = 100;"
          }
        ]
      }
    ]
  }
}
```

#### GlobTool → Analyze with Pattern

**Before (Legacy):**
```json
{
  "tool": "glob",
  "parameters": {
    "pattern": "**/*.ts",
    "exclude": ["node_modules/**"]
  }
}
```

**After (FileOperations):**
```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "analyze",
        "path": "**/*.ts",
        "options": {
          "excludePatterns": ["node_modules/**"],
          "patternMatching": true
        }
      }
    ]
  }
}
```

#### GrepTool → Analyze with Search

**Before (Legacy):**
```json
{
  "tool": "search_file_content",
  "parameters": {
    "pattern": "function\\s+\\w+",
    "file_path": "/path/to/file.ts"
  }
}
```

**After (FileOperations):**
```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "analyze",
        "path": "/path/to/file.ts",
        "options": {
          "searchPattern": "function\\s+\\w+",
          "searchType": "regex"
        }
      }
    ]
  }
}
```

### Phase 2: Batch Operations

Combine multiple operations into efficient batches:

#### Reading Multiple Files

**Before (Legacy - Multiple Calls):**
```json
// Call 1
{"tool": "read_file", "parameters": {"file_path": "/src/component.ts"}}
// Call 2  
{"tool": "read_file", "parameters": {"file_path": "/src/utils.ts"}}
// Call 3
{"tool": "read_file", "parameters": {"file_path": "/src/types.ts"}}
```

**After (FileOperations - Single Call):**
```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "analyze",
        "path": "/src/component.ts",
        "options": {"includeContent": true}
      },
      {
        "type": "analyze", 
        "path": "/src/utils.ts",
        "options": {"includeContent": true}
      },
      {
        "type": "analyze",
        "path": "/src/types.ts", 
        "options": {"includeContent": true}
      }
    ]
  }
}
```

#### Complex Refactoring

**Before (Legacy - Sequential Calls):**
```json
// Step 1: Read files
{"tool": "read_file", "parameters": {"file_path": "/src/old-api.ts"}}
// Step 2: Create new file
{"tool": "write_file", "parameters": {"file_path": "/src/new-api.ts", "content": "..."}}
// Step 3: Update imports
{"tool": "replace", "parameters": {"file_path": "/src/consumer.ts", "old_string": "import { api } from './old-api'", "new_string": "import { api } from './new-api'"}}
// Step 4: Delete old file
{"tool": "delete_file", "parameters": {"file_path": "/src/old-api.ts"}}
```

**After (FileOperations - Single Transaction):**
```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "analyze",
        "path": "/src/old-api.ts",
        "options": {"includeContent": true}
      },
      {
        "type": "create",
        "path": "/src/new-api.ts",
        "content": "// New API implementation..."
      },
      {
        "type": "edit",
        "path": "/src/consumer.ts",
        "edits": [
          {
            "type": "replace",
            "search": "import { api } from './old-api'",
            "replace": "import { api } from './new-api'"
          }
        ]
      },
      {
        "type": "delete",
        "path": "/src/old-api.ts"
      }
    ]
  }
}
```

### Phase 3: Advanced Operations

Leverage FileOperations' advanced capabilities:

#### Semantic Analysis

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "analyze",
        "path": "/src/**/*.ts",
        "options": {
          "astAnalysis": true,
          "extractSymbols": true,
          "dependencyAnalysis": true,
          "complexityAnalysis": true
        }
      }
    ]
  }
}
```

#### Smart Validation

```json
{
  "tool": "file_operations", 
  "parameters": {
    "operations": [
      {
        "type": "validate",
        "path": "/src/**/*.ts",
        "rules": [
          "syntax",
          "imports", 
          "typescript",
          "eslint"
        ],
        "autoFix": true
      }
    ]
  }
}
```

## Best Practices

### 1. Batch Related Operations

Group operations that work on related files or serve a common goal:

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      // Group: Component creation
      {"type": "create", "path": "/components/Button.tsx", "content": "..."},
      {"type": "create", "path": "/components/Button.test.tsx", "content": "..."},
      {"type": "create", "path": "/components/Button.stories.tsx", "content": "..."},
      
      // Group: Index file update
      {"type": "edit", "path": "/components/index.ts", "edits": [
        {"type": "append", "content": "export { Button } from './Button';\n"}
      ]}
    ]
  }
}
```

### 2. Use Dependencies for Ordering

When operations depend on each other, specify dependencies:

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "id": "read-config",
        "type": "analyze",
        "path": "/config/app.json",
        "options": {"includeContent": true}
      },
      {
        "id": "create-env",
        "type": "create", 
        "path": "/.env",
        "content": "# Generated from config\n",
        "dependencies": ["read-config"]
      }
    ]
  }
}
```

### 3. Leverage Pattern Matching

Use glob patterns for efficient file discovery:

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "type": "analyze",
        "path": "/src/**/*.{ts,tsx}",
        "options": {
          "excludePatterns": ["**/*.test.*", "**/*.spec.*"],
          "extractSymbols": true
        }
      }
    ]
  }
}
```

### 4. Use Validation Before Modification

Always validate before making changes:

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [
      {
        "id": "validate",
        "type": "validate",
        "path": "/src/**/*.ts",
        "rules": ["syntax", "typescript"]
      },
      {
        "id": "refactor",
        "type": "edit",
        "path": "/src/api.ts",
        "edits": [...],
        "dependencies": ["validate"]
      }
    ]
  }
}
```

## Performance Considerations

### Parallel vs Sequential Execution

FileOperations automatically optimizes execution:

- **Parallel**: Independent operations run concurrently
- **Sequential**: Dependent operations run in order
- **Batched**: Operations on the same file are grouped

### Caching Benefits

FileOperations caches:
- File contents
- AST parse results
- Analysis results
- Validation results

Subsequent operations on the same files benefit from caching.

### Memory Management

For large codebases:

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [...],
    "options": {
      "memoryLimit": "512MB",
      "concurrency": 4,
      "cacheTTL": 300
    }
  }
}
```

## Error Handling

FileOperations provides transaction-level error handling:

### Rollback on Failure

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [...],
    "options": {
      "rollbackOnError": true,
      "validateBeforeExecute": true
    }
  }
}
```

### Partial Success Handling

```json
{
  "tool": "file_operations",
  "parameters": {
    "operations": [...],
    "options": {
      "continueOnError": false,
      "reportPartialSuccess": true
    }
  }
}
```

## Migration Checklist

### For Individual Operations
- [ ] Replace tool name with `file_operations`
- [ ] Wrap parameters in `operations` array
- [ ] Convert parameters to operation-specific format
- [ ] Test with single operation first

### For Batch Operations  
- [ ] Identify related operations
- [ ] Group operations logically
- [ ] Add dependencies where needed
- [ ] Test incremental migration

### For Advanced Features
- [ ] Enable AST analysis for code operations
- [ ] Add validation steps before modifications
- [ ] Use pattern matching for file discovery
- [ ] Configure performance options

### Validation Steps
- [ ] Test with small file sets first
- [ ] Verify equivalent functionality
- [ ] Check performance improvements
- [ ] Validate error handling
- [ ] Test rollback scenarios

## Common Pitfalls

### 1. Over-batching
Don't group unrelated operations just to use FileOperations:

**Bad:**
```json
{
  "operations": [
    {"type": "analyze", "path": "/frontend/src/app.ts"},
    {"type": "edit", "path": "/backend/api/server.py"},
    {"type": "create", "path": "/docs/readme.md"}
  ]
}
```

**Good:**
```json
// Separate calls for unrelated operations
```

### 2. Missing Dependencies
Specify dependencies for operations that must run in order:

**Bad:**
```json
{
  "operations": [
    {"type": "delete", "path": "/old/file.ts"},
    {"type": "create", "path": "/old/file.ts", "content": "new content"}
  ]
}
```

**Good:**
```json
{
  "operations": [
    {"id": "delete", "type": "delete", "path": "/old/file.ts"},
    {"id": "create", "type": "create", "path": "/old/file.ts", "content": "new content", "dependencies": ["delete"]}
  ]
}
```

### 3. Inefficient Patterns
Use specific paths instead of overly broad patterns:

**Bad:**
```json
{"type": "analyze", "path": "/**/*.*"}
```

**Good:**
```json
{"type": "analyze", "path": "/src/**/*.{ts,js,tsx,jsx}"}
```

## Support and Rollback

If issues arise during migration:

1. **Enable Debug Mode**: Set `debug.enabled: true` in migration config
2. **Use Dry Run**: Set `debug.dryRun: true` to test without execution
3. **Gradual Rollback**: Disable specific tools using `excludeTools` config
4. **Complete Rollback**: Set migration phase to `disabled`

For help with specific migration scenarios, refer to the examples above or check the FileOperations documentation.