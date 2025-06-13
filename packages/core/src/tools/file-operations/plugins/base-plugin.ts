/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LanguageParser, ParseResult, Symbol, ASTNode, SupportedLanguage } from '../services/ast-parser.js';
import { CacheManager } from '../services/cache-manager.js';

/**
 * Plugin metadata for registration and discovery
 */
export interface PluginMetadata {
  /** Unique plugin identifier */
  id: string;
  /** Human-readable plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Plugin description */
  description: string;
  /** Supported languages */
  languages: SupportedLanguage[];
  /** Plugin author information */
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  /** Plugin dependencies */
  dependencies?: string[];
  /** Minimum required core version */
  minCoreVersion?: string;
  /** Plugin capabilities */
  capabilities: PluginCapabilities;
}

/**
 * Plugin capabilities definition
 */
export interface PluginCapabilities {
  /** Supports incremental parsing */
  incremental: boolean;
  /** Supports syntax highlighting */
  syntaxHighlighting: boolean;
  /** Supports code completion */
  codeCompletion: boolean;
  /** Supports error diagnostics */
  diagnostics: boolean;
  /** Supports code formatting */
  formatting: boolean;
  /** Supports refactoring */
  refactoring: boolean;
  /** Maximum file size supported (in bytes) */
  maxFileSize?: number;
  /** File extensions supported */
  fileExtensions: string[];
  /** MIME types supported */
  mimeTypes: string[];
}

/**
 * Plugin configuration interface
 */
export interface PluginConfiguration {
  /** Enable/disable the plugin */
  enabled: boolean;
  /** Plugin-specific settings */
  settings: Record<string, unknown>;
  /** Timeout for operations (in milliseconds) */
  timeout?: number;
  /** Maximum memory usage (in bytes) */
  maxMemory?: number;
}

/**
 * Plugin validation result
 */
export interface PluginValidationResult {
  /** Whether the plugin is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Compatibility issues */
  compatibility: string[];
}

/**
 * Enhanced language parser interface with plugin capabilities
 */
export interface EnhancedLanguageParser extends LanguageParser {
  /** Get plugin metadata */
  getMetadata(): PluginMetadata;
  /** Validate the plugin */
  validate(): Promise<PluginValidationResult>;
  /** Initialize the plugin with configuration */
  initialize(config: PluginConfiguration): Promise<void>;
  /** Cleanup plugin resources */
  cleanup(): Promise<void>;
  /** Check if plugin supports a specific file */
  supportsFile(filePath: string, content?: string): boolean;
  /** Get syntax highlighting tokens */
  getTokens?(content: string, filePath: string): Promise<SyntaxToken[]>;
  /** Get code completion suggestions */
  getCompletions?(content: string, position: Position, filePath: string): Promise<CompletionItem[]>;
  /** Get diagnostics (errors, warnings) */
  getDiagnostics?(content: string, filePath: string): Promise<Diagnostic[]>;
  /** Format code */
  formatCode?(content: string, filePath: string, options?: FormatOptions): Promise<string>;
}

/**
 * Syntax token for highlighting
 */
export interface SyntaxToken {
  type: TokenType;
  start: Position;
  end: Position;
  text: string;
  modifiers?: string[];
}

/**
 * Token types for syntax highlighting
 */
export type TokenType = 
  | 'keyword'
  | 'identifier'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator'
  | 'punctuation'
  | 'type'
  | 'function'
  | 'variable'
  | 'constant'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'enum'
  | 'property'
  | 'method'
  | 'parameter'
  | 'label'
  | 'macro'
  | 'decorator'
  | 'attribute';

/**
 * Position in a document
 */
export interface Position {
  line: number;
  column: number;
}

/**
 * Code completion item
 */
export interface CompletionItem {
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
}

/**
 * Completion item kinds
 */
export type CompletionItemKind =
  | 'text'
  | 'method'
  | 'function'
  | 'constructor'
  | 'field'
  | 'variable'
  | 'class'
  | 'interface'
  | 'module'
  | 'property'
  | 'unit'
  | 'value'
  | 'enum'
  | 'keyword'
  | 'snippet'
  | 'color'
  | 'file'
  | 'reference'
  | 'folder'
  | 'enumMember'
  | 'constant'
  | 'struct'
  | 'event'
  | 'operator'
  | 'typeParameter';

/**
 * Diagnostic information
 */
export interface Diagnostic {
  range: Range;
  severity: DiagnosticSeverity;
  message: string;
  code?: string | number;
  source?: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

/**
 * Range in a document
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Diagnostic severity levels
 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4
}

/**
 * Related diagnostic information
 */
export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

/**
 * Location reference
 */
export interface Location {
  uri: string;
  range: Range;
}

/**
 * Code formatting options
 */
export interface FormatOptions {
  tabSize?: number;
  insertSpaces?: boolean;
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
  trimFinalNewlines?: boolean;
}

/**
 * Base plugin class providing common functionality
 */
export abstract class BaseLanguagePlugin implements EnhancedLanguageParser {
  protected readonly cacheManager?: CacheManager;
  protected config?: PluginConfiguration;
  protected initialized = false;

  constructor(cacheManager?: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Get plugin metadata - must be implemented by subclasses
   */
  abstract getMetadata(): PluginMetadata;

  /**
   * Parse content - must be implemented by subclasses
   */
  abstract parse(content: string, filePath: string): Promise<ParseResult>;

  /**
   * Initialize the plugin with configuration
   */
  async initialize(config: PluginConfiguration): Promise<void> {
    this.config = config;
    this.initialized = true;
    await this.onInitialize(config);
  }

  /**
   * Hook for subclasses to perform initialization
   */
  protected async onInitialize(config: PluginConfiguration): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Cleanup plugin resources
   */
  async cleanup(): Promise<void> {
    this.initialized = false;
    await this.onCleanup();
  }

  /**
   * Hook for subclasses to perform cleanup
   */
  protected async onCleanup(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Validate the plugin
   */
  async validate(): Promise<PluginValidationResult> {
    const result: PluginValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      compatibility: []
    };

    try {
      // Validate metadata
      const metadata = this.getMetadata();
      if (!metadata.id || !metadata.name || !metadata.version) {
        result.errors.push('Plugin metadata is incomplete (missing id, name, or version)');
        result.valid = false;
      }

      if (!metadata.languages || metadata.languages.length === 0) {
        result.errors.push('Plugin must support at least one language');
        result.valid = false;
      }

      if (!metadata.capabilities.fileExtensions || metadata.capabilities.fileExtensions.length === 0) {
        result.warnings.push('Plugin does not specify supported file extensions');
      }

      // Validate implementation
      if (typeof this.parse !== 'function') {
        result.errors.push('Plugin must implement parse method');
        result.valid = false;
      }

      // Call subclass validation
      await this.onValidate(result);

    } catch (error) {
      result.errors.push(`Plugin validation failed: ${error instanceof Error ? error.message : String(error)}`);
      result.valid = false;
    }

    return result;
  }

  /**
   * Hook for subclasses to perform additional validation
   */
  protected async onValidate(result: PluginValidationResult): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Check if plugin supports a specific file
   */
  supportsFile(filePath: string, content?: string): boolean {
    const metadata = this.getMetadata();
    const ext = this.getFileExtension(filePath);
    
    // Check by file extension
    if (metadata.capabilities.fileExtensions.includes(ext)) {
      return true;
    }

    // Check by MIME type if available
    if (content && metadata.capabilities.mimeTypes.length > 0) {
      // This is a simplified check - in practice, you might use a more sophisticated MIME detection
      return false;
    }

    return false;
  }

  /**
   * Default implementation for incremental parsing support
   */
  supportsIncremental(): boolean {
    return this.getMetadata().capabilities.incremental;
  }

  /**
   * Default incremental parsing implementation (fallback to full parse)
   */
  async parseIncremental(
    content: string,
    filePath: string,
    previousTree?: unknown
  ): Promise<ParseResult> {
    // Default implementation falls back to full parse
    return this.parse(content, filePath);
  }

  /**
   * Get syntax highlighting tokens (optional)
   */
  async getTokens?(content: string, filePath: string): Promise<SyntaxToken[]> {
    throw new Error('Syntax highlighting not supported by this plugin');
  }

  /**
   * Get code completion suggestions (optional)
   */
  async getCompletions?(
    content: string,
    position: Position,
    filePath: string
  ): Promise<CompletionItem[]> {
    throw new Error('Code completion not supported by this plugin');
  }

  /**
   * Get diagnostics (optional)
   */
  async getDiagnostics?(content: string, filePath: string): Promise<Diagnostic[]> {
    throw new Error('Diagnostics not supported by this plugin');
  }

  /**
   * Format code (optional)
   */
  async formatCode?(
    content: string,
    filePath: string,
    options?: FormatOptions
  ): Promise<string> {
    throw new Error('Code formatting not supported by this plugin');
  }

  /**
   * Utility method to get file extension
   */
  protected getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  }

  /**
   * Utility method to check if plugin is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Plugin is not initialized. Call initialize() first.');
    }
  }

  /**
   * Utility method to get cache key
   */
  protected getCacheKey(filePath: string, operation: string): string {
    const metadata = this.getMetadata();
    return `plugin:${metadata.id}:${operation}:${filePath}`;
  }

  /**
   * Utility method to extract symbols from content using regex
   */
  protected extractSymbolsWithRegex(
    content: string,
    patterns: Array<{
      regex: RegExp;
      type: Symbol['type'];
      scope: Symbol['scope'];
      exported?: boolean;
    }>
  ): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = content.split('\n');

    for (const pattern of patterns) {
      let match;
      pattern.regex.lastIndex = 0; // Reset regex state

      while ((match = pattern.regex.exec(content)) !== null) {
        const matchStart = match.index;
        const lineStart = content.lastIndexOf('\n', matchStart) + 1;
        const line = content.substring(0, matchStart).split('\n').length;
        const column = matchStart - lineStart + 1;

        symbols.push({
          name: match[1] || match[0],
          type: pattern.type,
          position: { line, column },
          scope: pattern.scope,
          exported: pattern.exported || false
        });

        // Prevent infinite loops on global regexes
        if (!pattern.regex.global) break;
      }
    }

    return symbols;
  }
}