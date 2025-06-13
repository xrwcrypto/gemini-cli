/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import { LruCache } from '../../../utils/LruCache.js';
import { CacheManager } from './cache-manager.js';
// import { detectFileType } from '../../../utils/fileUtils.js';
import mime from 'mime-types';
import { createTypeScriptPlugin } from '../plugins/index.js';

/**
 * Supported programming languages
 */
export type SupportedLanguage = 
  | 'typescript'
  | 'javascript' 
  | 'python'
  | 'go'
  | 'java'
  | 'cpp'
  | 'c'
  | 'rust'
  | 'unknown';

/**
 * AST node types (simplified for now, can be extended with tree-sitter)
 */
export interface ASTNode {
  type: string;
  name?: string;
  startPosition: { line: number; column: number };
  endPosition: { line: number; column: number };
  children: ASTNode[];
  text?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Symbol information extracted from AST
 */
export interface Symbol {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'enum' | 'type' | 'import' | 'export';
  position: { line: number; column: number };
  scope: 'global' | 'module' | 'class' | 'function' | 'block';
  exported: boolean;
  imported?: { from: string; as?: string };
}

/**
 * Parsed symbol information (alias for Symbol)
 */
export type ParsedSymbol = Symbol;

/**
 * AST query interface for searching symbols
 */
export interface ASTQuery {
  type?: string;
  namePattern?: string;
  scope?: string;
  exported?: boolean;
}

/**
 * Parse result
 */
export interface ParseResult {
  ast?: ASTNode;
  symbols: Symbol[];
  imports: Array<{ from: string; items: string[] }>;
  exports: Array<{ name: string; type: string }>;
  errors: Array<{ message: string; position?: { line: number; column: number } }>;
  language: SupportedLanguage;
}

/**
 * Parser configuration
 */
export interface ParserConfig {
  enableIncremental?: boolean;
  maxFileSizeBytes?: number;
  timeout?: number;
}

/**
 * Language parser interface (for future tree-sitter integration)
 */
export interface LanguageParser {
  parse(content: string, filePath: string): Promise<ParseResult>;
  supportsIncremental(): boolean;
  parseIncremental(content: string, filePath: string, previousTree?: unknown): Promise<ParseResult>;
}

/**
 * Basic regex-based parser for TypeScript/JavaScript
 * This is a placeholder until tree-sitter integration
 */
class BasicTSJSParser implements LanguageParser {
  async parse(content: string, filePath: string): Promise<ParseResult> {
    const language = filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript';
    const result: ParseResult = {
      symbols: [],
      imports: [],
      exports: [],
      errors: [],
      language
    };

    try {
      // Extract imports
      const importRegex = /import\s+(?:(?:\{([^}]+)\})|(?:(\w+))|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const items = match[1] ? match[1].split(',').map(s => s.trim()) : 
                     match[2] ? [match[2]] : 
                     match[3] ? [`* as ${match[3]}`] : [];
        result.imports.push({ from: match[4], items });
      }

      // Extract function declarations
      const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
      while ((match = functionRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        result.symbols.push({
          name: match[1],
          type: 'function',
          position: { line, column: match.index - content.lastIndexOf('\n', match.index) },
          scope: 'module',
          exported: match[0].includes('export')
        });
      }

      // Extract class declarations
      const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
      while ((match = classRegex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        result.symbols.push({
          name: match[1],
          type: 'class',
          position: { line, column: match.index - content.lastIndexOf('\n', match.index) },
          scope: 'module',
          exported: match[0].includes('export')
        });
      }

      // Extract interface declarations (TypeScript)
      if (result.language === 'typescript') {
        const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
        while ((match = interfaceRegex.exec(content)) !== null) {
          const line = content.substring(0, match.index).split('\n').length;
          result.symbols.push({
            name: match[1],
            type: 'interface',
            position: { line, column: match.index - content.lastIndexOf('\n', match.index) },
            scope: 'module',
            exported: match[0].includes('export')
          });
        }
      }

      // Extract exports
      result.exports = result.symbols
        .filter(s => s.exported)
        .map(s => ({ name: s.name, type: s.type }));

    } catch (error) {
      result.errors.push({
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return result;
  }

  supportsIncremental(): boolean {
    return false;
  }

  async parseIncremental(content: string, filePath: string): Promise<ParseResult> {
    // For now, just do a full parse
    return this.parse(content, filePath);
  }
}

/**
 * AST Parser Service
 * Provides language parsing and AST analysis capabilities
 */
export class ASTParserService {
  private readonly parsers: Map<SupportedLanguage, LanguageParser>;
  private readonly parseCache: LruCache<string, ParseResult>;
  private readonly cacheManager?: CacheManager;
  private readonly config: ParserConfig;

  constructor(
    cacheManager?: CacheManager,
    config: ParserConfig = {}
  ) {
    this.cacheManager = cacheManager;
    this.config = {
      enableIncremental: false,
      maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
      timeout: 5000,
      ...config
    };

    this.parsers = new Map();
    this.parseCache = new LruCache<string, ParseResult>(100);

    // Register parsers
    // Use enhanced TypeScript plugin if available, otherwise fall back to basic parser
    try {
      const tsPlugin = createTypeScriptPlugin(cacheManager);
      this.parsers.set('typescript', tsPlugin);
      this.parsers.set('javascript', tsPlugin);
    } catch (error) {
      // Fall back to basic parser if TypeScript plugin fails to load
      const tsJsParser = new BasicTSJSParser();
      this.parsers.set('typescript', tsJsParser);
      this.parsers.set('javascript', tsJsParser);
    }
  }

  /**
   * Detect language from file path
   */
  detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = mime.lookup(filePath);

    // Check by extension first
    const extensionMap: Record<string, SupportedLanguage> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
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

    if (extensionMap[ext]) {
      return extensionMap[ext];
    }

    // Check by MIME type
    if (mimeType) {
      if (mimeType.includes('javascript')) return 'javascript';
      if (mimeType.includes('typescript')) return 'typescript';
      if (mimeType.includes('python')) return 'python';
    }

    return null;
  }

  /**
   * Parse a file
   */
  async parseFile(filePath: string, content?: string): Promise<ParseResult> {
    const normalizedPath = path.normalize(filePath);
    
    // Check cache first
    const cached = this.parseCache.get(normalizedPath);
    if (cached && !content) {
      return cached;
    }

    // Load content if not provided
    if (!content && this.cacheManager) {
      const fileResult = await this.cacheManager.get(normalizedPath);
      if (fileResult.error) {
        return {
          symbols: [],
          imports: [],
          exports: [],
          errors: [{ message: fileResult.error }],
          language: 'unknown'
        };
      }
      content = typeof fileResult.llmContent === 'string' ? fileResult.llmContent : '';
    }

    if (!content && content !== '') {
      return {
        symbols: [],
        imports: [],
        exports: [],
        errors: [{ message: 'No content provided' }],
        language: this.detectLanguage(filePath) || 'unknown'
      };
    }

    // Check file size
    if (Buffer.byteLength(content, 'utf8') > this.config.maxFileSizeBytes!) {
      return {
        symbols: [],
        imports: [],
        exports: [],
        errors: [{ message: 'File too large for parsing' }],
        language: this.detectLanguage(filePath) || 'unknown'
      };
    }

    // Detect language and get parser
    const language = this.detectLanguage(filePath) || 'unknown';
    const parser = this.parsers.get(language);

    if (!parser) {
      return {
        symbols: [],
        imports: [],
        exports: [],
        errors: [{ message: `No parser available for language: ${language}` }],
        language
      };
    }

    // Parse with timeout
    const parsePromise = parser.parse(content, normalizedPath);
    const timeoutPromise = new Promise<ParseResult>((_, reject) => 
      setTimeout(() => reject(new Error('Parse timeout')), this.config.timeout!)
    );

    try {
      const result = await Promise.race([parsePromise, timeoutPromise]);
      
      // Ensure language is set correctly
      result.language = language;
      
      // Cache result
      this.parseCache.set(normalizedPath, result);
      
      return result;
    } catch (error) {
      return {
        symbols: [],
        imports: [],
        exports: [],
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
        language
      };
    }
  }

  /**
   * Parse multiple files
   */
  async parseFiles(filePaths: string[]): Promise<Map<string, ParseResult>> {
    const results = new Map<string, ParseResult>();
    
    // Parse in parallel
    const promises = filePaths.map(async (filePath) => {
      const result = await this.parseFile(filePath);
      results.set(filePath, result);
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Query AST for specific patterns
   * This is a simplified version - tree-sitter would provide better querying
   */
  async queryAST(
    filePath: string,
    query: {
      type?: string;
      name?: string;
      scope?: string;
      exported?: boolean;
    }
  ): Promise<Symbol[]> {
    const parseResult = await this.parseFile(filePath);
    
    return parseResult.symbols.filter(symbol => {
      if (query.type && symbol.type !== query.type) return false;
      if (query.name && !symbol.name.includes(query.name)) return false;
      if (query.scope && symbol.scope !== query.scope) return false;
      if (query.exported !== undefined && symbol.exported !== query.exported) return false;
      return true;
    });
  }

  /**
   * Extract imports from a file
   */
  async extractImports(filePath: string): Promise<Array<{ from: string; items: string[] }>> {
    const result = await this.parseFile(filePath);
    return result.imports;
  }

  /**
   * Extract exports from a file
   */
  async extractExports(filePath: string): Promise<Array<{ name: string; type: string }>> {
    const result = await this.parseFile(filePath);
    return result.exports;
  }

  /**
   * Find symbol definition
   */
  async findSymbolDefinition(
    filePath: string,
    symbolName: string
  ): Promise<Symbol | null> {
    const result = await this.parseFile(filePath);
    return result.symbols.find(s => s.name === symbolName) || null;
  }

  /**
   * Get all symbols in a file
   */
  async getSymbols(filePath: string): Promise<Symbol[]> {
    const result = await this.parseFile(filePath);
    return result.symbols;
  }

  /**
   * Clear parse cache
   */
  clearCache(): void {
    this.parseCache.clear();
  }

  /**
   * Register a custom language parser
   */
  registerParser(language: SupportedLanguage, parser: LanguageParser): void {
    this.parsers.set(language, parser);
  }

  /**
   * Get registered parser for a language
   */
  getParser(language: SupportedLanguage): LanguageParser | undefined {
    return this.parsers.get(language);
  }

  /**
   * Check if incremental parsing is supported for a language
   */
  supportsIncremental(language: SupportedLanguage): boolean {
    const parser = this.parsers.get(language);
    return parser?.supportsIncremental() || false;
  }

  /**
   * Search for symbols matching a query
   */
  async searchSymbols(filePath: string, content: string, query: ASTQuery): Promise<ParsedSymbol[]> {
    const parseResult = await this.parseFile(filePath, content);
    
    if (!parseResult) {
      return [];
    }

    return parseResult.symbols.filter(symbol => {
      // Check type match
      if (query.type && symbol.type !== query.type) {
        return false;
      }

      // Check name pattern
      if (query.namePattern) {
        const regex = new RegExp(query.namePattern);
        if (!regex.test(symbol.name)) {
          return false;
        }
      }

      // Check scope
      if (query.scope && symbol.scope !== query.scope) {
        return false;
      }

      // Check export status
      if (query.exported !== undefined && symbol.exported !== query.exported) {
        return false;
      }

      return true;
    });
  }
}