/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { BaseTool, ToolResult } from '../../tools.js';
import { GrepToolParams } from '../../grep.js';
import { FileOperationsTool } from '../file-operations.js';
import { 
  FileOperationRequest, 
  AnalyzeOperation,
  SearchOptions
} from '../file-operations-types.js';
import { Config } from '../../../config/config.js';

/**
 * Adapter that maps GrepTool calls to FileOperations analyze operations with search
 * Ensures 100% backward compatibility with the original GrepTool
 */
export class GrepToolAdapter extends BaseTool<GrepToolParams, ToolResult> {
  static readonly Name = 'search_file_content';
  private readonly fileOperationsTool: FileOperationsTool;
  
  constructor(
    private readonly rootDirectory: string,
    private readonly config: Config
  ) {
    super(
      GrepToolAdapter.Name,
      'SearchText',
      'Searches for a regular expression pattern within the content of files in a specified directory (or current working directory). Can filter files by a glob pattern. Returns the lines containing matches, along with their file paths and line numbers.',
      {
        properties: {
          pattern: {
            description:
              "The regular expression (regex) pattern to search for within file contents (e.g., 'function\\s+myFunction', 'import\\s+\\{.*\\}\\s+from\\s+.*').",
            type: 'string',
          },
          path: {
            description:
              'Optional: The absolute path to the directory to search within. If omitted, searches the current working directory.',
            type: 'string',
          },
          include: {
            description:
              "Optional: A glob pattern to filter which files are searched (e.g., '*.js', '*.{ts,tsx}', 'src/**'). If omitted, searches all files (respecting potential global ignores).",
            type: 'string',
          },
        },
        required: ['pattern'],
        type: 'object',
      }
    );
    
    this.rootDirectory = path.resolve(rootDirectory);
    this.fileOperationsTool = new FileOperationsTool(config, this.rootDirectory);
  }
  
  validateToolParams(params: GrepToolParams): string | null {
    try {
      new RegExp(params.pattern);
    } catch (error) {
      return `Invalid regular expression pattern provided: ${params.pattern}. Error: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    if (params.path) {
      const targetPath = path.resolve(this.rootDirectory, params.path);
      if (!this.isWithinRoot(targetPath)) {
        return `Path validation failed: Attempted path "${params.path}" resolves outside the allowed root directory "${this.rootDirectory}".`;
      }
    }
    
    return null;
  }
  
  private isWithinRoot(targetPath: string): boolean {
    return (
      targetPath.startsWith(this.rootDirectory) ||
      targetPath === this.rootDirectory
    );
  }
  
  getDescription(params: GrepToolParams): string {
    let description = `'${params.pattern}'`;
    if (params.include) {
      description += ` in ${params.include}`;
    }
    if (params.path) {
      const resolvedPath = path.resolve(this.rootDirectory, params.path);
      if (resolvedPath === this.rootDirectory || params.path === '.') {
        description += ` within ./`;
      } else {
        const relativePath = this.makeRelative(resolvedPath);
        description += ` within ${this.shortenPath(relativePath)}`;
      }
    }
    return description;
  }
  
  async execute(
    params: GrepToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `Model provided invalid parameters. Error: ${validationError}`
      };
    }
    
    try {
      const searchDirAbs = path.resolve(this.rootDirectory, params.path || '.');
      const searchDirDisplay = params.path || '.';
      
      // Build search paths based on include pattern
      const searchPaths = params.include 
        ? [path.join(params.path || '.', params.include)]
        : [params.path || '**/*'];
      
      // Create analyze operation with search
      const searchOptions: SearchOptions = {
        pattern: params.pattern,
        type: 'regex',
        caseSensitive: false, // GrepTool default behavior
        contextLines: 0 // No context lines by default
      };
      
      const analyzeOp: AnalyzeOperation = {
        type: 'analyze',
        paths: searchPaths,
        search: searchOptions,
        extract: [], // Don't extract AST data, just search
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
      
      // Parse response and transform to GrepTool format
      const response = JSON.parse(result.llmContent);
      
      if (!response.success || response.results.length === 0) {
        const error = response.errors?.[0]?.message || 'Failed to search files';
        return {
          llmContent: `Error during grep search operation: ${error}`,
          returnDisplay: `Error: ${error}`
        };
      }
      
      const operationResult = response.results[0];
      if (operationResult.status === 'failed') {
        const error = operationResult.error?.message || 'Failed to search files';
        return {
          llmContent: `Error during grep search operation: ${error}`,
          returnDisplay: `Error: ${error}`
        };
      }
      
      // Extract matches from analyze result
      const analyzeResult = operationResult.data;
      const matches = analyzeResult?.matches || [];
      
      if (matches.length === 0) {
        const noMatchMsg = `No matches found for pattern "${params.pattern}" in path "${searchDirDisplay}"${params.include ? ` (filter: "${params.include}")` : ''}.`;
        return { 
          llmContent: noMatchMsg, 
          returnDisplay: `No matches found` 
        };
      }
      
      // Group matches by file (matching GrepTool format)
      const matchesByFile = this.groupMatchesByFile(matches, searchDirAbs);
      
      // Build output matching GrepTool format
      let llmContent = `Found ${matches.length} match(es) for pattern "${params.pattern}" in path "${searchDirDisplay}"${params.include ? ` (filter: "${params.include}")` : ''}:\n---\n`;
      
      for (const [filePath, fileMatches] of Object.entries(matchesByFile)) {
        llmContent += `File: ${filePath}\n`;
        fileMatches.forEach((match: any) => {
          const trimmedLine = match.match.trim();
          llmContent += `L${match.line}: ${trimmedLine}\n`;
        });
        llmContent += '---\n';
      }
      
      return {
        llmContent: llmContent.trim(),
        returnDisplay: `Found ${matches.length} matche(s)`
      };
      
    } catch (error) {
      console.error(`Error during GrepToolAdapter execution: ${error}`);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error during grep search operation: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`
      };
    }
  }
  
  /**
   * Group matches by file and sort by line number
   */
  private groupMatchesByFile(
    matches: any[], 
    searchDirAbs: string
  ): Record<string, any[]> {
    const matchesByFile: Record<string, any[]> = {};
    
    for (const match of matches) {
      const relativeFilePath = path.relative(searchDirAbs, match.file) || path.basename(match.file);
      
      if (!matchesByFile[relativeFilePath]) {
        matchesByFile[relativeFilePath] = [];
      }
      
      matchesByFile[relativeFilePath].push(match);
    }
    
    // Sort matches within each file by line number
    for (const filePath in matchesByFile) {
      matchesByFile[filePath].sort((a, b) => a.line - b.line);
    }
    
    return matchesByFile;
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