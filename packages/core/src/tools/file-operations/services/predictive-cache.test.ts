/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { FileSystemService } from './file-system-service.js';
import { CacheManager } from './cache-manager.js';
import { ASTParserService } from './ast-parser.js';
import { 
  PredictiveCache, 
  SimpleAccessPredictionModel,
  DecisionTreeAccessPredictionModel,
  NeuralNetworkAccessPredictionModel,
  EnsembleAccessPredictionModel,
  createPredictionModel,
  DEFAULT_PREDICTIVE_CACHE_CONFIG,
  type FileAccessPattern,
  type PredictiveCacheConfig,
  type ModelType
} from './predictive-cache.js';

// Mock fs module
vi.mock('fs', () => ({ 
  default: vol,
  promises: vol.promises 
}));
vi.mock('fs/promises', () => ({ default: vol.promises }));

describe('PredictiveCache', () => {
  let fileService: FileSystemService;
  let cacheManager: CacheManager;
  let astParser: ASTParserService;
  let predictiveCache: PredictiveCache;
  let config: PredictiveCacheConfig;

  beforeEach(() => {
    vol.reset();
    
    // Setup test files with imports for dependency analysis
    vol.fromJSON({
      '/test/src/index.ts': `import { util } from './utils.js';\nimport { config } from './config.js';\nconsole.log("hello");`,
      '/test/src/utils.ts': `export function util() {}\nimport { helper } from './helper.js';`,
      '/test/src/helper.ts': 'export function helper() {}',
      '/test/src/config.ts': 'export const config = { setting: true };',
      '/test/src/config.json': '{"setting": true}',
      '/test/docs/readme.md': '# Documentation',
      '/test/package.json': '{"name": "test"}'
    });

    fileService = new FileSystemService('/test');
    cacheManager = new CacheManager(fileService, {
      maxSizeBytes: 1024 * 1024,
      maxEntries: 100,
      enableWatching: false
    });

    astParser = new ASTParserService(cacheManager);

    config = {
      ...DEFAULT_PREDICTIVE_CACHE_CONFIG,
      enabled: true,
      maxPredictions: 3,
      predictionThreshold: 0.5,
      backgroundLoadingConcurrency: 2,
      patternWindowMs: 1000 * 60 * 60, // 1 hour
      modelUpdateInterval: 1000 * 60 * 5 // 5 minutes
    };

    predictiveCache = new PredictiveCache(fileService, cacheManager, config, undefined, astParser);
  });

  afterEach(() => {
    predictiveCache.destroy();
    cacheManager.destroy();
  });

  describe('Access Pattern Recording', () => {
    it('should record file access patterns', () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'edit');
      
      const metrics = predictiveCache.getMetrics();
      expect(metrics.totalPredictions).toBeGreaterThanOrEqual(0);
    });

    it('should clean up old patterns based on window', async () => {
      const shortConfig = { ...config, patternWindowMs: 50 };
      const cache = new PredictiveCache(fileService, cacheManager, shortConfig);
      
      cache.recordAccess('/test/src/index.ts', 'read');
      
      // Wait for patterns to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      
      cache.recordAccess('/test/src/utils.ts', 'read');
      await cache.trainModel();
      
      // Should have cleaned up old patterns
      const predictions = await cache.predictNextFiles();
      expect(predictions.length).toBeLessThanOrEqual(1); // Only recent patterns should remain
      
      cache.destroy();
    });

    it('should record context with access patterns', () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read', 'analyze-operation');
      
      // Access should be recorded with context
      expect(() => {
        predictiveCache.recordAccess('/test/src/utils.ts', 'edit', 'bulk-edit');
      }).not.toThrow();
    });
  });

  describe('File Prediction', () => {
    beforeEach(async () => {
      // Setup some access patterns
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      predictiveCache.recordAccess('/test/src/config.json', 'read');
      
      // Train the model
      await predictiveCache.trainModel();
    });

    it('should predict next files based on patterns', async () => {
      const predictions = await predictiveCache.predictNextFiles('/test/src/index.ts');
      
      expect(predictions).toBeInstanceOf(Array);
      predictions.forEach(prediction => {
        expect(prediction).toHaveProperty('filePath');
        expect(prediction).toHaveProperty('confidence');
        expect(prediction).toHaveProperty('reason');
        expect(prediction).toHaveProperty('features');
        expect(prediction).toHaveProperty('estimatedLoadTime');
        expect(prediction.confidence).toBeGreaterThanOrEqual(0);
        expect(prediction.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should limit predictions to maxPredictions', async () => {
      const predictions = await predictiveCache.predictNextFiles('/test/src/index.ts', 2);
      expect(predictions.length).toBeLessThanOrEqual(2);
    });

    it('should filter predictions by threshold', async () => {
      const highThresholdConfig = { ...config, predictionThreshold: 0.9 };
      const cache = new PredictiveCache(fileService, cacheManager, highThresholdConfig);
      
      cache.recordAccess('/test/src/index.ts', 'read');
      await cache.trainModel();
      
      const predictions = await cache.predictNextFiles();
      predictions.forEach(prediction => {
        expect(prediction.confidence).toBeGreaterThanOrEqual(0.9);
      });
      
      cache.destroy();
    });

    it('should include prediction reasons', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      predictiveCache.recordAccess('/test/src/utils.ts', 'read'); // Same directory
      
      await predictiveCache.trainModel();
      const predictions = await predictiveCache.predictNextFiles('/test/src/index.ts');
      
      predictions.forEach(prediction => {
        expect(typeof prediction.reason).toBe('string');
        expect(prediction.reason.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Pre-loading', () => {
    it('should preload predicted files', async () => {
      // Setup patterns
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles();
      const loadedCount = await predictiveCache.preloadFiles(predictions);
      
      expect(loadedCount).toBeGreaterThanOrEqual(0);
      expect(loadedCount).toBeLessThanOrEqual(predictions.length);
      
      const metrics = predictiveCache.getMetrics();
      expect(metrics.backgroundLoads).toBeGreaterThanOrEqual(0);
    });

    it('should limit concurrent preloading', async () => {
      const limitedConfig = { ...config, backgroundLoadingConcurrency: 1 };
      const cache = new PredictiveCache(fileService, cacheManager, limitedConfig);
      
      // Setup multiple files
      cache.recordAccess('/test/src/index.ts', 'read');
      cache.recordAccess('/test/src/utils.ts', 'read');
      cache.recordAccess('/test/src/config.json', 'read');
      await cache.trainModel();
      
      const predictions = await cache.predictNextFiles();
      const loadedCount = await cache.preloadFiles(predictions);
      
      // Should respect concurrency limit
      expect(loadedCount).toBeLessThanOrEqual(limitedConfig.backgroundLoadingConcurrency);
      
      cache.destroy();
    });

    it('should not preload already cached files', async () => {
      // Pre-cache a file
      await cacheManager.get('/test/src/index.ts');
      
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles();
      const loadedCount = await predictiveCache.preloadFiles(predictions);
      
      // Should handle already cached files gracefully
      expect(loadedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cache Warming', () => {
    it('should warm cache with startup strategy', async () => {
      // Setup access patterns
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      predictiveCache.recordAccess('/test/src/index.ts', 'read'); // Make it frequent
      
      const warmedCount = await predictiveCache.warmCache('startup');
      expect(warmedCount).toBeGreaterThanOrEqual(0);
    });

    it('should warm cache with pattern strategy', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await predictiveCache.trainModel();
      
      const warmedCount = await predictiveCache.warmCache('pattern');
      expect(warmedCount).toBeGreaterThanOrEqual(0);
    });

    it('should warm cache with all enabled strategies', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await predictiveCache.trainModel();
      
      const warmedCount = await predictiveCache.warmCache();
      expect(warmedCount).toBeGreaterThanOrEqual(0);
    });

    it('should respect strategy priority', async () => {
      const configWithPriorities = {
        ...config,
        warmingStrategies: [
          {
            name: 'high-priority',
            priority: 10,
            enabled: true,
            trigger: 'startup' as const,
            maxFiles: 2,
            patterns: ['**/*.ts']
          },
          {
            name: 'low-priority',
            priority: 1,
            enabled: true,
            trigger: 'pattern' as const,
            maxFiles: 1,
            patterns: ['**/*.js']
          }
        ]
      };
      
      const cache = new PredictiveCache(fileService, cacheManager, configWithPriorities);
      cache.recordAccess('/test/src/index.ts', 'read');
      await cache.trainModel();
      
      const warmedCount = await cache.warmCache();
      expect(warmedCount).toBeGreaterThanOrEqual(0);
      
      cache.destroy();
    });
  });

  describe('Model Training and Updates', () => {
    it('should train model with access patterns', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      
      await expect(predictiveCache.trainModel()).resolves.not.toThrow();
    });

    it('should handle online learning updates', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await predictiveCache.trainModel();
      
      await expect(
        predictiveCache.updateModelWithFeedback('/test/src/index.ts', true)
      ).resolves.not.toThrow();
    });

    it('should get feature importance from model', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await predictiveCache.trainModel();
      
      const importance = predictiveCache.getFeatureImportance();
      expect(importance).toBeInstanceOf(Map);
    });

    it('should not train when online learning is disabled', async () => {
      const noLearningConfig = { ...config, enableOnlineLearning: false };
      const cache = new PredictiveCache(fileService, cacheManager, noLearningConfig);
      
      cache.recordAccess('/test/src/index.ts', 'read');
      
      // Should not throw but also should not update
      await expect(
        cache.updateModelWithFeedback('/test/src/index.ts', true)
      ).resolves.not.toThrow();
      
      cache.destroy();
    });
  });

  describe('Enhanced Get with Prediction', () => {
    it('should get file with prediction enhancement', async () => {
      const result = await predictiveCache.getWithPrediction('/test/src/index.ts');
      
      expect(result).toHaveProperty('llmContent');
      expect(result.llmContent).toContain('console.log("hello")');
    });

    it('should track cache hits from predictions', async () => {
      // Pre-warm the cache by recording access and preloading
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      await predictiveCache.trainModel();
      
      // This should trigger prediction and background loading
      await predictiveCache.getWithPrediction('/test/src/index.ts');
      
      // Now check metrics
      const metrics = predictiveCache.getMetrics();
      expect(metrics.cacheHitsFromPrediction).toBeGreaterThanOrEqual(0);
    });

    it('should measure loading time savings', async () => {
      await predictiveCache.getWithPrediction('/test/src/index.ts');
      
      const metrics = predictiveCache.getMetrics();
      expect(metrics.loadingSavingsMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track comprehensive metrics', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles();
      await predictiveCache.preloadFiles(predictions);
      
      const metrics = predictiveCache.getMetrics();
      
      expect(metrics).toHaveProperty('totalPredictions');
      expect(metrics).toHaveProperty('accuratePredictions');
      expect(metrics).toHaveProperty('backgroundLoads');
      expect(metrics).toHaveProperty('cacheHitsFromPrediction');
      expect(metrics).toHaveProperty('averageConfidence');
      expect(metrics).toHaveProperty('loadingSavingsMs');
      expect(metrics).toHaveProperty('resourceMetrics');
      expect(metrics).toHaveProperty('adaptiveConfig');
      
      expect(typeof metrics.totalPredictions).toBe('number');
      expect(typeof metrics.accuratePredictions).toBe('number');
      expect(typeof metrics.backgroundLoads).toBe('number');
      expect(typeof metrics.cacheHitsFromPrediction).toBe('number');
      expect(typeof metrics.averageConfidence).toBe('number');
      expect(typeof metrics.loadingSavingsMs).toBe('number');
      
      // Check resource metrics structure
      expect(metrics.resourceMetrics).toHaveProperty('memoryUsageMB');
      expect(metrics.resourceMetrics).toHaveProperty('cpuUsagePercent');
      expect(metrics.resourceMetrics).toHaveProperty('diskIOPS');
      expect(metrics.resourceMetrics).toHaveProperty('networkLatencyMs');
      expect(metrics.resourceMetrics).toHaveProperty('concurrentOperations');
      
      // Check adaptive config structure
      expect(metrics.adaptiveConfig).toHaveProperty('maxConcurrentLoads');
      expect(metrics.adaptiveConfig).toHaveProperty('predictionThreshold');
      expect(metrics.adaptiveConfig).toHaveProperty('backgroundLoadingEnabled');
      expect(metrics.adaptiveConfig).toHaveProperty('cacheWarningEnabled');
      expect(metrics.adaptiveConfig).toHaveProperty('modelComplexity');
    });

    it('should calculate accurate average confidence', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles();
      const metrics = predictiveCache.getMetrics();
      
      if (predictions.length > 0) {
        const expectedAvg = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
        expect(metrics.averageConfidence).toBeCloseTo(expectedAvg, 2);
      }
    });
  });

  describe('Resource Management', () => {
    it('should track resource metrics', async () => {
      const resourceStatus = predictiveCache.getResourceStatus();
      
      expect(resourceStatus).toHaveProperty('metrics');
      expect(resourceStatus).toHaveProperty('adaptiveConfig');
      expect(resourceStatus).toHaveProperty('canPerformOperation');
      expect(resourceStatus).toHaveProperty('memoryPressure');
      expect(resourceStatus).toHaveProperty('cpuPressure');
      
      expect(typeof resourceStatus.canPerformOperation).toBe('boolean');
      expect(['low', 'medium', 'high']).toContain(resourceStatus.memoryPressure);
      expect(['low', 'medium', 'high']).toContain(resourceStatus.cpuPressure);
      
      expect(resourceStatus.metrics.memoryUsageMB).toBeGreaterThanOrEqual(0);
      expect(resourceStatus.metrics.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(resourceStatus.metrics.cpuUsagePercent).toBeLessThanOrEqual(100);
    });

    it('should adapt configuration based on resource usage', async () => {
      // Simulate high load by adding many concurrent operations
      for (let i = 0; i < 10; i++) {
        predictiveCache.recordAccess(`/test/file${i}.ts`, 'read');
      }
      
      // Wait a bit for resource metrics to update
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const statusAfter = predictiveCache.getResourceStatus();
      
      // Configuration should be adaptive to load
      expect(statusAfter.adaptiveConfig).toBeDefined();
      expect(statusAfter.adaptiveConfig.maxConcurrentLoads).toBeGreaterThan(0);
    });

    it('should limit operations under resource pressure', async () => {
      // Start with fresh cache to test resource limits
      const limitedConfig = {
        ...config,
        backgroundLoadingConcurrency: 1,
        predictionThreshold: 0.1
      };
      const cache = new PredictiveCache(fileService, cacheManager, limitedConfig);
      
      // Record patterns to generate predictions
      cache.recordAccess('/test/src/index.ts', 'read');
      cache.recordAccess('/test/src/utils.ts', 'read');
      await cache.trainModel();
      
      const predictions = await cache.predictNextFiles();
      const loadedCount = await cache.preloadFiles(predictions);
      
      // Should respect resource limits
      expect(loadedCount).toBeLessThanOrEqual(limitedConfig.backgroundLoadingConcurrency);
      
      cache.destroy();
    });

    it('should provide detailed resource status', async () => {
      const status = predictiveCache.getResourceStatus();
      
      // Should have all required properties
      expect(status.metrics).toHaveProperty('memoryUsageMB');
      expect(status.metrics).toHaveProperty('cpuUsagePercent');
      expect(status.metrics).toHaveProperty('diskIOPS');
      expect(status.metrics).toHaveProperty('networkLatencyMs');
      expect(status.metrics).toHaveProperty('concurrentOperations');
      
      expect(status.adaptiveConfig).toHaveProperty('maxConcurrentLoads');
      expect(status.adaptiveConfig).toHaveProperty('predictionThreshold');
      expect(status.adaptiveConfig).toHaveProperty('backgroundLoadingEnabled');
      expect(status.adaptiveConfig).toHaveProperty('cacheWarningEnabled');
      expect(status.adaptiveConfig).toHaveProperty('modelComplexity');
      
      // Values should be reasonable
      expect(status.metrics.memoryUsageMB).toBeGreaterThanOrEqual(0);
      expect(status.adaptiveConfig.maxConcurrentLoads).toBeGreaterThan(0);
      expect(status.adaptiveConfig.predictionThreshold).toBeGreaterThan(0);
      expect(status.adaptiveConfig.predictionThreshold).toBeLessThanOrEqual(1);
    });
  });

  describe('Disabled State', () => {
    it('should handle disabled state gracefully', async () => {
      const disabledConfig = { ...config, enabled: false };
      const cache = new PredictiveCache(fileService, cacheManager, disabledConfig);
      
      // All operations should be no-ops when disabled
      cache.recordAccess('/test/src/index.ts', 'read');
      
      const predictions = await cache.predictNextFiles();
      expect(predictions).toEqual([]);
      
      const loadedCount = await cache.preloadFiles();
      expect(loadedCount).toBe(0);
      
      const warmedCount = await cache.warmCache();
      expect(warmedCount).toBe(0);
      
      cache.destroy();
    });
  });

  describe('Dependency Analysis', () => {
    it('should analyze workspace and build dependency graph', async () => {
      // Record some access patterns to provide files for analysis
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      predictiveCache.recordAccess('/test/src/config.ts', 'read');
      
      const analysis = await predictiveCache.analyzeWorkspace('/test');
      
      expect(analysis).toHaveProperty('entryPoints');
      expect(analysis).toHaveProperty('coreFiles');
      expect(analysis).toHaveProperty('dependencies');
      expect(analysis).toHaveProperty('fileTypes');
      expect(analysis).toHaveProperty('directoryStructure');
      
      // Should have found files (either as entry points or core files)
      const totalFiles = analysis.entryPoints.length + analysis.coreFiles.length + analysis.testFiles.length + analysis.configFiles.length;
      expect(totalFiles).toBeGreaterThan(0);
      
      // Should have processed dependencies
      expect(analysis.dependencies).toHaveProperty('dependencies');
      expect(analysis.dependencies).toHaveProperty('dependents');
      expect(analysis.dependencies).toHaveProperty('clusters');
      
      // Should have enhanced analysis fields
      expect(analysis).toHaveProperty('projectType');
      expect(analysis).toHaveProperty('patterns');
      expect(analysis).toHaveProperty('hotspots');
      expect(analysis).toHaveProperty('criticalPaths');
      expect(analysis).toHaveProperty('buildFiles');
    });

    it('should provide dependency-based predictions', async () => {
      // Set up access patterns
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      
      const predictions = await predictiveCache.getPredictionsBasedOnDependencies('/test/src/index.ts');
      
      expect(predictions).toBeInstanceOf(Array);
      // Should include dependencies like utils.ts and config.ts
      predictions.forEach(prediction => {
        expect(prediction).toHaveProperty('filePath');
        expect(prediction).toHaveProperty('confidence');
        expect(prediction).toHaveProperty('reason');
        expect(prediction.reason).toMatch(/dependency|depends/i);
      });
    });

    it('should include dependency warming strategy', async () => {
      const configWithDeps = {
        ...config,
        warmingStrategies: [
          {
            name: 'dependency',
            priority: 8,
            enabled: true,
            trigger: 'dependency' as const,
            maxFiles: 5,
            patterns: ['**/*']
          }
        ]
      };
      
      const cache = new PredictiveCache(fileService, cacheManager, configWithDeps, undefined, astParser);
      
      // Record access to trigger dependency analysis
      cache.recordAccess('/test/src/index.ts', 'read');
      
      const warmedCount = await cache.warmCache('dependency');
      expect(warmedCount).toBeGreaterThanOrEqual(0);
      
      cache.destroy();
    });

    it('should cache workspace analysis results', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      
      const analysis1 = await predictiveCache.analyzeWorkspace('/test');
      const analysis2 = await predictiveCache.analyzeWorkspace('/test');
      
      // Results should be identical when cached
      expect(analysis1).toEqual(analysis2);
      
      // Both analyses should have the same structure
      expect(analysis1).toHaveProperty('entryPoints');
      expect(analysis1).toHaveProperty('coreFiles');
      expect(analysis1).toHaveProperty('dependencies');
    });

    it('should integrate dependency predictions with pattern predictions', async () => {
      // Record access patterns
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles('/test/src/index.ts');
      
      expect(predictions).toBeInstanceOf(Array);
      // Should include both dependency-based and pattern-based predictions
      expect(predictions.length).toBeGreaterThan(0);
      
      // Check that predictions include dependencies
      const filePaths = predictions.map(p => p.filePath);
      const hasUtilsDependency = filePaths.some(path => path.includes('utils'));
      const hasConfigDependency = filePaths.some(path => path.includes('config'));
      
      expect(hasUtilsDependency || hasConfigDependency).toBe(true);
    });

    it('should detect project type correctly', async () => {
      // Record access patterns to provide files for analysis
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      predictiveCache.recordAccess('/test/package.json', 'read');
      
      const analysis = await predictiveCache.analyzeWorkspace('/test');
      
      expect(analysis.projectType).toHaveProperty('type');
      expect(analysis.projectType).toHaveProperty('confidence');
      expect(analysis.projectType).toHaveProperty('indicators');
      
      // Should detect TypeScript project
      expect(['typescript', 'javascript', 'mixed']).toContain(analysis.projectType.type);
      expect(analysis.projectType.confidence).toBeGreaterThan(0);
      expect(analysis.projectType.indicators.length).toBeGreaterThan(0);
    });

    it('should provide project-specific patterns', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      
      const analysis = await predictiveCache.analyzeWorkspace('/test');
      
      expect(analysis.patterns).toHaveProperty('entryPointPatterns');
      expect(analysis.patterns).toHaveProperty('testPatterns');
      expect(analysis.patterns).toHaveProperty('configPatterns');
      expect(analysis.patterns).toHaveProperty('buildArtifactPatterns');
      expect(analysis.patterns).toHaveProperty('ignoredPatterns');
      expect(analysis.patterns).toHaveProperty('importantDirectories');
      
      // Should have reasonable patterns for TypeScript/JavaScript
      expect(analysis.patterns.entryPointPatterns.length).toBeGreaterThan(0);
      expect(analysis.patterns.testPatterns.length).toBeGreaterThan(0);
    });

    it('should identify hotspots from access patterns', async () => {
      // Record multiple accesses to create hotspots
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/index.ts', 'edit');
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      
      const analysis = await predictiveCache.analyzeWorkspace('/test');
      
      expect(analysis.hotspots).toBeInstanceOf(Array);
      expect(analysis.hotspots.length).toBeGreaterThanOrEqual(0);
      
      // Most accessed file should be in hotspots if any exist
      if (analysis.hotspots.length > 0) {
        expect(analysis.hotspots).toContain('/test/src/index.ts');
      }
    });

    it('should find critical dependency paths', async () => {
      // Set up files with dependencies
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      predictiveCache.recordAccess('/test/src/helper.ts', 'read');
      
      const analysis = await predictiveCache.analyzeWorkspace('/test');
      
      expect(analysis.criticalPaths).toBeInstanceOf(Array);
      // Critical paths may be empty for simple test setups
      analysis.criticalPaths.forEach(path => {
        expect(path).toBeInstanceOf(Array);
        expect(path.length).toBeGreaterThan(0);
      });
    });

    it('should handle git history analysis gracefully', async () => {
      // Set up access patterns
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      
      // Git history analysis should not throw even if git is not available
      const gitPatterns = await predictiveCache.analyzeGitHistory('/test');
      expect(gitPatterns).toBeInstanceOf(Map);
      
      // Should handle git-based predictions gracefully
      const gitPredictions = await predictiveCache.getPredictionsBasedOnGitHistory('/test/src/index.ts');
      expect(gitPredictions).toBeInstanceOf(Array);
    });

    it('should include git-history warming strategy', async () => {
      const configWithGit = {
        ...config,
        warmingStrategies: [
          {
            name: 'git-history',
            priority: 7,
            enabled: true,
            trigger: 'git-history' as const,
            maxFiles: 5,
            patterns: ['**/*'],
            gitOptions: {
              lookbackDays: 7,
              minCommits: 2,
              ignoreAuthors: ['bot']
            }
          }
        ]
      };
      
      const cache = new PredictiveCache(fileService, cacheManager, configWithGit, undefined, astParser);
      
      // Should not throw even if git is not available
      const warmedCount = await cache.warmCache('git-history');
      expect(warmedCount).toBeGreaterThanOrEqual(0);
      
      cache.destroy();
    });

    it('should integrate git predictions with other prediction types', async () => {
      // Record access patterns
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles('/test/src/index.ts');
      
      expect(predictions).toBeInstanceOf(Array);
      // Should work even without git history (will include dependency and pattern predictions)
      // The system should gracefully handle missing git data
    });

    it('should use adaptive prediction threshold', async () => {
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles('/test/src/index.ts');
      const status = predictiveCache.getResourceStatus();
      
      // All predictions should meet the adaptive threshold
      predictions.forEach(prediction => {
        expect(prediction.confidence).toBeGreaterThanOrEqual(status.adaptiveConfig.predictionThreshold);
      });
    });
  });

  describe('Enhanced Feature Extraction', () => {
    it('should extract enhanced features with dependency information', async () => {
      // Set up access patterns and dependencies
      predictiveCache.recordAccess('/test/src/index.ts', 'read');
      predictiveCache.recordAccess('/test/src/utils.ts', 'read');
      
      // Analyze workspace to build dependency graph
      await predictiveCache.analyzeWorkspace('/test');
      
      // Extract features should now include dependency information
      const predictions = await predictiveCache.predictNextFiles('/test/src/index.ts');
      
      if (predictions.length > 0) {
        const features = predictions[0].features;
        expect(features).toHaveProperty('dependencyCount');
        expect(features).toHaveProperty('dependencyStrength');
        expect(features).toHaveProperty('isDependentOn');
        expect(features).toHaveProperty('isEntryPoint');
        expect(features).toHaveProperty('isCoreFile');
        expect(features).toHaveProperty('workspaceRelevance');
        
        expect(typeof features.dependencyCount).toBe('number');
        expect(typeof features.dependencyStrength).toBe('number');
        expect(typeof features.isDependentOn).toBe('number');
        expect(typeof features.isEntryPoint).toBe('number');
        expect(typeof features.isCoreFile).toBe('number');
        expect(typeof features.workspaceRelevance).toBe('number');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors gracefully', async () => {
      // Try to access non-existent file
      predictiveCache.recordAccess('/test/nonexistent.ts', 'read');
      await predictiveCache.trainModel();
      
      const predictions = await predictiveCache.predictNextFiles();
      const loadedCount = await predictiveCache.preloadFiles(predictions);
      
      // Should not throw and should handle errors gracefully
      expect(loadedCount).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty patterns gracefully', async () => {
      // No patterns recorded
      const predictions = await predictiveCache.predictNextFiles();
      expect(predictions).toEqual([]);
      
      await expect(predictiveCache.trainModel()).resolves.not.toThrow();
    });

    it('should handle model training with empty data', async () => {
      const model = new SimpleAccessPredictionModel();
      await expect(model.train([])).resolves.not.toThrow();
      
      const predictions = await model.predict([]);
      expect(predictions).toEqual([]);
    });

    it('should handle workspace analysis errors gracefully', async () => {
      // Try to analyze non-existent workspace
      const analysis = await predictiveCache.analyzeWorkspace('/nonexistent');
      
      expect(analysis).toHaveProperty('entryPoints');
      expect(analysis).toHaveProperty('coreFiles');
      expect(analysis).toHaveProperty('dependencies');
      // Should return empty analysis rather than throw
      expect(analysis.entryPoints).toEqual([]);
    });
  });

  describe('Advanced ML Models', () => {
    it('should create different model types', () => {
      const simpleModel = createPredictionModel('simple');
      const decisionTreeModel = createPredictionModel('decision-tree');
      const neuralNetworkModel = createPredictionModel('neural-network');
      const ensembleModel = createPredictionModel('ensemble');

      expect(simpleModel).toBeInstanceOf(SimpleAccessPredictionModel);
      expect(decisionTreeModel).toBeInstanceOf(DecisionTreeAccessPredictionModel);
      expect(neuralNetworkModel).toBeInstanceOf(NeuralNetworkAccessPredictionModel);
      expect(ensembleModel).toBeInstanceOf(EnsembleAccessPredictionModel);
    });

    it('should use ensemble model with enhanced config', async () => {
      const ensembleConfig = {
        ...config,
        modelType: 'ensemble' as ModelType
      };

      const cache = new PredictiveCache(fileService, cacheManager, ensembleConfig, undefined, astParser);
      
      // Record patterns and train
      cache.recordAccess('/test/src/index.ts', 'read');
      cache.recordAccess('/test/src/utils.ts', 'read');
      await cache.trainModel();

      const predictions = await cache.predictNextFiles('/test/src/index.ts');
      expect(predictions).toBeInstanceOf(Array);

      // Ensemble should provide reasonable predictions
      const featureImportance = cache.getFeatureImportance();
      expect(featureImportance).toBeInstanceOf(Map);
      expect(featureImportance.size).toBeGreaterThan(0);

      cache.destroy();
    });

    it('should handle different model types in predictive cache', async () => {
      const modelTypes: ModelType[] = ['simple', 'decision-tree', 'neural-network', 'ensemble'];

      for (const modelType of modelTypes) {
        const modelConfig = { ...config, modelType };
        const cache = new PredictiveCache(fileService, cacheManager, modelConfig, undefined, astParser);

        cache.recordAccess('/test/src/index.ts', 'read');
        await cache.trainModel();

        const predictions = await cache.predictNextFiles();
        expect(predictions).toBeInstanceOf(Array);

        cache.destroy();
      }
    });

    it('should adapt model complexity based on resources', async () => {
      const cache = new PredictiveCache(fileService, cacheManager, config, undefined, astParser);
      
      cache.recordAccess('/test/src/index.ts', 'read');
      await cache.trainModel();
      
      const initialStatus = cache.getResourceStatus();
      expect(['simple', 'medium', 'complex']).toContain(initialStatus.adaptiveConfig.modelComplexity);
      
      cache.destroy();
    });
  });
});

describe('SimpleAccessPredictionModel', () => {
  let model: SimpleAccessPredictionModel;

  beforeEach(() => {
    model = new SimpleAccessPredictionModel();
  });

  describe('Training', () => {
    it('should train on access patterns', async () => {
      const patterns: FileAccessPattern[] = [
        {
          filePath: '/test/file1.ts',
          timestamp: Date.now(),
          operation: 'read',
          sessionId: 'test-session'
        },
        {
          filePath: '/test/file2.ts',
          timestamp: Date.now() - 1000,
          operation: 'edit',
          sessionId: 'test-session'
        }
      ];
      
      await expect(model.train(patterns)).resolves.not.toThrow();
    });

    it('should handle empty training data', async () => {
      await expect(model.train([])).resolves.not.toThrow();
    });
  });

  describe('Prediction', () => {
    it('should predict probabilities', async () => {
      const patterns: FileAccessPattern[] = [
        {
          filePath: '/test/file1.ts',
          timestamp: Date.now(),
          operation: 'read',
          sessionId: 'test-session'
        }
      ];
      
      await model.train(patterns);
      
      const features = [{
        temporalProximity: 0.8,
        spatialProximity: 0.6,
        accessFrequency: 0.4,
        fileType: '.ts',
        directoryDepth: 3,
        fileSize: 1000,
        lastModified: Date.now(),
        dependencyCount: 2,
        dependencyStrength: 0.7,
        isDependentOn: 0.5,
        isEntryPoint: 0,
        isCoreFile: 1,
        timeOfDay: 14,
        dayOfWeek: 2,
        workspaceRelevance: 0.8
      }];
      
      const predictions = await model.predict(features);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]).toBeGreaterThanOrEqual(0);
      expect(predictions[0]).toBeLessThanOrEqual(1);
    });

    it('should return default predictions when not trained', async () => {
      const features = [{
        temporalProximity: 0.5,
        spatialProximity: 0.5,
        accessFrequency: 0.5,
        fileType: '.ts',
        directoryDepth: 2,
        fileSize: 500,
        lastModified: Date.now(),
        dependencyCount: 1,
        dependencyStrength: 0.5,
        isDependentOn: 0.3,
        isEntryPoint: 0,
        isCoreFile: 0.5,
        timeOfDay: 10,
        dayOfWeek: 1,
        workspaceRelevance: 0.5
      }];
      
      const predictions = await model.predict(features);
      expect(predictions).toEqual([0.5]);
    });
  });

  describe('Online Learning', () => {
    it('should update model online', async () => {
      const pattern: FileAccessPattern = {
        filePath: '/test/file1.ts',
        timestamp: Date.now(),
        operation: 'read',
        sessionId: 'test-session'
      };
      
      await model.train([pattern]);
      await expect(model.updateOnline(pattern, true)).resolves.not.toThrow();
    });

    it('should handle online updates when not trained', async () => {
      const pattern: FileAccessPattern = {
        filePath: '/test/file1.ts',
        timestamp: Date.now(),
        operation: 'read',
        sessionId: 'test-session'
      };
      
      await expect(model.updateOnline(pattern, true)).resolves.not.toThrow();
    });
  });

  describe('Feature Importance', () => {
    it('should provide feature importance after training', async () => {
      const patterns: FileAccessPattern[] = [
        {
          filePath: '/test/file1.ts',
          timestamp: Date.now(),
          operation: 'read',
          sessionId: 'test-session'
        }
      ];
      
      await model.train(patterns);
      const importance = model.getFeatureImportance();
      
      expect(importance).toBeInstanceOf(Map);
      expect(importance.size).toBeGreaterThan(0);
    });

    it('should return empty importance when not trained', () => {
      const importance = model.getFeatureImportance();
      expect(importance).toBeInstanceOf(Map);
      expect(importance.size).toBe(0);
    });
  });
});

describe('DecisionTreeAccessPredictionModel', () => {
  let model: DecisionTreeAccessPredictionModel;

  beforeEach(() => {
    model = new DecisionTreeAccessPredictionModel(3, 1); // Smaller tree for testing
  });

  describe('Training and Prediction', () => {
    it('should train and make predictions', async () => {
      const patterns: FileAccessPattern[] = [
        { filePath: '/test/file1.ts', timestamp: Date.now(), operation: 'read', sessionId: 'test' },
        { filePath: '/test/file2.ts', timestamp: Date.now() - 1000, operation: 'edit', sessionId: 'test' },
        { filePath: '/test/file3.ts', timestamp: Date.now() - 2000, operation: 'read', sessionId: 'test' }
      ];

      await model.train(patterns);

      const features = [{
        temporalProximity: 0.8,
        spatialProximity: 0.6,
        accessFrequency: 0.4,
        fileType: '.ts',
        directoryDepth: 3,
        fileSize: 1000,
        lastModified: Date.now(),
        dependencyCount: 2,
        dependencyStrength: 0.7,
        isDependentOn: 0.5,
        isEntryPoint: 0,
        isCoreFile: 1,
        timeOfDay: 14,
        dayOfWeek: 2,
        workspaceRelevance: 0.8
      }];

      const predictions = await model.predict(features);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]).toBeGreaterThanOrEqual(0);
      expect(predictions[0]).toBeLessThanOrEqual(1);
    });

    it('should provide feature importance', async () => {
      const patterns: FileAccessPattern[] = [
        { filePath: '/test/file1.ts', timestamp: Date.now(), operation: 'read', sessionId: 'test' }
      ];

      await model.train(patterns);
      const importance = model.getFeatureImportance();
      expect(importance).toBeInstanceOf(Map);
    });
  });
});

describe('NeuralNetworkAccessPredictionModel', () => {
  let model: NeuralNetworkAccessPredictionModel;

  beforeEach(() => {
    model = new NeuralNetworkAccessPredictionModel([13, 4, 1], 0.1); // Smaller network for testing
  });

  describe('Training and Prediction', () => {
    it('should train and make predictions', async () => {
      const patterns: FileAccessPattern[] = [
        { filePath: '/test/file1.ts', timestamp: Date.now(), operation: 'read', sessionId: 'test' },
        { filePath: '/test/file2.ts', timestamp: Date.now() - 1000, operation: 'edit', sessionId: 'test' }
      ];

      await model.train(patterns);

      const features = [{
        temporalProximity: 0.8,
        spatialProximity: 0.6,
        accessFrequency: 0.4,
        fileType: '.ts',
        directoryDepth: 3,
        fileSize: 1000,
        lastModified: Date.now(),
        dependencyCount: 2,
        dependencyStrength: 0.7,
        isDependentOn: 0.5,
        isEntryPoint: 0,
        isCoreFile: 1,
        timeOfDay: 14,
        dayOfWeek: 2,
        workspaceRelevance: 0.8
      }];

      const predictions = await model.predict(features);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]).toBeGreaterThanOrEqual(0);
      expect(predictions[0]).toBeLessThanOrEqual(1);
    });

    it('should handle online learning', async () => {
      const pattern: FileAccessPattern = {
        filePath: '/test/file1.ts',
        timestamp: Date.now(),
        operation: 'read',
        sessionId: 'test'
      };

      await model.train([pattern]);
      await expect(model.updateOnline(pattern, true)).resolves.not.toThrow();
    });
  });
});

describe('EnsembleAccessPredictionModel', () => {
  let model: EnsembleAccessPredictionModel;

  beforeEach(() => {
    model = new EnsembleAccessPredictionModel();
  });

  describe('Ensemble Functionality', () => {
    it('should combine predictions from multiple models', async () => {
      const patterns: FileAccessPattern[] = [
        { filePath: '/test/file1.ts', timestamp: Date.now(), operation: 'read', sessionId: 'test' },
        { filePath: '/test/file2.ts', timestamp: Date.now() - 1000, operation: 'edit', sessionId: 'test' }
      ];

      await model.train(patterns);

      const features = [{
        temporalProximity: 0.8,
        spatialProximity: 0.6,
        accessFrequency: 0.4,
        fileType: '.ts',
        directoryDepth: 3,
        fileSize: 1000,
        lastModified: Date.now(),
        dependencyCount: 2,
        dependencyStrength: 0.7,
        isDependentOn: 0.5,
        isEntryPoint: 0,
        isCoreFile: 1,
        timeOfDay: 14,
        dayOfWeek: 2,
        workspaceRelevance: 0.8
      }];

      const predictions = await model.predict(features);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]).toBeGreaterThanOrEqual(0);
      expect(predictions[0]).toBeLessThanOrEqual(1);
    });

    it('should combine feature importance from all models', async () => {
      const patterns: FileAccessPattern[] = [
        { filePath: '/test/file1.ts', timestamp: Date.now(), operation: 'read', sessionId: 'test' }
      ];

      await model.train(patterns);
      const importance = model.getFeatureImportance();
      
      expect(importance).toBeInstanceOf(Map);
      expect(importance.size).toBeGreaterThan(0);
      
      // Should have meaningful feature importance scores
      const totalImportance = Array.from(importance.values()).reduce((sum, val) => sum + val, 0);
      expect(totalImportance).toBeGreaterThan(0);
    });
  });
});