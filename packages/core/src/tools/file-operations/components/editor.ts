/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileSystemService } from '../services/file-system-service.js';
import { CacheManager } from '../services/cache-manager.js';
import { ASTParserService } from '../services/ast-parser.js';
import {
  EditOperation,
  FileEdit,
  Change,
  FindReplaceChange,
  LineChange,
  PositionChange,
  ASTChange,
  EditResult
} from '../file-operations-types.js';

/**
 * Options for the editor
 */
export interface EditorOptions {
  /** Preserve original formatting (indentation, line endings) */
  preserveFormatting?: boolean;
  /** Validate syntax after edits */
  validateSyntax?: boolean;
  /** Create backup before editing */
  createBackup?: boolean;
  /** Dry run mode - return changes without applying */
  dryRun?: boolean;
}

/**
 * Result of a single file edit
 */
export interface FileEditResult {
  path: string;
  success: boolean;
  changesApplied: number;
  error?: string;
  syntaxValid?: boolean;
  preview?: string;
}

/**
 * Editor Component
 * Provides comprehensive file editing capabilities
 */
export class Editor {
  private readonly fileService: FileSystemService;
  private readonly cacheManager: CacheManager;
  private readonly astParser: ASTParserService;

  constructor(
    fileService: FileSystemService,
    cacheManager: CacheManager,
    astParser: ASTParserService
  ) {
    this.fileService = fileService;
    this.cacheManager = cacheManager;
    this.astParser = astParser;
  }

  /**
   * Execute edit operation
   */
  async edit(operation: EditOperation, options: EditorOptions = {}): Promise<EditResult> {
    const results = new Map<string, FileEditResult>();
    const syntaxErrors: string[] = [];

    // Process each file edit
    for (const fileEdit of operation.edits) {
      const result = await this.editFile(fileEdit, options);
      results.set(fileEdit.file, result);
      
      if (result.syntaxValid === false) {
        syntaxErrors.push(fileEdit.file);
      }
    }

    // Build response
    const changes: Record<string, number> = {};
    for (const [path, result] of results) {
      if (result.success) {
        changes[path] = result.changesApplied;
      }
    }

    return {
      filesEdited: Object.keys(changes).length,
      changes,
      syntaxErrors: syntaxErrors.length > 0 ? syntaxErrors : undefined
    };
  }

  /**
   * Edit a single file
   */
  private async editFile(fileEdit: FileEdit, options: EditorOptions): Promise<FileEditResult> {
    try {
      // Get file content
      const content = await this.cacheManager.get(fileEdit.file);
      
      if (!content || content.error) {
        if (fileEdit.createIfMissing) {
          // Create new file
          return this.createAndEditFile(fileEdit, options);
        }
        
        return {
          path: fileEdit.file,
          success: false,
          changesApplied: 0,
          error: content?.error || 'File not found'
        };
      }

      if (typeof content.llmContent !== 'string') {
        return {
          path: fileEdit.file,
          success: false,
          changesApplied: 0,
          error: 'File content is not text'
        };
      }

      // Apply changes
      let modifiedContent = content.llmContent;
      let changesApplied = 0;

      for (const change of fileEdit.changes) {
        const result = await this.applyChange(modifiedContent, change, fileEdit.file);
        if (result.modified) {
          modifiedContent = result.content;
          changesApplied += result.count;
        }
      }

      // Check if content actually changed
      if (modifiedContent === content.llmContent) {
        return {
          path: fileEdit.file,
          success: true,
          changesApplied: 0
        };
      }

      // Validate syntax if requested
      let syntaxValid: boolean | undefined;
      if (options.validateSyntax) {
        syntaxValid = await this.validateSyntax(fileEdit.file, modifiedContent);
      }

      // Apply formatting preservation
      if (options.preserveFormatting) {
        modifiedContent = this.preserveFormatting(content.llmContent, modifiedContent);
      }

      // Write file if not in dry run mode
      if (!options.dryRun) {
        const writeResult = await this.fileService.writeFiles(
          new Map([[fileEdit.file, modifiedContent]])
        );
        
        const result = writeResult.get(fileEdit.file);
        if (!result?.success) {
          return {
            path: fileEdit.file,
            success: false,
            changesApplied: 0,
            error: result?.error || 'Failed to write file'
          };
        }

        // Invalidate cache
        await this.cacheManager.invalidate(fileEdit.file);
      }

      return {
        path: fileEdit.file,
        success: true,
        changesApplied,
        syntaxValid,
        preview: options.dryRun ? modifiedContent.substring(0, 1000) : undefined
      };

    } catch (error) {
      return {
        path: fileEdit.file,
        success: false,
        changesApplied: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create a new file and apply edits
   */
  private async createAndEditFile(
    fileEdit: FileEdit,
    options: EditorOptions
  ): Promise<FileEditResult> {
    let content = '';
    let changesApplied = 0;

    // Apply changes to empty content
    for (const change of fileEdit.changes) {
      const result = await this.applyChange(content, change, fileEdit.file);
      if (result.modified) {
        content = result.content;
        changesApplied += result.count;
      }
    }

    // Write file if not in dry run mode
    if (!options.dryRun) {
      const writeResult = await this.fileService.writeFiles(
        new Map([[fileEdit.file, content]])
      );
      
      const result = writeResult.get(fileEdit.file);
      if (!result?.success) {
        return {
          path: fileEdit.file,
          success: false,
          changesApplied: 0,
          error: result?.error || 'Failed to create file'
        };
      }
    }

    return {
      path: fileEdit.file,
      success: true,
      changesApplied,
      preview: options.dryRun ? content : undefined
    };
  }

  /**
   * Apply a single change to content
   */
  private async applyChange(
    content: string,
    change: Change,
    filePath: string
  ): Promise<{ content: string; modified: boolean; count: number }> {
    switch (change.type) {
      case 'find-replace':
        return this.applyFindReplace(content, change);
      
      case 'line':
        return this.applyLineChange(content, change);
      
      case 'position':
        return this.applyPositionChange(content, change);
      
      case 'ast':
        return this.applyASTChange(content, change, filePath);
      
      default: {
        // Exhaustive check for unknown change types
        const _exhaustiveCheck: never = change;
        return { content, modified: false, count: 0 };
      }
    }
  }

  /**
   * Apply find-replace change
   */
  private applyFindReplace(
    content: string,
    change: FindReplaceChange
  ): { content: string; modified: boolean; count: number } {
    let count = 0;
    let result = content;

    if (change.regex) {
      // Regex replacement
      const flags = change.replaceAll ? 'g' : '';
      const regex = new RegExp(change.find, flags);
      
      result = content.replace(regex, () => {
        count++;
        return change.replace;
      });
    } else {
      // Literal string replacement
      if (change.replaceAll) {
        // Count occurrences
        const escaped = change.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = content.match(new RegExp(escaped, 'g'));
        count = matches ? matches.length : 0;
        
        // Replace all occurrences
        result = content.split(change.find).join(change.replace);
      } else {
        // Replace first occurrence
        const index = content.indexOf(change.find);
        if (index !== -1) {
          count = 1;
          result = content.substring(0, index) + 
                  change.replace + 
                  content.substring(index + change.find.length);
        }
      }
    }

    return {
      content: result,
      modified: count > 0,
      count
    };
  }

  /**
   * Apply line-based change
   */
  private applyLineChange(
    content: string,
    change: LineChange
  ): { content: string; modified: boolean; count: number } {
    const lines = content.split('\n');
    const lineIndex = change.line - 1; // Convert to 0-based

    if (lineIndex < 0 || lineIndex > lines.length) {
      return { content, modified: false, count: 0 };
    }

    let modified = false;
    let count = 0;

    switch (change.operation) {
      case 'insert':
        if (change.content !== undefined) {
          lines.splice(lineIndex, 0, change.content);
          modified = true;
          count = 1;
        }
        break;

      case 'replace':
        if (lineIndex < lines.length && change.content !== undefined) {
          lines[lineIndex] = change.content;
          modified = true;
          count = 1;
        }
        break;

      case 'delete':
        if (lineIndex < lines.length) {
          lines.splice(lineIndex, 1);
          modified = true;
          count = 1;
        }
        break;
        
      default:
        // Exhaustive check
        break;
    }

    return {
      content: lines.join('\n'),
      modified,
      count
    };
  }

  /**
   * Apply position-based change
   */
  private applyPositionChange(
    content: string,
    change: PositionChange
  ): { content: string; modified: boolean; count: number } {
    if (change.start < 0 || change.start > content.length ||
        change.end < change.start || change.end > content.length) {
      return { content, modified: false, count: 0 };
    }

    const result = content.substring(0, change.start) +
                  change.content +
                  content.substring(change.end);

    return {
      content: result,
      modified: true,
      count: 1
    };
  }

  /**
   * Apply AST-based change
   */
  private async applyASTChange(
    content: string,
    _change: ASTChange,
    _filePath: string
  ): Promise<{ content: string; modified: boolean; count: number }> {
    // For now, return unmodified as AST transformations require tree-sitter
    // This would be implemented when tree-sitter is integrated
    console.warn('AST transformations not yet implemented');
    return { content, modified: false, count: 0 };
  }

  /**
   * Validate syntax after edit
   */
  private async validateSyntax(filePath: string, content: string): Promise<boolean> {
    const language = this.astParser.detectLanguage(filePath);
    if (!language || language === 'unknown') {
      return true; // Can't validate unknown languages
    }

    const parseResult = await this.astParser.parseFile(filePath, content);
    return parseResult.errors.length === 0;
  }

  /**
   * Preserve formatting from original content
   */
  private preserveFormatting(original: string, modified: string): string {
    // Detect and preserve line endings
    const originalLineEnding = original.includes('\r\n') ? '\r\n' : '\n';
    const modifiedLines = modified.split(/\r?\n/);
    
    // Detect and preserve indentation style
    const indentMatch = original.match(/^([ \t]+)/m);
    const _indentStyle = indentMatch ? indentMatch[1][0] : ' ';
    // const indentSize = indentMatch ? 
    //   (indentStyle === '\t' ? 1 : indentMatch[1].length) : 2;

    // Rejoin with original line endings
    return modifiedLines.join(originalLineEnding);
  }

  /**
   * Batch edit multiple files
   */
  async batchEdit(
    edits: FileEdit[],
    options: EditorOptions = {}
  ): Promise<Map<string, FileEditResult>> {
    const results = new Map<string, FileEditResult>();

    // Process edits in parallel
    const promises = edits.map(async (edit) => {
      const result = await this.editFile(edit, options);
      results.set(edit.file, result);
    });

    await Promise.all(promises);
    return results;
  }
}