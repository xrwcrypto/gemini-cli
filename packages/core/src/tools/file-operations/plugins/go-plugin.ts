/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { 
  BaseLanguagePlugin, 
  PluginMetadata, 
  PluginConfiguration, 
  PluginValidationResult 
} from './base-plugin.js';
import { 
  ParseResult, 
  Symbol, 
  ASTNode, 
  SupportedLanguage 
} from '../services/ast-parser.js';
import { CacheManager } from '../services/cache-manager.js';

/**
 * Go-specific symbol types
 */
export type GoSymbolType = 
  | 'package'
  | 'import'
  | 'function'
  | 'method'
  | 'struct'
  | 'interface'
  | 'type'
  | 'const'
  | 'var'
  | 'field'
  | 'receiver';

/**
 * Go import information
 */
export interface GoImport {
  path: string;
  alias?: string;
  isLocal: boolean;
  isStandard: boolean;
}

/**
 * Go function/method information
 */
export interface GoFunction {
  name: string;
  receiver?: {
    name: string;
    type: string;
    pointer: boolean;
  };
  parameters: Array<{
    name: string;
    type: string;
  }>;
  returns: Array<{
    name?: string;
    type: string;
  }>;
  isExported: boolean;
  isMethod: boolean;
}

/**
 * Go struct information
 */
export interface GoStruct {
  name: string;
  fields: Array<{
    name: string;
    type: string;
    tag?: string;
    isExported: boolean;
  }>;
  methods: string[];
  isExported: boolean;
}

/**
 * Go interface information
 */
export interface GoInterface {
  name: string;
  methods: Array<{
    name: string;
    signature: string;
  }>;
  embedded: string[];
  isExported: boolean;
}

/**
 * Enhanced parse result for Go
 */
export interface GoParseResult extends ParseResult {
  goSpecific: {
    packageName: string;
    imports: GoImport[];
    functions: GoFunction[];
    structs: GoStruct[];
    interfaces: GoInterface[];
    constants: Array<{ name: string; type?: string; value?: string; isExported: boolean }>;
    variables: Array<{ name: string; type?: string; isExported: boolean }>;
    types: Array<{ name: string; underlying: string; isExported: boolean }>;
  };
}

/**
 * Go language plugin
 */
export class GoPlugin extends BaseLanguagePlugin {
  private static readonly GO_KEYWORDS = new Set([
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
    'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
    'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
    'var'
  ]);

  private static readonly STANDARD_PACKAGES = new Set([
    'bufio', 'bytes', 'context', 'crypto', 'database', 'encoding', 'errors',
    'fmt', 'hash', 'html', 'image', 'io', 'log', 'math', 'mime', 'net',
    'os', 'path', 'reflect', 'regexp', 'runtime', 'sort', 'strconv', 'strings',
    'sync', 'syscall', 'testing', 'text', 'time', 'unicode', 'unsafe'
  ]);

  /**
   * Get plugin metadata
   */
  getMetadata(): PluginMetadata {
    return {
      id: 'go-language-plugin',
      name: 'Go Language Plugin',
      version: '1.0.0',
      description: 'Comprehensive Go language support with package, function, struct, and interface parsing',
      languages: ['go'],
      author: {
        name: 'Gemini CLI',
        email: 'support@gemini-cli.dev'
      },
      capabilities: {
        incremental: true,
        syntaxHighlighting: true,
        codeCompletion: false,
        diagnostics: true,
        formatting: false,
        refactoring: false,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        fileExtensions: ['.go'],
        mimeTypes: ['text/x-go']
      }
    };
  }

  /**
   * Parse Go source code
   */
  async parse(content: string, filePath: string): Promise<GoParseResult> {
    const result: GoParseResult = {
      ast: undefined,
      symbols: [],
      imports: [],
      exports: [],
      errors: [],
      language: 'go' as SupportedLanguage,
      goSpecific: {
        packageName: '',
        imports: [],
        functions: [],
        structs: [],
        interfaces: [],
        constants: [],
        variables: [],
        types: []
      }
    };

    try {
      // Parse package declaration
      await this.parsePackage(content, result);
      
      // Parse imports
      await this.parseImports(content, result);
      
      // Parse functions and methods
      await this.parseFunctions(content, result);
      
      // Parse structs
      await this.parseStructs(content, result);
      
      // Parse interfaces
      await this.parseInterfaces(content, result);
      
      // Parse constants
      await this.parseConstants(content, result);
      
      // Parse variables
      await this.parseVariables(content, result);
      
      // Parse type declarations
      await this.parseTypes(content, result);
      
      // Build symbols array from parsed elements
      this.buildSymbols(result);
      
      // Build imports/exports arrays
      this.buildImportsExports(result);

    } catch (error) {
      result.errors.push({
        message: `Go parsing error: ${error instanceof Error ? error.message : String(error)}`,
        position: { line: 1, column: 1 }
      });
    }

    return result;
  }

  /**
   * Parse package declaration
   */
  private async parsePackage(content: string, result: GoParseResult): Promise<void> {
    const packageRegex = /^package\s+(\w+)/m;
    const match = content.match(packageRegex);
    
    if (match) {
      result.goSpecific.packageName = match[1];
    } else {
      result.errors.push({
        message: 'No package declaration found',
        position: { line: 1, column: 1 }
      });
    }
  }

  /**
   * Parse import declarations
   */
  private async parseImports(content: string, result: GoParseResult): Promise<void> {
    // Single import: import "path"
    const singleImportRegex = /import\s+"([^"]+)"/g;
    
    // Aliased import: import alias "path"
    const aliasedImportRegex = /import\s+(\w+)\s+"([^"]+)"/g;
    
    // Block imports: import ( ... )
    const blockImportRegex = /import\s*\(\s*([\s\S]*?)\s*\)/g;

    let match;

    // Parse single imports
    while ((match = singleImportRegex.exec(content)) !== null) {
      const importPath = match[1];
      const goImport = this.createGoImport(importPath);
      result.goSpecific.imports.push(goImport);
    }

    // Parse aliased imports
    while ((match = aliasedImportRegex.exec(content)) !== null) {
      const alias = match[1];
      const importPath = match[2];
      const goImport = this.createGoImport(importPath, alias);
      result.goSpecific.imports.push(goImport);
    }

    // Parse block imports
    while ((match = blockImportRegex.exec(content)) !== null) {
      const importBlock = match[1];
      const lines = importBlock.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('//')) continue;

        // Handle aliased imports in block
        const aliasMatch = trimmedLine.match(/^(\w+)\s+"([^"]+)"$/);
        if (aliasMatch) {
          const alias = aliasMatch[1];
          const importPath = aliasMatch[2];
          const goImport = this.createGoImport(importPath, alias);
          result.goSpecific.imports.push(goImport);
          continue;
        }

        // Handle regular imports in block
        const regularMatch = trimmedLine.match(/^"([^"]+)"$/);
        if (regularMatch) {
          const importPath = regularMatch[1];
          const goImport = this.createGoImport(importPath);
          result.goSpecific.imports.push(goImport);
        }
      }
    }
  }

  /**
   * Parse function and method declarations
   */
  private async parseFunctions(content: string, result: GoParseResult): Promise<void> {
    // Function regex: func name(params) returns { ... }
    const functionRegex = /func\s+(?:\(([^)]*)\)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|(\w+(?:\[\w+\])?(?:\.\w+)*)?)?/g;
    
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const receiverPart = match[1];
      const functionName = match[2];
      const paramsPart = match[3] || '';
      const returnsPart = match[4] || match[5] || '';

      const goFunction: GoFunction = {
        name: functionName,
        parameters: this.parseParameters(paramsPart),
        returns: this.parseReturns(returnsPart),
        isExported: this.isExported(functionName),
        isMethod: !!receiverPart
      };

      if (receiverPart) {
        goFunction.receiver = this.parseReceiver(receiverPart);
      }

      result.goSpecific.functions.push(goFunction);
    }
  }

  /**
   * Parse struct declarations
   */
  private async parseStructs(content: string, result: GoParseResult): Promise<void> {
    const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/g;
    
    let match;
    while ((match = structRegex.exec(content)) !== null) {
      const structName = match[1];
      const fieldsContent = match[2];

      const goStruct: GoStruct = {
        name: structName,
        fields: this.parseStructFields(fieldsContent),
        methods: [], // Methods will be identified from functions with receivers
        isExported: this.isExported(structName)
      };

      result.goSpecific.structs.push(goStruct);
    }

    // Associate methods with structs
    for (const func of result.goSpecific.functions) {
      if (func.receiver) {
        const struct = result.goSpecific.structs.find(s => 
          s.name === func.receiver!.type || s.name === func.receiver!.type.replace('*', '')
        );
        if (struct) {
          struct.methods.push(func.name);
        }
      }
    }
  }

  /**
   * Parse interface declarations
   */
  private async parseInterfaces(content: string, result: GoParseResult): Promise<void> {
    const interfaceRegex = /type\s+(\w+)\s+interface\s*\{([^}]*)\}/g;
    
    let match;
    while ((match = interfaceRegex.exec(content)) !== null) {
      const interfaceName = match[1];
      const methodsContent = match[2];

      const goInterface: GoInterface = {
        name: interfaceName,
        methods: this.parseInterfaceMethods(methodsContent),
        embedded: this.parseEmbeddedInterfaces(methodsContent),
        isExported: this.isExported(interfaceName)
      };

      result.goSpecific.interfaces.push(goInterface);
    }
  }

  /**
   * Parse constant declarations
   */
  private async parseConstants(content: string, result: GoParseResult): Promise<void> {
    // Single const: const name = value
    const singleConstRegex = /const\s+(\w+)(?:\s+(\w+(?:\[\w+\])?(?:\.\w+)*))?\s*=\s*([^;\n]+)/g;
    
    // Block const: const ( ... )
    const blockConstRegex = /const\s*\(\s*([\s\S]*?)\s*\)/g;

    let match;

    // Parse single constants
    while ((match = singleConstRegex.exec(content)) !== null) {
      const name = match[1];
      const type = match[2];
      const value = match[3]?.trim();

      result.goSpecific.constants.push({
        name,
        type,
        value,
        isExported: this.isExported(name)
      });
    }

    // Parse block constants
    while ((match = blockConstRegex.exec(content)) !== null) {
      const constBlock = match[1];
      const lines = constBlock.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('//')) continue;

        const constMatch = trimmedLine.match(/^(\w+)(?:\s+(\w+(?:\[\w+\])?(?:\.\w+)*))?\s*=?\s*([^,\n]*)/);
        if (constMatch) {
          const name = constMatch[1];
          const type = constMatch[2];
          const value = constMatch[3]?.trim();

          result.goSpecific.constants.push({
            name,
            type,
            value: value || undefined,
            isExported: this.isExported(name)
          });
        }
      }
    }
  }

  /**
   * Parse variable declarations
   */
  private async parseVariables(content: string, result: GoParseResult): Promise<void> {
    // Single var: var name type = value
    const singleVarRegex = /var\s+(\w+)(?:\s+(\w+(?:\[\w+\])?(?:\.\w+)*))?\s*(?:=\s*[^;\n]+)?/g;
    
    // Block var: var ( ... )
    const blockVarRegex = /var\s*\(\s*([\s\S]*?)\s*\)/g;

    let match;

    // Parse single variables
    while ((match = singleVarRegex.exec(content)) !== null) {
      const name = match[1];
      const type = match[2];

      result.goSpecific.variables.push({
        name,
        type,
        isExported: this.isExported(name)
      });
    }

    // Parse block variables
    while ((match = blockVarRegex.exec(content)) !== null) {
      const varBlock = match[1];
      const lines = varBlock.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('//')) continue;

        const varMatch = trimmedLine.match(/^(\w+)(?:\s+(\w+(?:\[\w+\])?(?:\.\w+)*))?\s*(?:=.*)?$/);
        if (varMatch) {
          const name = varMatch[1];
          const type = varMatch[2];

          result.goSpecific.variables.push({
            name,
            type,
            isExported: this.isExported(name)
          });
        }
      }
    }
  }

  /**
   * Parse type declarations
   */
  private async parseTypes(content: string, result: GoParseResult): Promise<void> {
    const typeRegex = /type\s+(\w+)\s+(?!struct|interface)(.+)/g;
    
    let match;
    while ((match = typeRegex.exec(content)) !== null) {
      const name = match[1];
      const underlying = match[2].trim();

      result.goSpecific.types.push({
        name,
        underlying,
        isExported: this.isExported(name)
      });
    }
  }

  /**
   * Build symbols array from parsed Go elements
   */
  private buildSymbols(result: GoParseResult): void {
    // Add package as symbol
    if (result.goSpecific.packageName) {
      result.symbols.push({
        name: result.goSpecific.packageName,
        type: 'import', // Using 'import' as closest match for package
        position: { line: 1, column: 1 },
        scope: 'global',
        exported: true
      });
    }

    // Add functions as symbols
    for (const func of result.goSpecific.functions) {
      result.symbols.push({
        name: func.name,
        type: 'function',
        position: { line: 1, column: 1 }, // TODO: Track actual positions
        scope: func.isMethod ? 'class' : 'global',
        exported: func.isExported
      });
    }

    // Add structs as symbols
    for (const struct of result.goSpecific.structs) {
      result.symbols.push({
        name: struct.name,
        type: 'class', // Using 'class' as closest match for struct
        position: { line: 1, column: 1 },
        scope: 'global',
        exported: struct.isExported
      });
    }

    // Add interfaces as symbols
    for (const iface of result.goSpecific.interfaces) {
      result.symbols.push({
        name: iface.name,
        type: 'interface',
        position: { line: 1, column: 1 },
        scope: 'global',
        exported: iface.isExported
      });
    }

    // Add types as symbols
    for (const type of result.goSpecific.types) {
      result.symbols.push({
        name: type.name,
        type: 'type',
        position: { line: 1, column: 1 },
        scope: 'global',
        exported: type.isExported
      });
    }
  }

  /**
   * Build imports/exports arrays
   */
  private buildImportsExports(result: GoParseResult): void {
    // Build imports
    for (const goImport of result.goSpecific.imports) {
      const items = goImport.alias ? [goImport.alias] : [path.basename(goImport.path)];
      result.imports.push({
        from: goImport.path,
        items
      });
    }

    // Build exports (all exported symbols)
    const exportedSymbols = result.symbols.filter(symbol => symbol.exported);
    for (const symbol of exportedSymbols) {
      result.exports.push({
        name: symbol.name,
        type: symbol.type
      });
    }
  }

  /**
   * Create Go import object
   */
  private createGoImport(importPath: string, alias?: string): GoImport {
    const isStandard = this.isStandardPackage(importPath);
    const isLocal = !isStandard && (importPath.startsWith('./') || importPath.startsWith('../'));

    return {
      path: importPath,
      alias,
      isLocal,
      isStandard
    };
  }

  /**
   * Check if a package is a standard library package
   */
  private isStandardPackage(packagePath: string): boolean {
    const parts = packagePath.split('/');
    const rootPackage = parts[0];
    return GoPlugin.STANDARD_PACKAGES.has(rootPackage);
  }

  /**
   * Check if an identifier is exported (starts with uppercase letter)
   */
  private isExported(name: string): boolean {
    return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
  }

  /**
   * Parse function parameters
   */
  private parseParameters(paramsPart: string): Array<{ name: string; type: string }> {
    const params: Array<{ name: string; type: string }> = [];
    
    if (!paramsPart.trim()) return params;

    const paramGroups = paramsPart.split(',');
    for (const group of paramGroups) {
      const trimmed = group.trim();
      if (!trimmed) continue;

      // Handle "name type" or just "type"
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const type = parts.slice(1).join(' ');
        params.push({ name, type });
      } else {
        // Just type, generate parameter name
        params.push({ name: `param${params.length}`, type: parts[0] });
      }
    }

    return params;
  }

  /**
   * Parse function return types
   */
  private parseReturns(returnsPart: string): Array<{ name?: string; type: string }> {
    const returns: Array<{ name?: string; type: string }> = [];
    
    if (!returnsPart.trim()) return returns;

    // Handle multiple returns in parentheses
    if (returnsPart.includes(',')) {
      const returnGroups = returnsPart.split(',');
      for (const group of returnGroups) {
        const trimmed = group.trim();
        if (trimmed) {
          returns.push({ type: trimmed });
        }
      }
    } else {
      returns.push({ type: returnsPart.trim() });
    }

    return returns;
  }

  /**
   * Parse receiver information
   */
  private parseReceiver(receiverPart: string): { name: string; type: string; pointer: boolean } {
    const trimmed = receiverPart.trim();
    const parts = trimmed.split(/\s+/);
    
    if (parts.length >= 2) {
      const name = parts[0];
      const type = parts[1];
      return {
        name,
        type: type.startsWith('*') ? type.substring(1) : type,
        pointer: type.startsWith('*')
      };
    }
    
    // Fallback
    return {
      name: 'self',
      type: trimmed.startsWith('*') ? trimmed.substring(1) : trimmed,
      pointer: trimmed.startsWith('*')
    };
  }

  /**
   * Parse struct fields
   */
  private parseStructFields(fieldsContent: string): Array<{
    name: string;
    type: string;
    tag?: string;
    isExported: boolean;
  }> {
    const fields: Array<{ name: string; type: string; tag?: string; isExported: boolean }> = [];
    const lines = fieldsContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // Match field with optional tag: name type `tag`
      const fieldMatch = trimmed.match(/^(\w+)\s+([^`\n]+)(?:`([^`]+)`)?/);
      if (fieldMatch) {
        const name = fieldMatch[1];
        const type = fieldMatch[2].trim();
        const tag = fieldMatch[3];

        fields.push({
          name,
          type,
          tag,
          isExported: this.isExported(name)
        });
      }
    }

    return fields;
  }

  /**
   * Parse interface methods
   */
  private parseInterfaceMethods(methodsContent: string): Array<{ name: string; signature: string }> {
    const methods: Array<{ name: string; signature: string }> = [];
    const lines = methodsContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // Skip embedded interfaces (they don't have parentheses)
      if (!trimmed.includes('(')) continue;

      const methodMatch = trimmed.match(/^(\w+)\s*(\([^)]*\)(?:\s*\([^)]*\)|[^()\s]+)?)/);
      if (methodMatch) {
        const name = methodMatch[1];
        const signature = methodMatch[2];

        methods.push({ name, signature });
      }
    }

    return methods;
  }

  /**
   * Parse embedded interfaces
   */
  private parseEmbeddedInterfaces(methodsContent: string): string[] {
    const embedded: string[] = [];
    const lines = methodsContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // Embedded interfaces don't have parentheses and are just type names
      if (!trimmed.includes('(') && /^\w+$/.test(trimmed)) {
        embedded.push(trimmed);
      }
    }

    return embedded;
  }

  /**
   * Supports incremental parsing
   */
  supportsIncremental(): boolean {
    return true;
  }

  /**
   * Incremental parsing implementation
   */
  async parseIncremental(
    content: string,
    filePath: string,
    previousTree?: unknown
  ): Promise<GoParseResult> {
    // For now, fall back to full parsing
    // In a real implementation, this would use tree-sitter or similar for incremental updates
    return this.parse(content, filePath);
  }
}

/**
 * Create a Go plugin instance
 */
export function createGoPlugin(cacheManager?: CacheManager): GoPlugin {
  return new GoPlugin(cacheManager);
}