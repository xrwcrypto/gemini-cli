/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Diff from 'diff';
import { DEFAULT_DIFF_OPTIONS } from '../diffOptions.js';
import { FileDiff, ToolResult, ToolResultDisplay } from '../tools.js';
import { makeRelative, shortenPath } from '../../utils/paths.js';
import {
  FileOperationResponse,
  OperationResult,
  OperationResultData,
  AnalyzeResult,
  EditResult,
  CreateResult,
  DeleteResult,
  ValidateResult,
  ExtractedData,
  SearchMatch,
  ValidationCheckResult,
  OperationError,
  FileOperationOptions,
} from './file-operations-types.js';

/**
 * Interface for file change tracking
 */
interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  oldContent?: string;
  newContent?: string;
}

/**
 * Progress update callback type
 */
export type ProgressCallback = (message: string) => void;

/**
 * Response builder for formatting FileOperations tool results
 */
export class ResponseBuilder {
  private rootDirectory: string;
  private fileChanges: Map<string, FileChange> = new Map();
  private errors: OperationError[] = [];
  private progressMessages: string[] = [];

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory;
  }

  /**
   * Tracks a file change for later diff generation
   */
  trackFileChange(change: FileChange): void {
    this.fileChanges.set(change.path, change);
  }

  /**
   * Adds an error to the error list
   */
  addError(error: OperationError): void {
    this.errors.push(error);
  }

  /**
   * Records a progress message
   */
  recordProgress(message: string): void {
    this.progressMessages.push(message);
  }

  /**
   * Builds the final ToolResult from operation response
   */
  buildToolResult(
    response: FileOperationResponse,
    options?: FileOperationOptions,
  ): ToolResult {
    const llmContent = this.buildLLMContent(response, options);
    const returnDisplay = this.buildReturnDisplay(response, options);

    return {
      llmContent,
      returnDisplay,
    };
  }

  /**
   * Builds structured JSON content for LLM history
   */
  private buildLLMContent(
    response: FileOperationResponse,
    options?: FileOperationOptions,
  ): string {
    const content: any = {
      success: response.success,
      summary: {
        totalOperations: response.summary.totalOperations,
        successful: response.summary.successful,
        failed: response.summary.failed,
        duration: response.summary.duration,
        filesAffected: response.summary.filesAffected.length,
      },
    };

    // Add detailed results based on returnFormat option
    if (options?.returnFormat !== 'minimal') {
      content.results = response.results.map((result) =>
        this.formatOperationResultForLLM(result, options?.returnFormat === 'raw'),
      );
    }

    // Add errors if any
    if (response.errors && response.errors.length > 0) {
      content.errors = response.errors.map((error) => ({
        operationId: error.operationId,
        message: error.message,
        code: error.code,
      }));
    }

    // Add file changes summary
    if (this.fileChanges.size > 0) {
      content.fileChanges = Array.from(this.fileChanges.values()).map((change) => ({
        path: makeRelative(change.path, this.rootDirectory),
        type: change.type,
      }));
    }

    return JSON.stringify(content, null, 2);
  }

  /**
   * Formats a single operation result for LLM content
   */
  private formatOperationResultForLLM(
    result: OperationResult,
    includeRawData: boolean,
  ): any {
    const formatted: any = {
      operationId: result.operationId,
      type: result.type,
      status: result.status,
    };

    if (result.error) {
      formatted.error = {
        message: result.error.message,
        code: result.error.code,
      };
    }

    if (result.data && result.status === 'success') {
      formatted.summary = this.getOperationSummary(result.type, result.data);
      
      if (includeRawData) {
        formatted.data = result.data;
      }
    }

    return formatted;
  }

  /**
   * Gets a concise summary of operation result data
   */
  private getOperationSummary(type: string, data: OperationResultData): any {
    switch (type) {
      case 'analyze':
        const analyzeData = data as AnalyzeResult;
        return {
          filesAnalyzed: analyzeData.filesAnalyzed,
          matchesFound: analyzeData.matches?.length || 0,
          extractedFiles: analyzeData.extracted ? Object.keys(analyzeData.extracted).length : 0,
        };

      case 'edit':
        const editData = data as EditResult;
        return {
          filesEdited: editData.filesEdited,
          totalChanges: Object.values(editData.changes).reduce((sum, count) => sum + count, 0),
          syntaxErrors: editData.syntaxErrors?.length || 0,
        };

      case 'create':
        const createData = data as CreateResult;
        return {
          filesCreated: createData.filesCreated,
          alreadyExisted: createData.alreadyExisted?.length || 0,
        };

      case 'delete':
        const deleteData = data as DeleteResult;
        return {
          filesDeleted: deleteData.filesDeleted,
          notFound: deleteData.notFound?.length || 0,
          directoriesRemoved: deleteData.directoriesRemoved?.length || 0,
        };

      case 'validate':
        const validateData = data as ValidateResult;
        return {
          valid: validateData.valid,
          checksPerformed: Object.keys(validateData.checks).length,
          filesFixed: validateData.fixed?.length || 0,
        };

      default:
        return {};
    }
  }

  /**
   * Builds human-readable display output
   */
  private buildReturnDisplay(
    response: FileOperationResponse,
    options?: FileOperationOptions,
  ): ToolResultDisplay {
    // If we have file changes, create a combined diff
    if (this.fileChanges.size > 0 && this.shouldShowDiffs(response)) {
      return this.buildFileDiff();
    }

    // Otherwise, build markdown summary
    return this.buildMarkdownSummary(response, options);
  }

  /**
   * Determines if we should show diffs instead of markdown
   */
  private shouldShowDiffs(response: FileOperationResponse): boolean {
    // Show diffs if we have file modifications and the operation was successful
    const hasModifications = Array.from(this.fileChanges.values()).some(
      (change) => change.type === 'modified' || change.type === 'created',
    );
    
    // Don't show diffs if there are many files (too much output)
    const fileCount = this.fileChanges.size;
    
    return hasModifications && fileCount <= 5 && response.success;
  }

  /**
   * Builds a combined file diff for display
   */
  private buildFileDiff(): FileDiff {
    const changes = Array.from(this.fileChanges.values());
    
    // If single file, return simple diff
    if (changes.length === 1) {
      const change = changes[0];
      const fileName = makeRelative(change.path, this.rootDirectory);
      const fileDiff = Diff.createPatch(
        fileName,
        change.oldContent || '',
        change.newContent || '',
        'Original',
        change.type === 'created' ? 'Created' : 'Modified',
        DEFAULT_DIFF_OPTIONS,
      );
      
      return { fileDiff, fileName };
    }

    // For multiple files, create a combined diff
    let combinedDiff = '';
    for (const change of changes) {
      const fileName = makeRelative(change.path, this.rootDirectory);
      const fileDiff = Diff.createPatch(
        fileName,
        change.oldContent || '',
        change.newContent || '',
        'Original',
        change.type === 'created' ? 'Created' : 'Modified',
        DEFAULT_DIFF_OPTIONS,
      );
      combinedDiff += fileDiff + '\n';
    }

    return {
      fileDiff: combinedDiff,
      fileName: `${changes.length} files modified`,
    };
  }

  /**
   * Builds a markdown summary of the operation results
   */
  private buildMarkdownSummary(
    response: FileOperationResponse,
    options?: FileOperationOptions,
  ): string {
    const lines: string[] = [];

    // Header
    lines.push('# File Operations Summary\n');

    // Overall status
    const statusEmoji = response.success ? '✅' : '❌';
    lines.push(`**Status:** ${statusEmoji} ${response.success ? 'Success' : 'Failed'}\n`);

    // Summary statistics
    lines.push('## Statistics');
    lines.push(`- **Total Operations:** ${response.summary.totalOperations}`);
    lines.push(`- **Successful:** ${response.summary.successful}`);
    lines.push(`- **Failed:** ${response.summary.failed}`);
    lines.push(`- **Duration:** ${response.summary.duration}ms`);
    lines.push(`- **Files Affected:** ${response.summary.filesAffected.length}`);
    lines.push('');

    // Operation results
    if (response.results.length > 0) {
      lines.push('## Operation Results\n');
      
      for (const result of response.results) {
        lines.push(this.formatOperationResultMarkdown(result));
      }
    }

    // Errors
    if (response.errors && response.errors.length > 0) {
      lines.push('## Errors\n');
      
      for (const error of response.errors) {
        lines.push(`### Operation: ${error.operationId}`);
        lines.push(`- **Message:** ${error.message}`);
        if (error.code) {
          lines.push(`- **Code:** ${error.code}`);
        }
        lines.push('');
      }
    }

    // File changes
    if (this.fileChanges.size > 0) {
      lines.push('## File Changes\n');
      
      const grouped = this.groupFileChangesByType();
      
      if (grouped.created.length > 0) {
        lines.push('### Created Files');
        for (const file of grouped.created) {
          lines.push(`- ${shortenPath(makeRelative(file, this.rootDirectory))}`);
        }
        lines.push('');
      }

      if (grouped.modified.length > 0) {
        lines.push('### Modified Files');
        for (const file of grouped.modified) {
          lines.push(`- ${shortenPath(makeRelative(file, this.rootDirectory))}`);
        }
        lines.push('');
      }

      if (grouped.deleted.length > 0) {
        lines.push('### Deleted Files');
        for (const file of grouped.deleted) {
          lines.push(`- ${shortenPath(makeRelative(file, this.rootDirectory))}`);
        }
        lines.push('');
      }
    }

    // Progress messages (if in verbose mode)
    if (options?.returnFormat === 'raw' && this.progressMessages.length > 0) {
      lines.push('## Progress Log\n');
      for (const message of this.progressMessages) {
        lines.push(`- ${message}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Formats a single operation result as markdown
   */
  private formatOperationResultMarkdown(result: OperationResult): string {
    const lines: string[] = [];
    const statusIcon = result.status === 'success' ? '✓' : result.status === 'failed' ? '✗' : '○';
    
    lines.push(`### ${statusIcon} ${result.type} (${result.operationId})`);
    lines.push(`**Status:** ${result.status}`);
    
    if (result.duration) {
      lines.push(`**Duration:** ${result.duration}ms`);
    }

    if (result.data && result.status === 'success') {
      lines.push('**Results:**');
      lines.push(this.formatOperationDataMarkdown(result.type, result.data));
    }

    if (result.error) {
      lines.push(`**Error:** ${result.error.message}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Formats operation-specific data as markdown
   */
  private formatOperationDataMarkdown(type: string, data: OperationResultData): string {
    const lines: string[] = [];

    switch (type) {
      case 'analyze':
        const analyzeData = data as AnalyzeResult;
        lines.push(`- Files analyzed: ${analyzeData.filesAnalyzed}`);
        
        if (analyzeData.matches && analyzeData.matches.length > 0) {
          lines.push(`- Matches found: ${analyzeData.matches.length}`);
          
          // Show first few matches
          const maxMatches = 3;
          const matchesToShow = analyzeData.matches.slice(0, maxMatches);
          
          for (const match of matchesToShow) {
            const relPath = shortenPath(makeRelative(match.file, this.rootDirectory));
            lines.push(`  - ${relPath}:${match.line}:${match.column} - ${match.match}`);
          }
          
          if (analyzeData.matches.length > maxMatches) {
            lines.push(`  - ... and ${analyzeData.matches.length - maxMatches} more`);
          }
        }

        if (analyzeData.extracted) {
          const fileCount = Object.keys(analyzeData.extracted).length;
          lines.push(`- Extracted data from ${fileCount} files`);
        }
        break;

      case 'edit':
        const editData = data as EditResult;
        lines.push(`- Files edited: ${editData.filesEdited}`);
        
        const totalChanges = Object.values(editData.changes).reduce((sum, count) => sum + count, 0);
        lines.push(`- Total changes: ${totalChanges}`);
        
        if (editData.syntaxErrors && editData.syntaxErrors.length > 0) {
          lines.push(`- Syntax errors: ${editData.syntaxErrors.length}`);
        }
        break;

      case 'create':
        const createData = data as CreateResult;
        lines.push(`- Files created: ${createData.filesCreated}`);
        
        if (createData.alreadyExisted && createData.alreadyExisted.length > 0) {
          lines.push(`- Already existed: ${createData.alreadyExisted.length}`);
        }
        break;

      case 'delete':
        const deleteData = data as DeleteResult;
        lines.push(`- Files deleted: ${deleteData.filesDeleted}`);
        
        if (deleteData.notFound && deleteData.notFound.length > 0) {
          lines.push(`- Not found: ${deleteData.notFound.length}`);
        }
        
        if (deleteData.directoriesRemoved && deleteData.directoriesRemoved.length > 0) {
          lines.push(`- Directories removed: ${deleteData.directoriesRemoved.length}`);
        }
        break;

      case 'validate':
        const validateData = data as ValidateResult;
        lines.push(`- Validation: ${validateData.valid ? 'Passed' : 'Failed'}`);
        lines.push(`- Checks performed: ${Object.keys(validateData.checks).length}`);
        
        for (const [checkName, checkResult] of Object.entries(validateData.checks)) {
          const checkStatus = checkResult.passed ? '✓' : '✗';
          lines.push(`  - ${checkStatus} ${checkName}: ${checkResult.issueCount} issues`);
        }
        
        if (validateData.fixed && validateData.fixed.length > 0) {
          lines.push(`- Files auto-fixed: ${validateData.fixed.length}`);
        }
        break;
    }

    return lines.join('\n');
  }

  /**
   * Groups file changes by type
   */
  private groupFileChangesByType(): {
    created: string[];
    modified: string[];
    deleted: string[];
  } {
    const grouped = {
      created: [] as string[],
      modified: [] as string[],
      deleted: [] as string[],
    };

    for (const [path, change] of this.fileChanges) {
      switch (change.type) {
        case 'created':
          grouped.created.push(path);
          break;
        case 'modified':
          grouped.modified.push(path);
          break;
        case 'deleted':
          grouped.deleted.push(path);
          break;
      }
    }

    // Sort paths for consistent output
    grouped.created.sort();
    grouped.modified.sort();
    grouped.deleted.sort();

    return grouped;
  }

  /**
   * Creates a streaming progress callback
   */
  createProgressCallback(updateOutput?: (output: string) => void): ProgressCallback {
    return (message: string) => {
      this.recordProgress(message);
      
      if (updateOutput) {
        // Build current progress display
        const display = this.buildProgressDisplay();
        updateOutput(display);
      }
    };
  }

  /**
   * Builds a progress display for streaming updates
   */
  private buildProgressDisplay(): string {
    const lines: string[] = [];
    
    lines.push('## File Operations Progress\n');
    
    // Show recent progress messages
    const recentMessages = this.progressMessages.slice(-10);
    for (const message of recentMessages) {
      lines.push(`- ${message}`);
    }
    
    // Show current file changes
    if (this.fileChanges.size > 0) {
      lines.push('\n### Files Modified');
      const changes = Array.from(this.fileChanges.values()).slice(-5);
      for (const change of changes) {
        const relPath = shortenPath(makeRelative(change.path, this.rootDirectory));
        lines.push(`- ${change.type}: ${relPath}`);
      }
      
      if (this.fileChanges.size > 5) {
        lines.push(`- ... and ${this.fileChanges.size - 5} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Clears all tracked state
   */
  clear(): void {
    this.fileChanges.clear();
    this.errors = [];
    this.progressMessages = [];
  }
}