# FileOperations Plugin API Guide

This comprehensive guide covers everything you need to know about creating, registering, and maintaining plugins for the FileOperations tool in Gemini CLI.

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Plugin Architecture](#plugin-architecture)
4. [Creating a Plugin](#creating-a-plugin)
5. [Plugin Registration](#plugin-registration)
6. [Testing Your Plugin](#testing-your-plugin)
7. [Advanced Features](#advanced-features)
8. [Best Practices](#best-practices)
9. [Examples](#examples)
10. [API Reference](#api-reference)

## Overview

The FileOperations plugin system provides a flexible, extensible architecture for adding language-specific parsing and analysis capabilities. Each plugin can:

- Parse source code and extract symbols (functions, classes, variables, etc.)
- Provide syntax highlighting tokens
- Offer code completion suggestions
- Generate diagnostics (errors, warnings)
- Format code according to language conventions
- Support incremental parsing for performance

### Supported Languages

Current built-in plugins support:
- **TypeScript/JavaScript** - Full AST parsing with TypeScript Compiler API
- **Python** - Comprehensive parsing with type annotation support
- **Go** - Complete parsing of packages, structs, interfaces, and functions

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- TypeScript knowledge for plugin development
- Understanding of your target language's syntax

### Basic Plugin Structure

```typescript
import { BaseLanguagePlugin, PluginMetadata } from './base-plugin.js';
import { ParseResult } from '../services/ast-parser.js';

export class MyLanguagePlugin extends BaseLanguagePlugin {
  getMetadata(): PluginMetadata {
    return {
      id: 'my-language-plugin',
      name: 'My Language Plugin',
      version: '1.0.0',
      description: 'Support for My Programming Language',
      languages: ['mylang'],
      capabilities: {
        incremental: true,
        syntaxHighlighting: false,
        codeCompletion: false,
        diagnostics: true,
        formatting: false,
        refactoring: false,
        fileExtensions: ['.mylang'],
        mimeTypes: ['text/x-mylang']
      }
    };
  }

  async parse(content: string, filePath: string): Promise<ParseResult> {
    // Implement your parsing logic here
    return {
      ast: undefined,
      symbols: [],
      imports: [],
      exports: [],
      errors: [],
      language: 'mylang'
    };
  }
}

export function createMyLanguagePlugin(cacheManager?: CacheManager): MyLanguagePlugin {
  return new MyLanguagePlugin(cacheManager);
}
```

## Plugin Architecture

### Core Interfaces

#### `EnhancedLanguageParser`
The main interface all plugins must implement:

```typescript
interface EnhancedLanguageParser extends LanguageParser {
  getMetadata(): PluginMetadata;
  validate(): Promise<PluginValidationResult>;
  initialize(config: PluginConfiguration): Promise<void>;
  cleanup(): Promise<void>;
  supportsFile(filePath: string, content?: string): boolean;
  
  // Optional advanced features
  getTokens?(content: string, filePath: string): Promise<SyntaxToken[]>;
  getCompletions?(content: string, position: Position, filePath: string): Promise<CompletionItem[]>;
  getDiagnostics?(content: string, filePath: string): Promise<Diagnostic[]>;
  formatCode?(content: string, filePath: string, options?: FormatOptions): Promise<string>;
}
```

#### `BaseLanguagePlugin`
Abstract base class providing common functionality:

```typescript
abstract class BaseLanguagePlugin implements EnhancedLanguageParser {
  protected readonly cacheManager?: CacheManager;
  protected config?: PluginConfiguration;
  protected initialized = false;

  // Utility methods available to subclasses:
  protected extractSymbolsWithRegex(...): Symbol[];
  protected getCacheKey(filePath: string, operation: string): string;
  protected ensureInitialized(): void;
  protected getFileExtension(filePath: string): string;
}
```

### Plugin Lifecycle

1. **Creation** - Plugin instance is created with optional cache manager
2. **Validation** - Plugin validates its configuration and capabilities
3. **Registration** - Plugin is registered with the plugin registry
4. **Initialization** - Plugin initializes with provided configuration
5. **Active** - Plugin processes parsing requests
6. **Cleanup** - Plugin releases resources when unregistered

## Creating a Plugin

### Step 1: Define Plugin Metadata

```typescript
getMetadata(): PluginMetadata {
  return {
    id: 'rust-language-plugin',
    name: 'Rust Language Plugin',
    version: '1.0.0',
    description: 'Comprehensive Rust language support',
    languages: ['rust'],
    author: {
      name: 'Your Name',
      email: 'your.email@example.com'
    },
    capabilities: {
      incremental: true,
      syntaxHighlighting: true,
      codeCompletion: false,
      diagnostics: true,
      formatting: false,
      refactoring: false,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      fileExtensions: ['.rs'],
      mimeTypes: ['text/x-rust']
    }
  };
}
```

### Step 2: Implement Core Parsing

```typescript
async parse(content: string, filePath: string): Promise<ParseResult> {
  const result: ParseResult = {
    ast: undefined,
    symbols: [],
    imports: [],
    exports: [],
    errors: [],
    language: 'rust'
  };

  try {
    // Extract functions
    this.parseFunctions(content, result);
    
    // Extract structs
    this.parseStructs(content, result);
    
    // Extract use statements (imports)
    this.parseUseStatements(content, result);
    
    // Extract public items (exports)
    this.parsePublicItems(content, result);
    
  } catch (error) {
    result.errors.push({
      message: `Parsing error: ${error.message}`,
      position: { line: 1, column: 1 }
    });
  }

  return result;
}
```

### Step 3: Add Language-Specific Parsing

```typescript
private parseFunctions(content: string, result: ParseResult): void {
  const functionRegex = /fn\s+(\w+)\s*\([^)]*\)(?:\s*->\s*[^{]+)?\s*\{/g;
  const symbols = this.extractSymbolsWithRegex(content, [{
    regex: functionRegex,
    type: 'function',
    scope: 'global',
    exported: false // Will be determined by pub keyword
  }]);
  
  result.symbols.push(...symbols);
}

private parseStructs(content: string, result: ParseResult): void {
  const structRegex = /struct\s+(\w+)\s*\{/g;
  const symbols = this.extractSymbolsWithRegex(content, [{
    regex: structRegex,
    type: 'class', // Map Rust structs to class type
    scope: 'global',
    exported: false
  }]);
  
  result.symbols.push(...symbols);
}
```

### Step 4: Implement File Support Detection

```typescript
supportsFile(filePath: string, content?: string): boolean {
  const metadata = this.getMetadata();
  const ext = this.getFileExtension(filePath);
  
  // Check by file extension
  if (metadata.capabilities.fileExtensions.includes(ext)) {
    return true;
  }
  
  // Check by content patterns if provided
  if (content) {
    // Look for Rust-specific patterns
    const rustPatterns = [
      /fn\s+\w+\s*\(/,
      /struct\s+\w+/,
      /impl\s+/,
      /use\s+[\w:]+;/
    ];
    
    return rustPatterns.some(pattern => pattern.test(content));
  }
  
  return false;
}
```

### Step 5: Add Validation

```typescript
protected async onValidate(result: PluginValidationResult): Promise<void> {
  // Add custom validation logic
  if (!this.supportsFile('test.rs')) {
    result.warnings.push('Plugin may not properly support .rs files');
  }
  
  // Validate that we can parse basic Rust syntax
  try {
    const testContent = 'fn main() {}';
    const parseResult = await this.parse(testContent, 'test.rs');
    if (parseResult.symbols.length === 0) {
      result.warnings.push('Basic parsing test failed');
    }
  } catch (error) {
    result.errors.push(`Validation parsing failed: ${error.message}`);
    result.valid = false;
  }
}
```

## Plugin Registration

### Manual Registration

```typescript
import { PluginRegistry } from './plugin-registry.js';
import { createMyLanguagePlugin } from './my-language-plugin.js';

const registry = new PluginRegistry(cacheManager);
const plugin = createMyLanguagePlugin(cacheManager);

await registry.register(plugin, {
  enabled: true,
  settings: {
    maxConcurrency: 4,
    timeout: 30000
  }
});
```

### Automatic Discovery

```typescript
const registry = new PluginRegistry(cacheManager);

// Discover plugins in specified directories
const discoveryResult = await registry.discoverPlugins([
  './plugins',
  '/usr/local/lib/gemini-cli-plugins',
  '~/.gemini-cli/plugins'
]);

// Load discovered plugins
for (const pluginInfo of discoveryResult.plugins) {
  if (!pluginInfo.error) {
    try {
      await registry.loadPlugin(pluginInfo.path);
    } catch (error) {
      console.warn(`Failed to load plugin ${pluginInfo.path}:`, error);
    }
  }
}
```

### Integration with AST Parser

```typescript
import { ASTParserService } from '../services/ast-parser.js';

const astParser = new ASTParserService(cacheManager);

// Register all plugins from registry
for (const registration of registry.listPlugins()) {
  for (const language of registration.metadata.languages) {
    astParser.registerParser(language, registration.plugin);
  }
}
```

## Testing Your Plugin

### Basic Testing Template

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MyLanguagePlugin, createMyLanguagePlugin } from './my-language-plugin.js';

describe('MyLanguagePlugin', () => {
  let plugin: MyLanguagePlugin;

  beforeEach(() => {
    plugin = createMyLanguagePlugin();
  });

  describe('metadata', () => {
    it('should return correct plugin metadata', () => {
      const metadata = plugin.getMetadata();
      expect(metadata.id).toBe('my-language-plugin');
      expect(metadata.languages).toContain('mylang');
    });
  });

  describe('parsing', () => {
    it('should parse basic syntax', async () => {
      const content = `// Your test content here`;
      const result = await plugin.parse(content, 'test.mylang');
      
      expect(result.language).toBe('mylang');
      expect(result.errors).toHaveLength(0);
      expect(result.symbols.length).toBeGreaterThan(0);
    });
  });

  describe('file support', () => {
    it('should support correct file extensions', () => {
      expect(plugin.supportsFile('test.mylang')).toBe(true);
      expect(plugin.supportsFile('test.txt')).toBe(false);
    });
  });

  describe('validation', () => {
    it('should validate successfully', async () => {
      const result = await plugin.validate();
      expect(result.valid).toBe(true);
    });
  });
});
```

### Integration Testing

```typescript
describe('Plugin Integration', () => {
  it('should work with plugin registry', async () => {
    const registry = new PluginRegistry();
    const plugin = createMyLanguagePlugin();
    
    await registry.register(plugin);
    
    const bestPlugin = registry.getBestPluginForFile('test.mylang');
    expect(bestPlugin?.metadata.id).toBe('my-language-plugin');
  });

  it('should work with language detection', async () => {
    const detector = new LanguageDetector();
    const content = `// Your language-specific content`;
    
    const result = await detector.detectLanguage('test.mylang', content);
    expect(result.language).toBe('mylang');
  });
});
```

## Advanced Features

### Syntax Highlighting

```typescript
async getTokens(content: string, filePath: string): Promise<SyntaxToken[]> {
  const tokens: SyntaxToken[] = [];
  
  // Tokenize keywords
  const keywordRegex = /\b(fn|struct|impl|use|pub|mod|let|mut)\b/g;
  let match;
  while ((match = keywordRegex.exec(content)) !== null) {
    tokens.push({
      type: 'keyword',
      start: this.getPosition(content, match.index),
      end: this.getPosition(content, match.index + match[0].length),
      text: match[0]
    });
  }
  
  // Tokenize strings
  const stringRegex = /"([^"\\]|\\.)*"/g;
  while ((match = stringRegex.exec(content)) !== null) {
    tokens.push({
      type: 'string',
      start: this.getPosition(content, match.index),
      end: this.getPosition(content, match.index + match[0].length),
      text: match[0]
    });
  }
  
  return tokens;
}
```

### Diagnostics

```typescript
async getDiagnostics(content: string, filePath: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  
  // Check for common issues
  if (content.includes('unwrap()')) {
    const matches = [...content.matchAll(/\.unwrap\(\)/g)];
    for (const match of matches) {
      const position = this.getPosition(content, match.index!);
      diagnostics.push({
        range: {
          start: position,
          end: { line: position.line, column: position.column + match[0].length }
        },
        severity: DiagnosticSeverity.Warning,
        message: 'Consider using expect() or proper error handling instead of unwrap()',
        code: 'prefer-expect-over-unwrap',
        source: 'my-language-plugin'
      });
    }
  }
  
  return diagnostics;
}
```

### Incremental Parsing

```typescript
async parseIncremental(
  content: string,
  filePath: string,
  previousTree?: unknown
): Promise<ParseResult> {
  // If we have a previous tree and the changes are minimal, 
  // we can update only the changed parts
  if (previousTree && this.canUseIncremental(content, previousTree)) {
    return this.updateParseTree(content, previousTree as MyParseTree);
  }
  
  // Fall back to full parsing
  return this.parse(content, filePath);
}

private canUseIncremental(content: string, previousTree: unknown): boolean {
  // Implement logic to determine if incremental parsing is beneficial
  // For example, check if the change is only whitespace or comments
  return false; // Simplified for example
}
```

## Best Practices

### Performance

1. **Use Caching**: Leverage the provided cache manager for expensive operations
2. **Lazy Loading**: Only parse what's needed when it's needed
3. **Incremental Updates**: Implement incremental parsing for large files
4. **Limit Scope**: Don't parse the entire file if only specific information is needed

```typescript
async parse(content: string, filePath: string): Promise<ParseResult> {
  // Check cache first
  const cacheKey = this.getCacheKey(filePath, 'parse');
  if (this.cacheManager) {
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      return cached as ParseResult;
    }
  }
  
  const result = await this.doParse(content, filePath);
  
  // Cache the result
  if (this.cacheManager) {
    this.cacheManager.set(cacheKey, result);
  }
  
  return result;
}
```

### Error Handling

1. **Graceful Degradation**: Continue processing even with syntax errors
2. **Detailed Error Messages**: Provide helpful error messages with positions
3. **Validation**: Validate inputs and configurations thoroughly

```typescript
async parse(content: string, filePath: string): Promise<ParseResult> {
  const result: ParseResult = {
    ast: undefined,
    symbols: [],
    imports: [],
    exports: [],
    errors: [],
    language: 'mylang'
  };

  try {
    this.parseSymbols(content, result);
  } catch (error) {
    result.errors.push({
      message: `Symbol parsing failed: ${error.message}`,
      position: { line: 1, column: 1 }
    });
  }

  try {
    this.parseImports(content, result);
  } catch (error) {
    result.errors.push({
      message: `Import parsing failed: ${error.message}`,
      position: { line: 1, column: 1 }
    });
  }

  return result;
}
```

### Memory Management

1. **Clean Up Resources**: Implement proper cleanup in the cleanup() method
2. **Limit Memory Usage**: Set reasonable limits on cache and buffer sizes
3. **Monitor Usage**: Track memory consumption during development

```typescript
async cleanup(): Promise<void> {
  // Clean up any resources
  if (this.parser) {
    this.parser.dispose();
    this.parser = undefined;
  }
  
  if (this.cache) {
    this.cache.clear();
  }
  
  await super.cleanup();
}
```

## Examples

### Complete Rust Plugin Example

See the full Rust plugin implementation in the [examples directory](./examples/rust-plugin.ts).

### Language Detection Integration

```typescript
// Create detector with custom patterns
const detector = new LanguageDetector({
  customPatterns: {
    'rust': [
      /fn\s+\w+/,
      /struct\s+\w+/,
      /impl\s+/
    ]
  }
});

// Detect language
const result = await detector.detectLanguage('unknown_file', content);
if (result.language === 'rust') {
  // Use Rust plugin
  const plugin = registry.getBestPluginForFile('file.rs');
  const parseResult = await plugin.parse(content, 'file.rs');
}
```

### Custom Validation Rules

```typescript
const validator = new PluginValidator({
  customRules: [{
    name: 'file-size-limit',
    description: 'Check that plugin respects file size limits',
    severity: 'warning',
    validate: async (plugin, metadata) => {
      const maxSize = metadata.capabilities.maxFileSize;
      return {
        passed: maxSize !== undefined && maxSize <= 10 * 1024 * 1024,
        message: maxSize > 10 * 1024 * 1024 ? 'File size limit too large' : undefined
      };
    }
  }]
});
```

## API Reference

### Core Types

#### `PluginMetadata`
```typescript
interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  languages: SupportedLanguage[];
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  dependencies?: string[];
  minCoreVersion?: string;
  capabilities: PluginCapabilities;
}
```

#### `PluginCapabilities`
```typescript
interface PluginCapabilities {
  incremental: boolean;
  syntaxHighlighting: boolean;
  codeCompletion: boolean;
  diagnostics: boolean;
  formatting: boolean;
  refactoring: boolean;
  maxFileSize?: number;
  fileExtensions: string[];
  mimeTypes: string[];
}
```

#### `ParseResult`
```typescript
interface ParseResult {
  ast?: ASTNode;
  symbols: Symbol[];
  imports: Array<{ from: string; items: string[] }>;
  exports: Array<{ name: string; type: string }>;
  errors: Array<{ message: string; position?: { line: number; column: number } }>;
  language: SupportedLanguage;
}
```

#### `Symbol`
```typescript
interface Symbol {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'enum' | 'type' | 'import' | 'export';
  position: { line: number; column: number };
  scope: 'global' | 'module' | 'class' | 'function' | 'block';
  exported: boolean;
  imported?: { from: string; as?: string };
}
```

### Plugin Registry Methods

#### `register(plugin, config?)`
Register a plugin instance with optional configuration.

#### `unregister(pluginId)`
Unregister a plugin by its ID.

#### `getBestPluginForFile(filePath, content?)`
Find the most suitable plugin for a given file.

#### `discoverPlugins(searchPaths)`
Discover plugins in specified directories.

#### `loadPlugin(pluginPath, options?)`
Load a plugin from a file path.

### Language Detector Methods

#### `detectLanguage(filePath, content?)`
Detect the language of a file based on path and content.

#### `detectLanguages(files)`
Batch detect languages for multiple files.

#### `getSupportedExtensions()`
Get list of all supported file extensions.

### Plugin Validator Methods

#### `validatePlugin(plugin)`
Validate a single plugin comprehensively.

#### `validatePlugins(plugins)`
Batch validate multiple plugins.

---

For more examples and detailed implementation guidance, see the existing plugin implementations:
- [TypeScript Plugin](./typescript-plugin.ts)
- [Python Plugin](./python-plugin.ts)  
- [Go Plugin](./go-plugin.ts)

For questions or contributions, please refer to the main project documentation or open an issue on the GitHub repository.