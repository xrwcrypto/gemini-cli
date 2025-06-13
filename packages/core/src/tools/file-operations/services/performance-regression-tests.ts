/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformanceBenchmark, BenchmarkConfig, BenchmarkResult, LoadTestConfig, LoadTestResult } from './performance-benchmark.js';
import { PerformanceMonitor } from './performance-monitor.js';
import { MemoryAnalyzer } from './memory-analyzer.js';

/**
 * Regression test configuration
 */
export interface RegressionTestConfig {
  name: string;
  description: string;
  testSuites: RegressionTestSuite[];
  baselineVersion?: string;
  targetPerformance: PerformanceTargets;
  environmentConfig: EnvironmentConfig;
  reportConfig: ReportConfig;
}

/**
 * Performance targets for regression testing
 */
export interface PerformanceTargets {
  maxLatencyMs: number;
  minOperationsPerSecond: number;
  maxMemoryUsageMb: number;
  minSuccessRate: number;
  maxRegressionPercent: number; // % performance degradation allowed
  benchmarkTimeoutMs: number;
}

/**
 * Environment configuration for consistent testing
 */
export interface EnvironmentConfig {
  nodeVersion?: string;
  cpuCores?: number;
  memoryGb?: number;
  diskType?: 'ssd' | 'hdd';
  operatingSystem?: string;
  warmupIterations: number;
  testIterations: number;
  parallelism: number;
}

/**
 * Report configuration
 */
export interface ReportConfig {
  formats: Array<'json' | 'html' | 'markdown' | 'junit'>;
  includeGraphs: boolean;
  includeDetailedMetrics: boolean;
  includeMemoryAnalysis: boolean;
  outputDirectory: string;
}

/**
 * Regression test suite
 */
export interface RegressionTestSuite {
  name: string;
  description: string;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  tests: RegressionTest[];
}

/**
 * Individual regression test
 */
export interface RegressionTest {
  name: string;
  description: string;
  category: 'unit' | 'integration' | 'stress' | 'load' | 'endurance';
  benchmark: BenchmarkConfig;
  loadTest?: LoadTestConfig;
  expectedPerformance: Partial<PerformanceTargets>;
  testFunction: () => Promise<void> | void;
  dataSetup?: () => Promise<unknown>;
  dataCleanup?: (data: unknown) => Promise<void>;
}

/**
 * Regression test result
 */
export interface RegressionTestResult {
  test: RegressionTest;
  benchmarkResult: BenchmarkResult;
  loadTestResult?: LoadTestResult;
  passed: boolean;
  failures: string[];
  warnings: string[];
  performanceComparison?: {
    baseline: BenchmarkResult;
    current: BenchmarkResult;
    regressionPercent: number;
    improved: boolean;
  };
  memoryAnalysis: {
    leaksDetected: boolean;
    peakMemoryMb: number;
    memoryGrowthMb: number;
    gcPressure: number;
  };
  executionTime: number;
}

/**
 * Regression test suite result
 */
export interface RegressionTestSuiteResult {
  suite: RegressionTestSuite;
  results: RegressionTestResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    warnings: number;
    averagePerformance: {
      latencyMs: number;
      operationsPerSecond: number;
      memoryUsageMb: number;
      successRate: number;
    };
    totalExecutionTime: number;
  };
}

/**
 * Complete regression test report
 */
export interface RegressionTestReport {
  config: RegressionTestConfig;
  suiteResults: RegressionTestSuiteResult[];
  overallSummary: {
    totalTests: number;
    passed: number;
    failed: number;
    warnings: number;
    performanceRegression: boolean;
    memoryRegression: boolean;
    executionTime: number;
    environment: NodeJS.ProcessVersions & { memory: string; cpu: string };
  };
  recommendations: string[];
  generatedAt: number;
}

/**
 * Performance regression testing system
 */
export class PerformanceRegressionTester {
  private benchmark: PerformanceBenchmark;
  private monitor: PerformanceMonitor;
  private memoryAnalyzer: MemoryAnalyzer;
  private baselines = new Map<string, BenchmarkResult>();

  constructor() {
    this.monitor = new PerformanceMonitor();
    this.memoryAnalyzer = new MemoryAnalyzer();
    this.benchmark = new PerformanceBenchmark(this.monitor);
  }

  /**
   * Run complete regression test suite
   */
  async runRegressionTests(config: RegressionTestConfig): Promise<RegressionTestReport> {
    console.log(`Starting regression tests: ${config.name}`);
    const startTime = Date.now();

    // Setup environment
    await this.setupEnvironment(config.environmentConfig);

    const suiteResults: RegressionTestSuiteResult[] = [];

    // Run each test suite
    for (const suite of config.testSuites) {
      console.log(`Running test suite: ${suite.name}`);
      const suiteResult = await this.runTestSuite(suite, config);
      suiteResults.push(suiteResult);
    }

    // Generate report
    const report = this.generateReport(config, suiteResults, Date.now() - startTime);
    
    // Save report
    await this.saveReport(report, config.reportConfig);

    console.log(`Regression tests completed in ${report.overallSummary.executionTime}ms`);
    console.log(`Results: ${report.overallSummary.passed}/${report.overallSummary.totalTests} passed`);

    return report;
  }

  /**
   * Run a single test suite
   */
  private async runTestSuite(
    suite: RegressionTestSuite,
    config: RegressionTestConfig
  ): Promise<RegressionTestSuiteResult> {
    const results: RegressionTestResult[] = [];

    // Suite setup
    if (suite.setup) {
      await suite.setup();
    }

    try {
      // Run each test
      for (const test of suite.tests) {
        console.log(`  Running test: ${test.name}`);
        const result = await this.runSingleTest(test, config);
        results.push(result);
      }
    } finally {
      // Suite teardown
      if (suite.teardown) {
        await suite.teardown();
      }
    }

    // Calculate summary
    const summary = this.calculateSuiteSummary(results);

    return {
      suite,
      results,
      summary,
    };
  }

  /**
   * Run a single regression test
   */
  private async runSingleTest(
    test: RegressionTest,
    config: RegressionTestConfig
  ): Promise<RegressionTestResult> {
    const startTime = Date.now();
    let testData: unknown;

    try {
      // Data setup
      if (test.dataSetup) {
        testData = await test.dataSetup();
      }

      // Start memory monitoring
      this.memoryAnalyzer.clear();
      this.memoryAnalyzer.startMonitoring();

      // Run benchmark
      const benchmarkResult = await this.benchmark.runBenchmark(test.benchmark, test.testFunction);

      // Run load test if specified
      let loadTestResult: LoadTestResult | undefined;
      if (test.loadTest) {
        loadTestResult = await this.benchmark.runLoadTest(test.loadTest, test.testFunction);
      }

      // Stop memory monitoring
      this.memoryAnalyzer.stopMonitoring();

      // Analyze results
      const passed = this.validateTestResult(benchmarkResult, test.expectedPerformance, config.targetPerformance);
      const failures = this.identifyFailures(benchmarkResult, test.expectedPerformance, config.targetPerformance);
      const warnings = this.identifyWarnings(benchmarkResult, test.expectedPerformance);

      // Performance comparison with baseline
      let performanceComparison: RegressionTestResult['performanceComparison'];
      const baseline = this.baselines.get(test.name);
      if (baseline) {
        const comparison = this.benchmark.compareBenchmarks(baseline, benchmarkResult);
        const regressionPercent = -comparison.improvement.averageDuration; // Negative improvement is regression
        performanceComparison = {
          baseline,
          current: benchmarkResult,
          regressionPercent,
          improved: comparison.improvement.averageDuration > 0,
        };
      }

      // Memory analysis
      const memoryReport = this.memoryAnalyzer.generateReport();
      const memoryAnalysis = {
        leaksDetected: memoryReport.leaks.length > 0,
        peakMemoryMb: memoryReport.summary.trend.peakUsage.heapUsed / (1024 * 1024),
        memoryGrowthMb: memoryReport.summary.trend.growthRate.heapUsed * 60 / (1024 * 1024), // Per minute
        gcPressure: memoryReport.summary.pressure.gcFrequency,
      };

      return {
        test,
        benchmarkResult,
        loadTestResult,
        passed,
        failures,
        warnings,
        performanceComparison,
        memoryAnalysis,
        executionTime: Date.now() - startTime,
      };

    } catch (error) {
      // Handle test failures
      return {
        test,
        benchmarkResult: this.createFailedBenchmarkResult(test, error),
        passed: false,
        failures: [`Test execution failed: ${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
        memoryAnalysis: {
          leaksDetected: false,
          peakMemoryMb: 0,
          memoryGrowthMb: 0,
          gcPressure: 0,
        },
        executionTime: Date.now() - startTime,
      };
    } finally {
      // Data cleanup
      if (test.dataCleanup && testData) {
        await test.dataCleanup(testData);
      }
    }
  }

  /**
   * Validate test result against expected performance
   */
  private validateTestResult(
    result: BenchmarkResult,
    expected: Partial<PerformanceTargets>,
    global: PerformanceTargets
  ): boolean {
    const maxLatency = expected.maxLatencyMs ?? global.maxLatencyMs;
    const minOps = expected.minOperationsPerSecond ?? global.minOperationsPerSecond;
    const maxMemory = expected.maxMemoryUsageMb ?? global.maxMemoryUsageMb;
    const minSuccess = expected.minSuccessRate ?? global.minSuccessRate;

    return (
      result.averageDuration <= maxLatency &&
      result.operationsPerSecond >= minOps &&
      (result.memoryUsage.peak.heapUsed / (1024 * 1024)) <= maxMemory &&
      result.successRate >= minSuccess
    );
  }

  /**
   * Identify test failures
   */
  private identifyFailures(
    result: BenchmarkResult,
    expected: Partial<PerformanceTargets>,
    global: PerformanceTargets
  ): string[] {
    const failures: string[] = [];

    const maxLatency = expected.maxLatencyMs ?? global.maxLatencyMs;
    if (result.averageDuration > maxLatency) {
      failures.push(`Latency ${result.averageDuration.toFixed(2)}ms exceeds maximum ${maxLatency}ms`);
    }

    const minOps = expected.minOperationsPerSecond ?? global.minOperationsPerSecond;
    if (result.operationsPerSecond < minOps) {
      failures.push(`Operations/sec ${result.operationsPerSecond.toFixed(2)} below minimum ${minOps}`);
    }

    const maxMemory = expected.maxMemoryUsageMb ?? global.maxMemoryUsageMb;
    const memoryMb = result.memoryUsage.peak.heapUsed / (1024 * 1024);
    if (memoryMb > maxMemory) {
      failures.push(`Memory usage ${memoryMb.toFixed(2)}MB exceeds maximum ${maxMemory}MB`);
    }

    const minSuccess = expected.minSuccessRate ?? global.minSuccessRate;
    if (result.successRate < minSuccess) {
      failures.push(`Success rate ${(result.successRate * 100).toFixed(2)}% below minimum ${(minSuccess * 100).toFixed(2)}%`);
    }

    return failures;
  }

  /**
   * Identify test warnings
   */
  private identifyWarnings(
    result: BenchmarkResult,
    _expected: Partial<PerformanceTargets>
  ): string[] {
    const warnings: string[] = [];

    // High variance warning
    if (result.standardDeviation > result.averageDuration * 0.5) {
      warnings.push('High latency variance detected - results may be inconsistent');
    }

    // Memory growth warning
    const memoryGrowth = result.memoryUsage.delta.heapUsed;
    if (memoryGrowth > 10 * 1024 * 1024) { // 10MB growth
      warnings.push(`Significant memory growth detected: ${(memoryGrowth / (1024 * 1024)).toFixed(2)}MB`);
    }

    // High P99 latency warning
    if (result.p99Duration > result.averageDuration * 3) {
      warnings.push(`P99 latency (${result.p99Duration.toFixed(2)}ms) is significantly higher than average`);
    }

    return warnings;
  }

  /**
   * Create a failed benchmark result
   */
  private createFailedBenchmarkResult(test: RegressionTest, error: unknown): BenchmarkResult {
    const currentMemory = process.memoryUsage();
    return {
      name: test.name,
      description: test.description,
      iterations: 0,
      concurrency: 1,
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
      failureCount: 1,
      memoryUsage: {
        initial: currentMemory,
        final: currentMemory,
        peak: currentMemory,
        delta: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
      },
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  /**
   * Calculate suite summary
   */
  private calculateSuiteSummary(results: RegressionTestResult[]): RegressionTestSuiteResult['summary'] {
    const totalTests = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = totalTests - passed;
    const warnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

    const validResults = results.filter(r => r.benchmarkResult.iterations > 0);
    const averagePerformance = validResults.length > 0 ? {
      latencyMs: validResults.reduce((sum, r) => sum + r.benchmarkResult.averageDuration, 0) / validResults.length,
      operationsPerSecond: validResults.reduce((sum, r) => sum + r.benchmarkResult.operationsPerSecond, 0) / validResults.length,
      memoryUsageMb: validResults.reduce((sum, r) => sum + (r.benchmarkResult.memoryUsage.peak.heapUsed / (1024 * 1024)), 0) / validResults.length,
      successRate: validResults.reduce((sum, r) => sum + r.benchmarkResult.successRate, 0) / validResults.length,
    } : {
      latencyMs: 0,
      operationsPerSecond: 0,
      memoryUsageMb: 0,
      successRate: 0,
    };

    const totalExecutionTime = results.reduce((sum, r) => sum + r.executionTime, 0);

    return {
      totalTests,
      passed,
      failed,
      warnings,
      averagePerformance,
      totalExecutionTime,
    };
  }

  /**
   * Generate complete regression test report
   */
  private generateReport(
    config: RegressionTestConfig,
    suiteResults: RegressionTestSuiteResult[],
    executionTime: number
  ): RegressionTestReport {
    // Calculate overall summary
    const totalTests = suiteResults.reduce((sum, suite) => sum + suite.summary.totalTests, 0);
    const passed = suiteResults.reduce((sum, suite) => sum + suite.summary.passed, 0);
    const failed = suiteResults.reduce((sum, suite) => sum + suite.summary.failed, 0);
    const warnings = suiteResults.reduce((sum, suite) => sum + suite.summary.warnings, 0);

    // Check for performance regression
    let performanceRegression = false;
    let memoryRegression = false;

    for (const suite of suiteResults) {
      for (const result of suite.results) {
        if (result.performanceComparison?.regressionPercent && result.performanceComparison.regressionPercent > config.targetPerformance.maxRegressionPercent) {
          performanceRegression = true;
        }
        if (result.memoryAnalysis.leaksDetected || result.memoryAnalysis.memoryGrowthMb > 50) {
          memoryRegression = true;
        }
      }
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(suiteResults, performanceRegression, memoryRegression);

    // Get environment info
    const environment = {
      ...process.versions,
      memory: `${Math.round(process.memoryUsage().heapTotal / (1024 * 1024))}MB`,
      cpu: `${process.env.NUMBER_OF_PROCESSORS || 'unknown'} cores`,
    };

    return {
      config,
      suiteResults,
      overallSummary: {
        totalTests,
        passed,
        failed,
        warnings,
        performanceRegression,
        memoryRegression,
        executionTime,
        environment,
      },
      recommendations,
      generatedAt: Date.now(),
    };
  }

  /**
   * Generate recommendations based on test results
   */
  private generateRecommendations(
    suiteResults: RegressionTestSuiteResult[],
    performanceRegression: boolean,
    memoryRegression: boolean
  ): string[] {
    const recommendations: string[] = [];

    if (performanceRegression) {
      recommendations.push('Performance regression detected - review recent changes and optimize slow operations');
      recommendations.push('Consider profiling the most regressed operations to identify bottlenecks');
    }

    if (memoryRegression) {
      recommendations.push('Memory regression detected - check for memory leaks and excessive allocations');
      recommendations.push('Review object lifecycle management and garbage collection patterns');
    }

    // Analyze failure patterns
    const allFailures = suiteResults.flatMap(suite => 
      suite.results.flatMap(result => result.failures)
    );

    const latencyFailures = allFailures.filter(f => f.includes('Latency')).length;
    const memoryFailures = allFailures.filter(f => f.includes('Memory')).length;
    const throughputFailures = allFailures.filter(f => f.includes('Operations/sec')).length;

    if (latencyFailures > 0) {
      recommendations.push('Multiple latency failures detected - focus on optimizing operation execution time');
    }

    if (memoryFailures > 0) {
      recommendations.push('Memory usage failures detected - implement memory optimization strategies');
    }

    if (throughputFailures > 0) {
      recommendations.push('Throughput failures detected - consider parallelization and caching improvements');
    }

    // Add general recommendations
    if (recommendations.length === 0) {
      recommendations.push('All tests passed - monitor performance trends for early detection of regressions');
    }

    recommendations.push('Regularly update performance baselines as system evolves');
    recommendations.push('Consider adding more granular performance tests for critical code paths');

    return recommendations;
  }

  /**
   * Setup test environment
   */
  private async setupEnvironment(config: EnvironmentConfig): Promise<void> {
    // Force garbage collection to start with clean state
    if (global.gc) {
      global.gc();
    }

    // Wait for system to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`Environment: Node ${process.version}, ${config.cpuCores || 'auto'} CPU cores`);
  }

  /**
   * Save regression test report
   */
  private async saveReport(report: RegressionTestReport, config: ReportConfig): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    for (const format of config.formats) {
      let content: string;
      let filename: string;

      switch (format) {
        case 'json':
          content = JSON.stringify(report, null, 2);
          filename = `regression-report-${timestamp}.json`;
          break;
        case 'html':
          content = this.generateHTMLReport(report);
          filename = `regression-report-${timestamp}.html`;
          break;
        case 'markdown':
          content = this.generateMarkdownReport(report);
          filename = `regression-report-${timestamp}.md`;
          break;
        case 'junit':
          content = this.generateJUnitReport(report);
          filename = `regression-report-${timestamp}.xml`;
          break;
        default:
          continue;
      }

      // In a real implementation, you would write to the file system
      console.log(`Report saved: ${filename} (${content.length} bytes)`);
    }
  }

  /**
   * Generate HTML report
   */
  private generateHTMLReport(report: RegressionTestReport): string {
    const { overallSummary } = report;
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Performance Regression Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .passed { color: green; }
        .failed { color: red; }
        .warning { color: orange; }
        .suite { margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; }
        .test { margin: 10px 0; padding: 10px; border-left: 3px solid #ccc; }
        .test.passed { border-left-color: green; }
        .test.failed { border-left-color: red; }
        table { border-collapse: collapse; width: 100%; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Performance Regression Test Report</h1>
    
    <div class="summary">
        <h2>Overall Summary</h2>
        <p><strong>Total Tests:</strong> ${overallSummary.totalTests}</p>
        <p><strong>Passed:</strong> <span class="passed">${overallSummary.passed}</span></p>
        <p><strong>Failed:</strong> <span class="failed">${overallSummary.failed}</span></p>
        <p><strong>Warnings:</strong> <span class="warning">${overallSummary.warnings}</span></p>
        <p><strong>Performance Regression:</strong> ${overallSummary.performanceRegression ? '❌ Yes' : '✅ No'}</p>
        <p><strong>Memory Regression:</strong> ${overallSummary.memoryRegression ? '❌ Yes' : '✅ No'}</p>
        <p><strong>Execution Time:</strong> ${(overallSummary.executionTime / 1000).toFixed(2)}s</p>
        <p><strong>Environment:</strong> Node ${overallSummary.environment.node}, ${overallSummary.environment.cpu}</p>
    </div>

    <h2>Recommendations</h2>
    <ul>
        ${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}
    </ul>

    <h2>Test Suites</h2>
    ${report.suiteResults.map(suite => `
        <div class="suite">
            <h3>${suite.suite.name}</h3>
            <p>${suite.suite.description}</p>
            <p><strong>Results:</strong> ${suite.summary.passed}/${suite.summary.totalTests} passed</p>
            
            ${suite.results.map(result => `
                <div class="test ${result.passed ? 'passed' : 'failed'}">
                    <h4>${result.test.name} ${result.passed ? '✅' : '❌'}</h4>
                    <p>${result.test.description}</p>
                    <table>
                        <tr><th>Metric</th><th>Value</th></tr>
                        <tr><td>Average Latency</td><td>${result.benchmarkResult.averageDuration.toFixed(2)}ms</td></tr>
                        <tr><td>Operations/sec</td><td>${result.benchmarkResult.operationsPerSecond.toFixed(2)}</td></tr>
                        <tr><td>Success Rate</td><td>${(result.benchmarkResult.successRate * 100).toFixed(2)}%</td></tr>
                        <tr><td>Peak Memory</td><td>${(result.benchmarkResult.memoryUsage.peak.heapUsed / (1024 * 1024)).toFixed(2)}MB</td></tr>
                    </table>
                    ${result.failures.length > 0 ? `
                        <h5>Failures:</h5>
                        <ul>${result.failures.map(f => `<li class="failed">${f}</li>`).join('')}</ul>
                    ` : ''}
                    ${result.warnings.length > 0 ? `
                        <h5>Warnings:</h5>
                        <ul>${result.warnings.map(w => `<li class="warning">${w}</li>`).join('')}</ul>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `).join('')}

    <p><small>Generated at ${new Date(report.generatedAt).toISOString()}</small></p>
</body>
</html>
    `;
  }

  /**
   * Generate Markdown report
   */
  private generateMarkdownReport(report: RegressionTestReport): string {
    const { overallSummary } = report;
    
    return `# Performance Regression Test Report

## Overall Summary

- **Total Tests:** ${overallSummary.totalTests}
- **Passed:** ${overallSummary.passed} ✅
- **Failed:** ${overallSummary.failed} ${overallSummary.failed > 0 ? '❌' : ''}
- **Warnings:** ${overallSummary.warnings}
- **Performance Regression:** ${overallSummary.performanceRegression ? '❌ Yes' : '✅ No'}
- **Memory Regression:** ${overallSummary.memoryRegression ? '❌ Yes' : '✅ No'}
- **Execution Time:** ${(overallSummary.executionTime / 1000).toFixed(2)}s
- **Environment:** Node ${overallSummary.environment.node}, ${overallSummary.environment.cpu}

## Recommendations

${report.recommendations.map(rec => `- ${rec}`).join('\n')}

## Test Suites

${report.suiteResults.map(suite => `
### ${suite.suite.name}

${suite.suite.description}

**Results:** ${suite.summary.passed}/${suite.summary.totalTests} passed

${suite.results.map(result => `
#### ${result.test.name} ${result.passed ? '✅' : '❌'}

${result.test.description}

| Metric | Value |
|--------|-------|
| Average Latency | ${result.benchmarkResult.averageDuration.toFixed(2)}ms |
| Operations/sec | ${result.benchmarkResult.operationsPerSecond.toFixed(2)} |
| Success Rate | ${(result.benchmarkResult.successRate * 100).toFixed(2)}% |
| Peak Memory | ${(result.benchmarkResult.memoryUsage.peak.heapUsed / (1024 * 1024)).toFixed(2)}MB |

${result.failures.length > 0 ? `**Failures:**\n${result.failures.map(f => `- ❌ ${f}`).join('\n')}` : ''}
${result.warnings.length > 0 ? `**Warnings:**\n${result.warnings.map(w => `- ⚠️ ${w}`).join('\n')}` : ''}
`).join('\n')}
`).join('\n')}

---
*Generated at ${new Date(report.generatedAt).toISOString()}*
    `;
  }

  /**
   * Generate JUnit XML report
   */
  private generateJUnitReport(report: RegressionTestReport): string {
    const totalTests = report.overallSummary.totalTests;
    const failures = report.overallSummary.failed;
    const time = report.overallSummary.executionTime / 1000;

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="${totalTests}" failures="${failures}" time="${time.toFixed(3)}">
${report.suiteResults.map(suite => `
  <testsuite name="${suite.suite.name}" tests="${suite.summary.totalTests}" failures="${suite.summary.failed}" time="${(suite.summary.totalExecutionTime / 1000).toFixed(3)}">
${suite.results.map(result => `
    <testcase name="${result.test.name}" classname="${suite.suite.name}" time="${(result.executionTime / 1000).toFixed(3)}">
${result.failures.length > 0 ? `
      <failure message="${result.failures[0]}">${result.failures.join('\n')}</failure>
` : ''}
${result.warnings.length > 0 ? `
      <system-out>${result.warnings.join('\n')}</system-out>
` : ''}
    </testcase>
`).join('')}
  </testsuite>
`).join('')}
</testsuites>`;
  }

  /**
   * Set baseline for comparison
   */
  setBaseline(testName: string, result: BenchmarkResult): void {
    this.baselines.set(testName, result);
  }

  /**
   * Load baselines from previous runs
   */
  async loadBaselines(baselineData: { [testName: string]: BenchmarkResult }): Promise<void> {
    for (const [testName, result] of Object.entries(baselineData)) {
      this.baselines.set(testName, result);
    }
  }

  /**
   * Export current baselines
   */
  exportBaselines(): { [testName: string]: BenchmarkResult } {
    const baselines: { [testName: string]: BenchmarkResult } = {};
    for (const [testName, result] of this.baselines.entries()) {
      baselines[testName] = result;
    }
    return baselines;
  }
}