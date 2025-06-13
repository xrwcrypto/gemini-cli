# FileOperations Plugins

This directory contains language-specific plugins that enhance the FileOperations tool with advanced parsing and analysis capabilities.

## Available Plugins

### TypeScript Plugin (`typescript-plugin.ts`)

The standard TypeScript plugin provides comprehensive support for TypeScript and JavaScript files using the official TypeScript Compiler API.

#### Features
- **Accurate Parsing**: Uses TypeScript Compiler API for precise AST generation
- **Type Information**: Extracts detailed type information from TypeScript files
- **Module Resolution**: Supports Node.js module resolution including `tsconfig.json` paths
- **TSConfig Support**: Automatically finds and respects `tsconfig.json` settings
- **Incremental Parsing**: Supports incremental parsing for better performance
- **Full TypeScript Support**: Handles all TypeScript features including:
  - Interfaces and type aliases
  - Generics and conditional types
  - Decorators and metadata
  - JSX/TSX files
  - Module imports/exports (both CommonJS and ESM)

### Enhanced TypeScript Plugin (`typescript-enhanced-plugin.ts`)

An advanced version of the TypeScript plugin with additional features for professional development workflows.

#### Enhanced Features
- **Advanced Type Analysis**: Extract detailed type information including properties, methods, base types
- **Decorator Support**: Parse and analyze decorators with arguments
- **Namespace Extraction**: Full namespace parsing with member analysis
- **JSX Support**: Parse React components and extract JSX elements with props
- **Module Augmentation**: Handle TypeScript module augmentation and global declarations
- **Language Service Integration**: Code completions, code fixes, find references
- **Semantic Tokens**: Enhanced syntax highlighting support
- **Advanced Module Resolution**: Better handling of path mapping and external libraries
- **Type-aware Refactoring**: Support for symbol renaming with type awareness
- **Complex Type Support**: Conditional types, mapped types, template literals
- **JSDoc Integration**: Extract JSDoc comments and tags

#### Enhanced API

The enhanced plugin provides additional methods beyond the standard `LanguageParser` interface:

```typescript
// Get detailed type information at a specific position
const typeInfo = await plugin.getEnhancedTypeInfo(
  '/path/to/file.ts',
  content,
  { line: 10, column: 5 }
);
console.log('Type:', typeInfo.type);
console.log('Documentation:', typeInfo.documentation);
console.log('Properties:', typeInfo.properties);
console.log('Methods:', typeInfo.methods);

// Get code completions
const completions = await plugin.getCompletions(
  '/path/to/file.ts',
  content,
  { line: 10, column: 5 }
);

// Find all references to a symbol
const references = await plugin.findReferences(
  '/path/to/file.ts',
  content,
  { line: 10, column: 5 }
);

// Get available code fixes
const fixes = await plugin.getCodeFixes(
  '/path/to/file.ts',
  content,
  { line: 10, column: 5 }
);

// Extract semantic tokens for syntax highlighting
const tokens = await plugin.getSemanticTokens('/path/to/file.ts', content);

// Advanced module resolution with detailed information
const resolution = await plugin.resolveModuleEnhanced('./utils', '/src/app.ts');
console.log('Resolved path:', resolution.resolvedPath);
console.log('Is external library:', resolution.isExternalLibrary);
console.log('Package name:', resolution.packageName);
console.log('Is type-only:', resolution.isTypeOnly);
```

## Usage Examples

### Basic File Analysis

```typescript
import { FileOperationsServer } from '../file-operations.js';

const server = new FileOperationsServer('/project/root');

// Analyze TypeScript files with enhanced capabilities
const request = {
  operations: [{
    type: 'analyze',
    paths: ['src/**/*.ts'],
    extract: ['imports', 'exports', 'functions', 'classes', 'interfaces', 'types'],
    deepAnalysis: true
  }]
};

const response = await server.processOperations(request);
```

### Using Enhanced TypeScript Plugin Directly

```typescript
import { createEnhancedTypeScriptPlugin } from './typescript-enhanced-plugin.js';
import { CacheManager } from '../services/cache-manager.js';

const cacheManager = new CacheManager();
const plugin = createEnhancedTypeScriptPlugin(cacheManager);

// Parse with enhanced information
const result = await plugin.parse(fileContent, '/path/to/file.ts');
console.log('Type Aliases:', result.typeAliases);
console.log('Decorators:', result.decorators);
console.log('Namespaces:', result.namespaces);
console.log('JSX Elements:', result.jsxElements);

// Get type information at cursor position
const typeInfo = await plugin.getEnhancedTypeInfo(
  '/path/to/file.ts',
  fileContent,
  { line: 15, column: 10 }
);
```

### Type-aware Refactoring

```typescript
// Find all references to a symbol
const references = await plugin.findReferences(
  '/project/src/user.service.ts',
  content,
  { line: 5, column: 15 } // Position of symbol
);

// Rename symbol across all files
for (const ref of references) {
  // Apply rename operation using FileOperations edit functionality
  // This ensures type-safe refactoring across the entire codebase
}
```

## Plugin Configuration

Use the `PluginLoader` to configure which plugins to load:

```typescript
import { createPluginLoader } from './plugin-loader.js';

// Load regular TypeScript plugin
const basicLoader = createPluginLoader({
  typescript: true,
  typescriptEnhanced: false
});

// Load enhanced TypeScript plugin (recommended for advanced workflows)
const enhancedLoader = createPluginLoader({
  typescript: false,
  typescriptEnhanced: true  // This takes precedence over the basic plugin
});

// Create parser with plugins
const parser = await enhancedLoader.createConfiguredParser();
```

### Custom Plugin Configuration

```typescript
const loader = createPluginLoader({
  typescriptEnhanced: true,
  customPlugins: [
    {
      language: 'ruby',
      path: '/path/to/ruby-plugin.js'
    }
  ]
});
```

## Plugin Architecture

### Base Interface

All plugins implement the `LanguageParser` interface:

```typescript
interface LanguageParser {
  parse(content: string, filePath: string): Promise<ParseResult>;
  supportsIncremental(): boolean;
  parseIncremental(content: string, filePath: string, previousTree?: unknown): Promise<ParseResult>;
}
```

### Enhanced Interface

Enhanced plugins can provide additional methods for IDE-like functionality:

```typescript
interface EnhancedLanguageParser extends LanguageParser {
  getEnhancedTypeInfo(filePath: string, content: string, position: Position): Promise<EnhancedTypeInfo>;
  getCompletions(filePath: string, content: string, position: Position): Promise<Completion[]>;
  findReferences(filePath: string, content: string, position: Position): Promise<Reference[]>;
  getCodeFixes(filePath: string, content: string, position: Position): Promise<CodeFix[]>;
  getSemanticTokens(filePath: string, content: string): Promise<SemanticToken[]>;
  resolveModuleEnhanced(moduleName: string, containingFile: string): Promise<ModuleResolution>;
}
```

## Creating Custom Plugins

To create a custom language plugin, implement the `LanguageParser` interface:

```typescript
import { LanguageParser, ParseResult } from '../services/ast-parser.js';
import { CacheManager } from '../services/cache-manager.js';

export class MyLanguagePlugin implements LanguageParser {
  constructor(private cacheManager?: CacheManager) {}

  async parse(content: string, filePath: string): Promise<ParseResult> {
    // Implement parsing logic
    return {
      ast: undefined, // Optional AST
      symbols: [],    // Extracted symbols
      imports: [],    // Import statements
      exports: [],    // Export statements
      errors: [],     // Parse errors
      language: 'mylang'
    };
  }

  supportsIncremental(): boolean {
    return false; // Return true if incremental parsing is supported
  }

  async parseIncremental(
    content: string,
    filePath: string,
    previousTree?: unknown
  ): Promise<ParseResult> {
    // Implement incremental parsing or fall back to full parse
    return this.parse(content, filePath);
  }
}

// Export factory function
export function createMyLanguagePlugin(cacheManager?: CacheManager): MyLanguagePlugin {
  return new MyLanguagePlugin(cacheManager);
}
```

### Plugin Registration

Add your plugin to the plugin loader:

```typescript
// In plugin-loader.ts
private async loadMyLanguagePlugin(parserService: ASTParserService): Promise<void> {
  try {
    const plugin = createMyLanguagePlugin(this.cacheManager);
    parserService.registerParser('mylang', plugin);
  } catch (error) {
    console.warn('Failed to load MyLanguage plugin:', error);
  }
}
```

## Testing

All plugins should have comprehensive test coverage:

```typescript
import { describe, it, expect } from 'vitest';
import { createEnhancedTypeScriptPlugin } from './typescript-enhanced-plugin.js';

describe('Enhanced TypeScript Plugin', () => {
  let plugin: TypeScriptEnhancedPlugin;

  beforeEach(() => {
    plugin = createEnhancedTypeScriptPlugin();
  });

  it('should extract type aliases with type parameters', async () => {
    const content = `
      export type Result<T, E = Error> = 
        | { success: true; data: T }
        | { success: false; error: E };
    `;

    const result = await plugin.parse(content, '/test/types.ts');
    
    expect(result.typeAliases).toHaveLength(1);
    expect(result.typeAliases[0].name).toBe('Result');
    expect(result.typeAliases[0].typeParameters).toEqual(['T', 'E']);
  });

  it('should provide enhanced type information', async () => {
    const content = `
      interface User {
        id: string;
        name: string;
        email?: string;
      }
    `;

    const typeInfo = await plugin.getEnhancedTypeInfo(
      '/test/user.ts',
      content,
      { line: 2, column: 10 }
    );

    expect(typeInfo).toBeDefined();
    expect(typeInfo?.properties).toBeDefined();
    expect(typeInfo?.properties?.length).toBeGreaterThan(0);
  });
});
```

## Performance Considerations

- **Caching**: Plugins use the provided `CacheManager` for expensive operations
- **Incremental Parsing**: Enhanced plugins support incremental parsing where possible
- **Lazy Loading**: Language services are only created when needed
- **Memory Management**: Proper cleanup of TypeScript language service resources

## Advanced Usage Examples

### Dependency Analysis

```typescript
const enhancedPlugin = createEnhancedTypeScriptPlugin();

// Analyze all imports in a project
for (const file of projectFiles) {
  const result = await enhancedPlugin.parse(content, file);
  
  for (const imp of result.imports) {
    const resolution = await enhancedPlugin.resolveModuleEnhanced(
      imp.from,
      file
    );
    
    console.log(`${imp.from} -> ${resolution.resolvedPath}`);
    console.log(`External: ${resolution.isExternalLibrary}`);
    console.log(`Package: ${resolution.packageName}`);
  }
}
```

### Code Generation

```typescript
// Extract interface definitions
const result = await enhancedPlugin.parse(interfaceContent, '/types.ts');

// Generate implementations based on type information
for (const symbol of result.symbols.filter(s => s.type === 'interface')) {
  const typeInfo = await enhancedPlugin.getEnhancedTypeInfo(
    '/types.ts',
    interfaceContent,
    symbol.position
  );
  
  // Use type information to generate service classes, mocks, etc.
  const serviceCode = generateServiceFromInterface(symbol.name, typeInfo);
}
```

## Future Plugins

Planned plugins for future implementation:

- **Python Plugin**: Using tree-sitter-python or Python AST
- **Go Plugin**: Using go/parser and go/ast packages  
- **Java Plugin**: Using Eclipse JDT or tree-sitter-java
- **Rust Plugin**: Using syn crate or tree-sitter-rust
- **C/C++ Plugin**: Using clang or tree-sitter-cpp

Each plugin will provide language-specific features while maintaining a consistent interface for the FileOperations tool.