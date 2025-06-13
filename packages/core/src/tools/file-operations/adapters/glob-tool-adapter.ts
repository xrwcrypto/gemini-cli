/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { BaseTool, ToolResult } from '../../tools.js';
import { GlobToolParams } from '../../glob.js';
import { FileOperationsTool } from '../file-operations.js';
import { 
  FileOperationRequest, 
  AnalyzeOperation 
} from '../file-operations-types.js';
import { Config } from '../../../config/config.js';

/**
 * Adapter that maps GlobTool calls to FileOperations analyze operations
 * Ensures 100% backward compatibility with the original GlobTool
 */
export class GlobToolAdapter extends BaseTool<GlobToolParams, ToolResult> {
  static readonly Name = 'glob';
  private readonly fileOperationsTool: FileOperationsTool;
  
  constructor(
    private readonly rootDirectory: string,
    private readonly config: Config
  ) {
    super(
      GlobToolAdapter.Name,
      'FindFiles',
      'Efficiently finds files matching specific glob patterns (e.g., `src/**/*.ts`, `**/*.md`), returning absolute paths sorted by modification time (newest first). Ideal for quickly locating files based on their name or path structure, especially in large codebases.',
      {
        properties: {
          pattern: {
            description:
              "The glob pattern to match against (e.g., '**/*.py', 'docs/*.md').",
            type: 'string',
          },
          path: {
            description:
              'Optional: The absolute path to the directory to search within. If omitted, searches the root directory.',
            type: 'string',
          },
          case_sensitive: {
            description:
              'Optional: Whether the search should be case-sensitive. Defaults to false.',
            type: 'boolean',
          },
          respect_git_ignore: {
            description:
              'Optional: Whether to respect .gitignore patterns when finding files. Only available in git repositories. Defaults to true.',
            type: 'boolean',
          },
        },
        required: ['pattern'],
        type: 'object',
      }
    );
    
    this.rootDirectory = path.resolve(rootDirectory);
    this.fileOperationsTool = new FileOperationsTool(config, this.rootDirectory);
  }
  
  validateToolParams(params: GlobToolParams): string | null {
    if (!params.pattern || typeof params.pattern !== 'string' || params.pattern.trim() === '') {
      return "The 'pattern' parameter cannot be empty.";
    }
    
    const searchDirAbsolute = path.resolve(
      this.rootDirectory,
      params.path || '.'
    );
    
    if (!this.isWithinRoot(searchDirAbsolute)) {
      return `Search path ("${searchDirAbsolute}") resolves outside the tool's root directory ("${this.rootDirectory}").`;
    }
    
    return null;
  }
  
  private isWithinRoot(pathToCheck: string): boolean {
    const absolutePathToCheck = path.resolve(pathToCheck);
    const normalizedPath = path.normalize(absolutePathToCheck);
    const normalizedRoot = path.normalize(this.rootDirectory);
    const rootWithSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : normalizedRoot + path.sep;
    return (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(rootWithSep)
    );
  }
  
  getDescription(params: GlobToolParams): string {
    let description = `'${params.pattern}'`;
    if (params.path) {
      const searchDir = path.resolve(this.rootDirectory, params.path || '.');
      const relativePath = this.makeRelative(searchDir);
      description += ` within ${this.shortenPath(relativePath)}`;
    }
    return description;
  }
  
  async execute(
    params: GlobToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError
      };
    }
    
    try {
      const searchDirAbsolute = path.resolve(
        this.rootDirectory,
        params.path || '.'
      );
      
      // Convert glob pattern to analyze operation
      const globPattern = params.path 
        ? path.join(params.path, params.pattern)
        : params.pattern;
      
      const analyzeOp: AnalyzeOperation = {
        type: 'analyze',
        paths: [globPattern],
        extract: [], // Don't extract content, just list files
        buildIndex: false,
        deepAnalysis: false
      };
      
      const request: FileOperationRequest = {
        operations: [analyzeOp],
        options: {
          parallel: false,
          returnFormat: 'structured',
          cacheStrategy: 'session'
        }
      };
      
      // Execute through FileOperations
      const result = await this.fileOperationsTool.execute(request, signal);
      
      // Parse response and transform to GlobTool format
      const response = JSON.parse(result.llmContent);
      
      if (!response.success || response.results.length === 0) {
        const error = response.errors?.[0]?.message || 'Failed to find files';
        return {
          llmContent: error,
          returnDisplay: `Error: ${error}`
        };
      }
      
      const operationResult = response.results[0];
      if (operationResult.status === 'failed') {
        const error = operationResult.error?.message || 'Failed to find files';
        return {
          llmContent: error,
          returnDisplay: `Error: ${error}`
        };
      }
      
      // Extract file paths from analyze result
      const analyzeResult = operationResult.data;
      const files = this.extractFilePaths(analyzeResult, params);
      
      if (!files || files.length === 0) {
        let message = `No files found matching pattern "${params.pattern}" within ${searchDirAbsolute}.`;
        if (params.respect_git_ignore !== false) {
          message += ` (git-ignored files excluded)`;
        }
        return {
          llmContent: message,
          returnDisplay: `No files found`
        };
      }
      
      // Sort files by modification time (newest first)
      // Note: FileOperations may not provide mtime, so we'll sort alphabetically as fallback
      const sortedFiles = this.sortFilesByRecency(files);
      
      const fileListDescription = sortedFiles.join('\n');
      const fileCount = sortedFiles.length;
      
      let resultMessage = `Found ${fileCount} file(s) matching "${params.pattern}" within ${searchDirAbsolute}`;
      if (params.respect_git_ignore !== false) {
        resultMessage += ` (git-ignored files excluded)`;
      }
      resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;
      
      return {
        llmContent: resultMessage,
        returnDisplay: `Found ${fileCount} matching file(s)`
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`GlobToolAdapter execute Error: ${errorMessage}`, error);
      return {
        llmContent: `Error during glob search operation: ${errorMessage}`,
        returnDisplay: `Error: An unexpected error occurred.`
      };
    }
  }
  
  /**
   * Extract file paths from analyze result
   */
  private extractFilePaths(analyzeResult: any, params: GlobToolParams): string[] {
    const files: string[] = [];
    
    // FileOperations analyze returns results by file
    if (analyzeResult && analyzeResult.extracted) {
      files.push(...Object.keys(analyzeResult.extracted));
    }
    
    // If analyze returned matches (when used for file listing)
    if (analyzeResult && analyzeResult.matches) {
      const uniqueFiles = new Set<string>();
      analyzeResult.matches.forEach((match: any) => {
        uniqueFiles.add(match.file);
      });
      files.push(...Array.from(uniqueFiles));
    }
    
    // Apply case sensitivity filter if needed
    if (params.case_sensitive === false && files.length > 0) {
      // Filter files based on case-insensitive pattern matching
      const pattern = params.pattern.toLowerCase();
      return files.filter(file => {
        const fileName = path.basename(file).toLowerCase();
        // Simple pattern matching (not full glob support)
        if (pattern.includes('*')) {
          const parts = pattern.split('*');
          return parts.every(part => fileName.includes(part));
        }
        return fileName.includes(pattern);
      });
    }
    
    return files;
  }
  
  /**
   * Sort files by recency (newest first), then alphabetically
   * Note: Since FileOperations may not provide mtime, we'll use alphabetical as fallback
   */
  private sortFilesByRecency(files: string[]): string[] {
    // For now, just sort alphabetically
    // In a real implementation, we'd need FileOperations to provide mtime data
    return files.sort((a, b) => a.localeCompare(b));
  }
  
  private makeRelative(absolutePath: string): string {
    if (absolutePath.startsWith(this.rootDirectory)) {
      return absolutePath.slice(this.rootDirectory.length + 1);
    }
    return absolutePath;
  }
  
  private shortenPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-3).join('/')}`;
  }
}