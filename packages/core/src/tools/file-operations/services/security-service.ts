/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { isWithinRoot } from '../../../utils/fileUtils.js';
import { ValidationError } from '../file-operations-errors.js';
import { Operation } from '../file-operations-types.js';

const realpath = promisify(fs.realpath);
const lstat = promisify(fs.lstat);

/**
 * Security configuration for operations
 */
export interface SecurityConfig {
  /** Maximum file size allowed in bytes */
  maxFileSize: number;
  /** Maximum number of operations per minute */
  operationRateLimit: number;
  /** Maximum memory usage in bytes */
  maxMemoryUsage: number;
  /** Maximum concurrent operations */
  maxConcurrentOperations: number;
  /** Sandbox timeout in milliseconds */
  sandboxTimeout: number;
  /** Allowed directories whitelist */
  allowedDirectories?: string[];
  /** Blocked directories blacklist */
  blockedDirectories?: string[];
  /** Enable comprehensive audit logging */
  enableAuditLogging: boolean;
  /** Enable symbolic link resolution */
  resolveSymlinks: boolean;
  /** Maximum depth for directory traversal */
  maxDirectoryDepth: number;
  /** Allowed file extensions */
  allowedExtensions?: string[];
  /** Blocked file extensions */
  blockedExtensions?: string[];
}

/**
 * Security audit log entry
 */
export interface SecurityAuditEntry {
  timestamp: Date;
  operationId: string;
  operationType: string;
  userId?: string;
  sessionId: string;
  action: string;
  resource: string;
  result: 'allowed' | 'denied' | 'error';
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Path validation result
 */
interface PathValidationResult {
  isValid: boolean;
  resolvedPath?: string;
  reason?: string;
  isSymlink?: boolean;
  realPath?: string;
}

/**
 * Resource usage tracking
 */
interface ResourceUsage {
  memoryUsage: number;
  operationCount: number;
  lastResetTime: Date;
}

/**
 * Comprehensive security service for FileOperations
 */
export class SecurityService extends EventEmitter {
  private readonly config: SecurityConfig;
  private readonly rootDirectory: string;
  private readonly auditLog: SecurityAuditEntry[] = [];
  private readonly resourceUsage = new Map<string, ResourceUsage>();
  private readonly sessionId: string;

  constructor(rootDirectory: string, config: Partial<SecurityConfig> = {}) {
    super();
    this.rootDirectory = path.resolve(rootDirectory);
    this.sessionId = crypto.randomUUID();
    
    this.config = {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      operationRateLimit: 100, // 100 operations per minute
      maxMemoryUsage: 500 * 1024 * 1024, // 500MB
      maxConcurrentOperations: 10,
      sandboxTimeout: 30000, // 30 seconds
      enableAuditLogging: true,
      resolveSymlinks: true,
      maxDirectoryDepth: 10,
      ...config,
    };
  }

  /**
   * Validate a file path with comprehensive security checks
   */
  async validatePath(
    filePath: string,
    operation: string,
    options: { allowGlob?: boolean; checkExists?: boolean } = {}
  ): Promise<PathValidationResult> {
    try {
      // Check for null bytes and other dangerous characters
      if (filePath.includes('\0')) {
        return {
          isValid: false,
          reason: 'Path contains null byte',
        };
      }

      // Check for dangerous patterns
      const dangerousPatterns = [
        /\.\.[/\\]\.\./, // Multiple parent directory traversals
        /^\/dev\//, // Device files
        /^\/proc\//, // Process files
        /^\/sys\//, // System files
        /^\/etc\/(?:passwd|shadow|sudoers)/, // Sensitive system files
        /^~\/\.ssh\//, // SSH keys
        /^~\/\.gnupg\//, // GPG keys
        /\$\{[^}]+\}/, // Shell variable expansion
        /`[^`]+`/, // Command substitution
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(filePath)) {
          return {
            isValid: false,
            reason: `Dangerous path pattern detected: ${pattern}`,
          };
        }
      }

      // Skip further validation for glob patterns if allowed
      if (options.allowGlob && this.isGlobPattern(filePath)) {
        return { isValid: true };
      }

      // Resolve to absolute path
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(this.rootDirectory, filePath);

      // Check blocked directories
      if (this.config.blockedDirectories) {
        for (const blocked of this.config.blockedDirectories) {
          const blockedPath = path.resolve(blocked);
          if (absolutePath.startsWith(blockedPath + path.sep) || absolutePath === blockedPath) {
            return {
              isValid: false,
              reason: `Path is in blocked directory: ${blocked}`,
            };
          }
        }
      }

      // Check allowed directories if whitelist is enabled
      if (this.config.allowedDirectories && this.config.allowedDirectories.length > 0) {
        let inAllowed = false;
        for (const allowed of this.config.allowedDirectories) {
          const allowedPath = path.resolve(allowed);
          if (absolutePath.startsWith(allowedPath + path.sep) || absolutePath === allowedPath) {
            inAllowed = true;
            break;
          }
        }
        if (!inAllowed) {
          return {
            isValid: false,
            reason: 'Path is not in allowed directories',
          };
        }
      }

      // Check if path is within root directory
      if (!isWithinRoot(absolutePath, this.rootDirectory)) {
        return {
          isValid: false,
          reason: 'Path is outside root directory',
        };
      }

      // Check directory depth
      const relativePath = path.relative(this.rootDirectory, absolutePath);
      const depth = relativePath.split(path.sep).filter(p => p !== '').length;
      if (depth > this.config.maxDirectoryDepth) {
        return {
          isValid: false,
          reason: `Path exceeds maximum directory depth of ${this.config.maxDirectoryDepth}`,
        };
      }

      // Check file extension
      const ext = path.extname(absolutePath).toLowerCase();
      if (this.config.blockedExtensions && this.config.blockedExtensions.includes(ext)) {
        return {
          isValid: false,
          reason: `File extension '${ext}' is blocked`,
        };
      }
      if (this.config.allowedExtensions && 
          this.config.allowedExtensions.length > 0 && 
          !this.config.allowedExtensions.includes(ext)) {
        return {
          isValid: false,
          reason: `File extension '${ext}' is not allowed`,
        };
      }

      // Check for symbolic links
      if (options.checkExists && this.config.resolveSymlinks) {
        try {
          const stats = await lstat(absolutePath);
          if (stats.isSymbolicLink()) {
            const realPath = await realpath(absolutePath);
            
            // Validate the resolved path
            if (!isWithinRoot(realPath, this.rootDirectory)) {
              return {
                isValid: false,
                reason: 'Symbolic link points outside root directory',
                isSymlink: true,
                realPath,
              };
            }

            return {
              isValid: true,
              resolvedPath: absolutePath,
              isSymlink: true,
              realPath,
            };
          }
        } catch (err) {
          // File doesn't exist, which is okay for some operations
        }
      }

      return {
        isValid: true,
        resolvedPath: absolutePath,
      };
    } catch (error) {
      return {
        isValid: false,
        reason: `Path validation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Sanitize input to prevent injection attacks
   */
  sanitizeInput(input: string, type: 'path' | 'regex' | 'code'): string {
    switch (type) {
      case 'path':
        // Remove null bytes and control characters
        return input
          .replace(/\0/g, '')
          .replace(/[\x00-\x1F\x7F]/g, '')
          .trim();

      case 'regex':
        // Escape special regex characters if needed
        // But preserve intended regex functionality
        return input.replace(/\0/g, '');

      case 'code':
        // Remove potential script injections
        return input
          .replace(/<script[^>]*>.*?<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=["']?[^"'\s]*["']?/gi, '');

      default:
        return input;
    }
  }

  /**
   * Check rate limits for operations
   */
  checkRateLimit(userId: string = 'anonymous'): boolean {
    const now = new Date();
    const usage = this.resourceUsage.get(userId) || {
      memoryUsage: 0,
      operationCount: 0,
      lastResetTime: now,
    };

    // Reset counters if more than a minute has passed
    const timeDiff = now.getTime() - usage.lastResetTime.getTime();
    if (timeDiff > 60000) {
      usage.operationCount = 0;
      usage.lastResetTime = now;
    }

    // Check rate limit
    if (usage.operationCount >= this.config.operationRateLimit) {
      this.logSecurityEvent({
        operationId: 'rate_limit_check',
        operationType: 'rate_limit',
        action: 'check_rate_limit',
        resource: userId,
        result: 'denied',
        reason: `Rate limit exceeded: ${usage.operationCount} operations in last minute`,
      });
      return false;
    }

    usage.operationCount++;
    this.resourceUsage.set(userId, usage);
    return true;
  }

  /**
   * Check memory usage limits
   */
  checkMemoryUsage(estimatedUsage: number, userId: string = 'anonymous'): boolean {
    const usage = this.resourceUsage.get(userId) || {
      memoryUsage: 0,
      operationCount: 0,
      lastResetTime: new Date(),
    };

    const totalUsage = usage.memoryUsage + estimatedUsage;
    if (totalUsage > this.config.maxMemoryUsage) {
      this.logSecurityEvent({
        operationId: 'memory_check',
        operationType: 'resource_limit',
        action: 'check_memory',
        resource: userId,
        result: 'denied',
        reason: `Memory limit exceeded: ${totalUsage} bytes (limit: ${this.config.maxMemoryUsage})`,
      });
      return false;
    }

    usage.memoryUsage = totalUsage;
    this.resourceUsage.set(userId, usage);
    return true;
  }

  /**
   * Update memory usage after operation
   */
  updateMemoryUsage(actualUsage: number, userId: string = 'anonymous'): void {
    const usage = this.resourceUsage.get(userId);
    if (usage) {
      usage.memoryUsage = Math.max(0, usage.memoryUsage - actualUsage);
      this.resourceUsage.set(userId, usage);
    }
  }

  /**
   * Log security event
   */
  private logSecurityEvent(entry: Omit<SecurityAuditEntry, 'timestamp' | 'sessionId'>): void {
    if (!this.config.enableAuditLogging) {
      return;
    }

    const fullEntry: SecurityAuditEntry = {
      ...entry,
      timestamp: new Date(),
      sessionId: this.sessionId,
    };

    this.auditLog.push(fullEntry);
    this.emit('security-event', fullEntry);

    // Keep audit log size manageable
    if (this.auditLog.length > 10000) {
      this.auditLog.splice(0, 1000);
    }
  }

  /**
   * Log operation attempt
   */
  logOperation(
    operation: Operation,
    result: 'allowed' | 'denied',
    reason?: string,
    userId?: string
  ): void {
    this.logSecurityEvent({
      operationId: operation.id || 'unknown',
      operationType: operation.type,
      userId,
      action: 'operation_attempt',
      resource: this.getOperationResource(operation),
      result,
      reason,
      metadata: {
        operationType: operation.type,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Get resource identifier for operation
   */
  private getOperationResource(operation: Operation): string {
    switch (operation.type) {
      case 'analyze':
        return (operation as any).paths?.join(', ') || (operation as any).files?.join(', ') || '';
      case 'edit':
        return operation.edits?.map(e => e.file).join(', ') || '';
      case 'create':
        return operation.files?.map(f => f.path).join(', ') || '';
      case 'delete':
        return operation.paths?.join(', ') || '';
      case 'validate':
        return (operation as any).commands?.map((c: any) => c.command).join(', ') || (operation as any).files?.join(', ') || '';
      default:
        return 'unknown';
    }
  }

  /**
   * Check if a path is a glob pattern
   */
  private isGlobPattern(filePath: string): boolean {
    return filePath.includes('*') || 
           filePath.includes('?') || 
           filePath.includes('[') || 
           filePath.includes('{');
  }

  /**
   * Get audit log entries
   */
  getAuditLog(filter?: {
    startTime?: Date;
    endTime?: Date;
    userId?: string;
    result?: 'allowed' | 'denied' | 'error';
    operationType?: string;
  }): SecurityAuditEntry[] {
    let entries = [...this.auditLog];

    if (filter) {
      if (filter.startTime) {
        entries = entries.filter(e => e.timestamp >= filter.startTime!);
      }
      if (filter.endTime) {
        entries = entries.filter(e => e.timestamp <= filter.endTime!);
      }
      if (filter.userId) {
        entries = entries.filter(e => e.userId === filter.userId);
      }
      if (filter.result) {
        entries = entries.filter(e => e.result === filter.result);
      }
      if (filter.operationType) {
        entries = entries.filter(e => e.operationType === filter.operationType);
      }
    }

    return entries;
  }

  /**
   * Generate security report
   */
  generateSecurityReport(): {
    summary: {
      totalOperations: number;
      allowedOperations: number;
      deniedOperations: number;
      errorOperations: number;
      uniqueUsers: number;
      timeRange: { start?: Date; end?: Date };
    };
    topDeniedReasons: Array<{ reason: string; count: number }>;
    operationsByType: Record<string, number>;
    suspiciousActivity: SecurityAuditEntry[];
  } {
    const deniedEntries = this.auditLog.filter(e => e.result === 'denied');
    const allowedEntries = this.auditLog.filter(e => e.result === 'allowed');
    const errorEntries = this.auditLog.filter(e => e.result === 'error');

    // Count denied reasons
    const deniedReasons = new Map<string, number>();
    deniedEntries.forEach(entry => {
      const reason = entry.reason || 'Unknown';
      deniedReasons.set(reason, (deniedReasons.get(reason) || 0) + 1);
    });

    // Count operations by type
    const operationTypes = new Map<string, number>();
    this.auditLog.forEach(entry => {
      operationTypes.set(entry.operationType, (operationTypes.get(entry.operationType) || 0) + 1);
    });

    // Find suspicious activity (multiple denied attempts)
    const userDeniedCounts = new Map<string, number>();
    deniedEntries.forEach(entry => {
      const user = entry.userId || 'anonymous';
      userDeniedCounts.set(user, (userDeniedCounts.get(user) || 0) + 1);
    });

    const suspiciousActivity = this.auditLog.filter(entry => {
      const user = entry.userId || 'anonymous';
      return userDeniedCounts.get(user)! > 5;
    });

    return {
      summary: {
        totalOperations: this.auditLog.length,
        allowedOperations: allowedEntries.length,
        deniedOperations: deniedEntries.length,
        errorOperations: errorEntries.length,
        uniqueUsers: new Set(this.auditLog.map(e => e.userId || 'anonymous')).size,
        timeRange: {
          start: this.auditLog.length > 0 ? this.auditLog[0].timestamp : undefined,
          end: this.auditLog.length > 0 ? this.auditLog[this.auditLog.length - 1].timestamp : undefined,
        },
      },
      topDeniedReasons: Array.from(deniedReasons.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
      operationsByType: Object.fromEntries(operationTypes),
      suspiciousActivity: suspiciousActivity.slice(0, 100),
    };
  }

  /**
   * Clear resource usage for a user
   */
  clearResourceUsage(userId: string = 'anonymous'): void {
    this.resourceUsage.delete(userId);
  }

  /**
   * Get current resource usage
   */
  getResourceUsage(userId: string = 'anonymous'): ResourceUsage | undefined {
    return this.resourceUsage.get(userId);
  }
}