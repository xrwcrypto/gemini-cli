/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Simple semver implementation since the full semver library is not available
const semverValid = (version: string): string | null => {
  const pattern = /^(\d+)\.(\d+)\.(\d+)(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
  return pattern.test(version) ? version : null;
};

const semverGte = (version1: string, version2: string): boolean => {
  const parseVersion = (v: string) => {
    const parts = v.split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };
  
  const v1 = parseVersion(version1);
  const v2 = parseVersion(version2);
  
  if (v1.major !== v2.major) return v1.major > v2.major;
  if (v1.minor !== v2.minor) return v1.minor > v2.minor;
  return v1.patch >= v2.patch;
};
import { 
  EnhancedLanguageParser, 
  PluginMetadata, 
  PluginValidationResult, 
  PluginCapabilities 
} from './base-plugin.js';
import { SupportedLanguage } from '../services/ast-parser.js';

/**
 * Plugin validation options
 */
export interface PluginValidationOptions {
  /** Strict validation mode */
  strict?: boolean;
  /** Required core version */
  requiredCoreVersion?: string;
  /** Maximum allowed plugin version */
  maxPluginVersion?: string;
  /** Validate dependencies */
  checkDependencies?: boolean;
  /** Validate file size limits */
  checkFileSizeLimits?: boolean;
  /** Custom validation rules */
  customRules?: ValidationRule[];
}

/**
 * Custom validation rule
 */
export interface ValidationRule {
  /** Rule name */
  name: string;
  /** Rule description */
  description: string;
  /** Rule severity */
  severity: 'error' | 'warning' | 'info';
  /** Rule validator function */
  validate: (plugin: EnhancedLanguageParser, metadata: PluginMetadata) => Promise<ValidationRuleResult>;
}

/**
 * Validation rule result
 */
export interface ValidationRuleResult {
  /** Whether the rule passed */
  passed: boolean;
  /** Error or warning message */
  message?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Detailed validation result with rule-specific information
 */
export interface DetailedValidationResult extends PluginValidationResult {
  /** Rule-specific results */
  ruleResults: Array<{
    rule: string;
    severity: 'error' | 'warning' | 'info';
    passed: boolean;
    message: string;
    context?: Record<string, unknown>;
  }>;
  /** Performance metrics */
  metrics: {
    validationTimeMs: number;
    memoryUsageMB?: number;
  };
}

/**
 * Plugin security validator
 */
export class PluginSecurityValidator {
  private static readonly DANGEROUS_PATTERNS = [
    /eval\s*\(/,
    /Function\s*\(/,
    /setTimeout\s*\(/,
    /setInterval\s*\(/,
    /require\s*\(\s*['"`]child_process['"`]\s*\)/,
    /require\s*\(\s*['"`]fs['"`]\s*\)/,
    /import\s+.*\s+from\s+['"`]child_process['"`]/,
    /import\s+.*\s+from\s+['"`]fs['"`]/,
    /__dirname/,
    /__filename/,
    /process\.env/,
    /process\.exit/,
    /Buffer\.from/
  ];

  /**
   * Validate plugin security
   */
  static validateSecurity(pluginCode: string): ValidationRuleResult {
    const issues: string[] = [];

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(pluginCode)) {
        issues.push(`Potentially dangerous pattern detected: ${pattern.source}`);
      }
    }

    return {
      passed: issues.length === 0,
      message: issues.length > 0 ? `Security issues found: ${issues.join(', ')}` : undefined,
      context: { issues }
    };
  }
}

/**
 * Comprehensive plugin validator
 */
export class PluginValidator {
  private options: PluginValidationOptions;
  private builtInRules: ValidationRule[];

  constructor(options: PluginValidationOptions = {}) {
    this.options = {
      strict: false,
      checkDependencies: true,
      checkFileSizeLimits: true,
      customRules: [],
      ...options
    };

    this.builtInRules = this.createBuiltInRules();
  }

  /**
   * Validate a plugin comprehensively
   */
  async validatePlugin(plugin: EnhancedLanguageParser): Promise<DetailedValidationResult> {
    const startTime = Date.now();
    const metadata = plugin.getMetadata();
    
    const result: DetailedValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      compatibility: [],
      ruleResults: [],
      metrics: {
        validationTimeMs: 0
      }
    };

    // Run basic validation first
    const basicResult = await plugin.validate();
    result.errors.push(...basicResult.errors);
    result.warnings.push(...basicResult.warnings);
    result.compatibility.push(...basicResult.compatibility);

    // Run all validation rules
    const allRules = [...this.builtInRules, ...(this.options.customRules || [])];
    
    for (const rule of allRules) {
      try {
        const ruleResult = await rule.validate(plugin, metadata);
        
        result.ruleResults.push({
          rule: rule.name,
          severity: rule.severity,
          passed: ruleResult.passed,
          message: ruleResult.message || '',
          context: ruleResult.context
        });

        if (!ruleResult.passed) {
          const message = `${rule.name}: ${ruleResult.message || 'Validation failed'}`;
          
          switch (rule.severity) {
            case 'error':
              result.errors.push(message);
              break;
            case 'warning':
              result.warnings.push(message);
              break;
            case 'info':
              // Info messages don't affect validity
              break;
          }
        }
      } catch (error) {
        const message = `Rule ${rule.name} failed: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(message);
        result.ruleResults.push({
          rule: rule.name,
          severity: 'error',
          passed: false,
          message
        });
      }
    }

    // Determine overall validity
    result.valid = result.errors.length === 0;

    // Calculate metrics
    result.metrics.validationTimeMs = Date.now() - startTime;
    
    // Add memory usage if available
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage();
      result.metrics.memoryUsageMB = memUsage.heapUsed / 1024 / 1024;
    }

    return result;
  }

  /**
   * Batch validate multiple plugins
   */
  async validatePlugins(plugins: EnhancedLanguageParser[]): Promise<Map<string, DetailedValidationResult>> {
    const results = new Map<string, DetailedValidationResult>();
    
    // Validate plugins in parallel
    const validationPromises = plugins.map(async plugin => {
      const metadata = plugin.getMetadata();
      const result = await this.validatePlugin(plugin);
      return { id: metadata.id, result };
    });

    const completedValidations = await Promise.allSettled(validationPromises);
    
    for (const validation of completedValidations) {
      if (validation.status === 'fulfilled') {
        results.set(validation.value.id, validation.value.result);
      } else {
        // Create error result for failed validations
        const errorResult: DetailedValidationResult = {
          valid: false,
          errors: [`Validation failed: ${validation.reason}`],
          warnings: [],
          compatibility: [],
          ruleResults: [],
          metrics: { validationTimeMs: 0 }
        };
        results.set('unknown', errorResult);
      }
    }

    return results;
  }

  /**
   * Create built-in validation rules
   */
  private createBuiltInRules(): ValidationRule[] {
    return [
      {
        name: 'metadata-completeness',
        description: 'Validate plugin metadata completeness',
        severity: 'error',
        validate: async (plugin, metadata) => {
          const missing: string[] = [];
          
          if (!metadata.id) missing.push('id');
          if (!metadata.name) missing.push('name');
          if (!metadata.version) missing.push('version');
          if (!metadata.description) missing.push('description');
          if (!metadata.languages || metadata.languages.length === 0) missing.push('languages');
          
          return {
            passed: missing.length === 0,
            message: missing.length > 0 ? `Missing required metadata: ${missing.join(', ')}` : undefined,
            context: { missing }
          };
        }
      },

      {
        name: 'security-validation',
        description: 'Check plugin for security vulnerabilities',
        severity: 'error',
        validate: async (plugin, metadata) => {
          // Get plugin source code for analysis (simplified - in real implementation would read from file)
          const pluginCode = plugin.toString();
          const securityResult = PluginSecurityValidator.validateSecurity(pluginCode);
          
          return {
            passed: securityResult.passed,
            message: securityResult.message,
            context: securityResult.context
          };
        }
      },

      {
        name: 'plugin-id-format',
        description: 'Validate plugin ID follows naming conventions',
        severity: 'error',
        validate: async (plugin, metadata) => {
          const validIdPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
          const validId = validIdPattern.test(metadata.id);
          
          return {
            passed: validId,
            message: !validId ? `Plugin ID '${metadata.id}' must use lowercase letters, numbers, and hyphens only` : undefined,
            context: { id: metadata.id, pattern: validIdPattern.source }
          };
        }
      },

      {
        name: 'author-information',
        description: 'Validate author information is provided',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          const hasAuthor = metadata.author && metadata.author.name;
          
          return {
            passed: !!hasAuthor,
            message: !hasAuthor ? 'Author information should be provided for community plugins' : undefined,
            context: { author: metadata.author }
          };
        }
      },

      {
        name: 'description-quality',
        description: 'Validate plugin description is meaningful',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          const minLength = 20;
          const hasGoodDescription = metadata.description && 
            metadata.description.length >= minLength &&
            !metadata.description.toLowerCase().includes('todo') &&
            !metadata.description.toLowerCase().includes('placeholder');
          
          return {
            passed: !!hasGoodDescription,
            message: !hasGoodDescription ? 
              `Plugin description should be at least ${minLength} characters and provide meaningful information` : undefined,
            context: { description: metadata.description, minLength }
          };
        }
      },
      
      {
        name: 'version-format',
        description: 'Validate plugin version format',
        severity: 'error',
        validate: async (plugin, metadata) => {
          const validVersion = semverValid(metadata.version);
          return {
            passed: validVersion !== null,
            message: !validVersion ? `Invalid version format: ${metadata.version}` : undefined,
            context: { version: metadata.version, valid: validVersion }
          };
        }
      },

      {
        name: 'core-compatibility',
        description: 'Check core version compatibility',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          if (!this.options.requiredCoreVersion || !metadata.minCoreVersion) {
            return { passed: true };
          }

          const compatible = semverGte(this.options.requiredCoreVersion, metadata.minCoreVersion);
          return {
            passed: compatible,
            message: !compatible ? 
              `Plugin requires core version ${metadata.minCoreVersion}, but ${this.options.requiredCoreVersion} is available` : undefined,
            context: { 
              required: metadata.minCoreVersion, 
              available: this.options.requiredCoreVersion 
            }
          };
        }
      },

      {
        name: 'capabilities-validation',
        description: 'Validate plugin capabilities',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          const caps = metadata.capabilities;
          const issues: string[] = [];

          if (!caps.fileExtensions || caps.fileExtensions.length === 0) {
            issues.push('No file extensions specified');
          }

          if (caps.maxFileSize && caps.maxFileSize <= 0) {
            issues.push('Invalid max file size');
          }

          // Check for contradictory capabilities
          if (caps.incremental && !caps.fileExtensions.some(ext => ['.ts', '.js', '.py', '.go'].includes(ext))) {
            issues.push('Incremental parsing claimed but no supported languages that typically support it');
          }

          return {
            passed: issues.length === 0,
            message: issues.length > 0 ? `Capability issues: ${issues.join(', ')}` : undefined,
            context: { issues }
          };
        }
      },

      {
        name: 'language-support',
        description: 'Validate language support claims',
        severity: 'error',
        validate: async (plugin, metadata) => {
          const supportedLanguages: SupportedLanguage[] = [
            'typescript', 'javascript', 'python', 'go', 'java', 'cpp', 'c', 'rust'
          ];

          const unsupported = metadata.languages.filter(lang => 
            !supportedLanguages.includes(lang)
          );

          return {
            passed: unsupported.length === 0,
            message: unsupported.length > 0 ? 
              `Unsupported languages claimed: ${unsupported.join(', ')}` : undefined,
            context: { unsupported, supported: supportedLanguages }
          };
        }
      },

      {
        name: 'method-implementation',
        description: 'Check required method implementations',
        severity: 'error',
        validate: async (plugin, metadata) => {
          const requiredMethods = ['parse', 'getMetadata', 'validate', 'initialize', 'cleanup', 'supportsFile'];
          const missing = requiredMethods.filter(method => 
            typeof (plugin as any)[method] !== 'function'
          );

          return {
            passed: missing.length === 0,
            message: missing.length > 0 ? `Missing required methods: ${missing.join(', ')}` : undefined,
            context: { missing, required: requiredMethods }
          };
        }
      },

      {
        name: 'performance-limits',
        description: 'Check performance-related limits',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          const issues: string[] = [];
          const caps = metadata.capabilities;

          if (caps.maxFileSize && caps.maxFileSize > 10 * 1024 * 1024) {
            issues.push(`Max file size is very large: ${caps.maxFileSize} bytes`);
          }

          if (metadata.dependencies && metadata.dependencies.length > 20) {
            issues.push(`Large number of dependencies: ${metadata.dependencies.length}`);
          }

          return {
            passed: issues.length === 0,
            message: issues.length > 0 ? `Performance concerns: ${issues.join(', ')}` : undefined,
            context: { issues }
          };
        }
      },

      {
        name: 'file-extension-validity',
        description: 'Validate file extensions format',
        severity: 'error',
        validate: async (plugin, metadata) => {
          const extensions = metadata.capabilities.fileExtensions;
          const invalidExtensions = extensions.filter(ext => 
            !ext.startsWith('.') || ext.length < 2 || /[^a-zA-Z0-9.]/.test(ext)
          );

          return {
            passed: invalidExtensions.length === 0,
            message: invalidExtensions.length > 0 ? 
              `Invalid file extensions: ${invalidExtensions.join(', ')}` : undefined,
            context: { invalid: invalidExtensions, all: extensions }
          };
        }
      },

      {
        name: 'parse-method-test',
        description: 'Test that parse method works with basic input',
        severity: 'error',
        validate: async (plugin, metadata) => {
          try {
            // Test with minimal valid content for the first supported language
            const testContent = this.getTestContentForLanguage(metadata.languages[0]);
            const testFileName = `test${metadata.capabilities.fileExtensions[0]}`;
            
            const result = await plugin.parse(testContent, testFileName);
            
            const isValid = result && 
              typeof result === 'object' &&
              Array.isArray(result.symbols) &&
              Array.isArray(result.imports) &&
              Array.isArray(result.exports) &&
              Array.isArray(result.errors);
            
            return {
              passed: isValid,
              message: !isValid ? 'Parse method does not return valid ParseResult structure' : undefined,
              context: { testContent, testFileName, result }
            };
          } catch (error) {
            return {
              passed: false,
              message: `Parse method throws error: ${error instanceof Error ? error.message : String(error)}`,
              context: { error: error instanceof Error ? error.message : String(error) }
            };
          }
        }
      },

      {
        name: 'plugin-performance',
        description: 'Check plugin initialization and parsing performance',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          const issues: string[] = [];
          
          // Test initialization time
          const initStart = Date.now();
          try {
            await plugin.initialize({ enabled: true, settings: {}, timeout: 5000 });
            const initTime = Date.now() - initStart;
            
            if (initTime > 1000) {
              issues.push(`Slow initialization: ${initTime}ms`);
            }
          } catch (error) {
            issues.push(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          
          // Test parsing time with moderately sized content
          try {
            const testContent = this.getTestContentForLanguage(metadata.languages[0]).repeat(50);
            const parseStart = Date.now();
            await plugin.parse(testContent, `test${metadata.capabilities.fileExtensions[0]}`);
            const parseTime = Date.now() - parseStart;
            
            if (parseTime > 500) {
              issues.push(`Slow parsing: ${parseTime}ms for ${testContent.length} characters`);
            }
          } catch (error) {
            // Parsing errors are handled by other rules
          }
          
          return {
            passed: issues.length === 0,
            message: issues.length > 0 ? `Performance issues: ${issues.join(', ')}` : undefined,
            context: { issues }
          };
        }
      },

      {
        name: 'plugin-cleanup',
        description: 'Validate plugin cleanup works properly',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          try {
            await plugin.cleanup();
            return {
              passed: true,
              message: undefined
            };
          } catch (error) {
            return {
              passed: false,
              message: `Cleanup method failed: ${error instanceof Error ? error.message : String(error)}`,
              context: { error: error instanceof Error ? error.message : String(error) }
            };
          }
        }
      },

      {
        name: 'supports-file-accuracy',
        description: 'Test supportsFile method accuracy',
        severity: 'warning',
        validate: async (plugin, metadata) => {
          const issues: string[] = [];
          
          // Test with supported extensions
          for (const ext of metadata.capabilities.fileExtensions) {
            const testFileName = `test${ext}`;
            const supports = plugin.supportsFile(testFileName);
            if (!supports) {
              issues.push(`Does not support declared extension: ${ext}`);
            }
          }
          
          // Test with unsupported extensions
          const unsupportedExts = ['.xyz', '.unknown', '.fake'];
          for (const ext of unsupportedExts) {
            const testFileName = `test${ext}`;
            const supports = plugin.supportsFile(testFileName);
            if (supports) {
              issues.push(`Incorrectly supports undeclared extension: ${ext}`);
            }
          }
          
          return {
            passed: issues.length === 0,
            message: issues.length > 0 ? `File support issues: ${issues.join(', ')}` : undefined,
            context: { issues }
          };
        }
      },

      {
        name: 'memory-efficiency',
        description: 'Check plugin memory usage patterns',
        severity: 'info',
        validate: async (plugin, metadata) => {
          if (typeof process === 'undefined' || !process.memoryUsage) {
            return { passed: true, message: 'Memory testing not available in this environment' };
          }
          
          const initialMemory = process.memoryUsage().heapUsed;
          
          try {
            // Initialize plugin
            await plugin.initialize({ enabled: true, settings: {}, timeout: 5000 });
            
            // Parse some content multiple times
            const testContent = this.getTestContentForLanguage(metadata.languages[0]);
            for (let i = 0; i < 10; i++) {
              await plugin.parse(testContent, `test${i}${metadata.capabilities.fileExtensions[0]}`);
            }
            
            // Force garbage collection if available
            if (global.gc) {
              global.gc();
            }
            
            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;
            const memoryIncreaseMB = memoryIncrease / (1024 * 1024);
            
            await plugin.cleanup();
            
            const excessive = memoryIncreaseMB > 10; // More than 10MB increase
            
            return {
              passed: !excessive,
              message: excessive ? `High memory usage detected: ${memoryIncreaseMB.toFixed(2)}MB increase` : undefined,
              context: { 
                initialMemory: initialMemory / (1024 * 1024),
                finalMemory: finalMemory / (1024 * 1024),
                increaseMB: memoryIncreaseMB
              }
            };
          } catch (error) {
            return {
              passed: false,
              message: `Memory testing failed: ${error instanceof Error ? error.message : String(error)}`,
              context: { error: error instanceof Error ? error.message : String(error) }
            };
          }
        }
      }
    ];
  }

  /**
   * Get test content for a specific language
   */
  private getTestContentForLanguage(language: SupportedLanguage): string {
    const testContent: Record<SupportedLanguage, string> = {
      'typescript': 'export interface Test { name: string; }',
      'javascript': 'function test() { return "hello"; }',
      'python': 'class Test:\n    def __init__(self):\n        pass',
      'go': 'package main\n\nfunc main() {\n    println("hello")\n}',
      'java': 'public class Test {\n    public static void main(String[] args) {}\n}',
      'cpp': '#include <iostream>\nint main() { return 0; }',
      'c': '#include <stdio.h>\nint main() { return 0; }',
      'rust': 'fn main() {\n    println!("hello");\n}',
      'unknown': '// test content'
    };

    return testContent[language] || testContent['unknown'];
  }
}

/**
 * Create a plugin validator with default options
 */
export function createPluginValidator(options?: PluginValidationOptions): PluginValidator {
  return new PluginValidator(options);
}