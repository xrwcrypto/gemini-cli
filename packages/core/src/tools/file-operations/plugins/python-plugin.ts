/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { LanguageParser, ParseResult, Symbol, ASTNode, SupportedLanguage } from '../services/ast-parser.js';
import { CacheManager } from '../services/cache-manager.js';

/**
 * Python import information
 */
interface PythonImport {
  module: string;
  names: string[];
  asNames: string[];
  level: number; // 0 for absolute, >0 for relative
  isFromImport: boolean;
}

/**
 * Python function signature
 */
interface PythonFunctionSignature {
  name: string;
  parameters: Array<{
    name: string;
    annotation?: string;
    default?: string;
    isVarArgs?: boolean;
    isKeywordArgs?: boolean;
  }>;
  returnAnnotation?: string;
  decorators: string[];
}

/**
 * Python class information
 */
interface PythonClassInfo {
  name: string;
  bases: string[];
  decorators: string[];
  methods: PythonFunctionSignature[];
  classVariables: string[];
}

/**
 * Enhanced Python parser using AST analysis
 */
export class PythonPlugin implements LanguageParser {
  private importCache = new Map<string, PythonImport[]>();
  private readonly cacheManager?: CacheManager;

  constructor(cacheManager?: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Parse a Python file
   */
  async parse(content: string, filePath: string): Promise<ParseResult> {
    const result: ParseResult = {
      ast: undefined,
      symbols: [],
      imports: [],
      exports: [],
      errors: [],
      language: 'python'
    };

    try {
      // Parse imports
      result.imports = this.parseImports(content);

      // Parse symbols (functions, classes, variables)
      result.symbols = this.parseSymbols(content);

      // Extract exports (all module-level symbols are considered exports in Python)
      result.exports = this.extractExports(result.symbols);

      // Create simplified AST
      result.ast = this.createAST(content);

      // Validate syntax and extract errors
      result.errors = this.validateSyntax(content);

    } catch (error) {
      result.errors.push({
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return result;
  }

  /**
   * Check if incremental parsing is supported
   */
  supportsIncremental(): boolean {
    return false; // Can be implemented later with tree-sitter
  }

  /**
   * Parse incrementally (reuse previous parse tree)
   */
  async parseIncremental(content: string, filePath: string, previousTree?: unknown): Promise<ParseResult> {
    // For now, do a full parse
    return this.parse(content, filePath);
  }

  /**
   * Parse Python imports
   */
  private parseImports(content: string): Array<{ from: string; items: string[] }> {
    const imports: Array<{ from: string; items: string[] }> = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip comments and empty lines
      if (line.startsWith('#') || !line) continue;

      // Handle import statements
      const importMatch = line.match(/^import\s+(.+)$/);
      if (importMatch) {
        const modules = importMatch[1].split(',').map(m => m.trim());
        modules.forEach(module => {
          const asMatch = module.match(/^(.+?)\s+as\s+(.+)$/);
          if (asMatch) {
            imports.push({ from: asMatch[1].trim(), items: [asMatch[2].trim()] });
          } else {
            imports.push({ from: module.trim(), items: [module.trim().split('.').pop() || module.trim()] });
          }
        });
        continue;
      }

      // Handle from...import statements
      const fromImportMatch = line.match(/^from\s+(.+?)\s+import\s+(.+)$/);
      if (fromImportMatch) {
        const module = fromImportMatch[1].trim();
        const importItems = fromImportMatch[2].trim();
        
        if (importItems === '*') {
          imports.push({ from: module, items: ['*'] });
        } else {
          const items = importItems.split(',').map(item => {
            const asMatch = item.trim().match(/^(.+?)\s+as\s+(.+)$/);
            return asMatch ? asMatch[2].trim() : item.trim();
          });
          imports.push({ from: module, items });
        }
        continue;
      }
    }

    return imports;
  }

  /**
   * Parse Python symbols (functions, classes, variables)
   */
  private parseSymbols(content: string): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = content.split('\n');
    let currentIndent = 0;
    let scopeStack: Array<{ name: string; type: 'class' | 'function' | 'module' }> = [{ name: '', type: 'module' }];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (trimmed.startsWith('#') || !trimmed) continue;

      // Calculate indentation
      const indent = line.length - line.trimStart().length;
      
      // Update scope based on indentation
      while (scopeStack.length > 1 && indent <= currentIndent) {
        scopeStack.pop();
        currentIndent = Math.max(0, currentIndent - 4); // Assume 4-space indentation
      }

      // Parse function definitions
      const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
      if (funcMatch) {
        const functionName = funcMatch[1];
        const isInClass = scopeStack[scopeStack.length - 1]?.type === 'class';
        
        symbols.push({
          name: functionName,
          type: 'function',
          position: { line: i + 1, column: indent + 1 },
          scope: isInClass ? 'class' : 'module',
          exported: !functionName.startsWith('_')
        });

        scopeStack.push({ name: functionName, type: 'function' });
        currentIndent = indent;
        continue;
      }

      // Parse class definitions
      const classMatch = trimmed.match(/^class\s+(\w+)(?:\s*\([^)]*\))?:/);
      if (classMatch) {
        const className = classMatch[1];
        
        symbols.push({
          name: className,
          type: 'class',
          position: { line: i + 1, column: indent + 1 },
          scope: 'module',
          exported: !className.startsWith('_')
        });

        scopeStack.push({ name: className, type: 'class' });
        currentIndent = indent;
        continue;
      }

      // Parse variable assignments at module level
      if (indent === 0) {
        const varMatch = trimmed.match(/^(\w+)\s*[:=]/);
        if (varMatch && !trimmed.includes('def ') && !trimmed.includes('class ')) {
          const varName = varMatch[1];
          // Skip imports and common non-variable patterns
          if (!['import', 'from', 'if', 'for', 'while', 'try', 'with'].includes(varName)) {
            symbols.push({
              name: varName,
              type: 'variable',
              position: { line: i + 1, column: 1 },
              scope: 'module',
              exported: !varName.startsWith('_')
            });
          }
        }
      }
    }

    return symbols;
  }

  /**
   * Extract exports from symbols
   */
  private extractExports(symbols: Symbol[]): Array<{ name: string; type: string }> {
    return symbols
      .filter(symbol => symbol.exported && symbol.scope === 'module')
      .map(symbol => ({ name: symbol.name, type: symbol.type }));
  }

  /**
   * Create a simplified AST representation
   */
  private createAST(content: string): ASTNode {
    const lines = content.split('\n');
    
    const rootNode: ASTNode = {
      type: 'Module',
      startPosition: { line: 1, column: 1 },
      endPosition: { line: lines.length, column: lines[lines.length - 1]?.length || 1 },
      children: [],
      text: content
    };

    // This is a simplified AST - in a full implementation, you'd use a proper Python parser
    // like tree-sitter-python or integrate with Python's ast module via child process
    
    return rootNode;
  }

  /**
   * Validate Python syntax
   */
  private validateSyntax(content: string): Array<{ message: string; position?: { line: number; column: number } }> {
    const errors: Array<{ message: string; position?: { line: number; column: number } }> = [];
    const lines = content.split('\n');

    // Basic syntax validation
    let indentStack: number[] = [0];
    let inString = false;
    let stringChar = '';
    let parenCount = 0;
    let bracketCount = 0;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Check indentation
      const indent = line.length - line.trimStart().length;
      
      // Validate indentation consistency
      if (indent > indentStack[indentStack.length - 1]) {
        indentStack.push(indent);
      } else if (indent < indentStack[indentStack.length - 1]) {
        // Find the matching indentation level
        let found = false;
        while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
          indentStack.pop();
        }
        if (indentStack[indentStack.length - 1] !== indent) {
          errors.push({
            message: 'IndentationError: unindent does not match any outer indentation level',
            position: { line: i + 1, column: 1 }
          });
        }
      }

      // Check for basic syntax errors
      // Colon requirement for control structures (but skip import statements and handle multiline)
      if (/^(if|elif|else|for|while|try|except|finally|with|def|class|async\s+def|async\s+with|async\s+for)\b/.test(trimmed) && 
          !trimmed.startsWith('import') &&
          !trimmed.startsWith('from')) {
        
        // Check if this line or any following lines (for multiline statements) contain a colon
        let hasColon = trimmed.includes(':');
        let lineIndex = i;
        
        // For function/class definitions that might span multiple lines, check subsequent lines
        if (!hasColon && /^(def|class|async\s+def)\b/.test(trimmed)) {
          // Look for closing parenthesis and colon in subsequent lines
          let currentParenCount = 0;
          for (let j = 0; j < trimmed.length; j++) {
            if (trimmed[j] === '(') currentParenCount++;
            if (trimmed[j] === ')') currentParenCount--;
          }
          
          // If parentheses are not closed on this line, check subsequent lines
          if (currentParenCount > 0) {
            for (let nextLine = i + 1; nextLine < lines.length && currentParenCount > 0; nextLine++) {
              const nextTrimmed = lines[nextLine].trim();
              if (!nextTrimmed || nextTrimmed.startsWith('#')) continue;
              
              for (let j = 0; j < nextTrimmed.length; j++) {
                if (nextTrimmed[j] === '(') currentParenCount++;
                if (nextTrimmed[j] === ')') currentParenCount--;
                if (nextTrimmed[j] === ':' && currentParenCount === 0) {
                  hasColon = true;
                  break;
                }
              }
              if (hasColon) break;
            }
          }
        }
        
        if (!hasColon) {
          errors.push({
            message: 'SyntaxError: invalid syntax - missing colon',
            position: { line: i + 1, column: trimmed.length }
          });
        }
      }

      // Check for unclosed parentheses, brackets, braces
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        // Handle string literals
        if ((char === '"' || char === "'") && (j === 0 || line[j-1] !== '\\')) {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
            stringChar = '';
          }
        }
        
        if (!inString) {
          switch (char) {
            case '(':
              parenCount++;
              break;
            case ')':
              parenCount--;
              if (parenCount < 0) {
                errors.push({
                  message: 'SyntaxError: unmatched closing parenthesis',
                  position: { line: i + 1, column: j + 1 }
                });
                parenCount = 0;
              }
              break;
            case '[':
              bracketCount++;
              break;
            case ']':
              bracketCount--;
              if (bracketCount < 0) {
                errors.push({
                  message: 'SyntaxError: unmatched closing bracket',
                  position: { line: i + 1, column: j + 1 }
                });
                bracketCount = 0;
              }
              break;
            case '{':
              braceCount++;
              break;
            case '}':
              braceCount--;
              if (braceCount < 0) {
                errors.push({
                  message: 'SyntaxError: unmatched closing brace',
                  position: { line: i + 1, column: j + 1 }
                });
                braceCount = 0;
              }
              break;
          }
        }
      }
    }

    // Check for unclosed brackets at end of file
    if (parenCount > 0) {
      errors.push({ message: 'SyntaxError: unclosed parenthesis' });
    }
    if (bracketCount > 0) {
      errors.push({ message: 'SyntaxError: unclosed bracket' });
    }
    if (braceCount > 0) {
      errors.push({ message: 'SyntaxError: unclosed brace' });
    }

    return errors;
  }

  /**
   * Resolve Python imports
   */
  async resolveImport(
    moduleName: string,
    containingFile: string,
    isRelative: boolean = false
  ): Promise<string | null> {
    try {
      const containingDir = path.dirname(containingFile);
      
      // Handle relative imports
      if (isRelative || moduleName.startsWith('.')) {
        return this.resolveRelativeImport(moduleName, containingDir);
      }
      
      // Handle absolute imports
      return this.resolveAbsoluteImport(moduleName, containingDir);
    } catch (error) {
      return null;
    }
  }

  /**
   * Resolve relative imports
   */
  private async resolveRelativeImport(moduleName: string, containingDir: string): Promise<string | null> {
    const dotCount = (moduleName.match(/^\.*/) || [''])[0].length;
    const actualModule = moduleName.slice(dotCount);
    
    // Go up directories based on dot count
    let currentDir = containingDir;
    for (let i = 0; i < dotCount - 1; i++) {
      currentDir = path.dirname(currentDir);
    }
    
    if (actualModule) {
      const modulePath = path.join(currentDir, ...actualModule.split('.'));
      return this.findPythonModule(modulePath);
    }
    
    return currentDir;
  }

  /**
   * Resolve absolute imports
   */
  private async resolveAbsoluteImport(moduleName: string, containingDir: string): Promise<string | null> {
    // Check if it's a standard library module
    if (this.isStandardLibrary(moduleName)) {
      return null; // Standard library, no file path
    }
    
    // Look for the module in the current directory and parent directories
    let currentDir = containingDir;
    const root = path.parse(currentDir).root;
    
    while (currentDir !== root) {
      const modulePath = path.join(currentDir, ...moduleName.split('.'));
      const resolved = await this.findPythonModule(modulePath);
      if (resolved) {
        return resolved;
      }
      
      // Check in site-packages or virtual environment
      const sitePackagesPath = await this.findInSitePackages(moduleName, currentDir);
      if (sitePackagesPath) {
        return sitePackagesPath;
      }
      
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }

  /**
   * Find Python module file
   */
  private async findPythonModule(basePath: string): Promise<string | null> {
    const candidates = [
      `${basePath}.py`,
      `${basePath}/__init__.py`,
      path.join(basePath, '__init__.py')
    ];
    
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue to next candidate
      }
    }
    
    return null;
  }

  /**
   * Find module in site-packages or virtual environment
   */
  private async findInSitePackages(moduleName: string, startDir: string): Promise<string | null> {
    const virtualEnvPaths = [
      'venv/lib/python*/site-packages',
      '.venv/lib/python*/site-packages',
      'env/lib/python*/site-packages'
    ];
    
    // Look for virtual environment
    let currentDir = startDir;
    const root = path.parse(currentDir).root;
    
    while (currentDir !== root) {
      for (const venvPath of virtualEnvPaths) {
        try {
          // This is simplified - in reality you'd use glob or similar to find python* directories
          const sitePkgPath = path.join(currentDir, venvPath.replace('python*', 'python3.8'));
          const modulePath = path.join(sitePkgPath, ...moduleName.split('.'));
          const resolved = await this.findPythonModule(modulePath);
          if (resolved) {
            return resolved;
          }
        } catch {
          // Continue
        }
      }
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }

  /**
   * Check if module is in Python standard library
   */
  private isStandardLibrary(moduleName: string): boolean {
    const standardLibraryModules = new Set([
      // Core modules
      'os', 'sys', 'time', 'datetime', 'math', 'random', 'json', 'csv',
      're', 'collections', 'itertools', 'functools', 'operator', 'types',
      'copy', 'pickle', 'shelve', 'dbm', 'sqlite3', 'zlib', 'gzip',
      'bz2', 'lzma', 'zipfile', 'tarfile', 'pathlib', 'glob', 'fnmatch',
      'shutil', 'tempfile', 'getpass', 'getopt', 'argparse', 'logging',
      'warnings', 'traceback', 'gc', 'weakref', 'inspect', 'dis',
      
      // Network and Internet
      'urllib', 'http', 'html', 'xml', 'email', 'base64', 'binascii',
      'uu', 'quopri', 'socket', 'ssl', 'hashlib', 'hmac', 'secrets',
      
      // Threading and multiprocessing
      'threading', 'multiprocessing', 'concurrent', 'queue', 'sched',
      'subprocess', 'signal', 'asyncio', 'contextvars',
      
      // File formats
      'configparser', 'netrc', 'xdrlib', 'plistlib',
      
      // Crypto
      'hashlib', 'hmac', 'secrets',
      
      // Data types
      'struct', 'codecs', 'unicodedata', 'stringprep',
      
      // Development tools
      'doctest', 'unittest', 'test', 'pdb', 'profile', 'pstats', 'timeit',
      'trace', 'tabnanny', 'compileall', 'dis', 'pickletools',
      
      // Runtime
      'site', 'user', 'builtins', '__future__', '__main__',
      
      // Platform specific
      'posix', 'pwd', 'grp', 'crypt', 'spwd', 'pty', 'tty', 'pipes',
      'resource', 'nis', 'syslog', 'mmap', 'select', 'fcntl', 'termios'
    ]);
    
    const rootModule = moduleName.split('.')[0];
    return standardLibraryModules.has(rootModule);
  }

  /**
   * Extract function signature from line
   */
  private extractFunctionSignature(content: string, functionName: string): PythonFunctionSignature | null {
    const funcRegex = new RegExp(`def\\s+${functionName}\\s*\\(([^)]*)\\)(?:\\s*->\\s*([^:]+))?:`, 'g');
    const match = funcRegex.exec(content);
    
    if (!match) return null;
    
    const params = match[1] ? this.parseParameters(match[1]) : [];
    const returnAnnotation = match[2]?.trim();
    
    // Find decorators (simplified)
    const lines = content.split('\n');
    const funcIndex = lines.findIndex(line => line.includes(`def ${functionName}`));
    const decorators: string[] = [];
    
    for (let i = funcIndex - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('@')) {
        decorators.unshift(line);
      } else if (line && !line.startsWith('#')) {
        break;
      }
    }
    
    return {
      name: functionName,
      parameters: params,
      returnAnnotation,
      decorators
    };
  }

  /**
   * Parse function parameters
   */
  private parseParameters(paramString: string): Array<{
    name: string;
    annotation?: string;
    default?: string;
    isVarArgs?: boolean;
    isKeywordArgs?: boolean;
  }> {
    const params: Array<{
      name: string;
      annotation?: string;
      default?: string;
      isVarArgs?: boolean;
      isKeywordArgs?: boolean;
    }> = [];
    
    // Split by commas, but respect nested structures
    const paramParts = this.splitParameters(paramString);
    
    for (const part of paramParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      // Handle *args and **kwargs
      if (trimmed.startsWith('**')) {
        const name = trimmed.slice(2).split(':')[0].split('=')[0].trim();
        params.push({ name, isKeywordArgs: true });
        continue;
      }
      
      if (trimmed.startsWith('*')) {
        const name = trimmed.slice(1).split(':')[0].split('=')[0].trim();
        params.push({ name, isVarArgs: true });
        continue;
      }
      
      // Parse regular parameters
      const defaultMatch = trimmed.match(/^([^=]+)=(.+)$/);
      const annotationMatch = trimmed.match(/^([^:]+):([^=]+)(?:=(.+))?$/);
      
      if (annotationMatch) {
        const name = annotationMatch[1].trim();
        const annotation = annotationMatch[2].trim();
        const defaultValue = annotationMatch[3]?.trim();
        params.push({ name, annotation, default: defaultValue });
      } else if (defaultMatch) {
        const name = defaultMatch[1].trim();
        const defaultValue = defaultMatch[2].trim();
        params.push({ name, default: defaultValue });
      } else {
        params.push({ name: trimmed });
      }
    }
    
    return params;
  }

  /**
   * Split parameters by commas, respecting nested structures
   */
  private splitParameters(paramString: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < paramString.length; i++) {
      const char = paramString[i];
      
      if ((char === '"' || char === "'") && (i === 0 || paramString[i-1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
      }
      
      if (!inString) {
        if (char === '(' || char === '[' || char === '{') {
          depth++;
        } else if (char === ')' || char === ']' || char === '}') {
          depth--;
        } else if (char === ',' && depth === 0) {
          parts.push(current);
          current = '';
          continue;
        }
      }
      
      current += char;
    }
    
    if (current) {
      parts.push(current);
    }
    
    return parts;
  }
}

/**
 * Create Python plugin instance
 */
export function createPythonPlugin(cacheManager?: CacheManager): PythonPlugin {
  return new PythonPlugin(cacheManager);
}