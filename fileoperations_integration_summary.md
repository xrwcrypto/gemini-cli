# FileOperations Tool Integration Summary

## Gemini CLI Architecture Overview

The Gemini CLI is a monorepo project with two main packages:

1. **packages/cli** - User-facing CLI interface (React-based TUI)
2. **packages/core** - Backend logic, API client, and tools

## Key Components for Integration

### Tool System
- **BaseTool** class: All tools extend this base class from `packages/core/src/tools/tools.ts`
- **ToolRegistry**: Manages tool registration and discovery in `packages/core/src/tools/tool-registry.ts`
- **Tool Interface**: Requires `name`, `description`, `parameterSchema`, `execute()`, `validateToolParams()`, etc.

### Existing File Tools
- `ReadFileTool` - reads single files
- `WriteFileTool` - writes files with approval
- `EditTool` - performs find/replace operations
- `GlobTool` - finds files by pattern
- `GrepTool` - searches file contents

### Integration Points

1. **Tool Registration**: Tools are registered in `createToolRegistry()` function in `packages/core/src/config/config.ts`
2. **MCP Support**: The system supports Model Context Protocol for external tools
3. **Approval System**: File modifications require user approval based on `ApprovalMode`
4. **Sandboxing**: All operations respect platform-specific sandbox restrictions
5. **Telemetry**: OpenTelemetry integration for metrics and monitoring

## FileOperations Tool Integration Strategy

### Phase 1: MCP Implementation
- Implement as an MCP server first for testing
- Register via `mcpServers` in settings.json
- Test alongside existing tools

### Phase 2: Core Tool
- Move to `packages/core/src/tools/file-operations/`
- Extend `BaseTool` class
- Register in `createToolRegistry()`

### Phase 3: Migration
- Create adapters for backward compatibility
- Update LLM prompts gradually
- Deprecate individual file tools

## Key Differences from Standalone Project

1. **TypeScript instead of Go**: The Gemini CLI is entirely TypeScript-based
2. **Monorepo structure**: Work within the existing workspace
3. **Existing utilities**: Leverage existing error handling, validation, and file utilities
4. **Tool interface**: Must implement the established Tool interface
5. **Testing**: Use Vitest instead of Go's testing framework
6. **Configuration**: Integrate with existing Config system

## Next Steps

1. Set up MCP server implementation
2. Define FileOperationRequest schema matching FunctionDeclaration format
3. Implement core execution engine with existing utilities
4. Add comprehensive tests
5. Document in docs/tools/ directory