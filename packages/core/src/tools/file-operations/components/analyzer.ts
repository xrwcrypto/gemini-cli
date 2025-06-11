/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { globby } from 'globby';
import { ASTParserService, ParsedSymbol, ASTQuery } from '../services/ast-parser.js';
import { FileSystemService } from '../services/file-system-service.js';
import { CacheManager } from '../services/cache-manager.js';
import { AnalyzeOperation, FileInfo } from '../file-operations-types.js';

/**
 * Pattern match result
 */
export interface PatternMatch {
  file: string;
  line: number;
  column: number;
  match: string;
  context?: string;
}

/**
 * File analysis result
 */
export interface FileAnalysis {
  path: string;
  size: number;
  lines: number;
  language?: string;
  imports: string[];
  exports: string[];
  symbols: ParsedSymbol[];
  complexity?: number;
  dependencies: string[];
}

/**
 * Dependency graph node
 */
export interface DependencyNode {
  path: string;
  imports: string[];
  exports: string[];
  dependents: string[]; // Files that depend on this file
  dependencies: string[]; // Files this file depends on
}

/**
 * Dependency graph
 */
export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  roots: string[]; // Files with no dependencies
  leaves: string[]; // Files with no dependents
  cycles: string[][]; // Detected circular dependencies
}

/**
 * Analysis result
 */
export interface AnalysisResult {
  files: FileAnalysis[];
  patterns?: PatternMatch[];
  dependencyGraph?: DependencyGraph;
  summary: {
    totalFiles: number;
    totalLines: number;
    totalSize: number;
    languages: Record<string, number>;
    averageComplexity?: number;
  };
}

/**
 * Analyzer options
 */
export interface AnalyzerOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  maxDepth?: number;
  followSymlinks?: boolean;
  analyzeDependencies?: boolean;
  calculateComplexity?: boolean;
}

/**
 * Complexity metrics
 */
interface ComplexityMetrics {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  linesOfCode: number;
  linesOfComments: number;
}

/**
 * Analyzer Component
 * Provides comprehensive code analysis capabilities
 */
export class Analyzer {
  private readonly astParser: ASTParserService;
  private readonly fileService: FileSystemService;
  private readonly cacheManager: CacheManager;

  constructor(
    astParser: ASTParserService,
    fileService: FileSystemService,
    cacheManager: CacheManager
  ) {
    this.astParser = astParser;
    this.fileService = fileService;
    this.cacheManager = cacheManager;
  }

  /**
   * Analyze files based on operation
   */
  async analyze(operation: AnalyzeOperation, options: AnalyzerOptions = {}): Promise<AnalysisResult> {
    const files = await this.findFiles(operation.paths, options);
    const fileAnalyses: FileAnalysis[] = [];
    const patternMatches: PatternMatch[] = [];

    // Analyze each file
    for (const filePath of files) {
      const analysis = await this.analyzeFile(filePath, options);
      if (analysis) {
        fileAnalyses.push(analysis);
      }

      // Pattern matching if requested
      if (operation.patterns) {
        const matches = await this.findPatterns(filePath, operation.patterns);
        patternMatches.push(...matches);
      }
    }

    // Build dependency graph if requested
    let dependencyGraph: DependencyGraph | undefined;
    if (options.analyzeDependencies) {
      dependencyGraph = this.buildDependencyGraph(fileAnalyses);
    }

    // Calculate summary
    const summary = this.calculateSummary(fileAnalyses);

    return {
      files: fileAnalyses,
      patterns: patternMatches.length > 0 ? patternMatches : undefined,
      dependencyGraph,
      summary
    };
  }

  /**
   * Find files matching patterns
   */
  private async findFiles(paths: string[], options: AnalyzerOptions): Promise<string[]> {
    const patterns = paths.length > 0 ? paths : ['**/*'];
    const ignorePatterns = options.excludePatterns || ['**/node_modules/**', '**/.git/**'];

    const files = await globby(patterns, {
      ignore: ignorePatterns,
      onlyFiles: true,
      followSymbolicLinks: options.followSymlinks ?? false,
      deep: options.maxDepth
    });

    return files;
  }

  /**
   * Analyze a single file
   */
  private async analyzeFile(filePath: string, options: AnalyzerOptions): Promise<FileAnalysis | null> {
    try {
      // Get file content from cache
      const content = await this.cacheManager.get(filePath);
      if (!content || content.error) {
        return null;
      }

      // Get file stats
      const stats = await fs.stat(filePath);
      
      // Detect language
      const language = this.astParser.detectLanguage(filePath) || null;
      
      // Parse AST if language is supported
      let imports: string[] = [];
      let exports: string[] = [];
      let symbols: ParsedSymbol[] = [];
      let complexity: number | undefined;

      if (language && typeof content.llmContent === 'string') {
        const parsed = await this.astParser.parseFile(filePath, content.llmContent);
        
        if (parsed) {
          // Extract imports and exports from ParseResult
          imports = parsed.imports.map(imp => imp.from);
          exports = parsed.exports.map(exp => exp.name);
          symbols = parsed.symbols;

          // Calculate complexity if requested
          if (options.calculateComplexity) {
            complexity = this.calculateComplexity(content.llmContent, symbols);
          }
        }
      }

      // Count lines
      const lines = typeof content.llmContent === 'string' 
        ? content.llmContent.split('\n').length 
        : 0;

      // Extract dependencies
      const dependencies = this.extractDependencies(filePath, imports);

      return {
        path: filePath,
        size: stats.size,
        lines,
        language: language || undefined,
        imports,
        exports,
        symbols,
        complexity,
        dependencies
      };
    } catch (error) {
      console.error(`Failed to analyze file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Find pattern matches in file
   */
  private async findPatterns(filePath: string, patterns: string[]): Promise<PatternMatch[]> {
    const matches: PatternMatch[] = [];
    
    try {
      const content = await this.cacheManager.get(filePath);
      if (!content || content.error || typeof content.llmContent !== 'string') {
        return matches;
      }

      const lines = content.llmContent.split('\n');
      
      for (const pattern of patterns) {
        const regex = new RegExp(pattern, 'gm');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content.llmContent)) !== null) {
          // Calculate line and column
          const beforeMatch = content.llmContent.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;
          const lastNewline = beforeMatch.lastIndexOf('\n');
          const column = match.index - lastNewline;

          // Get context (surrounding lines)
          const contextStart = Math.max(0, lineNumber - 2);
          const contextEnd = Math.min(lines.length, lineNumber + 2);
          const context = lines.slice(contextStart - 1, contextEnd).join('\n');

          matches.push({
            file: filePath,
            line: lineNumber,
            column,
            match: match[0],
            context
          });
        }
      }
    } catch (error) {
      console.error(`Failed to find patterns in ${filePath}:`, error);
    }

    return matches;
  }

  /**
   * Build dependency graph from file analyses
   */
  private buildDependencyGraph(fileAnalyses: FileAnalysis[]): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const fileMap = new Map<string, FileAnalysis>();

    // Create map for quick lookup
    for (const analysis of fileAnalyses) {
      fileMap.set(analysis.path, analysis);
      nodes.set(analysis.path, {
        path: analysis.path,
        imports: analysis.imports,
        exports: analysis.exports,
        dependents: [],
        dependencies: analysis.dependencies
      });
    }

    // Build dependents relationships
    for (const analysis of fileAnalyses) {
      for (const dep of analysis.dependencies) {
        const depNode = nodes.get(dep);
        if (depNode) {
          depNode.dependents.push(analysis.path);
        }
      }
    }

    // Find roots and leaves
    const roots: string[] = [];
    const leaves: string[] = [];

    for (const [filePath, node] of nodes) {
      if (node.dependencies.length === 0) {
        roots.push(filePath);
      }
      if (node.dependents.length === 0) {
        leaves.push(filePath);
      }
    }

    // Detect cycles
    const cycles = this.detectCycles(nodes);

    return {
      nodes,
      roots,
      leaves,
      cycles
    };
  }

  /**
   * Detect circular dependencies
   */
  private detectCycles(nodes: Map<string, DependencyNode>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];

    const dfs = (filePath: string): void => {
      visited.add(filePath);
      recursionStack.add(filePath);
      currentPath.push(filePath);

      const node = nodes.get(filePath);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            dfs(dep);
          } else if (recursionStack.has(dep)) {
            // Found cycle
            const cycleStart = currentPath.indexOf(dep);
            const cycle = currentPath.slice(cycleStart);
            cycle.push(dep); // Complete the cycle
            cycles.push(cycle);
          }
        }
      }

      currentPath.pop();
      recursionStack.delete(filePath);
    };

    for (const filePath of nodes.keys()) {
      if (!visited.has(filePath)) {
        dfs(filePath);
      }
    }

    return cycles;
  }

  /**
   * Extract dependencies from imports
   */
  private extractDependencies(filePath: string, imports: string[]): string[] {
    const dependencies: string[] = [];
    const fileDir = path.dirname(filePath);

    for (const importPath of imports) {
      // Skip external modules
      if (!importPath.startsWith('.')) {
        continue;
      }

      // Resolve relative import
      let resolvedPath = path.resolve(fileDir, importPath);
      
      // Add common extensions if not present
      if (!path.extname(resolvedPath)) {
        const extensions = ['.ts', '.tsx', '.js', '.jsx'];
        for (const ext of extensions) {
          const withExt = resolvedPath + ext;
          // In real implementation, would check if file exists
          resolvedPath = withExt;
          break;
        }
      }

      dependencies.push(resolvedPath);
    }

    return dependencies;
  }

  /**
   * Calculate file complexity
   */
  private calculateComplexity(content: string, symbols: ParsedSymbol[]): number {
    const metrics = this.calculateComplexityMetrics(content, symbols);
    
    // Simple weighted average of different complexity metrics
    return Math.round(
      (metrics.cyclomaticComplexity * 0.4) +
      (metrics.cognitiveComplexity * 0.4) +
      (metrics.linesOfCode / 100 * 0.2)
    );
  }

  /**
   * Calculate detailed complexity metrics
   */
  private calculateComplexityMetrics(content: string, symbols: ParsedSymbol[]): ComplexityMetrics {
    const lines = content.split('\n');
    let cyclomaticComplexity = 1; // Base complexity
    let cognitiveComplexity = 0;
    let linesOfCode = 0;
    let linesOfComments = 0;

    // Simple heuristic-based calculation
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines
      if (!trimmed) continue;

      // Count comments
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        linesOfComments++;
        continue;
      }

      linesOfCode++;

      // Increase cyclomatic complexity for control flow statements
      if (/\b(if|else if|for|while|switch|case|catch)\b/.test(trimmed)) {
        cyclomaticComplexity++;
      }

      // Increase cognitive complexity for nested structures
      const indentLevel = line.search(/\S/);
      if (indentLevel > 0 && /\b(if|for|while)\b/.test(trimmed)) {
        cognitiveComplexity += Math.floor(indentLevel / 2);
      }
    }

    // Add complexity based on symbol count and types
    for (const symbol of symbols) {
      if (symbol.type === 'function') {
        cyclomaticComplexity++;
      }
    }

    return {
      cyclomaticComplexity,
      cognitiveComplexity,
      linesOfCode,
      linesOfComments
    };
  }

  /**
   * Calculate analysis summary
   */
  private calculateSummary(fileAnalyses: FileAnalysis[]): AnalysisResult['summary'] {
    let totalLines = 0;
    let totalSize = 0;
    let totalComplexity = 0;
    let complexityCount = 0;
    const languages: Record<string, number> = {};

    for (const analysis of fileAnalyses) {
      totalLines += analysis.lines;
      totalSize += analysis.size;
      
      if (analysis.language) {
        languages[analysis.language] = (languages[analysis.language] || 0) + 1;
      }

      if (analysis.complexity !== undefined) {
        totalComplexity += analysis.complexity;
        complexityCount++;
      }
    }

    return {
      totalFiles: fileAnalyses.length,
      totalLines,
      totalSize,
      languages,
      averageComplexity: complexityCount > 0 ? totalComplexity / complexityCount : undefined
    };
  }

  /**
   * Search symbols using AST query
   */
  async searchSymbols(files: string[], query: ASTQuery): Promise<Record<string, ParsedSymbol[]>> {
    const results: Record<string, ParsedSymbol[]> = {};

    for (const filePath of files) {
      const content = await this.cacheManager.get(filePath);
      if (!content || content.error || typeof content.llmContent !== 'string') {
        continue;
      }

      const language = this.astParser.detectLanguage(filePath);
      if (!language || language === 'unknown') {
        continue;
      }

      const symbols = await this.astParser.searchSymbols(filePath, content.llmContent, query);
      if (symbols.length > 0) {
        results[filePath] = symbols;
      }
    }

    return results;
  }

  /**
   * Extract file info for validation
   */
  async extractFileInfo(filePath: string): Promise<FileInfo | null> {
    try {
      const content = await this.cacheManager.get(filePath);
      if (!content || content.error) {
        return null;
      }

      const stats = await fs.stat(filePath);
      const language = this.astParser.detectLanguage(filePath);

      return {
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        language: language || null
      };
    } catch (error) {
      console.error(`Failed to extract file info for ${filePath}:`, error);
      return null;
    }
  }
}