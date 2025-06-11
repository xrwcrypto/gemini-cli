# FileOperations Mega Tool - Technical Architecture for Gemini CLI

## Overview

The FileOperations mega tool is a high-performance, unified file manipulation system designed as a feature enhancement for the Gemini CLI. It replaces multiple atomic file operations (ReadFileTool, WriteFileTool, EditTool, GlobTool, GrepTool) with a single, intelligent, batch-capable tool. This architecture prioritizes minimizing LLM round trips through parallel execution, intelligent caching, and transaction support.

This tool will be implemented as a new core tool within the Gemini CLI's existing architecture, leveraging the established Tool interface and MCP (Model Context Protocol) integration capabilities.

## Core Design Principles

1. **Batch Operations**: Execute multiple file operations in a single request
2. **Parallel Execution**: Process independent operations concurrently
3. **Transaction Support**: All-or-nothing operation groups with rollback capability
4. **Intelligent Caching**: Reuse AST parsing and file analysis across operations
5. **Structured Returns**: Provide parsed, actionable data instead of raw text
6. **Progressive Enhancement**: Gracefully degrade when advanced features unavailable

## System Architecture

### Integration with Gemini CLI

The FileOperations tool will be integrated into the Gemini CLI architecture as follows:

```
┌─────────────────────────────────────────────────────────────┐
│                    Gemini CLI Architecture                   │
├─────────────────────────────────────────────────────────────┤
│  packages/cli (UI)  │  packages/core (Backend)              │
├─────────────────────────────────────────────────────────────┤
│                    Tool Registry                             │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐    │
│  │ ReadFileTool│ │WriteFileTool│ │  FileOperationsTool│    │
│  │   (legacy)  │ │  (legacy)   │ │      (NEW)        │    │
│  └─────────────┘ └─────────────┘ └───────────────────┘    │
└─────────────────────────────────────────────────────────────┘

                              ↓

┌─────────────────────────────────────────────────────────────┐
│              FileOperationsTool Implementation               │
├─────────────────────────────────────────────────────────────┤
│  Request Parser  │  Operation Planner  │  Response Builder  │
├─────────────────────────────────────────────────────────────┤
│                   Execution Engine                           │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐    │
│  │  Analyzer   │ │   Editor    │ │    Validator      │    │
│  │  Component  │ │  Component  │ │    Component      │    │
│  └─────────────┘ └─────────────┘ └───────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                   Core Services                              │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐    │
│  │ File System │ │ AST Parser  │ │  Cache Manager    │    │
│  │   Service   │ │   Service   │ │     Service       │    │
│  └─────────────┘ └─────────────┘ └───────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

#### 0. FileOperationsTool Class
- Extends `BaseTool<FileOperationRequest, ToolResult>` from Gemini CLI core
- Implements the Tool interface required by the ToolRegistry
- Handles parameter validation, confirmation prompts, and execution
- Integrates with existing Config and approval workflows

#### 1. Request Parser
- Validates incoming operation requests
- Analyzes dependencies between operations
- Creates execution plan with optimal ordering
- Identifies parallelization opportunities

#### 2. Operation Planner
- Builds directed acyclic graph (DAG) of operations
- Groups operations by:
  - File locality (operations on same file)
  - Operation type (reads before writes)
  - Dependency chains
- Optimizes for:
  - Minimal file system access
  - Maximum parallelism
  - Cache utilization

#### 3. Execution Engine
- Manages thread pool for parallel execution
- Implements transaction boundaries
- Handles rollback on failure
- Provides progress streaming

#### 4. Component Modules

##### Analyzer Component
Capabilities:
- AST parsing with language detection
- Symbol extraction (imports, exports, functions, classes)
- Dependency graph building
- Pattern matching (regex, AST-based, semantic)
- Complexity analysis
- TODO/FIXME extraction

##### Editor Component
Capabilities:
- Multi-file batch editing
- Find/replace with regex support
- AST-aware transformations
- Line-based and position-based edits
- Template-based file creation
- Syntax validation pre/post edit

##### Validator Component
Capabilities:
- Syntax checking across languages
- Import resolution validation
- Type checking integration
- Linting integration
- Test execution hooks
- Auto-fix capability

#### 5. Core Services

##### File System Service
- Efficient file reading with streaming
- Atomic writes with temporary files
- File watching for cache invalidation
- Permission handling
- Symbolic link resolution

##### AST Parser Service
- Multi-language support via tree-sitter
- Incremental parsing for large files
- AST caching with invalidation
- Query language for AST traversal
- Source map maintenance

##### Cache Manager Service
- LRU cache for file contents
- AST cache with dependency tracking
- Operation result caching
- Session-based cache lifecycle
- Memory pressure handling

## Data Structures

### Operation Request Schema

```typescript
interface FileOperationRequest {
  operations: Operation[];
  options: {
    parallel?: boolean;          // Default: true
    transaction?: boolean;       // Default: false
    continueOnError?: boolean;   // Default: false
    returnFormat?: 'raw' | 'structured' | 'minimal';
    cacheStrategy?: 'none' | 'session' | 'persistent';
  };
}

interface Operation {
  id?: string;                   // For referencing in dependencies
  type: 'analyze' | 'edit' | 'create' | 'delete' | 'validate';
  dependsOn?: string[];          // Operation IDs that must complete first
  // Type-specific parameters...
}
```

### Analysis Operation

```typescript
interface AnalyzeOperation extends Operation {
  type: 'analyze';
  paths: string[];               // Glob patterns
  extract?: ExtractType[];       // What to extract
  buildIndex?: boolean;          // Build searchable index
  deepAnalysis?: boolean;        // Include complexity, security analysis
}

type ExtractType = 
  | 'imports' | 'exports' | 'functions' | 'classes'
  | 'interfaces' | 'types' | 'variables' | 'todos'
  | 'dependencies' | 'complexity' | 'all';
```

### Edit Operation

```typescript
interface EditOperation extends Operation {
  type: 'edit';
  edits: FileEdit[];
  validateSyntax?: boolean;      // Check syntax after edits
  preserveFormatting?: boolean;  // Maintain indentation/style
}

interface FileEdit {
  file: string;
  changes: Change[];
  createIfMissing?: boolean;
}

interface Change {
  type: 'find-replace' | 'line' | 'position' | 'ast';
  // Type-specific fields...
}
```

### Response Schema

```typescript
interface FileOperationResponse {
  success: boolean;
  results: OperationResult[];
  summary: {
    totalOperations: number;
    successful: number;
    failed: number;
    duration: number;
    filesAffected: string[];
  };
  errors?: OperationError[];
}

interface OperationResult {
  operationId: string;
  type: string;
  status: 'success' | 'failed' | 'skipped';
  data?: any;                    // Type-specific result data
  error?: OperationError;
}
```

## Implementation Details

### Tool Implementation

```typescript
import { BaseTool, ToolResult } from '../tools/tools.js';
import { Config } from '../config/config.js';
import { SchemaValidator } from '../utils/schemaValidator.js';

export class FileOperationsTool extends BaseTool<FileOperationRequest, ToolResult> {
  static readonly Name = 'file_operations';
  
  constructor(
    private readonly config: Config,
    private readonly rootDirectory: string
  ) {
    super(
      FileOperationsTool.Name,
      'FileOperations',
      'Batch file operations with parallel execution and transaction support',
      // Schema definition here
    );
  }
  
  async execute(params: FileOperationRequest, signal: AbortSignal): Promise<ToolResult> {
    const engine = new ExecutionEngine(this.config, this.rootDirectory);
    const response = await engine.execute(params, signal);
    
    return {
      llmContent: JSON.stringify(response),
      returnDisplay: this.formatDisplay(response)
    };
  }
}
```

### Parallel Execution Strategy

```typescript
class ExecutionEngine {
  private workerPool: WorkerPool;
  private operationGraph: DAG<Operation>;
  
  async execute(request: FileOperationRequest): Promise<FileOperationResponse> {
    // Build execution graph
    this.operationGraph = this.buildDAG(request.operations);
    
    // Get execution stages (operations that can run in parallel)
    const stages = this.operationGraph.getExecutionStages();
    
    // Execute each stage
    for (const stage of stages) {
      if (request.options.parallel) {
        await Promise.all(stage.map(op => this.executeOperation(op)));
      } else {
        for (const op of stage) {
          await this.executeOperation(op);
        }
      }
    }
  }
}
```

### Transaction Support

```typescript
class TransactionManager {
  private snapshots: Map<string, FileSnapshot>;
  
  async beginTransaction(files: string[]) {
    for (const file of files) {
      this.snapshots.set(file, await this.createSnapshot(file));
    }
  }
  
  async commit() {
    this.snapshots.clear();
  }
  
  async rollback() {
    for (const [file, snapshot] of this.snapshots) {
      await this.restoreSnapshot(file, snapshot);
    }
  }
}
```

### AST-Based Editing

```typescript
class ASTEditor {
  async applyASTEdit(file: string, edit: ASTEdit) {
    const ast = await this.parseFile(file);
    const query = this.compileQuery(edit.query);
    const matches = query.matches(ast.rootNode);
    
    for (const match of matches) {
      const replacement = this.generateReplacement(match, edit.transform);
      this.applyReplacement(ast, match, replacement);
    }
    
    return this.generateCode(ast);
  }
}
```

## Performance Optimizations

### 1. Intelligent Batching
- Group operations by file to minimize I/O
- Combine multiple edits to same file into single write
- Batch AST parsing for files in same directory

### 2. Caching Strategy
- Cache parsed ASTs for session duration
- Invalidate cache on file modification
- Pre-emptively cache frequently accessed files
- Use memory-mapped files for large codebases

### 3. Streaming Results
- Return results as they complete
- Use Server-Sent Events for progress updates
- Chunk large responses

### 4. Language-Specific Optimizations
- Use native language servers when available
- Leverage incremental compilation APIs
- Cache compiled artifacts

## Error Handling

### Error Categories

1. **Validation Errors**: Invalid operation parameters
2. **File System Errors**: Permission denied, file not found
3. **Syntax Errors**: Invalid code after edits
4. **Dependency Errors**: Required operation failed
5. **Resource Errors**: Memory limit, timeout

### Error Recovery

```typescript
interface ErrorRecovery {
  strategy: 'retry' | 'skip' | 'abort' | 'fix';
  maxRetries?: number;
  fallback?: Operation;
  autoFix?: {
    syntax?: boolean;
    imports?: boolean;
    formatting?: boolean;
  };
}
```

## Security Considerations

1. **Path Traversal Prevention**: Validate all file paths
2. **Resource Limits**: Cap memory usage and execution time
3. **Sandbox Execution**: Run validators in isolated environment
4. **Input Sanitization**: Validate regex patterns and code
5. **Permission Checking**: Respect file system permissions

## Extension Points

### Language Plugins

```typescript
interface LanguagePlugin {
  name: string;
  extensions: string[];
  parser: Parser;
  analyzer?: Analyzer;
  formatter?: Formatter;
  validator?: Validator;
}
```

### Custom Operations

```typescript
interface CustomOperation {
  name: string;
  execute(context: OperationContext): Promise<any>;
  validate?(params: any): ValidationResult;
  estimateCost?(params: any): CostEstimate;
}
```

## LLM System Instructions

### How to Use FileOperations Effectively

When you have access to the FileOperations tool, follow these guidelines to maximize performance and minimize round trips:

#### 1. **Batch Everything**
Instead of sequential operations, combine related work:

```typescript
// ❌ BAD: Multiple round trips
Read("src/index.ts")
Read("src/types.ts")
Edit("src/index.ts", ...)
Edit("src/types.ts", ...)
Bash("npm test")

// ✅ GOOD: Single round trip
FileOperations({
  operations: [
    { type: "analyze", paths: ["src/*.ts"], extract: ["imports", "exports"] },
    { type: "edit", edits: [/* all edits */] },
    { type: "validate", commands: ["npm test"] }
  ]
})
```

#### 2. **Use Analysis Before Editing**
Always analyze files first to understand structure:

```typescript
FileOperations({
  operations: [
    {
      id: "analyze-api",
      type: "analyze",
      paths: ["src/api/**/*.ts"],
      extract: ["functions", "imports", "exports"],
      buildIndex: true
    },
    {
      id: "refactor",
      type: "edit",
      dependsOn: ["analyze-api"],  // Use analysis results
      edits: [/* informed edits based on analysis */]
    }
  ]
})
```

#### 3. **Leverage Parallel Execution**
Mark operations that can run simultaneously:

```typescript
FileOperations({
  operations: [
    // These will run in parallel
    { id: "lint", type: "validate", commands: ["npm run lint"] },
    { id: "test", type: "validate", commands: ["npm test"] },
    { id: "typecheck", type: "validate", commands: ["npm run typecheck"] }
  ],
  options: { parallel: true }
})
```

#### 4. **Use Structured Extraction**
Request structured data instead of raw text:

```typescript
{
  type: "analyze",
  paths: ["**/*.ts"],
  extract: ["imports", "exports", "functions"],
  returnFormat: "structured"  // Returns parsed AST data
}
```

#### 5. **Implement Transaction Patterns**
For risky operations, use transactions:

```typescript
FileOperations({
  operations: [/* multiple edits */],
  options: {
    transaction: true,  // Rollback on any failure
    validateSyntax: true  // Check before committing
  }
})
```

#### 6. **Common Patterns**

**Refactoring Pattern:**
```typescript
{
  operations: [
    { type: "analyze", paths: ["**/*.ts"], extract: ["all"] },
    { type: "edit", edits: [/* refactoring changes */] },
    { type: "validate", commands: ["npm test", "npm run lint"] }
  ]
}
```

**Search and Replace Pattern:**
```typescript
{
  operations: [
    { 
      type: "analyze", 
      paths: ["**/*.ts"], 
      search: { pattern: "oldFunction", type: "ast" }
    },
    { 
      type: "edit", 
      edits: [{ 
        file: "*", // Apply to all files with matches
        find: "oldFunction", 
        replace: "newFunction" 
      }]
    }
  ]
}
```

**Create Module Pattern:**
```typescript
{
  operations: [
    { 
      type: "create", 
      files: [
        { path: "src/newModule/index.ts", template: "module-index" },
        { path: "src/newModule/types.ts", template: "module-types" },
        { path: "src/newModule/newModule.test.ts", template: "test-suite" }
      ]
    },
    { 
      type: "edit", 
      edits: [{ 
        file: "src/index.ts", 
        after: "// Exports", 
        content: "export * from './newModule';" 
      }]
    }
  ]
}
```

#### 7. **Performance Tips**

1. **Pre-warm Cache**: If you know you'll need files, analyze them first
2. **Use Globs Wisely**: Be specific with patterns to avoid unnecessary processing
3. **Structured Returns**: Always request structured data over raw text
4. **Dependency Chains**: Use operation IDs and dependsOn for complex workflows
5. **Incremental Updates**: Use the buildIndex option for subsequent searches

#### 8. **Error Handling**

Always check the response structure:

```typescript
const response = await FileOperations({...});

if (!response.success) {
  // Handle errors by operation
  response.errors.forEach(error => {
    console.log(`Operation ${error.operationId} failed: ${error.message}`);
  });
}
```

## Migration Strategy

### Phase 1: Implementation as MCP Tool
- Implement FileOperationsTool as an MCP server
- Register via mcpServers configuration in settings.json
- Test alongside existing tools without disruption
- Gather performance metrics and user feedback

### Phase 2: Core Tool Integration
- Move implementation to packages/core/src/tools/
- Register in createToolRegistry() in config.ts
- Implement adapters for backward compatibility
- Add feature flag for gradual rollout

### Phase 3: Legacy Tool Deprecation
- Update LLM system prompts to prefer FileOperations
- Mark old tools (ReadFileTool, WriteFileTool, etc.) as deprecated
- Provide migration guides and tooling
- Remove legacy tools in major version update

### Phase 4: Advanced Features
- Enable AST-based operations
- Implement predictive caching
- Add custom language plugins
- Integrate with existing extension system

## Performance Metrics

### Key Performance Indicators

1. **Operations per Second**: Target 100+ ops/sec
2. **Latency**: P99 < 100ms for simple operations
3. **Memory Usage**: < 500MB for typical session
4. **Cache Hit Rate**: > 80% for repeated operations

### Benchmarks

| Operation | Current Tools | FileOperations | Improvement |
|-----------|--------------|----------------|-------------|
| Read 10 files | 10 requests | 1 request | 10x |
| Edit 10 files | 10 requests | 1 request | 10x |
| Search + Edit | 20+ requests | 1 request | 20x |
| Refactor function | 30+ requests | 1 request | 30x |

## Future Enhancements

1. **Machine Learning Integration**
   - Predict next operations
   - Suggest optimizations
   - Learn from usage patterns

2. **Distributed Execution**
   - Scale across multiple machines
   - Handle massive codebases
   - Cloud-based processing

3. **Real-time Collaboration**
   - Multiple agents working together
   - Conflict resolution
   - Shared cache and state

4. **Advanced Analysis**
   - Security vulnerability scanning
   - Performance profiling
   - Architecture visualization

## Integration with Gemini CLI Features

### Approval Mode Support
The FileOperationsTool will respect the existing ApprovalMode settings:
- `ApprovalMode.DEFAULT`: Prompt for file modifications
- `ApprovalMode.AUTO_EDIT`: Auto-approve file edits
- `ApprovalMode.YOLO`: Auto-approve all operations

### Sandboxing Integration
- Respect existing sandbox restrictions
- Use Config.getSandboxMode() for operation constraints
- Integrate with platform-specific sandbox implementations

### Telemetry and Metrics
- Emit metrics via existing telemetry framework
- Track operation counts, latencies, and success rates
- Integration with OpenTelemetry collectors

### Configuration
```typescript
// In settings.json
{
  "fileOperations": {
    "enabled": true,
    "maxParallelOperations": 10,
    "cacheStrategy": "session",
    "transactionTimeout": 30000,
    "astParsingEnabled": true
  }
}
```

## LLM System Instructions

### Overview
This section provides guidance for Language Learning Models (LLMs) on how to effectively use the FileOperations mega tool within the Gemini CLI to minimize round trips and maximize efficiency.

### Core Principles for LLM Usage

1. **Batch Everything**: Always combine multiple operations into a single request
2. **Analyze Before Edit**: Use analyze operations to understand code structure before making changes
3. **Transaction Safety**: Use transactions for multi-file refactoring operations
4. **Structured Data**: Request structured responses for easier parsing and decision making
5. **Dependency Chains**: Leverage operation dependencies to create complex workflows

### Common Usage Patterns

#### Pattern 1: Code Analysis and Understanding
```typescript
// Single request to understand entire codebase structure
{
  operations: [
    {
      id: "analyze-all",
      type: "analyze",
      paths: ["src/**/*.ts", "src/**/*.tsx"],
      extract: ["imports", "exports", "functions", "classes", "interfaces"],
      buildIndex: true,
      deepAnalysis: true
    }
  ],
  options: {
    returnFormat: "structured",
    cacheStrategy: "session"
  }
}
```

#### Pattern 2: Multi-File Refactoring
```typescript
// Rename a function across entire codebase
{
  operations: [
    {
      id: "find-usage",
      type: "analyze",
      paths: ["**/*.ts"],
      extract: ["functions"],
      // Find all files using the old function name
    },
    {
      id: "rename-function",
      type: "edit",
      dependsOn: ["find-usage"],
      edits: [
        // Edits generated based on analysis results
      ],
      validateSyntax: true
    },
    {
      id: "update-tests",
      type: "edit",
      dependsOn: ["rename-function"],
      edits: [
        // Update test files
      ]
    },
    {
      id: "validate-all",
      type: "validate",
      dependsOn: ["update-tests"],
      // Run validation on all modified files
    }
  ],
  options: {
    transaction: true,
    parallel: false
  }
}
```

#### Pattern 3: Code Generation with Context
```typescript
// Generate new code based on existing patterns
{
  operations: [
    {
      id: "analyze-patterns",
      type: "analyze",
      paths: ["src/components/**/*.tsx"],
      extract: ["classes", "interfaces", "functions"],
      buildIndex: true
    },
    {
      id: "create-component",
      type: "create",
      dependsOn: ["analyze-patterns"],
      // Create new component following existing patterns
    },
    {
      id: "update-index",
      type: "edit",
      dependsOn: ["create-component"],
      // Update barrel exports
    },
    {
      id: "validate-new-code",
      type: "validate",
      dependsOn: ["update-index"]
    }
  ],
  options: {
    transaction: true
  }
}
```

### Best Practices for LLMs

#### 1. Pre-Analysis Phase
Always start with analysis operations to:
- Understand code structure and dependencies
- Identify all files that need modification
- Build a mental model of the codebase
- Cache AST data for subsequent operations

#### 2. Operation Grouping
- Group related edits to the same file
- Use dependencies to ensure correct execution order
- Leverage parallel execution for independent operations
- Use transactions for atomic multi-file changes

#### 3. Error Handling
- Always include validation operations after edits
- Use `continueOnError` wisely based on operation criticality
- Request structured error responses for better recovery
- Plan rollback strategies for complex operations

#### 4. Performance Optimization
- Use glob patterns efficiently to minimize file scanning
- Request only needed data in analysis operations
- Leverage caching for repeated operations
- Batch similar operations together

### Common Mistakes to Avoid

1. **Sequential Thinking**: Don't chain multiple tool calls when one batched call would work
2. **Over-Analysis**: Don't analyze files you won't modify
3. **Missing Dependencies**: Ensure edits happen after analysis completes
4. **Ignoring Transactions**: Use transactions for multi-file operations
5. **Raw Text Processing**: Use structured responses for easier parsing

### Advanced Techniques

#### 1. Conditional Operations
```typescript
// Use analysis results to conditionally execute operations
{
  operations: [
    {
      id: "check-imports",
      type: "analyze",
      paths: ["src/**/*.ts"],
      extract: ["imports"]
    },
    {
      id: "fix-imports",
      type: "edit",
      dependsOn: ["check-imports"],
      // Only execute if analysis finds issues
      condition: "hasUnresolvedImports"
    }
  ]
}
```

#### 2. Progressive Enhancement
```typescript
// Start simple, add complexity based on results
{
  operations: [
    {
      id: "quick-scan",
      type: "analyze",
      paths: ["src/**/*.ts"],
      extract: ["functions"],
      deepAnalysis: false
    },
    {
      id: "deep-scan",
      type: "analyze",
      dependsOn: ["quick-scan"],
      // Only deep scan files with complex functions
      paths: ["{{complex_files}}"],
      deepAnalysis: true
    }
  ]
}
```

#### 3. Caching Strategy
```typescript
// Optimize for repeated operations
{
  operations: [
    {
      id: "cache-warm",
      type: "analyze",
      paths: ["src/core/**/*.ts"],
      buildIndex: true
    },
    // Subsequent operations benefit from warmed cache
  ],
  options: {
    cacheStrategy: "persistent"
  }
}
```

### Integration Examples

#### Example 1: Full Codebase Refactor
```typescript
// Complete refactoring workflow in one request
{
  operations: [
    // 1. Analyze current state
    { id: "analyze", type: "analyze", paths: ["**/*.ts"], extract: ["all"] },
    
    // 2. Update imports
    { id: "fix-imports", type: "edit", dependsOn: ["analyze"], /* ... */ },
    
    // 3. Rename variables
    { id: "rename-vars", type: "edit", dependsOn: ["fix-imports"], /* ... */ },
    
    // 4. Update types
    { id: "update-types", type: "edit", dependsOn: ["rename-vars"], /* ... */ },
    
    // 5. Format code
    { id: "format", type: "edit", dependsOn: ["update-types"], /* ... */ },
    
    // 6. Validate everything
    { id: "validate", type: "validate", dependsOn: ["format"] }
  ],
  options: {
    transaction: true,
    returnFormat: "structured"
  }
}
```

#### Example 2: Smart Code Generation
```typescript
// Generate code based on existing patterns
{
  operations: [
    // 1. Learn patterns
    { id: "learn", type: "analyze", paths: ["src/models/**/*.ts"], extract: ["classes", "interfaces"] },
    
    // 2. Generate similar code
    { id: "generate", type: "create", dependsOn: ["learn"], /* ... */ },
    
    // 3. Integrate with existing code
    { id: "integrate", type: "edit", dependsOn: ["generate"], /* ... */ },
    
    // 4. Add tests
    { id: "add-tests", type: "create", dependsOn: ["integrate"], /* ... */ },
    
    // 5. Validate
    { id: "validate", type: "validate", dependsOn: ["add-tests"] }
  ]
}
```

### Performance Tips for LLMs

1. **Minimize File Reads**: Use analysis operations to read once, edit many times
2. **Batch by Locality**: Group operations on files in the same directory
3. **Use Indexes**: Build indexes for large codebases to speed up searches
4. **Cache Wisely**: Use session caching for iterative operations
5. **Parallel When Possible**: Identify independent operations for parallel execution

### Debugging Workflows

When operations fail:
1. Check operation dependencies
2. Verify file paths exist
3. Ensure syntax is valid before and after edits
4. Use structured error responses
5. Consider transaction rollback

### Migration from Legacy Tools

For LLMs currently using individual tools:
1. Identify tool call sequences
2. Map to FileOperations operations
3. Combine into single request
4. Add appropriate dependencies
5. Enable transactions for safety