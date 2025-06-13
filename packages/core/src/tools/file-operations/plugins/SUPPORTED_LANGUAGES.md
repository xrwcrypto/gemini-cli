# Supported Languages Documentation

This document provides comprehensive information about all languages supported by the FileOperations plugin system, their capabilities, and usage examples.

## Overview

The FileOperations tool supports multiple programming languages through a sophisticated plugin architecture. Each language plugin provides varying levels of support for:

- **Parsing** - Extract symbols, imports, exports from source code
- **Syntax Highlighting** - Provide tokens for syntax highlighting
- **Diagnostics** - Generate errors, warnings, and suggestions
- **Code Completion** - Suggest completions at cursor position
- **Formatting** - Format code according to language conventions
- **Incremental Parsing** - Update parse trees efficiently for large files

## Language Support Matrix

| Language | Plugin | Parsing | Syntax Highlighting | Diagnostics | Completion | Formatting | Incremental |
|----------|--------|---------|-------------------|-------------|------------|------------|-------------|
| TypeScript | ✅ Built-in | ✅ Full | ✅ Yes | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| JavaScript | ✅ Built-in | ✅ Full | ✅ Yes | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| Python | ✅ Built-in | ✅ Full | ✅ Yes | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| Go | ✅ Built-in | ✅ Full | ✅ Yes | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| Java | 🚧 Planned | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| C++ | 🚧 Planned | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| C | 🚧 Planned | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| Rust | 🚧 Planned | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |

Legend:
- ✅ Fully supported
- 🚧 In development/planned
- ❌ Not supported

## TypeScript & JavaScript Support

### Overview
The TypeScript plugin provides comprehensive support for both TypeScript and JavaScript files using the TypeScript Compiler API. It offers two variants:

1. **Basic Plugin** - Regex-based parsing with good performance
2. **Enhanced Plugin** - Full TypeScript Compiler API integration

### Capabilities

#### File Extensions
- `.ts` - TypeScript files
- `.tsx` - TypeScript React files
- `.js` - JavaScript files
- `.jsx` - JavaScript React files
- `.mjs` - JavaScript modules
- `.cjs` - CommonJS files

#### MIME Types
- `application/javascript`
- `application/typescript`
- `text/javascript`
- `text/typescript`

#### Supported Features

**Symbol Extraction:**
- Functions and arrow functions
- Classes and constructors
- Interfaces and type aliases
- Variables (const, let, var)
- Enums
- Namespaces/modules
- Import/export statements

**TypeScript-Specific:**
- Type annotations
- Generic types
- Decorators
- Abstract classes
- Access modifiers (public, private, protected)

### Usage Examples

#### Basic Parsing
```typescript
const plugin = createTypeScriptPlugin(cacheManager);
const content = `
interface User {
  name: string;
  age: number;
}

export class UserService {
  private users: User[] = [];
  
  addUser(user: User): void {
    this.users.push(user);
  }
  
  getUsers(): User[] {
    return this.users;
  }
}
`;

const result = await plugin.parse(content, 'user-service.ts');
console.log(result.symbols); // Functions, classes, interfaces
console.log(result.exports); // Exported symbols
```

#### Advanced Features (Enhanced Plugin)
```typescript
const enhancedPlugin = createEnhancedTypeScriptPlugin(cacheManager);

// Get semantic tokens
const tokens = await enhancedPlugin.getTokens!(content, 'file.ts');

// Get diagnostics
const diagnostics = await enhancedPlugin.getDiagnostics!(content, 'file.ts');

// Get completions at position
const completions = await enhancedPlugin.getCompletions!(
  content, 
  { line: 10, column: 5 }, 
  'file.ts'
);
```

### Configuration

```typescript
await registry.register(createTypeScriptPlugin(cacheManager), {
  enabled: true,
  settings: {
    includeDeclarations: true,
    parseJSX: true,
    strictMode: false
  }
});
```

## Python Support

### Overview
The Python plugin provides comprehensive parsing for Python files with support for modern Python features including type annotations, async/await, and dataclasses.

### Capabilities

#### File Extensions
- `.py` - Python files
- `.pyi` - Python stub files
- `.pyw` - Python Windows files

#### MIME Types
- `text/x-python`
- `application/x-python`

#### Supported Features

**Symbol Extraction:**
- Functions and methods
- Classes and inheritance
- Variables and constants
- Import statements (import, from...import)
- Decorators
- Lambda functions
- Async functions and methods

**Type Annotations:**
- Function parameter types
- Return type annotations
- Variable type hints
- Generic types

**Advanced Features:**
- Virtual environment detection
- Standard library import recognition
- Relative vs absolute imports
- Wildcard imports

### Usage Examples

#### Basic Parsing
```python
# Example Python content
class UserRepository:
    def __init__(self, database: Database):
        self.db = database
    
    async def get_user(self, user_id: int) -> Optional[User]:
        result = await self.db.fetch_one(
            "SELECT * FROM users WHERE id = ?", user_id
        )
        return User(**result) if result else None
    
    @cached_property
    def user_count(self) -> int:
        return len(self.get_all_users())

if __name__ == "__main__":
    repo = UserRepository(Database())
```

```typescript
const plugin = createPythonPlugin(cacheManager);
const result = await plugin.parse(pythonContent, 'repository.py');

console.log(result.symbols.filter(s => s.type === 'class')); // Classes
console.log(result.symbols.filter(s => s.type === 'function')); // Functions/methods
```

#### Import Analysis
```typescript
const result = await plugin.parse(content, 'app.py');

// Standard library imports
const stdImports = result.imports.filter(imp => 
  plugin.isStandardLibrary(imp.from)
);

// Local imports
const localImports = result.imports.filter(imp => 
  imp.from.startsWith('.') || imp.from.startsWith('..')
);
```

### Configuration

```typescript
await registry.register(createPythonPlugin(cacheManager), {
  enabled: true,
  settings: {
    pythonVersion: '3.9',
    enableTypeHints: true,
    checkVirtualEnv: true,
    parseAsyncSyntax: true
  }
});
```

## Go Support

### Overview
The Go plugin provides comprehensive parsing for Go source files with full support for Go's unique features like packages, interfaces, and receiver methods.

### Capabilities

#### File Extensions
- `.go` - Go source files

#### MIME Types
- `text/x-go`

#### Supported Features

**Symbol Extraction:**
- Package declarations
- Functions and methods (with receivers)
- Structs and struct fields
- Interfaces and embedded interfaces
- Type declarations
- Constants and variables
- Import statements

**Go-Specific Features:**
- Receiver methods (pointer and value receivers)
- Embedded struct fields
- Interface embedding
- Package-level exports (capitalized identifiers)
- Standard library detection
- Local vs external imports

### Usage Examples

#### Basic Parsing
```go
// Example Go content
package handlers

import (
    "encoding/json"
    "net/http"
    "github.com/gorilla/mux"
)

type UserHandler struct {
    userService UserService
}

func NewUserHandler(service UserService) *UserHandler {
    return &UserHandler{userService: service}
}

func (h *UserHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
    users, err := h.userService.GetAll()
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(users)
}

type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}
```

```typescript
const plugin = createGoPlugin(cacheManager);
const result = await plugin.parse(goContent, 'handler.go') as GoParseResult;

// Go-specific parsing results
console.log(result.goSpecific.packageName); // "handlers"
console.log(result.goSpecific.structs); // User, UserHandler
console.log(result.goSpecific.functions); // Functions and methods
console.log(result.goSpecific.imports); // Import analysis
```

#### Advanced Go Features
```typescript
// Check for exported symbols
const exportedSymbols = result.symbols.filter(s => s.exported);

// Find methods by receiver type
const userMethods = result.goSpecific.functions.filter(f => 
  f.receiver?.type === 'UserHandler'
);

// Analyze imports
const standardImports = result.goSpecific.imports.filter(i => i.isStandard);
const localImports = result.goSpecific.imports.filter(i => i.isLocal);
```

### Configuration

```typescript
await registry.register(createGoPlugin(cacheManager), {
  enabled: true,
  settings: {
    goVersion: '1.19',
    parseModFiles: true,
    checkModulePaths: true,
    enableGoroutineAnalysis: false
  }
});
```

## Language Detection

### Overview
The language detection system uses multiple strategies to identify file languages:

1. **File Extension** - Primary method, highest confidence
2. **Filename Patterns** - Special files like Makefile, Dockerfile
3. **Shebang Lines** - Script headers like `#!/usr/bin/env python`
4. **Content Analysis** - Pattern matching in file contents
5. **MIME Types** - Fallback method

### Usage Examples

#### Basic Detection
```typescript
const detector = new LanguageDetector();

// Detect by extension
const result1 = await detector.detectLanguage('app.ts');
console.log(result1.language); // 'typescript'

// Detect by content
const content = 'package main\nfunc main() {}';
const result2 = await detector.detectLanguage('unknown', content);
console.log(result2.language); // 'go'
console.log(result2.method); // 'content'
```

#### Batch Detection
```typescript
const files = [
  { path: 'app.ts', content: 'export class App {}' },
  { path: 'script.py', content: 'def main(): pass' },
  { path: 'main.go', content: 'package main\nfunc main() {}' }
];

const results = await detector.detectLanguages(files);
for (const [path, result] of results) {
  console.log(`${path}: ${result.language} (${result.confidence})`);
}
```

#### Custom Patterns
```typescript
const detector = new LanguageDetector({
  customPatterns: {
    'rust': [
      /fn\s+\w+/,
      /struct\s+\w+/,
      /impl\s+/
    ],
    'kotlin': [
      /fun\s+\w+/,
      /class\s+\w+/,
      /package\s+[\w.]+/
    ]
  }
});
```

## Performance Considerations

### Caching Strategy
All plugins support caching through the CacheManager:

```typescript
const cacheManager = new CacheManager({
  maxSize: 1000,           // Max cached items
  defaultTtl: 300000,      // 5 minute TTL
  enableFileWatching: true // Auto-invalidate on file changes
});

const plugin = createTypeScriptPlugin(cacheManager);
```

### Memory Management
- **File Size Limits**: Each plugin has configurable max file size
- **Session Cleanup**: Cache is cleared between sessions
- **Memory Pressure**: Automatic eviction when memory is low

### Incremental Parsing
All plugins support incremental parsing for better performance on large files:

```typescript
// First parse
const result1 = await plugin.parse(content, 'large-file.ts');

// Modified content - only changed parts are re-parsed
const result2 = await plugin.parseIncremental(
  modifiedContent, 
  'large-file.ts', 
  result1.ast
);
```

## Extending Language Support

### Creating a New Plugin
See the [Plugin API Guide](./PLUGIN_API_GUIDE.md) for detailed instructions on creating new language plugins.

### Contributing
To contribute a new language plugin:

1. Implement the `EnhancedLanguageParser` interface
2. Extend `BaseLanguagePlugin` for common functionality
3. Add comprehensive tests
4. Update this documentation
5. Submit a pull request

### Plugin Requirements
- **Metadata**: Complete plugin metadata with capabilities
- **Validation**: Implement validation for plugin health
- **Testing**: 80%+ test coverage
- **Documentation**: Usage examples and API documentation
- **Performance**: Support for files up to 5MB
- **Error Handling**: Graceful handling of malformed code

## Troubleshooting

### Common Issues

#### Plugin Not Loading
```typescript
// Check plugin registration
const plugins = registry.listPlugins();
console.log(plugins.map(p => p.metadata.id));

// Validate plugin
const validation = await plugin.validate();
if (!validation.valid) {
  console.error('Plugin validation failed:', validation.errors);
}
```

#### Poor Performance
```typescript
// Enable performance monitoring
const validator = new PluginValidator({
  checkFileSizeLimits: true
});

// Check plugin metrics
const results = await validator.validatePlugins([plugin]);
console.log(results.get(plugin.getMetadata().id)?.metrics);
```

#### Detection Issues
```typescript
// Check language detection confidence
const result = await detector.detectLanguage(filePath, content);
if (result.confidence < 0.7) {
  console.warn('Low confidence detection:', result);
  console.log('Alternatives:', result.metadata.alternatives);
}
```

### Debug Mode
Enable debug logging for detailed plugin operation information:

```typescript
const registry = new PluginRegistry(cacheManager);

registry.on('plugin-error', (metadata, error) => {
  console.error(`Plugin ${metadata.id} error:`, error);
});

registry.on('plugin-validated', (metadata, result) => {
  console.log(`Plugin ${metadata.id} validation:`, result);
});
```

## Future Roadmap

### Planned Languages
- **Java** - Full support with Maven/Gradle integration
- **C/C++** - CMake integration and header parsing
- **Rust** - Cargo integration and macro support
- **C#** - .NET project support
- **Ruby** - Gem and Rails support
- **PHP** - Composer and framework support

### Planned Features
- **Tree-sitter Integration** - More accurate parsing for all languages
- **Language Servers** - Integration with existing language servers
- **Code Formatting** - Language-specific code formatting
- **Refactoring** - Automated refactoring suggestions
- **Cross-language Analysis** - Dependencies between different languages

## Resources

- [Plugin API Guide](./PLUGIN_API_GUIDE.md) - Complete plugin development guide
- [TypeScript Plugin Source](./typescript-plugin.ts) - Reference implementation
- [Python Plugin Source](./python-plugin.ts) - Python-specific features
- [Go Plugin Source](./go-plugin.ts) - Go-specific parsing
- [Cross-language Tests](./cross-language-integration.test.ts) - Integration examples

For questions, bug reports, or feature requests, please open an issue in the main repository.