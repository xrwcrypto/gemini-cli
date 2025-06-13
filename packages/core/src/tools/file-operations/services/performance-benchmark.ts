/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformanceMonitor, PerformanceMetrics } from './performance-monitor.js';

/**
 * Benchmark test configuration
 */
export interface BenchmarkConfig {
  name: string;
  description: string;
  iterations: number;
  warmupIterations: number;
  concurrency: number;
  timeout: number;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
}

/**
 * Benchmark test function
 */
export type BenchmarkTestFunction = () => Promise<void> | void;

/**
 * Benchmark result statistics
 */
export interface BenchmarkResult {
  name: string;
  description: string;
  iterations: number;
  concurrency: number;
  totalDuration: number;
  averageDuration: number;
  medianDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration: number;
  p99Duration: number;
  standardDeviation: number;
  operationsPerSecond: number;
  successRate: number;
  failureCount: number;
  memoryUsage: {
    initial: NodeJS.MemoryUsage;
    final: NodeJS.MemoryUsage;
    peak: NodeJS.MemoryUsage;
    delta: NodeJS.MemoryUsage;
  };
  errors: string[];
}

/**
 * Benchmark comparison result
 */
export interface BenchmarkComparison {
  baseline: BenchmarkResult;
  current: BenchmarkResult;
  improvement: {
    averageDuration: number; // Percentage improvement (negative = regression)
    operationsPerSecond: number;
    memoryUsage: number;
    successRate: number;
  };
  significantDifference: boolean;
  recommendation: string;
}

/**
 * Load testing configuration
 */
export interface LoadTestConfig {
  name: string;
  description: string;
  duration: number; // Duration in milliseconds
  rampUpTime: number; // Time to reach target concurrency
  targetConcurrency: number;
  maxConcurrency: number;
  requestsPerSecond?: number;
}

/**
 * Load test result
 */
export interface LoadTestResult {
  name: string;
  description: string;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  concurrencyLevels: number[];
  memoryUsage: NodeJS.MemoryUsage[];
  errors: { [key: string]: number };
  performanceBreakdown: {
    timeRange: [number, number];
    requestsPerSecond: number;
    averageResponseTime: number;
    errorRate: number;
  }[];
}

/**
 * Performance benchmarking system for FileOperations
 */
export class PerformanceBenchmark {
  private monitor: PerformanceMonitor;
  private baselines = new Map<string, BenchmarkResult>();

  constructor(monitor?: PerformanceMonitor) {
    this.monitor = monitor || new PerformanceMonitor();
  }

  /**
   * Run a single benchmark test
   */
  async runBenchmark(
    config: BenchmarkConfig,
    testFunction: BenchmarkTestFunction,
  ): Promise<BenchmarkResult> {
    const { name, description, iterations, warmupIterations, concurrency, timeout, setup, teardown } = config;
    
    // Setup
    if (setup) {
      await setup();
    }

    try {
      // Warmup phase
      if (warmupIterations > 0) {
        await this.runWarmup(warmupIterations, testFunction);
      }

      // Actual benchmark
      const durations: number[] = [];
      const errors: string[] = [];
      let successCount = 0;
      let failureCount = 0;

      const initialMemory = process.memoryUsage();
      let peakMemory = initialMemory;

      // Run iterations
      for (let i = 0; i < iterations; i++) {
        const batchDurations = await this.runConcurrentBatch(concurrency, testFunction, timeout);
        
        for (const result of batchDurations) {
          if (result.success) {
            durations.push(result.duration);
            successCount++;
          } else {
            errors.push(result.error || 'Unknown error');
            failureCount++;
          }
        }

        // Track peak memory usage
        const currentMemory = process.memoryUsage();
        if (currentMemory.heapUsed > peakMemory.heapUsed) {
          peakMemory = currentMemory;
        }

        // Allow event loop to breathe
        await new Promise(resolve => setImmediate(resolve));
      }

      const finalMemory = process.memoryUsage();

      // Calculate statistics
      const result = this.calculateBenchmarkResult(
        name,
        description,
        iterations * concurrency,
        concurrency,
        durations,
        successCount,
        failureCount,
        initialMemory,
        finalMemory,
        peakMemory,
        errors,
      );

      return result;
    } finally {
      // Teardown
      if (teardown) {
        await teardown();
      }
    }
  }

  /**
   * Run warmup iterations
   */
  private async runWarmup(iterations: number, testFunction: BenchmarkTestFunction): Promise<void> {
    for (let i = 0; i < iterations; i++) {
      try {
        await testFunction();
      } catch (error) {
        // Ignore warmup errors
      }
    }
  }

  /**
   * Run a concurrent batch of tests
   */
  private async runConcurrentBatch(
    concurrency: number,
    testFunction: BenchmarkTestFunction,
    timeout: number,
  ): Promise<Array<{ success: boolean; duration: number; error?: string }>> {
    const promises = Array.from({ length: concurrency }, async () => {
      const startTime = Date.now();
      
      try {
        await Promise.race([
          testFunction(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), timeout)
          ),
        ]);
        
        return {
          success: true,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Calculate benchmark result statistics
   */
  private calculateBenchmarkResult(
    name: string,
    description: string,
    totalIterations: number,
    concurrency: number,
    durations: number[],
    successCount: number,
    failureCount: number,
    initialMemory: NodeJS.MemoryUsage,
    finalMemory: NodeJS.MemoryUsage,
    peakMemory: NodeJS.MemoryUsage,
    errors: string[],
  ): BenchmarkResult {
    if (durations.length === 0) {
      return {
        name,
        description,
        iterations: totalIterations,
        concurrency,
        totalDuration: 0,
        averageDuration: 0,
        medianDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        p95Duration: 0,
        p99Duration: 0,
        standardDeviation: 0,
        operationsPerSecond: 0,
        successRate: 0,
        failureCount,
        memoryUsage: {
          initial: initialMemory,
          final: finalMemory,
          peak: peakMemory,
          delta: this.calculateMemoryDelta(initialMemory, finalMemory),
        },
        errors,
      };
    }

    const sortedDurations = [...durations].sort((a, b) => a - b);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const averageDuration = totalDuration / durations.length;
    const medianDuration = sortedDurations[Math.floor(sortedDurations.length / 2)];
    const minDuration = sortedDurations[0];
    const maxDuration = sortedDurations[sortedDurations.length - 1];
    const p95Duration = sortedDurations[Math.floor(sortedDurations.length * 0.95)];
    const p99Duration = sortedDurations[Math.floor(sortedDurations.length * 0.99)];
    
    // Calculate standard deviation
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - averageDuration, 2), 0) / durations.length;
    const standardDeviation = Math.sqrt(variance);
    
    const operationsPerSecond = durations.length / (totalDuration / 1000);
    const successRate = successCount / totalIterations;

    return {
      name,
      description,
      iterations: totalIterations,
      concurrency,
      totalDuration,
      averageDuration,
      medianDuration,
      minDuration,
      maxDuration,
      p95Duration,
      p99Duration,
      standardDeviation,
      operationsPerSecond,
      successRate,
      failureCount,
      memoryUsage: {
        initial: initialMemory,
        final: finalMemory,
        peak: peakMemory,
        delta: this.calculateMemoryDelta(initialMemory, finalMemory),
      },
      errors,
    };
  }

  /**
   * Calculate memory usage delta
   */
  private calculateMemoryDelta(initial: NodeJS.MemoryUsage, final: NodeJS.MemoryUsage): NodeJS.MemoryUsage {
    return {
      rss: final.rss - initial.rss,
      heapTotal: final.heapTotal - initial.heapTotal,
      heapUsed: final.heapUsed - initial.heapUsed,
      external: final.external - initial.external,
      arrayBuffers: final.arrayBuffers - initial.arrayBuffers,
    };
  }

  /**
   * Run a load test
   */
  async runLoadTest(
    config: LoadTestConfig,
    testFunction: BenchmarkTestFunction,
  ): Promise<LoadTestResult> {
    const { name, description, duration, rampUpTime, targetConcurrency, maxConcurrency, requestsPerSecond } = config;
    
    const startTime = Date.now();
    const endTime = startTime + duration;
    const rampUpEndTime = startTime + rampUpTime;
    
    const results: Array<{ timestamp: number; duration: number; success: boolean; error?: string }> = [];
    const memorySnapshots: Array<{ timestamp: number; memory: NodeJS.MemoryUsage }> = [];
    const errors: { [key: string]: number } = {};
    
    let currentConcurrency = 1;
    let activeRequests = 0;
    let totalRequests = 0;
    let requestInterval: NodeJS.Timeout | undefined;

    // Function to execute a single request
    const executeRequest = async () => {
      if (activeRequests >= currentConcurrency) return;
      
      activeRequests++;
      totalRequests++;
      const requestStartTime = Date.now();
      
      try {
        await testFunction();
        results.push({
          timestamp: requestStartTime,
          duration: Date.now() - requestStartTime,
          success: true,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors[errorMessage] = (errors[errorMessage] || 0) + 1;
        results.push({
          timestamp: requestStartTime,
          duration: Date.now() - requestStartTime,
          success: false,
          error: errorMessage,
        });
      } finally {
        activeRequests--;
      }
    };

    // Start the load test
    const loadTestPromise = new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        const now = Date.now();
        
        // Check if test should end
        if (now >= endTime) {
          clearInterval(interval);
          if (requestInterval) clearInterval(requestInterval);
          resolve();
          return;
        }
        
        // Update concurrency during ramp-up
        if (now <= rampUpEndTime) {
          const rampUpProgress = (now - startTime) / rampUpTime;
          currentConcurrency = Math.min(
            Math.floor(1 + (targetConcurrency - 1) * rampUpProgress),
            maxConcurrency
          );
        } else {
          currentConcurrency = Math.min(targetConcurrency, maxConcurrency);
        }
        
        // Take memory snapshot
        memorySnapshots.push({
          timestamp: now,
          memory: process.memoryUsage(),
        });
        
        // Execute requests based on target RPS or concurrency
        if (requestsPerSecond) {
          const requestsThisSecond = requestsPerSecond;
          const intervalMs = 1000 / requestsThisSecond;
          
          if (!requestInterval) {
            requestInterval = setInterval(executeRequest, intervalMs);
          }
        } else {
          // Execute based on concurrency
          for (let i = activeRequests; i < currentConcurrency; i++) {
            executeRequest();
          }
        }
      }, 100); // Check every 100ms
    });

    await loadTestPromise;
    
    // Wait for remaining requests to complete
    while (activeRequests > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Calculate results
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    
    const durations = successfulResults.map(r => r.duration);
    const sortedDurations = [...durations].sort((a, b) => a - b);
    
    const averageResponseTime = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;
    const maxResponseTime = durations.length > 0 ? Math.max(...durations) : 0;
    const minResponseTime = durations.length > 0 ? Math.min(...durations) : 0;
    const p95ResponseTime = durations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length * 0.95)] : 0;
    const p99ResponseTime = durations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length * 0.99)] : 0;
    
    const actualDuration = Date.now() - startTime;
    const actualRequestsPerSecond = totalRequests / (actualDuration / 1000);
    
    // Calculate performance breakdown (divide into 10-second intervals)
    const performanceBreakdown: LoadTestResult['performanceBreakdown'] = [];
    const intervalSize = 10000; // 10 seconds
    
    for (let i = 0; i < actualDuration; i += intervalSize) {
      const intervalStart = startTime + i;
      const intervalEnd = Math.min(intervalStart + intervalSize, startTime + actualDuration);
      
      const intervalResults = results.filter(r => r.timestamp >= intervalStart && r.timestamp < intervalEnd);
      const intervalSuccessful = intervalResults.filter(r => r.success);
      
      if (intervalResults.length > 0) {
        const intervalDurations = intervalSuccessful.map(r => r.duration);
        const intervalAvgResponseTime = intervalDurations.length > 0 
          ? intervalDurations.reduce((sum, d) => sum + d, 0) / intervalDurations.length 
          : 0;
        
        performanceBreakdown.push({
          timeRange: [intervalStart, intervalEnd],
          requestsPerSecond: intervalResults.length / (intervalSize / 1000),
          averageResponseTime: intervalAvgResponseTime,
          errorRate: (intervalResults.length - intervalSuccessful.length) / intervalResults.length,
        });
      }
    }

    return {
      name,
      description,
      duration: actualDuration,
      totalRequests,
      successfulRequests: successfulResults.length,
      failedRequests: failedResults.length,
      averageResponseTime,
      maxResponseTime,
      minResponseTime,
      p95ResponseTime,
      p99ResponseTime,
      requestsPerSecond: actualRequestsPerSecond,
      concurrencyLevels: Array.from(new Set(memorySnapshots.map((_, i) => {
        const timestamp = startTime + i * 100;
        if (timestamp <= rampUpEndTime) {
          const rampUpProgress = (timestamp - startTime) / rampUpTime;
          return Math.min(Math.floor(1 + (targetConcurrency - 1) * rampUpProgress), maxConcurrency);
        }
        return Math.min(targetConcurrency, maxConcurrency);
      }))),
      memoryUsage: memorySnapshots.map(s => s.memory),
      errors,
      performanceBreakdown,
    };
  }

  /**
   * Compare benchmark results
   */
  compareBenchmarks(baseline: BenchmarkResult, current: BenchmarkResult): BenchmarkComparison {
    const avgDurationImprovement = ((baseline.averageDuration - current.averageDuration) / baseline.averageDuration) * 100;
    const opsPerSecImprovement = ((current.operationsPerSecond - baseline.operationsPerSecond) / baseline.operationsPerSecond) * 100;
    const memoryImprovement = ((baseline.memoryUsage.peak.heapUsed - current.memoryUsage.peak.heapUsed) / baseline.memoryUsage.peak.heapUsed) * 100;
    const successRateImprovement = ((current.successRate - baseline.successRate) / baseline.successRate) * 100;
    
    // Determine if the difference is statistically significant
    const significantDifference = Math.abs(avgDurationImprovement) > 5 || Math.abs(opsPerSecImprovement) > 5;
    
    // Generate recommendation
    let recommendation = '';
    if (avgDurationImprovement > 10) {
      recommendation = 'Significant performance improvement detected. Consider adopting these changes.';
    } else if (avgDurationImprovement < -10) {
      recommendation = 'Performance regression detected. Investigate and address before deploying.';
    } else if (memoryImprovement > 20) {
      recommendation = 'Significant memory usage improvement. Consider adopting for better resource efficiency.';
    } else if (memoryImprovement < -20) {
      recommendation = 'Memory usage increased significantly. Monitor for potential memory leaks.';
    } else {
      recommendation = 'Performance is within acceptable variance. No immediate action required.';
    }

    return {
      baseline,
      current,
      improvement: {
        averageDuration: avgDurationImprovement,
        operationsPerSecond: opsPerSecImprovement,
        memoryUsage: memoryImprovement,
        successRate: successRateImprovement,
      },
      significantDifference,
      recommendation,
    };
  }

  /**
   * Set baseline for a benchmark
   */
  setBaseline(name: string, result: BenchmarkResult): void {
    this.baselines.set(name, result);
  }

  /**
   * Get baseline for a benchmark
   */
  getBaseline(name: string): BenchmarkResult | undefined {
    return this.baselines.get(name);
  }

  /**
   * Run regression test against baseline
   */
  async runRegressionTest(
    name: string,
    config: BenchmarkConfig,
    testFunction: BenchmarkTestFunction,
  ): Promise<{ result: BenchmarkResult; comparison?: BenchmarkComparison }> {
    const result = await this.runBenchmark(config, testFunction);
    const baseline = this.getBaseline(name);
    
    if (baseline) {
      const comparison = this.compareBenchmarks(baseline, result);
      return { result, comparison };
    }
    
    return { result };
  }

  /**
   * Generate performance report
   */
  generateReport(results: BenchmarkResult[]): string {
    let report = '# Performance Benchmark Report\n\n';
    
    for (const result of results) {
      report += `## ${result.name}\n`;
      report += `${result.description}\n\n`;
      report += `- **Iterations**: ${result.iterations}\n`;
      report += `- **Concurrency**: ${result.concurrency}\n`;
      report += `- **Success Rate**: ${(result.successRate * 100).toFixed(2)}%\n`;
      report += `- **Operations/sec**: ${result.operationsPerSecond.toFixed(2)}\n`;
      report += `- **Average Duration**: ${result.averageDuration.toFixed(2)}ms\n`;
      report += `- **Median Duration**: ${result.medianDuration.toFixed(2)}ms\n`;
      report += `- **P95 Duration**: ${result.p95Duration.toFixed(2)}ms\n`;
      report += `- **P99 Duration**: ${result.p99Duration.toFixed(2)}ms\n`;
      report += `- **Memory Peak**: ${(result.memoryUsage.peak.heapUsed / 1024 / 1024).toFixed(2)}MB\n`;
      report += `- **Memory Delta**: ${(result.memoryUsage.delta.heapUsed / 1024 / 1024).toFixed(2)}MB\n`;
      
      if (result.errors.length > 0) {
        report += `- **Errors**: ${result.failureCount}\n`;
        const errorCounts = result.errors.reduce((acc, error) => {
          acc[error] = (acc[error] || 0) + 1;
          return acc;
        }, {} as { [key: string]: number });
        
        for (const [error, count] of Object.entries(errorCounts)) {
          report += `  - ${error}: ${count}\n`;
        }
      }
      
      report += '\n';
    }
    
    return report;
  }
}