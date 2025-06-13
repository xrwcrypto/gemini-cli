/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SupportedLanguage } from '../services/ast-parser.js';

/**
 * Plugin scaffold configuration
 */
export interface PluginScaffoldConfig {
  /** Plugin name */
  name: string;
  /** Plugin ID */
  id: string;
  /** Plugin description */
  description: string;
  /** Author information */
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  /** Target languages */
  languages: SupportedLanguage[];
  /** File extensions */
  fileExtensions: string[];
  /** Plugin capabilities */
  capabilities: {
    incremental: boolean;
    syntaxHighlighting: boolean;
    codeCompletion: boolean;
    diagnostics: boolean;
    formatting: boolean;
    refactoring: boolean;
  };
  /** Output directory */
  outputDir: string;
  /** Include tests */
  includeTests: boolean;
  /** Include examples */
  includeExamples: boolean;
}

/**
 * Plugin template type
 */
export type PluginTemplate = 'basic' | 'regex-based' | 'tree-sitter' | 'language-server';

/**
 * Plugin CLI utility for scaffolding new plugins
 */
export class PluginCLI {
  
  /**
   * Create a new plugin from scratch
   */
  static async createPlugin(config: PluginScaffoldConfig, template: PluginTemplate = 'basic'): Promise<void> {
    const pluginDir = path.join(config.outputDir, `${config.id}-plugin`);
    
    // Create plugin directory
    await fs.mkdir(pluginDir, { recursive: true });
    
    // Generate plugin files
    await this.generatePluginFile(pluginDir, config, template);
    await this.generateTestFile(pluginDir, config);
    await this.generatePackageJson(pluginDir, config);
    await this.generateReadme(pluginDir, config);
    
    if (config.includeExamples) {
      await this.generateExamples(pluginDir, config);
    }
    
    console.log(`✅ Plugin '${config.name}' created successfully at ${pluginDir}`);
    console.log('\nNext steps:');
    console.log(`1. cd ${pluginDir}`);
    console.log('2. npm install');
    console.log('3. npm test');
    console.log('4. Implement your language parsing logic in the parse() method');
  }

  /**
   * Generate the main plugin file
   */
  private static async generatePluginFile(
    pluginDir: string, 
    config: PluginScaffoldConfig, 
    template: PluginTemplate
  ): Promise<void> {
    const pluginContent = this.getPluginTemplate(config, template);
    await fs.writeFile(path.join(pluginDir, `${config.id}.ts`), pluginContent);
  }

  /**
   * Generate test file
   */
  private static async generateTestFile(pluginDir: string, config: PluginScaffoldConfig): Promise<void> {
    const testContent = this.getTestTemplate(config);
    await fs.writeFile(path.join(pluginDir, `${config.id}.test.ts`), testContent);
  }

  /**
   * Generate package.json
   */
  private static async generatePackageJson(pluginDir: string, config: PluginScaffoldConfig): Promise<void> {
    const packageJson = {
      name: `${config.id}-plugin`,
      version: '1.0.0',
      description: config.description,
      main: `${config.id}.js`,
      types: `${config.id}.d.ts`,
      scripts: {
        build: 'tsc',
        test: 'vitest run',
        'test:watch': 'vitest',
        lint: 'eslint src/**/*.ts',
        'type-check': 'tsc --noEmit'
      },
      keywords: [
        'gemini-cli',
        'plugin',
        'language-parser',
        ...config.languages
      ],
      author: config.author,
      license: 'Apache-2.0',
      dependencies: {
        '@types/node': '^18.0.0'
      },
      devDependencies: {
        'typescript': '^4.9.0',
        'vitest': '^0.30.0',
        'eslint': '^8.0.0',
        '@typescript-eslint/eslint-plugin': '^5.0.0',
        '@typescript-eslint/parser': '^5.0.0'
      },
      peerDependencies: {
        'gemini-cli': '^1.0.0'
      }
    };

    await fs.writeFile(
      path.join(pluginDir, 'package.json'), 
      JSON.stringify(packageJson, null, 2)
    );
  }

  /**
   * Generate README.md
   */
  private static async generateReadme(pluginDir: string, config: PluginScaffoldConfig): Promise<void> {
    const readmeContent = `# ${config.name}

${config.description}

## Supported Languages

${config.languages.map(lang => `- ${lang}`).join('\n')}

## File Extensions

${config.fileExtensions.map(ext => `- ${ext}`).join('\n')}

## Capabilities

${Object.entries(config.capabilities)
  .map(([key, value]) => `- ${key}: ${value ? '✅' : '❌'}`)
  .join('\n')}

## Installation

\`\`\`bash
npm install ${config.id}-plugin
\`\`\`

## Usage

\`\`\`typescript
import { ${this.toPascalCase(config.id)}Plugin } from './${config.id}';

const plugin = new ${this.toPascalCase(config.id)}Plugin();
const result = await plugin.parse(content, filePath);
\`\`\`

## Development

\`\`\`bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Type check
npm run type-check
\`\`\`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for your changes
5. Ensure all tests pass
6. Submit a pull request

## License

Apache-2.0

## Author

${config.author.name}${config.author.email ? ` <${config.author.email}>` : ''}
`;

    await fs.writeFile(path.join(pluginDir, 'README.md'), readmeContent);
  }

  /**
   * Generate examples
   */
  private static async generateExamples(pluginDir: string, config: PluginScaffoldConfig): Promise<void> {
    const examplesDir = path.join(pluginDir, 'examples');
    await fs.mkdir(examplesDir, { recursive: true });

    // Generate example files for each supported language
    for (const language of config.languages) {
      const exampleContent = this.getExampleContent(language);
      const extension = config.fileExtensions.find(ext => 
        this.getLanguageForExtension(ext) === language
      ) || config.fileExtensions[0];
      
      await fs.writeFile(
        path.join(examplesDir, `example${extension}`),
        exampleContent
      );
    }

    // Generate usage example
    const usageExample = `/**
 * Example usage of ${config.name}
 */

import { ${this.toPascalCase(config.id)}Plugin } from '../${config.id}';

async function main() {
  const plugin = new ${this.toPascalCase(config.id)}Plugin();
  
  // Initialize the plugin
  await plugin.initialize({
    enabled: true,
    settings: {},
    timeout: 30000
  });

  // Parse example files
  const fs = require('fs').promises;
  
${config.languages.map(language => {
  const extension = config.fileExtensions.find(ext => 
    this.getLanguageForExtension(ext) === language
  ) || config.fileExtensions[0];
  
  return `  // Parse ${language} file
  const ${language}Content = await fs.readFile('./example${extension}', 'utf-8');
  const ${language}Result = await plugin.parse(${language}Content, 'example${extension}');
  console.log('${language.charAt(0).toUpperCase() + language.slice(1)} symbols:', ${language}Result.symbols.length);`;
}).join('\n\n')}

  // Cleanup
  await plugin.cleanup();
}

main().catch(console.error);
`;

    await fs.writeFile(path.join(examplesDir, 'usage.ts'), usageExample);
  }

  /**
   * Get plugin template based on type
   */
  private static getPluginTemplate(config: PluginScaffoldConfig, template: PluginTemplate): string {
    const className = this.toPascalCase(config.id);
    
    switch (template) {
      case 'regex-based':
        return this.getRegexBasedTemplate(config, className);
      case 'tree-sitter':
        return this.getTreeSitterTemplate(config, className);
      case 'language-server':
        return this.getLanguageServerTemplate(config, className);
      default:
        return this.getBasicTemplate(config, className);
    }
  }

  /**
   * Get basic plugin template
   */
  private static getBasicTemplate(config: PluginScaffoldConfig, className: string): string {
    return `/**
 * @license
 * Copyright 2025 ${config.author.name}
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  BaseLanguagePlugin, 
  PluginMetadata, 
  PluginConfiguration,
  PluginValidationResult
} from '@gemini-cli/core/tools/file-operations/plugins/base-plugin';
import { 
  ParseResult, 
  Symbol, 
  SupportedLanguage 
} from '@gemini-cli/core/tools/file-operations/services/ast-parser';
import { CacheManager } from '@gemini-cli/core/tools/file-operations/services/cache-manager';

/**
 * ${config.name}
 */
export class ${className}Plugin extends BaseLanguagePlugin {
  
  /**
   * Get plugin metadata
   */
  getMetadata(): PluginMetadata {
    return {
      id: '${config.id}',
      name: '${config.name}',
      version: '1.0.0',
      description: '${config.description}',
      languages: ${JSON.stringify(config.languages)},
      author: ${JSON.stringify(config.author, null, 6)},
      capabilities: {
        incremental: ${config.capabilities.incremental},
        syntaxHighlighting: ${config.capabilities.syntaxHighlighting},
        codeCompletion: ${config.capabilities.codeCompletion},
        diagnostics: ${config.capabilities.diagnostics},
        formatting: ${config.capabilities.formatting},
        refactoring: ${config.capabilities.refactoring},
        maxFileSize: 5 * 1024 * 1024, // 5MB
        fileExtensions: ${JSON.stringify(config.fileExtensions)},
        mimeTypes: ${JSON.stringify(this.getMimeTypesForLanguages(config.languages))}
      }
    };
  }

  /**
   * Parse source code
   */
  async parse(content: string, filePath: string): Promise<ParseResult> {
    const result: ParseResult = {
      ast: undefined,
      symbols: [],
      imports: [],
      exports: [],
      errors: [],
      language: this.detectLanguage(filePath) || '${config.languages[0]}'
    };

    try {
      // TODO: Implement your parsing logic here
      
      // Example: Extract functions using regex
      this.extractFunctions(content, result);
      
      // Example: Extract imports
      this.extractImports(content, result);
      
      // Example: Extract exports
      this.extractExports(content, result);
      
    } catch (error) {
      result.errors.push({
        message: \`Parsing error: \${error instanceof Error ? error.message : String(error)}\`,
        position: { line: 1, column: 1 }
      });
    }

    return result;
  }

  /**
   * Extract functions from content
   */
  private extractFunctions(content: string, result: ParseResult): void {
    // TODO: Implement function extraction for your language
    // This is a basic example - customize for your language syntax
    
    const functionRegex = /function\\s+(\\w+)\\s*\\(/g;
    const symbols = this.extractSymbolsWithRegex(content, [{
      regex: functionRegex,
      type: 'function',
      scope: 'global',
      exported: false
    }]);
    
    result.symbols.push(...symbols);
  }

  /**
   * Extract imports from content
   */
  private extractImports(content: string, result: ParseResult): void {
    // TODO: Implement import extraction for your language
    // Example for generic import syntax
    
    const importRegex = /import\\s+.*?from\\s+['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      result.imports.push({
        from: match[1],
        items: ['*'] // Simplified - extract actual imported items
      });
    }
  }

  /**
   * Extract exports from content
   */
  private extractExports(content: string, result: ParseResult): void {
    // TODO: Implement export extraction for your language
    // Example for generic export syntax
    
    const exportRegex = /export\\s+(\\w+)\\s+(\\w+)/g;
    let match;
    
    while ((match = exportRegex.exec(content)) !== null) {
      result.exports.push({
        name: match[2],
        type: match[1]
      });
    }
  }

  /**
   * Detect language from file path
   */
  private detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = this.getFileExtension(filePath);
    const metadata = this.getMetadata();
    
    if (metadata.capabilities.fileExtensions.includes(ext)) {
      // Map extension to language
${config.languages.map(lang => {
  const exts = config.fileExtensions.filter(ext => this.getLanguageForExtension(ext) === lang);
  return `      if (${JSON.stringify(exts)}.includes(ext)) return '${lang}';`;
}).join('\n')}
    }
    
    return null;
  }

  /**
   * Additional validation
   */
  protected async onValidate(result: PluginValidationResult): Promise<void> {
    // TODO: Add custom validation logic for your plugin
    
    // Example: Test basic parsing
    try {
      const testContent = this.getTestContent();
      const parseResult = await this.parse(testContent, \`test\${this.getMetadata().capabilities.fileExtensions[0]}\`);
      
      if (parseResult.errors.length > 0) {
        result.warnings.push('Basic parsing test produced errors');
      }
    } catch (error) {
      result.errors.push(\`Validation parsing failed: \${error instanceof Error ? error.message : String(error)}\`);
      result.valid = false;
    }
  }

  /**
   * Get test content for validation
   */
  private getTestContent(): string {
    // TODO: Return appropriate test content for your language
    return 'function test() { return "hello"; }';
  }
}

/**
 * Create plugin instance
 */
export function create${className}Plugin(cacheManager?: CacheManager): ${className}Plugin {
  return new ${className}Plugin(cacheManager);
}

/**
 * Default export for dynamic loading
 */
export default create${className}Plugin;
`;
  }

  /**
   * Get regex-based template
   */
  private static getRegexBasedTemplate(config: PluginScaffoldConfig, className: string): string {
    // Return a more sophisticated regex-based template
    return this.getBasicTemplate(config, className).replace(
      '// TODO: Implement your parsing logic here',
      `// Regex-based parsing implementation
      this.parseWithRegex(content, result);`
    ).replace(
      '  /**',
      `  /**
   * Parse using regex patterns
   */
  private parseWithRegex(content: string, result: ParseResult): void {
    // Define regex patterns for your language constructs
    const patterns = [
      {
        name: 'functions',
        regex: /function\\s+(\\w+)\\s*\\([^)]*\\)/g,
        extract: (match: RegExpExecArray) => ({
          name: match[1],
          type: 'function' as const,
          position: this.getLineColumn(content, match.index),
          scope: 'global' as const,
          exported: content.substring(Math.max(0, match.index - 20), match.index).includes('export')
        })
      }
      // Add more patterns as needed
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        const symbol = pattern.extract(match);
        result.symbols.push(symbol);
      }
    }
  }

  /**
   * Get line and column from string index
   */
  private getLineColumn(content: string, index: number): { line: number; column: number } {
    const beforeIndex = content.substring(0, index);
    const lines = beforeIndex.split('\\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1
    };
  }

  /**`
    );
  }

  /**
   * Get tree-sitter template
   */
  private static getTreeSitterTemplate(config: PluginScaffoldConfig, className: string): string {
    return `/**
 * @license
 * Copyright 2025 ${config.author.name}
 * SPDX-License-Identifier: Apache-2.0
 */

// Note: This template requires tree-sitter integration
// Install tree-sitter: npm install tree-sitter tree-sitter-${config.languages[0]}

import { 
  BaseLanguagePlugin, 
  PluginMetadata 
} from '@gemini-cli/core/tools/file-operations/plugins/base-plugin';
import { ParseResult } from '@gemini-cli/core/tools/file-operations/services/ast-parser';

// TODO: Import appropriate tree-sitter parser
// import Parser from 'tree-sitter';
// import Language from 'tree-sitter-${config.languages[0]}';

/**
 * ${config.name} with Tree-sitter integration
 */
export class ${className}Plugin extends BaseLanguagePlugin {
  // private parser?: Parser;

  getMetadata(): PluginMetadata {
    // ... metadata implementation
  }

  async parse(content: string, filePath: string): Promise<ParseResult> {
    // TODO: Implement tree-sitter parsing
    /*
    if (!this.parser) {
      this.parser = new Parser();
      this.parser.setLanguage(Language);
    }

    const tree = this.parser.parse(content);
    return this.convertTreeToParseResult(tree, content);
    */
    
    throw new Error('Tree-sitter integration not implemented yet');
  }

  // TODO: Implement tree traversal and conversion methods
}
`;
  }

  /**
   * Get language server template
   */
  private static getLanguageServerTemplate(config: PluginScaffoldConfig, className: string): string {
    return `/**
 * @license
 * Copyright 2025 ${config.author.name}
 * SPDX-License-Identifier: Apache-2.0
 */

// Note: This template integrates with language servers
// Requires language server protocol implementation

import { 
  BaseLanguagePlugin, 
  PluginMetadata,
  CompletionItem,
  Diagnostic,
  SyntaxToken
} from '@gemini-cli/core/tools/file-operations/plugins/base-plugin';
import { ParseResult } from '@gemini-cli/core/tools/file-operations/services/ast-parser';

/**
 * ${config.name} with Language Server integration
 */
export class ${className}Plugin extends BaseLanguagePlugin {
  private languageClient?: any; // TODO: Type properly

  getMetadata(): PluginMetadata {
    return {
      // ... standard metadata with enhanced capabilities
      capabilities: {
        incremental: true,
        syntaxHighlighting: true,
        codeCompletion: true,
        diagnostics: true,
        formatting: true,
        refactoring: true,
        // ... other capabilities
      }
    };
  }

  async parse(content: string, filePath: string): Promise<ParseResult> {
    // TODO: Use language server for parsing
    throw new Error('Language server integration not implemented yet');
  }

  // Enhanced capabilities through language server
  async getTokens(content: string, filePath: string): Promise<SyntaxToken[]> {
    // TODO: Implement syntax highlighting via language server
    return [];
  }

  async getCompletions(content: string, position: any, filePath: string): Promise<CompletionItem[]> {
    // TODO: Implement code completion via language server
    return [];
  }

  async getDiagnostics(content: string, filePath: string): Promise<Diagnostic[]> {
    // TODO: Implement diagnostics via language server
    return [];
  }
}
`;
  }

  /**
   * Get test template
   */
  private static getTestTemplate(config: PluginScaffoldConfig): string {
    const className = this.toPascalCase(config.id);
    
    return `/**
 * @license
 * Copyright 2025 ${config.author.name}
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ${className}Plugin, create${className}Plugin } from './${config.id}';

describe('${className}Plugin', () => {
  let plugin: ${className}Plugin;

  beforeEach(() => {
    plugin = create${className}Plugin();
  });

  describe('metadata', () => {
    it('should return correct plugin metadata', () => {
      const metadata = plugin.getMetadata();
      
      expect(metadata.id).toBe('${config.id}');
      expect(metadata.name).toBe('${config.name}');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.description).toBe('${config.description}');
      expect(metadata.languages).toEqual(${JSON.stringify(config.languages)});
      expect(metadata.capabilities.fileExtensions).toEqual(${JSON.stringify(config.fileExtensions)});
    });

    it('should have valid capabilities', () => {
      const metadata = plugin.getMetadata();
      const caps = metadata.capabilities;
      
      expect(typeof caps.incremental).toBe('boolean');
      expect(typeof caps.syntaxHighlighting).toBe('boolean');
      expect(typeof caps.codeCompletion).toBe('boolean');
      expect(typeof caps.diagnostics).toBe('boolean');
      expect(typeof caps.formatting).toBe('boolean');
      expect(typeof caps.refactoring).toBe('boolean');
      expect(Array.isArray(caps.fileExtensions)).toBe(true);
      expect(Array.isArray(caps.mimeTypes)).toBe(true);
    });
  });

  describe('file support', () => {
${config.fileExtensions.map(ext => `    it('should support ${ext} files', () => {
      expect(plugin.supportsFile('test${ext}')).toBe(true);
    });`).join('\n\n')}

    it('should not support unsupported file types', () => {
      expect(plugin.supportsFile('test.xyz')).toBe(false);
      expect(plugin.supportsFile('test.unknown')).toBe(false);
    });
  });

  describe('parsing', () => {
${config.languages.map((language, index) => {
  const ext = config.fileExtensions[index] || config.fileExtensions[0];
  const testContent = this.getExampleContent(language);
  
  return `    it('should parse ${language} content', async () => {
      const content = \`${testContent.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
      const result = await plugin.parse(content, 'test${ext}');
      
      expect(result).toBeDefined();
      expect(result.language).toBe('${language}');
      expect(Array.isArray(result.symbols)).toBe(true);
      expect(Array.isArray(result.imports)).toBe(true);
      expect(Array.isArray(result.exports)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      
      // Add specific assertions for your language
      // expect(result.symbols.length).toBeGreaterThan(0);
    });`;
}).join('\n\n')}

    it('should handle empty content gracefully', async () => {
      const result = await plugin.parse('', 'test${config.fileExtensions[0]}');
      
      expect(result).toBeDefined();
      expect(result.symbols).toEqual([]);
      expect(result.imports).toEqual([]);
      expect(result.exports).toEqual([]);
    });

    it('should handle malformed content gracefully', async () => {
      const malformedContent = 'this is not valid syntax {[}';
      const result = await plugin.parse(malformedContent, 'test${config.fileExtensions[0]}');
      
      expect(result).toBeDefined();
      // Should not throw an error, but may have error entries
    });
  });

  describe('validation', () => {
    it('should validate successfully', async () => {
      const result = await plugin.validate();
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('lifecycle', () => {
    it('should initialize and cleanup properly', async () => {
      await expect(plugin.initialize({
        enabled: true,
        settings: {},
        timeout: 30000
      })).resolves.not.toThrow();

      await expect(plugin.cleanup()).resolves.not.toThrow();
    });
  });

  // TODO: Add more specific tests for your language features
  describe('language-specific features', () => {
    it('should extract language-specific symbols', async () => {
      // TODO: Add tests specific to your language constructs
      expect(true).toBe(true); // Placeholder
    });
  });
});
`;
  }

  /**
   * Get example content for a language
   */
  private static getExampleContent(language: SupportedLanguage): string {
    const examples: Record<SupportedLanguage, string> = {
      'typescript': `interface User {
  id: number;
  name: string;
}

export class UserService {
  getUser(id: number): User {
    return { id, name: "John" };
  }
}`,
      'javascript': `function createUser(name) {
  return {
    id: Math.random(),
    name: name
  };
}

module.exports = { createUser };`,
      'python': `class User:
    def __init__(self, name: str):
        self.name = name
    
    def greet(self) -> str:
        return f"Hello, {self.name}!"

def create_user(name: str) -> User:
    return User(name)`,
      'go': `package main

import "fmt"

type User struct {
    ID   int
    Name string
}

func (u User) Greet() string {
    return fmt.Sprintf("Hello, %s!", u.Name)
}

func main() {
    user := User{ID: 1, Name: "John"}
    fmt.Println(user.Greet())
}`,
      'java': `public class User {
    private int id;
    private String name;
    
    public User(int id, String name) {
        this.id = id;
        this.name = name;
    }
    
    public String greet() {
        return "Hello, " + name + "!";
    }
}`,
      'cpp': `#include <iostream>
#include <string>

class User {
private:
    int id;
    std::string name;
    
public:
    User(int id, const std::string& name) : id(id), name(name) {}
    
    std::string greet() const {
        return "Hello, " + name + "!";
    }
};`,
      'c': `#include <stdio.h>
#include <string.h>

typedef struct {
    int id;
    char name[50];
} User;

void greet(const User* user) {
    printf("Hello, %s!\\n", user->name);
}

int main() {
    User user = {1, "John"};
    greet(&user);
    return 0;
}`,
      'rust': `struct User {
    id: u32,
    name: String,
}

impl User {
    fn new(id: u32, name: String) -> Self {
        User { id, name }
    }
    
    fn greet(&self) -> String {
        format!("Hello, {}!", self.name)
    }
}

fn main() {
    let user = User::new(1, "John".to_string());
    println!("{}", user.greet());
}`,
      'unknown': '// Example content'
    };

    return examples[language] || examples['unknown'];
  }

  /**
   * Get MIME types for languages
   */
  private static getMimeTypesForLanguages(languages: SupportedLanguage[]): string[] {
    const mimeMap: Record<SupportedLanguage, string[]> = {
      'typescript': ['application/typescript', 'text/typescript'],
      'javascript': ['application/javascript', 'text/javascript'],
      'python': ['text/x-python'],
      'go': ['text/x-go'],
      'java': ['text/x-java-source'],
      'cpp': ['text/x-c++'],
      'c': ['text/x-c'],
      'rust': ['text/x-rust'],
      'unknown': []
    };

    return languages.flatMap(lang => mimeMap[lang] || []);
  }

  /**
   * Get language for file extension
   */
  private static getLanguageForExtension(extension: string): SupportedLanguage | null {
    const extMap: Record<string, SupportedLanguage> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.java': 'java',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.rs': 'rust'
    };

    return extMap[extension] || null;
  }

  /**
   * Convert string to PascalCase
   */
  private static toPascalCase(str: string): string {
    return str.replace(/(^|-)([a-z])/g, (_, __, letter) => letter.toUpperCase());
  }

  /**
   * Validate plugin configuration
   */
  static validateConfig(config: PluginScaffoldConfig): string[] {
    const errors: string[] = [];

    if (!config.name) errors.push('Plugin name is required');
    if (!config.id) errors.push('Plugin ID is required');
    if (!config.description) errors.push('Plugin description is required');
    if (!config.author?.name) errors.push('Author name is required');
    if (!config.languages || config.languages.length === 0) errors.push('At least one language is required');
    if (!config.fileExtensions || config.fileExtensions.length === 0) errors.push('At least one file extension is required');
    if (!config.outputDir) errors.push('Output directory is required');

    // Validate ID format
    if (config.id && !/^[a-z0-9-]+$/.test(config.id)) {
      errors.push('Plugin ID must contain only lowercase letters, numbers, and hyphens');
    }

    // Validate file extensions
    if (config.fileExtensions) {
      for (const ext of config.fileExtensions) {
        if (!ext.startsWith('.')) {
          errors.push(`File extension must start with dot: ${ext}`);
        }
      }
    }

    return errors;
  }

  /**
   * Interactive plugin creation wizard
   */
  static async createInteractive(): Promise<void> {
    // This would implement an interactive CLI wizard
    // For now, just show the structure
    console.log('Interactive plugin creation wizard would be implemented here');
    console.log('It would prompt for:');
    console.log('- Plugin name');
    console.log('- Plugin ID');
    console.log('- Description');
    console.log('- Author information');
    console.log('- Target languages');
    console.log('- File extensions');
    console.log('- Capabilities');
    console.log('- Template type');
    console.log('- Output directory');
  }
}

/**
 * CLI entry point
 */
export async function runPluginCLI(args: string[]): Promise<void> {
  const command = args[0];

  switch (command) {
    case 'create':
      // Parse arguments and create plugin
      console.log('Plugin creation command');
      break;
    
    case 'validate':
      // Validate existing plugin
      console.log('Plugin validation command');
      break;
      
    case 'interactive':
      await PluginCLI.createInteractive();
      break;
      
    default:
      console.log('Unknown command. Available commands: create, validate, interactive');
  }
}