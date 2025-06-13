/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import crypto from 'crypto';
import { ValidationError } from '../file-operations-errors.js';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const rmdir = promisify(fs.rmdir);

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  /** Maximum execution time in milliseconds */
  timeout: number;
  /** Maximum memory usage in MB */
  memoryLimit: number;
  /** Maximum CPU time in milliseconds */
  cpuLimit: number;
  /** Allow network access */
  allowNetwork: boolean;
  /** Allow file system access */
  allowFileSystem: boolean;
  /** Allowed modules for require/import */
  allowedModules: string[];
  /** Environment variables to pass to sandbox */
  env?: Record<string, string>;
  /** Temporary directory for sandbox files */
  tempDir?: string;
}

/**
 * Sandbox execution result
 */
export interface SandboxResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
  memoryUsed: number;
  cpuTime: number;
}

/**
 * Sandbox execution context
 */
interface SandboxContext {
  code: string;
  args: unknown[];
  config: SandboxConfig;
}

/**
 * Worker message types
 */
interface WorkerMessage {
  type: 'execute' | 'result' | 'error' | 'metrics';
  data?: unknown;
  error?: string;
  metrics?: {
    executionTime: number;
    memoryUsed: number;
    cpuTime: number;
  };
}

/**
 * Secure sandbox service for code execution
 */
export class SandboxService extends EventEmitter {
  private readonly defaultConfig: SandboxConfig;
  private readonly tempDir: string;
  private activeWorkers = new Set<Worker>();

  constructor(config: Partial<SandboxConfig> = {}) {
    super();
    
    this.defaultConfig = {
      timeout: 5000, // 5 seconds
      memoryLimit: 50, // 50MB
      cpuLimit: 5000, // 5 seconds CPU time
      allowNetwork: false,
      allowFileSystem: false,
      allowedModules: ['path', 'url', 'util'], // Safe built-in modules only
      ...config,
    };

    this.tempDir = config.tempDir || path.join(process.cwd(), '.sandbox-temp');
    this.ensureTempDir();
  }

  /**
   * Execute code in a secure sandbox
   */
  async execute(
    code: string,
    args: unknown[] = [],
    config: Partial<SandboxConfig> = {}
  ): Promise<SandboxResult> {
    const sandboxConfig = { ...this.defaultConfig, ...config };
    const startTime = Date.now();
    
    try {
      // Validate and sanitize code
      this.validateCode(code);
      
      // Create worker script
      const workerScript = await this.createWorkerScript(code, sandboxConfig);
      
      // Execute in worker
      const result = await this.executeInWorker(workerScript, args, sandboxConfig);
      
      // Clean up
      await this.cleanupWorkerScript(workerScript);
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
        cpuTime: 0,
      };
    }
  }

  /**
   * Validate code for obvious security issues
   */
  private validateCode(code: string): void {
    // Check for dangerous patterns
    const dangerousPatterns = [
      /require\s*\(\s*['"]child_process['"]\s*\)/,
      /require\s*\(\s*['"]fs['"]\s*\)/,
      /require\s*\(\s*['"]net['"]\s*\)/,
      /require\s*\(\s*['"]http['"]\s*\)/,
      /require\s*\(\s*['"]https['"]\s*\)/,
      /process\.\s*exit/,
      /process\.\s*kill/,
      /eval\s*\(/,
      /new\s+Function\s*\(/,
      /import\s+.*\s+from\s+['"]child_process['"]/,
      /import\s+.*\s+from\s+['"]fs['"]/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        throw new ValidationError(`Code contains potentially dangerous pattern: ${pattern}`);
      }
    }
  }

  /**
   * Create worker script file
   */
  private async createWorkerScript(code: string, config: SandboxConfig): Promise<string> {
    const scriptId = crypto.randomUUID();
    const scriptPath = path.join(this.tempDir, `worker-${scriptId}.js`);
    
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const { performance } = require('perf_hooks');

// Sandbox environment setup
const sandbox = {
  console: {
    log: (...args) => parentPort.postMessage({ type: 'log', data: args }),
    error: (...args) => parentPort.postMessage({ type: 'error', data: args }),
    warn: (...args) => parentPort.postMessage({ type: 'warn', data: args }),
  },
  require: (module) => {
    const allowed = ${JSON.stringify(config.allowedModules)};
    if (!allowed.includes(module)) {
      throw new Error(\`Module '\${module}' is not allowed in sandbox\`);
    }
    return require(module);
  },
};

// Override global objects
global.console = sandbox.console;
global.require = sandbox.require;

// Disable dangerous globals
global.process = undefined;
global.eval = undefined;
global.Function = undefined;

// Execute user code
(async () => {
  const startTime = performance.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  try {
    // Create isolated function
    const AsyncFunction = (async function () {}).constructor;
    const userFunction = new AsyncFunction('args', 'sandbox', workerData.code);
    
    // Execute with timeout
    const result = await Promise.race([
      userFunction(workerData.args, sandbox),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Execution timeout')), ${config.timeout})
      )
    ]);
    
    const endTime = performance.now();
    const endMemory = process.memoryUsage().heapUsed;
    
    parentPort.postMessage({
      type: 'result',
      data: result,
      metrics: {
        executionTime: endTime - startTime,
        memoryUsed: endMemory - startMemory,
        cpuTime: process.cpuUsage().user / 1000, // Convert to ms
      }
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message || String(error),
      metrics: {
        executionTime: performance.now() - startTime,
        memoryUsed: process.memoryUsage().heapUsed - startMemory,
        cpuTime: process.cpuUsage().user / 1000,
      }
    });
  }
})();
`;

    await writeFile(scriptPath, workerCode);
    return scriptPath;
  }

  /**
   * Execute code in worker thread
   */
  private async executeInWorker(
    scriptPath: string,
    args: unknown[],
    config: SandboxConfig
  ): Promise<SandboxResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(scriptPath, {
        workerData: { code: args[0], args: args.slice(1) },
        resourceLimits: {
          maxOldGenerationSizeMb: config.memoryLimit,
          maxYoungGenerationSizeMb: config.memoryLimit / 2,
          codeRangeSizeMb: config.memoryLimit / 4,
        },
      });

      this.activeWorkers.add(worker);
      
      let result: SandboxResult = {
        success: false,
        executionTime: 0,
        memoryUsed: 0,
        cpuTime: 0,
      };

      // Set execution timeout
      const timeout = setTimeout(() => {
        worker.terminate();
        this.activeWorkers.delete(worker);
        resolve({
          ...result,
          success: false,
          error: 'Execution timeout exceeded',
        });
      }, config.timeout);

      worker.on('message', (message: WorkerMessage) => {
        switch (message.type) {
          case 'result':
            clearTimeout(timeout);
            result = {
              success: true,
              result: message.data,
              ...message.metrics!,
            };
            worker.terminate();
            this.activeWorkers.delete(worker);
            resolve(result);
            break;

          case 'error':
            clearTimeout(timeout);
            result = {
              success: false,
              error: message.error,
              ...message.metrics!,
            };
            worker.terminate();
            this.activeWorkers.delete(worker);
            resolve(result);
            break;

          // 'log' case removed - not in WorkerMessage type
        }
      });

      worker.on('error', (error) => {
        clearTimeout(timeout);
        this.activeWorkers.delete(worker);
        resolve({
          ...result,
          success: false,
          error: error.message,
        });
      });

      worker.on('exit', (code) => {
        clearTimeout(timeout);
        this.activeWorkers.delete(worker);
        if (code !== 0 && !result.success) {
          resolve({
            ...result,
            success: false,
            error: `Worker exited with code ${code}`,
          });
        }
      });
    });
  }

  /**
   * Create isolated environment for specific language
   */
  async createLanguageSandbox(
    language: 'javascript' | 'typescript' | 'python',
    code: string,
    config: Partial<SandboxConfig> = {}
  ): Promise<SandboxResult> {
    switch (language) {
      case 'javascript':
        return this.execute(code, [], config);

      case 'typescript':
        // For TypeScript, we would transpile first
        // This is a simplified version
        const jsCode = this.transpileTypeScript(code);
        return this.execute(jsCode, [], config);

      case 'python':
        // For Python, we would use a Python subprocess
        // This is a placeholder
        throw new ValidationError('Python sandbox not yet implemented');

      default:
        throw new ValidationError(`Unsupported language: ${language}`);
    }
  }

  /**
   * Simple TypeScript transpilation (placeholder)
   */
  private transpileTypeScript(code: string): string {
    // In a real implementation, we would use the TypeScript compiler
    // For now, just strip type annotations
    return code
      .replace(/:\s*\w+(\[\])?/g, '') // Remove type annotations
      .replace(/as\s+\w+/g, '') // Remove type assertions
      .replace(/interface\s+\w+\s*{[^}]*}/g, '') // Remove interfaces
      .replace(/type\s+\w+\s*=\s*[^;]+;/g, ''); // Remove type aliases
  }

  /**
   * Ensure temporary directory exists
   */
  private async ensureTempDir(): Promise<void> {
    try {
      await mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  /**
   * Clean up worker script
   */
  private async cleanupWorkerScript(scriptPath: string): Promise<void> {
    try {
      await unlink(scriptPath);
    } catch (error) {
      // File might already be deleted
    }
  }

  /**
   * Terminate all active workers
   */
  async terminateAll(): Promise<void> {
    const promises = Array.from(this.activeWorkers).map(worker => {
      return new Promise<void>((resolve) => {
        worker.terminate().then(() => {
          this.activeWorkers.delete(worker);
          resolve();
        });
      });
    });

    await Promise.all(promises);
  }

  /**
   * Clean up temporary directory
   */
  async cleanup(): Promise<void> {
    await this.terminateAll();
    
    try {
      const files = await promisify(fs.readdir)(this.tempDir);
      await Promise.all(
        files.map(file => unlink(path.join(this.tempDir, file)))
      );
      await rmdir(this.tempDir);
    } catch (error) {
      // Directory might not exist or already be empty
    }
  }
}