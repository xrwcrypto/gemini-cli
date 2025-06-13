/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import mime from 'mime-types';
import { SupportedLanguage } from '../services/ast-parser.js';

/**
 * Language detection result
 */
export interface LanguageDetectionResult {
  /** Detected language */
  language: SupportedLanguage;
  /** Confidence score (0-1) */
  confidence: number;
  /** Detection method used */
  method: 'extension' | 'shebang' | 'content' | 'mime' | 'filename' | 'fallback';
  /** Additional metadata */
  metadata: {
    /** File extension */
    extension?: string;
    /** MIME type */
    mimeType?: string;
    /** Detected patterns */
    patterns?: string[];
    /** Alternative language candidates */
    alternatives?: Array<{ language: SupportedLanguage; confidence: number }>;
  };
}

/**
 * Language detection options
 */
export interface LanguageDetectionOptions {
  /** Enable content-based detection */
  analyzeContent?: boolean;
  /** Maximum content size to analyze (in bytes) */
  maxContentSize?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Enable fallback to unknown */
  allowUnknown?: boolean;
  /** Custom language patterns */
  customPatterns?: Record<string, RegExp[]>;
}

/**
 * Language pattern definitions for content-based detection
 */
interface LanguagePattern {
  language: SupportedLanguage;
  patterns: Array<{
    regex: RegExp;
    weight: number;
    description: string;
  }>;
  keywords: string[];
  indicators: string[];
}

/**
 * Enhanced language detection utility
 */
export class LanguageDetector {
  private static readonly EXTENSION_MAP: Record<string, SupportedLanguage> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.pyi': 'python',
    '.pyw': 'python',
    '.go': 'go',
    '.java': 'java',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.cc': 'cpp',
    '.c++': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',
    '.hh': 'cpp',
    '.h++': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.rs': 'rust',
    '.rlib': 'rust'
  };

  private static readonly FILENAME_PATTERNS: Array<{
    pattern: RegExp;
    language: SupportedLanguage;
    confidence: number;
  }> = [
    { pattern: /^Dockerfile$/i, language: 'unknown', confidence: 0.9 },
    { pattern: /^Makefile$/i, language: 'unknown', confidence: 0.9 },
    { pattern: /^CMakeLists\.txt$/i, language: 'cpp', confidence: 0.8 },
    { pattern: /^setup\.py$/i, language: 'python', confidence: 0.9 },
    { pattern: /^requirements\.txt$/i, language: 'python', confidence: 0.7 },
    { pattern: /^package\.json$/i, language: 'javascript', confidence: 0.8 },
    { pattern: /^tsconfig\.json$/i, language: 'typescript', confidence: 0.9 },
    { pattern: /^go\.mod$/i, language: 'go', confidence: 0.9 },
    { pattern: /^go\.sum$/i, language: 'go', confidence: 0.8 },
    { pattern: /^Cargo\.toml$/i, language: 'rust', confidence: 0.9 },
    { pattern: /^pom\.xml$/i, language: 'java', confidence: 0.8 }
  ];

  private static readonly SHEBANG_PATTERNS: Array<{
    pattern: RegExp;
    language: SupportedLanguage;
    confidence: number;
  }> = [
    { pattern: /^#!.*\bnode\b/, language: 'javascript', confidence: 0.9 },
    { pattern: /^#!.*\bpython\b/, language: 'python', confidence: 0.9 },
    { pattern: /^#!.*\bpython3\b/, language: 'python', confidence: 0.95 },
    { pattern: /^#!.*\bgo\b/, language: 'go', confidence: 0.8 },
    { pattern: /^#!.*\/bin\/sh/, language: 'unknown', confidence: 0.7 },
    { pattern: /^#!.*\/bin\/bash/, language: 'unknown', confidence: 0.7 }
  ];

  private static readonly LANGUAGE_PATTERNS: LanguagePattern[] = [
    {
      language: 'typescript',
      patterns: [
        { regex: /\binterface\s+\w+/g, weight: 3, description: 'TypeScript interface' },
        { regex: /\btype\s+\w+\s*=/g, weight: 3, description: 'TypeScript type alias' },
        { regex: /:\s*\w+(\[\]|\<.*?\>)?(\s*\|\s*\w+)*\s*[;,=)]/g, weight: 2, description: 'TypeScript type annotations' },
        { regex: /\bimport.*from\s+['"][^'"]+['"];?$/gm, weight: 2, description: 'ES6 imports' },
        { regex: /\bexport\s+(interface|type|class|function|const|let|var)\b/g, weight: 2, description: 'TypeScript exports' },
        { regex: /\bas\s+\w+/g, weight: 1, description: 'TypeScript type assertions' },
        { regex: /\<.*?\>/g, weight: 1, description: 'Generic types' }
      ],
      keywords: ['interface', 'type', 'namespace', 'declare', 'readonly', 'public', 'private', 'protected'],
      indicators: ['tsc', 'TypeScript', '@types/', 'ts-node']
    },
    {
      language: 'javascript',
      patterns: [
        { regex: /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g, weight: 3, description: 'CommonJS require' },
        { regex: /module\.exports\s*=/g, weight: 3, description: 'CommonJS exports' },
        { regex: /\bimport.*from\s+['"][^'"]+['"];?$/gm, weight: 2, description: 'ES6 imports' },
        { regex: /\bexport\s+(default\s+)?(class|function|const|let|var)\b/g, weight: 2, description: 'ES6 exports' },
        { regex: /\bfunction\s+\w+\s*\(/g, weight: 1, description: 'Function declarations' },
        { regex: /\b(var|let|const)\s+\w+/g, weight: 1, description: 'Variable declarations' }
      ],
      keywords: ['function', 'var', 'let', 'const', 'require', 'module', 'exports'],
      indicators: ['node', 'npm', 'package.json', 'webpack', 'babel']
    },
    {
      language: 'python',
      patterns: [
        { regex: /^def\s+\w+\s*\(/gm, weight: 3, description: 'Python function definition' },
        { regex: /^class\s+\w+\s*(\([^)]*\))?\s*:/gm, weight: 3, description: 'Python class definition' },
        { regex: /^import\s+\w+/gm, weight: 2, description: 'Python import' },
        { regex: /^from\s+[\w.]+\s+import\s+/gm, weight: 2, description: 'Python from import' },
        { regex: /\bif\s+__name__\s*==\s*['"]__main__['"]:/g, weight: 3, description: 'Python main guard' },
        { regex: /^\s*#.*$/gm, weight: 1, description: 'Python comments' },
        { regex: /\bself\b/g, weight: 1, description: 'Python self parameter' }
      ],
      keywords: ['def', 'class', 'import', 'from', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally'],
      indicators: ['python', 'pip', 'virtualenv', 'conda', '__pycache__']
    },
    {
      language: 'go',
      patterns: [
        { regex: /^package\s+\w+/gm, weight: 5, description: 'Go package declaration' },
        { regex: /^func\s+\w+\s*\(/gm, weight: 3, description: 'Go function declaration' },
        { regex: /^func\s*\([^)]*\)\s*\w+\s*\(/gm, weight: 3, description: 'Go method declaration' },
        { regex: /^type\s+\w+\s+struct\s*\{/gm, weight: 3, description: 'Go struct declaration' },
        { regex: /^type\s+\w+\s+interface\s*\{/gm, weight: 3, description: 'Go interface declaration' },
        { regex: /\bimport\s*\(\s*$/gm, weight: 2, description: 'Go import block' },
        { regex: /:=\s*/g, weight: 2, description: 'Go short variable declaration' }
      ],
      keywords: ['package', 'import', 'func', 'type', 'struct', 'interface', 'const', 'var', 'go', 'defer', 'chan'],
      indicators: ['go.mod', 'go.sum', 'golang', 'gofmt']
    },
    {
      language: 'java',
      patterns: [
        { regex: /^package\s+[\w.]+;/gm, weight: 4, description: 'Java package declaration' },
        { regex: /^import\s+[\w.]+;/gm, weight: 2, description: 'Java import' },
        { regex: /\bpublic\s+class\s+\w+/g, weight: 3, description: 'Java public class' },
        { regex: /\bpublic\s+static\s+void\s+main\s*\(/g, weight: 4, description: 'Java main method' },
        { regex: /\b(public|private|protected)\s+(static\s+)?(final\s+)?\w+\s+\w+\s*\(/g, weight: 2, description: 'Java method declaration' },
        { regex: /\bnew\s+\w+\s*\(/g, weight: 1, description: 'Java object instantiation' }
      ],
      keywords: ['public', 'private', 'protected', 'static', 'final', 'abstract', 'class', 'interface', 'extends', 'implements'],
      indicators: ['javac', 'maven', 'gradle', 'pom.xml', '.class']
    },
    {
      language: 'cpp',
      patterns: [
        { regex: /#include\s*<[^>]+>/g, weight: 3, description: 'C++ system include' },
        { regex: /#include\s*"[^"]+"/g, weight: 2, description: 'C++ local include' },
        { regex: /\bnamespace\s+\w+/g, weight: 3, description: 'C++ namespace' },
        { regex: /\bclass\s+\w+/g, weight: 2, description: 'C++ class' },
        { regex: /\btemplate\s*</g, weight: 2, description: 'C++ template' },
        { regex: /\bstd::/g, weight: 2, description: 'C++ standard library' },
        { regex: /\b(public|private|protected)\s*:/g, weight: 1, description: 'C++ access specifiers' }
      ],
      keywords: ['namespace', 'class', 'template', 'typename', 'virtual', 'override', 'const', 'constexpr'],
      indicators: ['g++', 'clang++', 'cmake', 'make', '.hpp', '.cpp']
    },
    {
      language: 'c',
      patterns: [
        { regex: /#include\s*<[^>]+>/g, weight: 2, description: 'C system include' },
        { regex: /#include\s*"[^"]+"/g, weight: 2, description: 'C local include' },
        { regex: /\bint\s+main\s*\(/g, weight: 3, description: 'C main function' },
        { regex: /\btypedef\s+/g, weight: 2, description: 'C typedef' },
        { regex: /\bstruct\s+\w+/g, weight: 2, description: 'C struct' },
        { regex: /\bmalloc\s*\(/g, weight: 2, description: 'C memory allocation' },
        { regex: /\bprintf\s*\(/g, weight: 1, description: 'C printf function' }
      ],
      keywords: ['typedef', 'struct', 'union', 'enum', 'sizeof', 'malloc', 'free', 'static', 'extern'],
      indicators: ['gcc', 'clang', 'make', '.h', '.c']
    },
    {
      language: 'rust',
      patterns: [
        { regex: /\bfn\s+\w+\s*\(/g, weight: 3, description: 'Rust function' },
        { regex: /\bstruct\s+\w+/g, weight: 2, description: 'Rust struct' },
        { regex: /\benum\s+\w+/g, weight: 2, description: 'Rust enum' },
        { regex: /\buse\s+[\w:]+;/g, weight: 2, description: 'Rust use statement' },
        { regex: /\blet\s+(mut\s+)?\w+/g, weight: 2, description: 'Rust variable binding' },
        { regex: /\bmatch\s+\w+\s*\{/g, weight: 2, description: 'Rust match expression' },
        { regex: /\bimpl\s+/g, weight: 2, description: 'Rust implementation' }
      ],
      keywords: ['fn', 'let', 'mut', 'struct', 'enum', 'impl', 'trait', 'use', 'mod', 'pub', 'match'],
      indicators: ['cargo', 'rustc', 'Cargo.toml', '.rs']
    }
  ];

  private options: LanguageDetectionOptions;

  constructor(options: LanguageDetectionOptions = {}) {
    this.options = {
      analyzeContent: true,
      maxContentSize: 10 * 1024, // 10KB
      minConfidence: 0.5,
      allowUnknown: true,
      customPatterns: {},
      ...options
    };
  }

  /**
   * Detect language from file path and content
   */
  async detectLanguage(filePath: string, content?: string): Promise<LanguageDetectionResult> {
    const candidates: Array<{ language: SupportedLanguage; confidence: number; method: string }> = [];

    // Try extension-based detection first
    const extensionResult = this.detectByExtension(filePath);
    if (extensionResult) {
      candidates.push({
        language: extensionResult.language,
        confidence: extensionResult.confidence,
        method: 'extension'
      });
    }

    // Try filename pattern detection
    const filenameResult = this.detectByFilename(filePath);
    if (filenameResult) {
      candidates.push({
        language: filenameResult.language,
        confidence: filenameResult.confidence,
        method: 'filename'
      });
    }

    // Try MIME type detection
    const mimeResult = this.detectByMimeType(filePath);
    if (mimeResult) {
      candidates.push({
        language: mimeResult.language,
        confidence: mimeResult.confidence,
        method: 'mime'
      });
    }

    // Try content-based detection if content is provided
    if (content && this.options.analyzeContent) {
      const contentResults = await this.detectByContent(content);
      candidates.push(...contentResults.map(result => ({
        language: result.language,
        confidence: result.confidence,
        method: 'content' as const
      })));

      // Try shebang detection
      const shebangResult = this.detectByShebang(content);
      if (shebangResult) {
        candidates.push({
          language: shebangResult.language,
          confidence: shebangResult.confidence,
          method: 'shebang'
        });
      }
    }

    // Sort candidates by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);

    // Find the best result
    const bestCandidate = candidates.find(c => c.confidence >= (this.options.minConfidence || 0.5));
    
    if (!bestCandidate) {
      // Fallback to unknown if allowed
      if (this.options.allowUnknown) {
        return {
          language: 'unknown',
          confidence: 0.1,
          method: 'fallback',
          metadata: {
            extension: path.extname(filePath),
            alternatives: candidates.map(c => ({ language: c.language, confidence: c.confidence }))
          }
        };
      } else {
        // Return the best candidate even if confidence is low
        const fallback = candidates[0] || { language: 'unknown' as SupportedLanguage, confidence: 0.1, method: 'fallback' };
        return {
          language: fallback.language,
          confidence: fallback.confidence,
          method: fallback.method as any,
          metadata: {
            extension: path.extname(filePath),
            alternatives: candidates.slice(1).map(c => ({ language: c.language, confidence: c.confidence }))
          }
        };
      }
    }

    return {
      language: bestCandidate.language,
      confidence: bestCandidate.confidence,
      method: bestCandidate.method as any,
      metadata: {
        extension: path.extname(filePath),
        mimeType: mime.lookup(filePath) || undefined,
        alternatives: candidates.slice(1).map(c => ({ language: c.language, confidence: c.confidence }))
      }
    };
  }

  /**
   * Detect language by file extension
   */
  private detectByExtension(filePath: string): { language: SupportedLanguage; confidence: number } | null {
    const ext = path.extname(filePath).toLowerCase();
    const language = LanguageDetector.EXTENSION_MAP[ext];
    
    if (language) {
      return { language, confidence: 0.8 };
    }
    
    return null;
  }

  /**
   * Detect language by filename patterns
   */
  private detectByFilename(filePath: string): { language: SupportedLanguage; confidence: number } | null {
    const filename = path.basename(filePath);
    
    for (const pattern of LanguageDetector.FILENAME_PATTERNS) {
      if (pattern.pattern.test(filename)) {
        return { language: pattern.language, confidence: pattern.confidence };
      }
    }
    
    return null;
  }

  /**
   * Detect language by MIME type
   */
  private detectByMimeType(filePath: string): { language: SupportedLanguage; confidence: number } | null {
    const mimeType = mime.lookup(filePath);
    
    if (!mimeType) return null;
    
    const mimeToLanguage: Record<string, { language: SupportedLanguage; confidence: number }> = {
      'application/javascript': { language: 'javascript', confidence: 0.7 },
      'application/typescript': { language: 'typescript', confidence: 0.8 },
      'text/x-python': { language: 'python', confidence: 0.7 },
      'text/x-go': { language: 'go', confidence: 0.7 },
      'text/x-java-source': { language: 'java', confidence: 0.7 },
      'text/x-c': { language: 'c', confidence: 0.7 },
      'text/x-c++': { language: 'cpp', confidence: 0.7 },
      'text/x-rust': { language: 'rust', confidence: 0.7 }
    };
    
    return mimeToLanguage[mimeType] || null;
  }

  /**
   * Detect language by shebang line
   */
  private detectByShebang(content: string): { language: SupportedLanguage; confidence: number } | null {
    const firstLine = content.split('\n')[0];
    
    if (!firstLine.startsWith('#!')) return null;
    
    for (const pattern of LanguageDetector.SHEBANG_PATTERNS) {
      if (pattern.pattern.test(firstLine)) {
        return { language: pattern.language, confidence: pattern.confidence };
      }
    }
    
    return null;
  }

  /**
   * Detect language by content analysis
   */
  private async detectByContent(content: string): Promise<Array<{ language: SupportedLanguage; confidence: number }>> {
    // Limit content size for analysis
    const analysisContent = content.length > (this.options.maxContentSize || 10240) 
      ? content.substring(0, this.options.maxContentSize) 
      : content;

    const results: Array<{ language: SupportedLanguage; confidence: number }> = [];

    for (const pattern of LanguageDetector.LANGUAGE_PATTERNS) {
      let score = 0;
      let matchCount = 0;
      const foundPatterns: string[] = [];

      // Check patterns
      for (const patternDef of pattern.patterns) {
        const matches = analysisContent.match(patternDef.regex);
        if (matches) {
          score += matches.length * patternDef.weight;
          matchCount += matches.length;
          foundPatterns.push(patternDef.description);
        }
      }

      // Check keywords
      for (const keyword of pattern.keywords) {
        const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'g');
        const matches = analysisContent.match(keywordRegex);
        if (matches) {
          score += matches.length * 0.5;
          matchCount += matches.length;
        }
      }

      // Check indicators
      for (const indicator of pattern.indicators) {
        if (analysisContent.includes(indicator)) {
          score += 2;
          matchCount++;
        }
      }

      // Calculate confidence based on score and content length
      if (score > 0) {
        const confidence = Math.min(score / (analysisContent.length / 100), 1.0);
        if (confidence >= 0.1) {
          results.push({ language: pattern.language, confidence });
        }
      }
    }

    // Check custom patterns if provided
    if (this.options.customPatterns) {
      for (const [language, patterns] of Object.entries(this.options.customPatterns)) {
        let score = 0;
        for (const pattern of patterns) {
          const matches = analysisContent.match(pattern);
          if (matches) {
            score += matches.length;
          }
        }
        if (score > 0) {
          const confidence = Math.min(score / 10, 1.0);
          results.push({ language: language as SupportedLanguage, confidence });
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Batch detect languages for multiple files
   */
  async detectLanguages(
    files: Array<{ path: string; content?: string }>
  ): Promise<Map<string, LanguageDetectionResult>> {
    const results = new Map<string, LanguageDetectionResult>();
    
    const detectionPromises = files.map(async file => {
      const result = await this.detectLanguage(file.path, file.content);
      return { path: file.path, result };
    });

    const completedDetections = await Promise.allSettled(detectionPromises);
    
    for (const detection of completedDetections) {
      if (detection.status === 'fulfilled') {
        results.set(detection.value.path, detection.value.result);
      } else {
        // Create error result for failed detections
        results.set('unknown', {
          language: 'unknown',
          confidence: 0,
          method: 'fallback',
          metadata: {}
        });
      }
    }

    return results;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Object.keys(LanguageDetector.EXTENSION_MAP);
  }

  /**
   * Check if a file extension is supported
   */
  isExtensionSupported(extension: string): boolean {
    return extension.toLowerCase() in LanguageDetector.EXTENSION_MAP;
  }

  /**
   * Get language for extension
   */
  getLanguageForExtension(extension: string): SupportedLanguage | null {
    return LanguageDetector.EXTENSION_MAP[extension.toLowerCase()] || null;
  }

  /**
   * Analyze a multi-language project
   */
  async analyzeProject(
    files: Array<{ path: string; content?: string }>
  ): Promise<ProjectAnalysisResult> {
    const detectionResults = await this.detectLanguages(files);
    
    // Group files by language
    const languageGroups = new Map<SupportedLanguage, Array<{ path: string; confidence: number }>>();
    
    for (const [filePath, result] of detectionResults) {
      if (!languageGroups.has(result.language)) {
        languageGroups.set(result.language, []);
      }
      languageGroups.get(result.language)!.push({
        path: filePath,
        confidence: result.confidence
      });
    }

    // Calculate language statistics
    const totalFiles = files.length;
    const languageStats = Array.from(languageGroups.entries()).map(([language, files]) => ({
      language,
      fileCount: files.length,
      percentage: (files.length / totalFiles) * 100,
      averageConfidence: files.reduce((sum, f) => sum + f.confidence, 0) / files.length,
      files: files.map(f => f.path)
    }));

    // Sort by file count (primary language first)
    languageStats.sort((a, b) => b.fileCount - a.fileCount);

    // Detect project patterns
    const patterns = this.detectProjectPatterns(files, languageStats);

    return {
      totalFiles,
      languages: languageStats,
      primaryLanguage: languageStats[0]?.language || 'unknown',
      patterns,
      recommendations: this.generateRecommendations(languageStats, patterns)
    };
  }

  /**
   * Detect common project patterns
   */
  private detectProjectPatterns(
    files: Array<{ path: string; content?: string }>,
    languageStats: Array<{ language: SupportedLanguage; fileCount: number; files: string[] }>
  ): ProjectPattern[] {
    const patterns: ProjectPattern[] = [];
    const filePaths = files.map(f => f.path);

    // Frontend/Backend pattern
    const frontendLanguages = ['typescript', 'javascript'];
    const backendLanguages = ['go', 'python', 'java', 'rust', 'cpp', 'c'];
    
    const hasFrontend = languageStats.some(stat => frontendLanguages.includes(stat.language));
    const hasBackend = languageStats.some(stat => backendLanguages.includes(stat.language));

    if (hasFrontend && hasBackend) {
      patterns.push({
        type: 'full-stack',
        description: 'Full-stack application with frontend and backend components',
        confidence: 0.9,
        evidence: [
          `Frontend: ${languageStats.filter(s => frontendLanguages.includes(s.language)).map(s => s.language).join(', ')}`,
          `Backend: ${languageStats.filter(s => backendLanguages.includes(s.language)).map(s => s.language).join(', ')}`
        ]
      });
    }

    // Microservices pattern
    const serviceDirectories = this.findServiceDirectories(filePaths);
    if (serviceDirectories.length > 1) {
      patterns.push({
        type: 'microservices',
        description: 'Microservices architecture with multiple service directories',
        confidence: 0.8,
        evidence: [`Found ${serviceDirectories.length} service directories: ${serviceDirectories.join(', ')}`]
      });
    }

    // Monorepo pattern
    const packageJsonFiles = filePaths.filter(p => p.includes('package.json')).length;
    const hasWorkspaces = filePaths.some(p => p.includes('packages/') || p.includes('apps/'));
    
    if (packageJsonFiles > 1 || hasWorkspaces) {
      patterns.push({
        type: 'monorepo',
        description: 'Monorepo structure with multiple packages',
        confidence: packageJsonFiles > 2 ? 0.9 : 0.7,
        evidence: [`${packageJsonFiles} package.json files`, hasWorkspaces ? 'Workspace structure detected' : ''].filter(Boolean)
      });
    }

    // Documentation-heavy pattern
    const docFiles = filePaths.filter(p => 
      p.endsWith('.md') || p.endsWith('.rst') || p.includes('docs/') || p.includes('documentation/')
    ).length;
    
    if (docFiles > filePaths.length * 0.3) {
      patterns.push({
        type: 'documentation-heavy',
        description: 'Project with extensive documentation',
        confidence: 0.8,
        evidence: [`${docFiles} documentation files (${Math.round(docFiles / filePaths.length * 100)}% of total)`]
      });
    }

    // Multi-language scripting
    const scriptingLanguages = languageStats.filter(s => ['python', 'javascript', 'go'].includes(s.language));
    if (scriptingLanguages.length >= 2) {
      patterns.push({
        type: 'multi-language-tooling',
        description: 'Multiple scripting languages for different tools/purposes',
        confidence: 0.7,
        evidence: [`Scripting languages: ${scriptingLanguages.map(s => s.language).join(', ')}`]
      });
    }

    return patterns;
  }

  /**
   * Find service directories in file paths
   */
  private findServiceDirectories(filePaths: string[]): string[] {
    const servicePatterns = [
      /^services?\/([^\/]+)/,
      /^microservices\/([^\/]+)/,
      /^apps\/([^\/]+)/,
      /^packages\/([^\/]+)/
    ];

    const services = new Set<string>();

    for (const filePath of filePaths) {
      for (const pattern of servicePatterns) {
        const match = filePath.match(pattern);
        if (match) {
          services.add(match[1]);
        }
      }
    }

    return Array.from(services);
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    languageStats: Array<{ language: SupportedLanguage; fileCount: number; percentage: number }>,
    patterns: ProjectPattern[]
  ): ProjectRecommendation[] {
    const recommendations: ProjectRecommendation[] = [];

    // Language tooling recommendations
    const primaryLanguage = languageStats[0]?.language;
    if (primaryLanguage) {
      const toolingMap: Record<SupportedLanguage, string[]> = {
        'typescript': ['TypeScript Language Server', 'ESLint', 'Prettier'],
        'javascript': ['ESLint', 'Prettier', 'Babel'],
        'python': ['Pylsp/Pyright', 'Black', 'isort', 'mypy'],
        'go': ['gopls', 'gofmt', 'golangci-lint'],
        'java': ['Eclipse JDT', 'Checkstyle', 'SpotBugs'],
        'cpp': ['clangd', 'clang-format', 'clang-tidy'],
        'c': ['clangd', 'clang-format', 'cppcheck'],
        'rust': ['rust-analyzer', 'rustfmt', 'clippy'],
        'unknown': []
      };

      const tools = toolingMap[primaryLanguage] || [];
      if (tools.length > 0) {
        recommendations.push({
          type: 'tooling',
          priority: 'high',
          description: `Configure ${primaryLanguage} development tools`,
          actions: tools.map(tool => `Set up ${tool}`),
          impact: 'Improved code quality and developer experience'
        });
      }
    }

    // Multi-language project recommendations
    if (languageStats.length > 2) {
      recommendations.push({
        type: 'organization',
        priority: 'medium',
        description: 'Consider organizing multi-language codebase',
        actions: [
          'Create language-specific directories',
          'Set up language-specific CI/CD pipelines',
          'Document language choices and conventions'
        ],
        impact: 'Better project organization and maintainability'
      });
    }

    // Pattern-specific recommendations
    for (const pattern of patterns) {
      switch (pattern.type) {
        case 'full-stack':
          recommendations.push({
            type: 'architecture',
            priority: 'medium',
            description: 'Full-stack project optimization',
            actions: [
              'Set up shared type definitions',
              'Configure API contract testing',
              'Implement end-to-end testing'
            ],
            impact: 'Better integration between frontend and backend'
          });
          break;

        case 'microservices':
          recommendations.push({
            type: 'architecture',
            priority: 'high',
            description: 'Microservices best practices',
            actions: [
              'Implement service discovery',
              'Set up centralized logging',
              'Configure service mesh',
              'Implement circuit breakers'
            ],
            impact: 'Improved service reliability and observability'
          });
          break;

        case 'monorepo':
          recommendations.push({
            type: 'tooling',
            priority: 'high',
            description: 'Monorepo tooling setup',
            actions: [
              'Configure workspace management (Lerna, Nx, or Rush)',
              'Set up shared build tools',
              'Implement dependency graph analysis'
            ],
            impact: 'Better dependency management and build optimization'
          });
          break;
      }
    }

    return recommendations;
  }
}

/**
 * Project analysis result
 */
export interface ProjectAnalysisResult {
  /** Total number of files analyzed */
  totalFiles: number;
  /** Language statistics */
  languages: Array<{
    language: SupportedLanguage;
    fileCount: number;
    percentage: number;
    averageConfidence: number;
    files: string[];
  }>;
  /** Primary language of the project */
  primaryLanguage: SupportedLanguage;
  /** Detected project patterns */
  patterns: ProjectPattern[];
  /** Recommendations for the project */
  recommendations: ProjectRecommendation[];
}

/**
 * Project pattern detection result
 */
export interface ProjectPattern {
  /** Pattern type */
  type: 'full-stack' | 'microservices' | 'monorepo' | 'documentation-heavy' | 'multi-language-tooling';
  /** Pattern description */
  description: string;
  /** Confidence score */
  confidence: number;
  /** Evidence supporting this pattern */
  evidence: string[];
}

/**
 * Project recommendation
 */
export interface ProjectRecommendation {
  /** Recommendation type */
  type: 'tooling' | 'architecture' | 'organization';
  /** Priority level */
  priority: 'high' | 'medium' | 'low';
  /** Recommendation description */
  description: string;
  /** Specific actions to take */
  actions: string[];
  /** Expected impact */
  impact: string;
}

/**
 * Mixed-language project analyzer
 */
export class ProjectLanguageAnalyzer {
  private detector: LanguageDetector;

  constructor(options?: LanguageDetectionOptions) {
    this.detector = new LanguageDetector(options);
  }

  /**
   * Analyze language distribution in a project
   */
  async analyzeLanguageDistribution(
    files: Array<{ path: string; content?: string }>
  ): Promise<LanguageDistribution> {
    const detectionResults = await this.detector.detectLanguages(files);
    const languageCounts = new Map<SupportedLanguage, number>();
    const totalFiles = files.length;

    // Count files by language
    for (const [_, result] of detectionResults) {
      const count = languageCounts.get(result.language) || 0;
      languageCounts.set(result.language, count + 1);
    }

    // Calculate distribution
    const distribution = Array.from(languageCounts.entries()).map(([language, count]) => ({
      language,
      count,
      percentage: (count / totalFiles) * 100
    }));

    // Sort by count
    distribution.sort((a, b) => b.count - a.count);

    // Calculate diversity metrics
    const diversity = this.calculateLanguageDiversity(distribution);

    return {
      totalFiles,
      languages: distribution,
      diversity,
      suggestions: this.generateLanguageSuggestions(distribution)
    };
  }

  /**
   * Calculate language diversity metrics
   */
  private calculateLanguageDiversity(
    distribution: Array<{ language: SupportedLanguage; count: number; percentage: number }>
  ): LanguageDiversityMetrics {
    const totalLanguages = distribution.length;
    
    // Shannon entropy for diversity
    const entropy = distribution.reduce((sum, lang) => {
      const probability = lang.percentage / 100;
      return sum - (probability * Math.log2(probability));
    }, 0);

    // Normalized entropy (0-1 scale)
    const maxEntropy = Math.log2(totalLanguages);
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

    // Primary language dominance
    const primaryDominance = distribution[0]?.percentage || 0;

    return {
      totalLanguages,
      entropy,
      normalizedEntropy,
      primaryDominance,
      classification: this.classifyProjectDiversity(normalizedEntropy, primaryDominance)
    };
  }

  /**
   * Classify project diversity
   */
  private classifyProjectDiversity(normalizedEntropy: number, primaryDominance: number): string {
    if (primaryDominance > 80) {
      return 'mono-language';
    } else if (primaryDominance > 60) {
      return 'primary-with-support';
    } else if (normalizedEntropy > 0.7) {
      return 'highly-diverse';
    } else {
      return 'moderately-diverse';
    }
  }

  /**
   * Generate language suggestions
   */
  private generateLanguageSuggestions(
    distribution: Array<{ language: SupportedLanguage; count: number; percentage: number }>
  ): LanguageSuggestion[] {
    const suggestions: LanguageSuggestion[] = [];

    // Suggest consolidation if too many minor languages
    const minorLanguages = distribution.filter(d => d.percentage < 5);
    if (minorLanguages.length > 3) {
      suggestions.push({
        type: 'consolidation',
        description: 'Consider consolidating minor languages',
        languages: minorLanguages.map(l => l.language),
        rationale: 'Reducing language diversity can improve maintainability and reduce complexity'
      });
    }

    // Suggest primary language adoption for related tasks
    const primaryLanguage = distribution[0]?.language;
    if (primaryLanguage && distribution[0].percentage > 50) {
      const relatedTasks: Record<SupportedLanguage, string[]> = {
        'typescript': ['scripting', 'configuration', 'tooling'],
        'javascript': ['scripting', 'configuration', 'tooling'],
        'python': ['automation', 'data processing', 'scripting'],
        'go': ['microservices', 'CLI tools', 'system programming'],
        'java': ['enterprise applications', 'microservices'],
        'cpp': ['system programming', 'performance-critical components'],
        'c': ['system programming', 'embedded development'],
        'rust': ['system programming', 'performance-critical components'],
        'unknown': []
      };

      const tasks = relatedTasks[primaryLanguage] || [];
      if (tasks.length > 0) {
        suggestions.push({
          type: 'standardization',
          description: `Consider using ${primaryLanguage} for ${tasks.join(', ')}`,
          languages: [primaryLanguage],
          rationale: 'Leveraging your primary language can reduce context switching and improve team efficiency'
        });
      }
    }

    return suggestions;
  }
}

/**
 * Language distribution analysis
 */
export interface LanguageDistribution {
  /** Total files analyzed */
  totalFiles: number;
  /** Language breakdown */
  languages: Array<{
    language: SupportedLanguage;
    count: number;
    percentage: number;
  }>;
  /** Diversity metrics */
  diversity: LanguageDiversityMetrics;
  /** Language suggestions */
  suggestions: LanguageSuggestion[];
}

/**
 * Language diversity metrics
 */
export interface LanguageDiversityMetrics {
  /** Total number of languages */
  totalLanguages: number;
  /** Shannon entropy */
  entropy: number;
  /** Normalized entropy (0-1) */
  normalizedEntropy: number;
  /** Primary language dominance percentage */
  primaryDominance: number;
  /** Diversity classification */
  classification: string;
}

/**
 * Language suggestion
 */
export interface LanguageSuggestion {
  /** Suggestion type */
  type: 'consolidation' | 'standardization' | 'diversification';
  /** Description */
  description: string;
  /** Affected languages */
  languages: SupportedLanguage[];
  /** Rationale for the suggestion */
  rationale: string;
}

/**
 * Create a language detector with default options
 */
export function createLanguageDetector(options?: LanguageDetectionOptions): LanguageDetector {
  return new LanguageDetector(options);
}

/**
 * Create a project language analyzer
 */
export function createProjectLanguageAnalyzer(options?: LanguageDetectionOptions): ProjectLanguageAnalyzer {
  return new ProjectLanguageAnalyzer(options);
}