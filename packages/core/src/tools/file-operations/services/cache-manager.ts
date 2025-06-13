/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LruCache } from '../../../utils/LruCache.js';
import { FileSystemService } from './file-system-service.js';
import { ProcessedFileReadResult } from '../../../utils/fileUtils.js';
import { PredictiveCache, DEFAULT_PREDICTIVE_CACHE_CONFIG, type PredictiveCacheConfig } from './predictive-cache.js';
import { ASTParserService } from './ast-parser.js';
import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Cache entry metadata
 */
interface CacheEntry {
  content: ProcessedFileReadResult;
  timestamp: number;
  size: number;
  hash?: string;
}

/**
 * File change event
 */
interface FileChangeEvent {
  path: string;
  type: 'change' | 'rename' | 'delete';
  timestamp: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number;
  maxSize: number;
}

/**
 * Cache manager configuration
 */
export interface CacheConfig {
  maxSizeBytes: number;
  maxEntries: number;
  ttlMs?: number;
  enableWatching?: boolean;
  predictiveCache?: PredictiveCacheConfig;
}

/**
 * Cache manager for file operations
 * Provides LRU caching with file watching and memory management
 * Enhanced with predictive caching capabilities
 */
export class CacheManager {
  private readonly cache: LruCache<string, CacheEntry>;
  private readonly fileService: FileSystemService;
  private readonly config: Required<Omit<CacheConfig, 'predictiveCache'>> & { predictiveCache?: PredictiveCacheConfig };
  private currentSizeBytes: number = 0;
  private stats: CacheStats;
  private watchedFiles: Set<string> = new Set();
  private sessionId: string;
  private predictiveCache?: PredictiveCache;
  
  constructor(
    fileService: FileSystemService,
    config: CacheConfig
  ) {
    this.fileService = fileService;
    this.config = {
      maxSizeBytes: config.maxSizeBytes,
      maxEntries: config.maxEntries,
      ttlMs: config.ttlMs ?? 0,
      enableWatching: config.enableWatching ?? true,
      predictiveCache: config.predictiveCache
    };
    
    this.cache = new LruCache<string, CacheEntry>(config.maxEntries);
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      currentSize: 0,
      maxSize: config.maxEntries
    };
    
    // Generate session ID for cache lifecycle
    this.sessionId = crypto.randomBytes(8).toString('hex');
    
    // Initialize predictive cache if enabled
    if (config.predictiveCache?.enabled) {
      const predictiveConfig = { ...DEFAULT_PREDICTIVE_CACHE_CONFIG, ...config.predictiveCache };
      const astParser = new ASTParserService(this);
      this.predictiveCache = new PredictiveCache(fileService, this, predictiveConfig, undefined, astParser);
    }
  }

  /**
   * Get file content from cache or load it
   * Enhanced with predictive caching
   */
  async get(filePath: string): Promise<ProcessedFileReadResult> {
    // Use predictive cache if available
    if (this.predictiveCache) {
      return await this.predictiveCache.getWithPrediction(filePath);
    }
    return this.getInternal(filePath);
  }

  /**
   * Internal get method that doesn't use predictive caching
   * Used by predictive cache to avoid circular dependency
   */
  async getInternal(filePath: string): Promise<ProcessedFileReadResult> {
    const normalizedPath = path.normalize(filePath);
    const internalCache = (this.cache as unknown as { cache: Map<string, CacheEntry> }).cache;
    const entry = internalCache.get(normalizedPath);
    
    if (entry) {
      // Check TTL if configured
      if (this.config.ttlMs > 0) {
        const age = Date.now() - entry.timestamp;
        if (age > this.config.ttlMs) {
          this.evict(normalizedPath);
          this.stats.misses++; // Count as miss since cache expired
          
          // Load from disk but don't count miss again
          const results = await this.fileService.readFiles([normalizedPath]);
          const content = results.get(normalizedPath);
          
          if (content && !content.error) {
            await this.set(normalizedPath, content);
          }
          
          return content || {
            llmContent: '',
            returnDisplay: 'Failed to read file',
            error: 'File read failed'
          };
        }
      }
      
      // Update LRU by re-setting
      this.cache.get(normalizedPath); // This updates LRU order
      
      this.stats.hits++;
      return entry.content;
    }
    
    this.stats.misses++;
    return this.loadAndCache(normalizedPath);
  }

  /**
   * Get multiple files with optimized batch loading
   */
  async getMany(filePaths: string[]): Promise<Map<string, ProcessedFileReadResult>> {
    const results = new Map<string, ProcessedFileReadResult>();
    const uncachedPaths: string[] = [];
    const internalCache = (this.cache as unknown as { cache: Map<string, CacheEntry> }).cache;
    
    // Check cache first
    for (const filePath of filePaths) {
      const normalizedPath = path.normalize(filePath);
      const entry = internalCache.get(normalizedPath);
      
      if (entry && (this.config.ttlMs === 0 || Date.now() - entry.timestamp <= this.config.ttlMs)) {
        // Update LRU order
        this.cache.get(normalizedPath);
        this.stats.hits++;
        results.set(filePath, entry.content);
      } else {
        if (entry) {
          // Entry expired
          this.evict(normalizedPath);
        }
        uncachedPaths.push(filePath);
      }
    }
    
    // Batch load uncached files
    if (uncachedPaths.length > 0) {
      this.stats.misses += uncachedPaths.length;
      const loaded = await this.fileService.readFiles(uncachedPaths);
      
      for (const [filePath, content] of loaded) {
        results.set(filePath, content);
        // Cache successful loads
        if (!content.error) {
          await this.set(filePath, content);
        }
      }
    }
    
    return results;
  }

  /**
   * Set cache entry
   */
  async set(filePath: string, content: ProcessedFileReadResult): Promise<void> {
    const normalizedPath = path.normalize(filePath);
    
    // Calculate content size
    const size = this.calculateSize(content);
    
    // Check if we need to evict entries to make space
    const internalCache = (this.cache as unknown as { cache: Map<string, CacheEntry> }).cache;
    while (this.currentSizeBytes + size > this.config.maxSizeBytes && internalCache.size > 0) {
      const oldestKey = internalCache.keys().next().value;
      if (oldestKey) {
        this.evict(oldestKey);
      }
    }
    
    // Don't cache if single item exceeds max size
    if (size > this.config.maxSizeBytes) {
      return;
    }
    
    const entry: CacheEntry = {
      content,
      timestamp: Date.now(),
      size,
      hash: this.calculateHash(content)
    };
    
    // Update size tracking
    const existingEntry = this.cache.get(normalizedPath);
    if (existingEntry) {
      this.currentSizeBytes -= existingEntry.size;
    }
    
    this.cache.set(normalizedPath, entry);
    this.currentSizeBytes += size;
    
    // Set up file watching if enabled
    if (this.config.enableWatching && !this.watchedFiles.has(normalizedPath)) {
      this.watchFile(normalizedPath);
    }
  }

  /**
   * Invalidate cache entry
   */
  invalidate(filePath: string): void {
    const normalizedPath = path.normalize(filePath);
    this.evict(normalizedPath);
  }

  /**
   * Invalidate multiple cache entries
   */
  invalidateMany(filePaths: string[]): void {
    for (const filePath of filePaths) {
      this.invalidate(filePath);
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    // Get current size before clearing
    const internalCache = (this.cache as unknown as { cache: Map<string, CacheEntry> }).cache;
    const currentSize = internalCache.size;
    
    // Unwatch all files
    for (const filePath of this.watchedFiles) {
      this.fileService.unwatchFile(filePath);
    }
    this.watchedFiles.clear();
    
    this.cache.clear();
    this.currentSizeBytes = 0;
    this.stats.evictions += currentSize;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const internalCache = (this.cache as unknown as { cache: Map<string, CacheEntry> }).cache;
    return {
      ...this.stats,
      currentSize: internalCache.size
    };
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Record file access for predictive analysis
   */
  recordAccess(filePath: string, operation: string, context?: string): void {
    if (this.predictiveCache) {
      this.predictiveCache.recordAccess(filePath, operation, context);
    }
  }

  /**
   * Get predictive cache metrics
   */
  getPredictiveMetrics() {
    return this.predictiveCache?.getMetrics();
  }

  /**
   * Warm cache using predictive strategies
   */
  async warmCache(strategy?: string): Promise<number> {
    if (this.predictiveCache) {
      return await this.predictiveCache.warmCache(strategy);
    }
    return 0;
  }

  /**
   * Train the prediction model
   */
  async trainPredictionModel(): Promise<void> {
    if (this.predictiveCache) {
      await this.predictiveCache.trainModel();
    }
  }

  /**
   * Get predicted next files
   */
  async getPredictedFiles(currentFile?: string, limit?: number) {
    if (this.predictiveCache) {
      return await this.predictiveCache.predictNextFiles(currentFile, limit);
    }
    return [];
  }

  /**
   * Get feature importance from prediction model
   */
  getFeatureImportance(): Map<string, number> | undefined {
    return this.predictiveCache?.getFeatureImportance();
  }

  /**
   * Analyze workspace dependencies
   */
  async analyzeWorkspace(workspaceRoot?: string) {
    if (this.predictiveCache) {
      return await this.predictiveCache.analyzeWorkspace(workspaceRoot);
    }
    return null;
  }

  /**
   * Get dependency-based predictions
   */
  async getDependencyPredictions(currentFile: string, limit?: number) {
    if (this.predictiveCache) {
      return await this.predictiveCache.getPredictionsBasedOnDependencies(currentFile, limit);
    }
    return [];
  }

  /**
   * Handle memory pressure
   */
  handleMemoryPressure(targetReduction: number): number {
    let reducedBytes = 0;
    const internalCache = (this.cache as unknown as { cache: Map<string, CacheEntry> }).cache;
    const entries = Array.from(internalCache.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.value.timestamp - b.value.timestamp);
    
    for (const { key, value } of entries) {
      if (reducedBytes >= targetReduction) {
        break;
      }
      
      reducedBytes += value.size;
      this.evict(key);
    }
    
    return reducedBytes;
  }

  /**
   * Destroy cache manager
   */
  destroy(): void {
    this.clear();
    if (this.predictiveCache) {
      this.predictiveCache.destroy();
    }
  }

  /**
   * Load file and cache it
   */
  private async loadAndCache(filePath: string): Promise<ProcessedFileReadResult> {
    // Miss already counted in get() method
    const results = await this.fileService.readFiles([filePath]);
    const content = results.get(filePath);
    
    if (content && !content.error) {
      await this.set(filePath, content);
    }
    
    return content || {
      llmContent: '',
      returnDisplay: 'Failed to read file',
      error: 'File read failed'
    };
  }

  /**
   * Evict entry from cache
   */
  private evict(filePath: string): void {
    // Access the internal cache map
    const internalCache = (this.cache as unknown as { cache: Map<string, CacheEntry> }).cache;
    const entry = internalCache.get(filePath);
    
    if (entry) {
      this.currentSizeBytes -= entry.size;
      this.stats.evictions++;
      
      // Remove from cache
      internalCache.delete(filePath);
      
      // Unwatch file
      if (this.watchedFiles.has(filePath)) {
        this.fileService.unwatchFile(filePath);
        this.watchedFiles.delete(filePath);
      }
    }
  }

  /**
   * Calculate size of cache entry
   */
  private calculateSize(content: ProcessedFileReadResult): number {
    let size = 0;
    
    if (typeof content.llmContent === 'string') {
      size += Buffer.byteLength(content.llmContent, 'utf8');
    } else {
      // For non-string content (images, PDFs), estimate size
      size += JSON.stringify(content.llmContent).length;
    }
    
    if (content.returnDisplay) {
      size += Buffer.byteLength(content.returnDisplay, 'utf8');
    }
    
    if (content.error) {
      size += Buffer.byteLength(content.error, 'utf8');
    }
    
    return size;
  }

  /**
   * Calculate hash of content for change detection
   */
  private calculateHash(content: ProcessedFileReadResult): string {
    const hash = crypto.createHash('sha256');
    
    if (typeof content.llmContent === 'string') {
      hash.update(content.llmContent);
    } else {
      hash.update(JSON.stringify(content.llmContent));
    }
    
    return hash.digest('hex');
  }

  /**
   * Watch file for changes
   */
  private watchFile(filePath: string): void {
    try {
      this.fileService.watchFile(filePath, (event) => {
        // Invalidate cache on any change
        this.invalidate(filePath);
        
        // Log change event
        const changeEvent: FileChangeEvent = {
          path: filePath,
          type: event === 'rename' ? 'rename' : 'change',
          timestamp: Date.now()
        };
        
        // Could emit this event for monitoring
        this.onFileChange(changeEvent);
      });
      
      this.watchedFiles.add(filePath);
    } catch (_error) {
      // Ignore watch errors (file might not exist anymore)
    }
  }

  /**
   * Handle file change event
   */
  private onFileChange(_event: FileChangeEvent): void {
    // This could be extended to emit events or trigger callbacks
    // For now, just invalidation is handled in watchFile
  }
}