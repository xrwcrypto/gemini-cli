# FileOperations Plugin System

This directory contains the comprehensive plugin system for the FileOperations tool, enabling extensible language support for the Gemini CLI with community contribution capabilities.

## Overview

The plugin system provides a robust, extensible architecture for language-specific code analysis with the following capabilities:

- **Advanced Language Parsing** - Extract symbols, imports, exports, and semantic information
- **High-Performance Processing** - Incremental parsing, caching, and parallel execution
- **Rich IDE Features** - Syntax highlighting, code completion, diagnostics, and formatting
- **Multi-Language Projects** - Intelligent detection and analysis of polyglot codebases
- **Community Extensions** - Full plugin development toolkit and validation framework
- **Production Ready** - Comprehensive testing, security validation, and performance monitoring

## Architecture Highlights

### 🏗️ Core Components

- **BaseLanguagePlugin**: Abstract foundation with common functionality and lifecycle management
- **PluginRegistry**: Advanced plugin discovery, registration, validation, and lifecycle management
- **Enhanced Validator**: Security scanning, performance testing, and quality assurance
- **Language Detection**: Multi-strategy detection with project pattern analysis
- **Test Framework**: Comprehensive testing utilities with benchmarking and validation

### 🔧 Development Tools

- **Plugin CLI**: Scaffolding tool with multiple templates (basic, regex-based, tree-sitter, language-server)
- **Test Suite**: Automated testing with performance benchmarks and validation
- **Migration Tools**: Version management and backward compatibility utilities
- **Documentation Generator**: Automated API documentation and examples

## Built-in Language Support

### TypeScript/JavaScript Plugin ⭐
- **Features**: Full TypeScript Compiler API integration, enhanced parsing capabilities
- **Advanced**: Semantic tokens, type checking, import resolution, code completion
- **Files**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
- **Performance**: Tree-sitter integration available, incremental parsing optimized

### Python Plugin 🐍
- **Features**: Comprehensive AST parsing, type annotation support, virtual environment awareness
- **Advanced**: Decorators, async/await, comprehensions, dataclasses
- **Files**: `.py`, `.pyi`, `.pyw`
- **Integrations**: Standard library detection, package resolution

### Go Plugin 🐹
- **Features**: Complete Go parsing with packages, structs, interfaces, methods
- **Advanced**: Receiver methods, embedded interfaces, module resolution, export detection
- **Files**: `.go`
- **Specifics**: Go-specific patterns, standard library classification

## Enhanced Capabilities

### 🚀 Performance Features

- **Parallel Processing**: Multi-threaded parsing with dependency-aware scheduling
- **Intelligent Caching**: Content-based caching with TTL and memory management  
- **Incremental Updates**: Tree-sitter integration for minimal reparsing
- **Memory Management**: Resource monitoring and automatic cleanup

### 🔍 Project Analysis

- **Multi-Language Detection**: Content-based analysis with confidence scoring
- **Project Patterns**: Automatic detection of full-stack, microservices, monorepo architectures
- **Language Distribution**: Diversity metrics and consolidation recommendations
- **Tooling Suggestions**: Context-aware development tool recommendations

### 🛡️ Security & Quality

- **Security Scanning**: Pattern detection for potentially dangerous code
- **Performance Validation**: Automated benchmarking and threshold enforcement
- **Quality Metrics**: Code complexity analysis and best practice validation
- **Compliance Checking**: License validation and dependency scanning

## Quick Start

### 🏃‍♂️ Using Existing Plugins

```typescript
import { PluginRegistry, LanguageDetector } from './plugins';

// Initialize registry with built-in plugins
const registry = new PluginRegistry();
await registry.register(createTypeScriptPlugin());
await registry.register(createPythonPlugin());
await registry.register(createGoPlugin());

// Intelligent file analysis
const detector = new LanguageDetector();
const result = await detector.detectLanguage('app.ts', content);
console.log(`Detected: ${result.language} (${result.confidence})`);

// Get best plugin and parse
const plugin = registry.getBestPluginForFile('app.ts', content);
const parseResult = await plugin.parse(content, 'app.ts');
console.log(`Found ${parseResult.symbols.length} symbols`);
```

### 🛠️ Creating New Plugins

#### Option 1: Plugin CLI (Recommended)
```bash
# Interactive creation
npx @gemini-cli/plugin-cli interactive

# Direct creation
npx @gemini-cli/plugin-cli create \
  --name "Rust Language Plugin" \
  --id "rust-language-plugin" \
  --languages rust \
  --extensions .rs,.rlib \
  --template tree-sitter \
  --capabilities parsing,diagnostics,formatting
```

#### Option 2: Manual Development
```typescript
import { BaseLanguagePlugin, PluginMetadata } from './base-plugin';

export class RustPlugin extends BaseLanguagePlugin {
  getMetadata(): PluginMetadata {
    return {
      id: 'rust-language-plugin',
      name: 'Rust Language Plugin',
      version: '1.0.0',
      description: 'Comprehensive Rust language support with tree-sitter',
      languages: ['rust'],
      capabilities: {
        incremental: true,
        syntaxHighlighting: true,
        diagnostics: true,
        formatting: true,
        // ... more capabilities
      }
    };
  }

  async parse(content: string, filePath: string): Promise<ParseResult> {
    // Implementation using tree-sitter, regex, or language server
    return {
      symbols: this.extractSymbols(content),
      imports: this.extractImports(content),
      exports: this.extractExports(content),
      // ... more parsing results
    };
  }
}
```

### 🧪 Testing Your Plugin

```typescript
import { PluginTestSuite, PluginValidator } from './plugin-test-utils';

// Comprehensive testing
const testSuite = new PluginTestSuite();
const plugin = new RustPlugin();

// Generate standard test cases
const testCases = PluginTestSuite.generateStandardTestCases('rust');

// Run full test suite
const results = await testSuite.runTests({
  plugin,
  testCases,
  validation: { strict: true, performanceThreshold: 100 }
});

console.log(`Tests: ${results.summary.passedTests}/${results.summary.totalTests} passed`);

// Performance benchmarking
const benchmarks = PluginTestSuite.generateBenchmarkCases('rust');
const perfResults = await testSuite.benchmark({
  plugin,
  benchmarks,
  iterations: 100,
  warmupIterations: 10
});
```

## Project Analysis Features

### 🔍 Multi-Language Project Analysis

```typescript
import { LanguageDetector, ProjectLanguageAnalyzer } from './language-detection';

const detector = new LanguageDetector();
const analyzer = new ProjectLanguageAnalyzer();

// Analyze entire project
const projectFiles = [
  { path: 'frontend/app.tsx', content: '...' },
  { path: 'backend/main.go', content: '...' },
  { path: 'scripts/deploy.py', content: '...' }
];

const analysis = await detector.analyzeProject(projectFiles);

console.log(`Primary language: ${analysis.primaryLanguage}`);
console.log(`Languages found: ${analysis.languages.length}`);
console.log(`Detected patterns: ${analysis.patterns.map(p => p.type).join(', ')}`);

// Get recommendations
for (const rec of analysis.recommendations) {
  console.log(`${rec.priority}: ${rec.description}`);
  console.log(`Actions: ${rec.actions.join(', ')}`);
}
```

### 📊 Language Distribution Analysis

```typescript
const distribution = await analyzer.analyzeLanguageDistribution(projectFiles);

console.log(`Project diversity: ${distribution.diversity.classification}`);
console.log(`Primary language dominance: ${distribution.diversity.primaryDominance}%`);

// Review suggestions
for (const suggestion of distribution.suggestions) {
  console.log(`${suggestion.type}: ${suggestion.description}`);
  console.log(`Rationale: ${suggestion.rationale}`);
}
```

## Advanced Features

### 🔒 Security & Validation

```typescript
import { PluginValidator, PluginSecurityValidator } from './plugin-validator';

// Enhanced validation with custom rules
const validator = new PluginValidator({
  strict: true,
  customRules: [{
    name: 'performance-check',
    severity: 'warning',
    validate: async (plugin, metadata) => {
      // Custom validation logic
      return { passed: true };
    }
  }]
});

const result = await validator.validatePlugin(plugin);
console.log(`Validation: ${result.valid ? 'PASSED' : 'FAILED'}`);
console.log(`Performance: ${result.metrics.validationTimeMs}ms`);
```

### ⚡ Performance Monitoring

```typescript
import { PluginRegistry } from './plugin-registry';

const registry = new PluginRegistry();

// Monitor plugin performance
registry.on('plugin-performance', (metadata, metrics) => {
  if (metrics.avgParseTime > 100) {
    console.warn(`Slow plugin: ${metadata.id} (${metrics.avgParseTime}ms)`);
  }
});

// Error monitoring
registry.on('plugin-error', (metadata, error) => {
  console.error(`Plugin error: ${metadata.id}`, error);
});
```

## Enhanced TypeScript Plugin Features

### Advanced Type Analysis
```typescript
import { createEnhancedTypeScriptPlugin } from './typescript-enhanced-plugin';

const plugin = createEnhancedTypeScriptPlugin();

// Get detailed type information at a specific position
const typeInfo = await plugin.getEnhancedTypeInfo(
  '/path/to/file.ts',
  content,
  { line: 10, column: 5 }
);
console.log('Type:', typeInfo.type);
console.log('Documentation:', typeInfo.documentation);
console.log('Properties:', typeInfo.properties);

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
```

### Type-aware Refactoring
```typescript
// Find all references to a symbol
const references = await plugin.findReferences(
  '/project/src/user.service.ts',
  content,
  { line: 5, column: 15 }
);

// Rename symbol across all files
for (const ref of references) {
  // Apply rename operation using FileOperations edit functionality
  // This ensures type-safe refactoring across the entire codebase
}
```

## Documentation

### 📚 Comprehensive Guides

- **[Plugin API Guide](./PLUGIN_API_GUIDE.md)**: Complete development reference with examples
- **[Plugin Lifecycle Guide](./PLUGIN_LIFECYCLE_GUIDE.md)**: Lifecycle management, versioning, and migration
- **[Supported Languages](./SUPPORTED_LANGUAGES.md)**: Current language support matrix and roadmap

### 🎯 Quick References

- **Templates**: Basic, regex-based, tree-sitter, language-server integration patterns
- **Testing**: Unit tests, integration tests, performance benchmarks, validation
- **Security**: Pattern detection, vulnerability scanning, safe execution
- **Performance**: Caching strategies, incremental parsing, memory management

## File Structure

```
plugins/
├── 📄 README.md                          # This overview
├── 📄 PLUGIN_API_GUIDE.md               # Comprehensive development guide  
├── 📄 PLUGIN_LIFECYCLE_GUIDE.md         # Lifecycle and migration guide
├── 📄 SUPPORTED_LANGUAGES.md            # Language support matrix
│
├── 🏗️ Core Architecture
│   ├── base-plugin.ts                   # Foundation classes and interfaces
│   ├── plugin-registry.ts               # Plugin management and discovery
│   ├── plugin-validator.ts              # Security and quality validation
│   └── language-detection.ts            # Multi-strategy language detection
│
├── 🛠️ Development Tools  
│   ├── plugin-cli.ts                    # Scaffolding and development CLI
│   ├── plugin-test-utils.ts             # Testing framework and utilities
│   └── cross-language-integration.test.ts # Integration test suite
│
├── 🌐 Language Plugins
│   ├── typescript-plugin.ts             # TypeScript/JavaScript support
│   ├── typescript-enhanced-plugin.ts    # Advanced TypeScript features
│   ├── python-plugin.ts                 # Python language support
│   ├── go-plugin.ts                     # Go language support
│   └── index.ts                         # Plugin exports and registration
│
└── 🧪 Test Files
    ├── plugin-loader.test.ts            # Plugin loading tests
    ├── typescript-plugin.test.ts        # TypeScript plugin tests
    ├── python-plugin.test.ts            # Python plugin tests
    └── go-plugin.test.ts               # Go plugin tests
```

## Contributing

### 🤝 Community Contributions

We welcome community contributions! The plugin system is designed for extensibility:

1. **Follow Development Guide**: Use the [Plugin API Guide](./PLUGIN_API_GUIDE.md)
2. **Use Plugin CLI**: Start with `npx @gemini-cli/plugin-cli interactive`
3. **Comprehensive Testing**: Include unit tests, integration tests, and benchmarks
4. **Security Review**: All plugins undergo security validation
5. **Documentation**: Provide examples, migration guides, and API documentation

### 🎯 Contribution Areas

- **New Language Support**: Add parsers for additional programming languages
- **Enhanced Features**: Improve existing plugins with advanced capabilities  
- **Performance Optimization**: Optimize parsing algorithms and caching strategies
- **Testing & Validation**: Enhance test coverage and validation rules
- **Documentation**: Improve guides, examples, and API documentation
- **Tooling**: Develop better development and debugging tools

### 🏆 Quality Standards

- **Security**: All code undergoes security scanning and validation
- **Performance**: Must meet performance benchmarks and memory usage limits
- **Testing**: Requires >80% test coverage with comprehensive test suites
- **Documentation**: Must include JSDoc comments and usage examples
- **Compatibility**: Must maintain backward compatibility and migration paths

For detailed contribution guidelines, see the [Plugin API Guide](./PLUGIN_API_GUIDE.md) and [Plugin Lifecycle Guide](./PLUGIN_LIFECYCLE_GUIDE.md).

## Legacy Plugin Architecture

The system maintains backward compatibility with the existing plugin architecture while providing enhanced capabilities through the new plugin system. Legacy plugins continue to work seamlessly alongside new plugins.

### Enhanced Interface Compatibility

```typescript
// Legacy interface (still supported)
interface LanguageParser {
  parse(content: string, filePath: string): Promise<ParseResult>;
  supportsIncremental(): boolean;
  parseIncremental(content: string, filePath: string, previousTree?: unknown): Promise<ParseResult>;
}

// Enhanced interface (new capabilities)
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

This ensures existing integrations continue to work while enabling new capabilities for enhanced plugins.