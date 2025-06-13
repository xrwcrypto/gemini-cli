/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  EnhancedLanguageParser, 
  PluginMetadata, 
  PluginValidationResult,
  PluginConfiguration 
} from './base-plugin.js';
import { ParseResult, Symbol, SupportedLanguage } from '../services/ast-parser.js';
import { PluginValidator, DetailedValidationResult } from './plugin-validator.js';
import { LanguageDetector } from './language-detection.js';
import { CacheManager } from '../services/cache-manager.js';

/**
 * Plugin test configuration
 */
export interface PluginTestConfig {
  /** Plugin instance to test */
  plugin: EnhancedLanguageParser;
  /** Test cases to run */
  testCases: PluginTestCase[];
  /** Validation options */
  validation?: {
    strict: boolean;
    performanceThreshold?: number;
    memoryThreshold?: number;
  };
  /** Cache manager for testing */
  cacheManager?: CacheManager;
}

/**
 * Plugin test case
 */
export interface PluginTestCase {
  /** Test case name */
  name: string;
  /** Test description */
  description: string;
  /** Input content */
  content: string;
  /** File path for context */
  filePath: string;
  /** Expected results */
  expected: {
    /** Expected language */
    language?: SupportedLanguage;
    /** Expected symbols (partial match) */
    symbols?: Partial<Symbol>[];
    /** Expected imports */
    imports?: Array<{ from: string; items?: string[] }>;
    /** Expected exports */
    exports?: Array<{ name: string; type?: string }>;
    /** Expected error count */
    errorCount?: number;
    /** Should not throw */
    shouldNotThrow?: boolean;
  };
  /** Test configuration */
  config?: {
    timeout?: number;
    skipValidation?: boolean;
  };
}

/**
 * Plugin test result
 */
export interface PluginTestResult {
  /** Test case name */
  testName: string;
  /** Test passed */
  passed: boolean;
  /** Parse result */
  parseResult?: ParseResult;
  /** Validation result */
  validationResult?: DetailedValidationResult;
  /** Performance metrics */
  performance: {
    parseTimeMs: number;
    memoryUsageBytes?: number;
  };
  /** Test errors */
  errors: string[];
  /** Test warnings */
  warnings: string[];
}

/**
 * Plugin test suite result
 */
export interface PluginTestSuiteResult {
  /** Plugin metadata */
  metadata: PluginMetadata;
  /** Overall test success */
  success: boolean;
  /** Individual test results */
  testResults: PluginTestResult[];
  /** Summary statistics */
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    totalTime: number;
    averageParseTime: number;
  };
  /** Validation result */
  validation?: DetailedValidationResult;
}

/**
 * Plugin benchmarking configuration
 */
export interface PluginBenchmarkConfig {
  /** Plugin to benchmark */
  plugin: EnhancedLanguageParser;
  /** Benchmark cases */
  benchmarks: PluginBenchmarkCase[];
  /** Number of iterations per benchmark */
  iterations: number;
  /** Warmup iterations */
  warmupIterations: number;
}

/**
 * Plugin benchmark case
 */
export interface PluginBenchmarkCase {
  /** Benchmark name */
  name: string;
  /** Content to parse */
  content: string;
  /** File path */
  filePath: string;
  /** Content size category */
  category: 'small' | 'medium' | 'large' | 'extra-large';
}

/**
 * Benchmark result
 */
export interface PluginBenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Content category */
  category: string;
  /** Content size in bytes */
  contentSize: number;
  /** Performance metrics */
  metrics: {
    /** Average parse time */
    avgParseTimeMs: number;
    /** Minimum parse time */
    minParseTimeMs: number;
    /** Maximum parse time */
    maxParseTimeMs: number;
    /** Standard deviation */
    stdDevMs: number;
    /** Operations per second */
    opsPerSecond: number;
    /** Memory usage */
    avgMemoryUsageBytes?: number;
  };
  /** Parse results for validation */
  sampleResult: ParseResult;
}

/**
 * Comprehensive plugin testing utility
 */
export class PluginTestSuite {
  private validator: PluginValidator;
  private detector: LanguageDetector;

  constructor() {
    this.validator = new PluginValidator({
      strict: true,
      checkDependencies: true
    });
    this.detector = new LanguageDetector();
  }

  /**
   * Run comprehensive tests on a plugin
   */
  async runTests(config: PluginTestConfig): Promise<PluginTestSuiteResult> {
    const startTime = Date.now();
    const testResults: PluginTestResult[] = [];
    const metadata = config.plugin.getMetadata();

    // Initialize plugin
    await config.plugin.initialize({
      enabled: true,
      settings: {},
      timeout: 30000
    });

    // Run validation if requested
    let validationResult: DetailedValidationResult | undefined;
    if (!config.validation || config.validation.strict !== false) {
      validationResult = await this.validator.validatePlugin(config.plugin);
    }

    // Run test cases
    for (const testCase of config.testCases) {
      const result = await this.runSingleTest(config.plugin, testCase);
      testResults.push(result);
    }

    // Cleanup plugin
    await config.plugin.cleanup();

    const totalTime = Date.now() - startTime;
    const passedTests = testResults.filter(r => r.passed).length;

    return {
      metadata,
      success: passedTests === testResults.length && (!validationResult || validationResult.valid),
      testResults,
      summary: {
        totalTests: testResults.length,
        passedTests,
        failedTests: testResults.length - passedTests,
        totalTime,
        averageParseTime: testResults.reduce((sum, r) => sum + r.performance.parseTimeMs, 0) / testResults.length
      },
      validation: validationResult
    };
  }

  /**
   * Run a single test case
   */
  private async runSingleTest(
    plugin: EnhancedLanguageParser,
    testCase: PluginTestCase
  ): Promise<PluginTestResult> {
    const result: PluginTestResult = {
      testName: testCase.name,
      passed: false,
      performance: { parseTimeMs: 0 },
      errors: [],
      warnings: []
    };

    try {
      // Measure memory before
      const initialMemory = typeof process !== 'undefined' && process.memoryUsage ? 
        process.memoryUsage().heapUsed : undefined;

      // Parse content
      const startTime = Date.now();
      const parseResult = await plugin.parse(testCase.content, testCase.filePath);
      const parseTime = Date.now() - startTime;

      // Measure memory after
      const finalMemory = typeof process !== 'undefined' && process.memoryUsage ? 
        process.memoryUsage().heapUsed : undefined;

      result.parseResult = parseResult;
      result.performance.parseTimeMs = parseTime;
      if (initialMemory !== undefined && finalMemory !== undefined) {
        result.performance.memoryUsageBytes = finalMemory - initialMemory;
      }

      // Validate results
      await this.validateTestCase(testCase, parseResult, result);

    } catch (error) {
      if (testCase.expected.shouldNotThrow) {
        result.errors.push(`Test should not throw, but threw: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        result.warnings.push(`Test threw error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    result.passed = result.errors.length === 0;
    return result;
  }

  /**
   * Validate test case results
   */
  private async validateTestCase(
    testCase: PluginTestCase,
    parseResult: ParseResult,
    result: PluginTestResult
  ): Promise<void> {
    const expected = testCase.expected;

    // Check language
    if (expected.language && parseResult.language !== expected.language) {
      result.errors.push(`Expected language '${expected.language}', got '${parseResult.language}'`);
    }

    // Check error count
    if (expected.errorCount !== undefined && parseResult.errors.length !== expected.errorCount) {
      result.errors.push(`Expected ${expected.errorCount} errors, got ${parseResult.errors.length}`);
    }

    // Check symbols
    if (expected.symbols) {
      for (const expectedSymbol of expected.symbols) {
        const found = parseResult.symbols.some(symbol => 
          this.symbolMatches(symbol, expectedSymbol)
        );
        if (!found) {
          result.errors.push(`Expected symbol not found: ${JSON.stringify(expectedSymbol)}`);
        }
      }
    }

    // Check imports
    if (expected.imports) {
      for (const expectedImport of expected.imports) {
        const found = parseResult.imports.some(imp => 
          imp.from === expectedImport.from &&
          (!expectedImport.items || this.arraysMatch(imp.items, expectedImport.items))
        );
        if (!found) {
          result.errors.push(`Expected import not found: ${JSON.stringify(expectedImport)}`);
        }
      }
    }

    // Check exports
    if (expected.exports) {
      for (const expectedExport of expected.exports) {
        const found = parseResult.exports.some(exp => 
          exp.name === expectedExport.name &&
          (!expectedExport.type || exp.type === expectedExport.type)
        );
        if (!found) {
          result.errors.push(`Expected export not found: ${JSON.stringify(expectedExport)}`);
        }
      }
    }
  }

  /**
   * Check if symbol matches expected pattern
   */
  private symbolMatches(symbol: Symbol, expected: Partial<Symbol>): boolean {
    return (
      (!expected.name || symbol.name === expected.name) &&
      (!expected.type || symbol.type === expected.type) &&
      (!expected.scope || symbol.scope === expected.scope) &&
      (expected.exported === undefined || symbol.exported === expected.exported)
    );
  }

  /**
   * Check if arrays match (order-independent)
   */
  private arraysMatch<T>(arr1: T[], arr2: T[]): boolean {
    if (arr1.length !== arr2.length) return false;
    return arr2.every(item => arr1.includes(item));
  }

  /**
   * Benchmark plugin performance
   */
  async benchmark(config: PluginBenchmarkConfig): Promise<PluginBenchmarkResult[]> {
    const results: PluginBenchmarkResult[] = [];

    // Initialize plugin
    await config.plugin.initialize({
      enabled: true,
      settings: {},
      timeout: 30000
    });

    for (const benchmark of config.benchmarks) {
      const result = await this.runBenchmark(config.plugin, benchmark, config.iterations, config.warmupIterations);
      results.push(result);
    }

    // Cleanup plugin
    await config.plugin.cleanup();

    return results;
  }

  /**
   * Run a single benchmark
   */
  private async runBenchmark(
    plugin: EnhancedLanguageParser,
    benchmark: PluginBenchmarkCase,
    iterations: number,
    warmupIterations: number
  ): Promise<PluginBenchmarkResult> {
    const times: number[] = [];
    const memoryUsages: number[] = [];
    let sampleResult: ParseResult | undefined;

    // Warmup iterations
    for (let i = 0; i < warmupIterations; i++) {
      await plugin.parse(benchmark.content, benchmark.filePath);
    }

    // Benchmark iterations
    for (let i = 0; i < iterations; i++) {
      const initialMemory = typeof process !== 'undefined' && process.memoryUsage ? 
        process.memoryUsage().heapUsed : undefined;

      const startTime = Date.now();
      const parseResult = await plugin.parse(benchmark.content, benchmark.filePath);
      const endTime = Date.now();

      const finalMemory = typeof process !== 'undefined' && process.memoryUsage ? 
        process.memoryUsage().heapUsed : undefined;

      times.push(endTime - startTime);
      
      if (initialMemory !== undefined && finalMemory !== undefined) {
        memoryUsages.push(finalMemory - initialMemory);
      }

      if (!sampleResult) {
        sampleResult = parseResult;
      }
    }

    // Calculate statistics
    const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);
    const opsPerSecond = 1000 / avgTime;
    const avgMemoryUsage = memoryUsages.length > 0 ? 
      memoryUsages.reduce((sum, mem) => sum + mem, 0) / memoryUsages.length : undefined;

    return {
      name: benchmark.name,
      category: benchmark.category,
      contentSize: benchmark.content.length,
      metrics: {
        avgParseTimeMs: avgTime,
        minParseTimeMs: minTime,
        maxParseTimeMs: maxTime,
        stdDevMs: stdDev,
        opsPerSecond,
        avgMemoryUsageBytes: avgMemoryUsage
      },
      sampleResult: sampleResult!
    };
  }

  /**
   * Generate standard test cases for a language
   */
  static generateStandardTestCases(language: SupportedLanguage): PluginTestCase[] {
    const testCases: PluginTestCase[] = [];
    
    // Basic syntax test
    testCases.push({
      name: `${language}-basic-syntax`,
      description: `Test basic ${language} syntax parsing`,
      content: this.getBasicSyntaxContent(language),
      filePath: `test${this.getFileExtension(language)}`,
      expected: {
        language,
        shouldNotThrow: true,
        errorCount: 0
      }
    });

    // Complex syntax test
    testCases.push({
      name: `${language}-complex-syntax`,
      description: `Test complex ${language} syntax parsing`,
      content: this.getComplexSyntaxContent(language),
      filePath: `complex${this.getFileExtension(language)}`,
      expected: {
        language,
        shouldNotThrow: true
      }
    });

    // Error handling test
    testCases.push({
      name: `${language}-malformed-syntax`,
      description: `Test error handling with malformed ${language} syntax`,
      content: this.getMalformedSyntaxContent(language),
      filePath: `malformed${this.getFileExtension(language)}`,
      expected: {
        language,
        shouldNotThrow: true
      }
    });

    // Empty content test
    testCases.push({
      name: `${language}-empty-content`,
      description: `Test parsing empty ${language} file`,
      content: '',
      filePath: `empty${this.getFileExtension(language)}`,
      expected: {
        language,
        shouldNotThrow: true,
        symbols: [],
        imports: [],
        exports: []
      }
    });

    return testCases;
  }

  /**
   * Generate benchmark cases for a language
   */
  static generateBenchmarkCases(language: SupportedLanguage): PluginBenchmarkCase[] {
    const extension = this.getFileExtension(language);
    
    return [
      {
        name: `${language}-small`,
        content: this.getBasicSyntaxContent(language),
        filePath: `small${extension}`,
        category: 'small'
      },
      {
        name: `${language}-medium`,
        content: this.getComplexSyntaxContent(language).repeat(10),
        filePath: `medium${extension}`,
        category: 'medium'
      },
      {
        name: `${language}-large`,
        content: this.getComplexSyntaxContent(language).repeat(100),
        filePath: `large${extension}`,
        category: 'large'
      },
      {
        name: `${language}-extra-large`,
        content: this.getComplexSyntaxContent(language).repeat(1000),
        filePath: `extra-large${extension}`,
        category: 'extra-large'
      }
    ];
  }

  /**
   * Get basic syntax content for a language
   */
  private static getBasicSyntaxContent(language: SupportedLanguage): string {
    const content: Record<SupportedLanguage, string> = {
      'typescript': `interface User { name: string; }\nexport class UserService { getUser(): User { return { name: "John" }; } }`,
      'javascript': `function createUser(name) { return { id: 1, name }; }\nmodule.exports = { createUser };`,
      'python': `class User:\n    def __init__(self, name):\n        self.name = name\n\ndef create_user(name):\n    return User(name)`,
      'go': `package main\n\ntype User struct {\n    Name string\n}\n\nfunc main() {\n    user := User{Name: "John"}\n}`,
      'java': `public class User {\n    private String name;\n    public User(String name) { this.name = name; }\n}`,
      'cpp': `#include <string>\nclass User {\nprivate:\n    std::string name;\npublic:\n    User(const std::string& n) : name(n) {}\n};`,
      'c': `#include <stdio.h>\ntypedef struct { char name[50]; } User;\nint main() { return 0; }`,
      'rust': `struct User { name: String }\nimpl User { fn new(name: String) -> Self { User { name } } }`,
      'unknown': '// basic content'
    };

    return content[language] || content['unknown'];
  }

  /**
   * Get complex syntax content for a language
   */
  private static getComplexSyntaxContent(language: SupportedLanguage): string {
    const content: Record<SupportedLanguage, string> = {
      'typescript': `
import { Observable } from 'rxjs';

interface Repository<T> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
}

export class UserRepository implements Repository<User> {
  constructor(private db: Database) {}
  
  async findById(id: string): Promise<User | null> {
    const result = await this.db.query('SELECT * FROM users WHERE id = ?', [id]);
    return result.rows[0] || null;
  }
  
  async save(user: User): Promise<User> {
    if (user.id) {
      return this.update(user);
    } else {
      return this.create(user);
    }
  }
}`,
      'javascript': `
const { EventEmitter } = require('events');

class UserService extends EventEmitter {
  constructor(repository) {
    super();
    this.repository = repository;
    this.cache = new Map();
  }
  
  async getUser(id) {
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }
    
    const user = await this.repository.findById(id);
    if (user) {
      this.cache.set(id, user);
      this.emit('userLoaded', user);
    }
    
    return user;
  }
}

module.exports = { UserService };`,
      'python': `
from abc import ABC, abstractmethod
from typing import Optional, List, Dict
import asyncio

class Repository(ABC):
    @abstractmethod
    async def find_by_id(self, id: str) -> Optional[Dict]:
        pass
    
    @abstractmethod
    async def save(self, entity: Dict) -> Dict:
        pass

class UserRepository(Repository):
    def __init__(self, db_connection):
        self.db = db_connection
    
    async def find_by_id(self, id: str) -> Optional[Dict]:
        async with self.db.cursor() as cursor:
            await cursor.execute("SELECT * FROM users WHERE id = %s", (id,))
            result = await cursor.fetchone()
            return result
    
    async def save(self, user: Dict) -> Dict:
        if 'id' in user:
            return await self._update(user)
        else:
            return await self._create(user)`,
      'go': `
package main

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "time"
)

type Repository interface {
    FindByID(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, user *User) error
}

type UserRepository struct {
    db    *sql.DB
    cache map[string]*User
}

func NewUserRepository(db *sql.DB) *UserRepository {
    return &UserRepository{
        db:    db,
        cache: make(map[string]*User),
    }
}

func (r *UserRepository) FindByID(ctx context.Context, id string) (*User, error) {
    if user, exists := r.cache[id]; exists {
        return user, nil
    }
    
    var user User
    query := "SELECT id, name, email, created_at FROM users WHERE id = $1"
    err := r.db.QueryRowContext(ctx, query, id).Scan(
        &user.ID, &user.Name, &user.Email, &user.CreatedAt,
    )
    
    if err != nil {
        return nil, fmt.Errorf("failed to find user: %w", err)
    }
    
    r.cache[id] = &user
    return &user, nil
}`,
      'java': `
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

public interface Repository<T, ID> {
    CompletableFuture<Optional<T>> findById(ID id);
    CompletableFuture<T> save(T entity);
}

public class UserRepository implements Repository<User, String> {
    private final DatabaseConnection db;
    private final ConcurrentHashMap<String, User> cache;
    
    public UserRepository(DatabaseConnection db) {
        this.db = db;
        this.cache = new ConcurrentHashMap<>();
    }
    
    @Override
    public CompletableFuture<Optional<User>> findById(String id) {
        return CompletableFuture.supplyAsync(() -> {
            User cachedUser = cache.get(id);
            if (cachedUser != null) {
                return Optional.of(cachedUser);
            }
            
            try {
                User user = db.queryForObject(
                    "SELECT * FROM users WHERE id = ?",
                    User.class,
                    id
                );
                
                if (user != null) {
                    cache.put(id, user);
                }
                
                return Optional.ofNullable(user);
            } catch (SQLException e) {
                throw new RuntimeException("Database error", e);
            }
        });
    }
}`,
      'cpp': `
#include <memory>
#include <unordered_map>
#include <future>
#include <optional>

template<typename T, typename ID>
class Repository {
public:
    virtual ~Repository() = default;
    virtual std::future<std::optional<T>> findById(const ID& id) = 0;
    virtual std::future<T> save(const T& entity) = 0;
};

class UserRepository : public Repository<User, std::string> {
private:
    std::shared_ptr<DatabaseConnection> db_;
    std::unordered_map<std::string, User> cache_;
    mutable std::mutex cache_mutex_;

public:
    explicit UserRepository(std::shared_ptr<DatabaseConnection> db)
        : db_(std::move(db)) {}
    
    std::future<std::optional<User>> findById(const std::string& id) override {
        return std::async(std::launch::async, [this, id]() -> std::optional<User> {
            std::lock_guard<std::mutex> lock(cache_mutex_);
            
            auto it = cache_.find(id);
            if (it != cache_.end()) {
                return it->second;
            }
            
            auto user = db_->queryForObject<User>(
                "SELECT * FROM users WHERE id = ?", id
            );
            
            if (user) {
                cache_[id] = *user;
            }
            
            return user;
        });
    }
};`,
      'c': `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

typedef struct {
    char id[64];
    char name[128];
    char email[128];
} User;

typedef struct {
    User* users;
    size_t count;
    size_t capacity;
    pthread_mutex_t mutex;
} UserRepository;

UserRepository* user_repository_create(size_t initial_capacity) {
    UserRepository* repo = malloc(sizeof(UserRepository));
    if (!repo) return NULL;
    
    repo->users = malloc(sizeof(User) * initial_capacity);
    if (!repo->users) {
        free(repo);
        return NULL;
    }
    
    repo->count = 0;
    repo->capacity = initial_capacity;
    pthread_mutex_init(&repo->mutex, NULL);
    
    return repo;
}

User* user_repository_find_by_id(UserRepository* repo, const char* id) {
    if (!repo || !id) return NULL;
    
    pthread_mutex_lock(&repo->mutex);
    
    for (size_t i = 0; i < repo->count; i++) {
        if (strcmp(repo->users[i].id, id) == 0) {
            pthread_mutex_unlock(&repo->mutex);
            return &repo->users[i];
        }
    }
    
    pthread_mutex_unlock(&repo->mutex);
    return NULL;
}`,
      'rust': `
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;
use async_trait::async_trait;

#[async_trait]
pub trait Repository<T, ID> {
    type Error;
    
    async fn find_by_id(&self, id: ID) -> Result<Option<T>, Self::Error>;
    async fn save(&self, entity: T) -> Result<T, Self::Error>;
}

pub struct UserRepository {
    db: Arc<dyn DatabaseConnection>,
    cache: Arc<RwLock<HashMap<String, User>>>,
}

impl UserRepository {
    pub fn new(db: Arc<dyn DatabaseConnection>) -> Self {
        Self {
            db,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl Repository<User, String> for UserRepository {
    type Error = DatabaseError;
    
    async fn find_by_id(&self, id: String) -> Result<Option<User>, Self::Error> {
        {
            let cache = self.cache.read().await;
            if let Some(user) = cache.get(&id) {
                return Ok(Some(user.clone()));
            }
        }
        
        let user = self.db.query_for_object::<User>(
            "SELECT * FROM users WHERE id = $1",
            &[&id],
        ).await?;
        
        if let Some(ref user) = user {
            let mut cache = self.cache.write().await;
            cache.insert(id, user.clone());
        }
        
        Ok(user)
    }
    
    async fn save(&self, user: User) -> Result<User, Self::Error> {
        if user.id.is_empty() {
            self.create_user(user).await
        } else {
            self.update_user(user).await
        }
    }
}`,
      'unknown': '// complex content'
    };

    return content[language] || content['unknown'];
  }

  /**
   * Get malformed syntax content for a language
   */
  private static getMalformedSyntaxContent(language: SupportedLanguage): string {
    const content: Record<SupportedLanguage, string> = {
      'typescript': `interface User { name: string; // missing closing brace\nclass Service {`,
      'javascript': `function test( { // missing parameters and closing\nconst x = {`,
      'python': `class User:\n    def __init__(self\n        # missing closing and indentation error\nif True`,
      'go': `package main\n\nfunc test( {\n    // missing parameters\ntype User struct {`,
      'java': `public class User {\n    private String name\n    // missing semicolon\n    public void method( {`,
      'cpp': `class User {\npublic:\n    User( {\n    // missing parameters\n#include incomplete`,
      'c': `#include <stdio.h>\nint main( {\n    // missing parameters\nstruct User {`,
      'rust': `struct User {\n    name: String\n    // missing comma\nfn test( {`,
      'unknown': '// malformed content {'
    };

    return content[language] || content['unknown'];
  }

  /**
   * Get file extension for a language
   */
  private static getFileExtension(language: SupportedLanguage): string {
    const extensions: Record<SupportedLanguage, string> = {
      'typescript': '.ts',
      'javascript': '.js',
      'python': '.py',
      'go': '.go',
      'java': '.java',
      'cpp': '.cpp',
      'c': '.c',
      'rust': '.rs',
      'unknown': '.txt'
    };

    return extensions[language] || extensions['unknown'];
  }
}

/**
 * Plugin test runner utility
 */
export class PluginTestRunner {
  /**
   * Run tests and generate report
   */
  static async runAndReport(
    plugin: EnhancedLanguageParser,
    outputFormat: 'console' | 'json' | 'html' = 'console'
  ): Promise<string> {
    const testSuite = new PluginTestSuite();
    const metadata = plugin.getMetadata();
    
    // Generate standard test cases for all supported languages
    const testCases: PluginTestCase[] = [];
    for (const language of metadata.languages) {
      testCases.push(...PluginTestSuite.generateStandardTestCases(language));
    }

    const result = await testSuite.runTests({
      plugin,
      testCases,
      validation: { strict: true }
    });

    switch (outputFormat) {
      case 'json':
        return JSON.stringify(result, null, 2);
      
      case 'html':
        return this.generateHtmlReport(result);
      
      default:
        return this.generateConsoleReport(result);
    }
  }

  /**
   * Generate console report
   */
  private static generateConsoleReport(result: PluginTestSuiteResult): string {
    const lines: string[] = [];
    
    lines.push(`=== Plugin Test Report: ${result.metadata.name} ===`);
    lines.push(`Version: ${result.metadata.version}`);
    lines.push(`Languages: ${result.metadata.languages.join(', ')}`);
    lines.push(`Overall Success: ${result.success ? 'PASS' : 'FAIL'}`);
    lines.push('');
    
    lines.push(`Summary:`);
    lines.push(`  Total Tests: ${result.summary.totalTests}`);
    lines.push(`  Passed: ${result.summary.passedTests}`);
    lines.push(`  Failed: ${result.summary.failedTests}`);
    lines.push(`  Total Time: ${result.summary.totalTime}ms`);
    lines.push(`  Average Parse Time: ${result.summary.averageParseTime.toFixed(2)}ms`);
    lines.push('');

    if (result.validation) {
      lines.push(`Validation: ${result.validation.valid ? 'PASS' : 'FAIL'}`);
      if (result.validation.errors.length > 0) {
        lines.push(`  Errors: ${result.validation.errors.join(', ')}`);
      }
      if (result.validation.warnings.length > 0) {
        lines.push(`  Warnings: ${result.validation.warnings.join(', ')}`);
      }
      lines.push('');
    }

    lines.push('Test Results:');
    for (const testResult of result.testResults) {
      const status = testResult.passed ? 'PASS' : 'FAIL';
      lines.push(`  ${status} ${testResult.testName} (${testResult.performance.parseTimeMs}ms)`);
      
      if (testResult.errors.length > 0) {
        for (const error of testResult.errors) {
          lines.push(`    ERROR: ${error}`);
        }
      }
      
      if (testResult.warnings.length > 0) {
        for (const warning of testResult.warnings) {
          lines.push(`    WARN: ${warning}`);
        }
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Generate HTML report
   */
  private static generateHtmlReport(result: PluginTestSuiteResult): string {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Plugin Test Report: ${result.metadata.name}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .summary { margin: 20px 0; }
        .test-result { margin: 10px 0; padding: 10px; border-radius: 5px; }
        .pass { background: #d4edda; }
        .fail { background: #f8d7da; }
        .error { color: #721c24; margin-left: 20px; }
        .warning { color: #856404; margin-left: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Plugin Test Report: ${result.metadata.name}</h1>
        <p><strong>Version:</strong> ${result.metadata.version}</p>
        <p><strong>Languages:</strong> ${result.metadata.languages.join(', ')}</p>
        <p><strong>Overall Success:</strong> ${result.success ? '✅ PASS' : '❌ FAIL'}</p>
    </div>
    
    <div class="summary">
        <h2>Summary</h2>
        <ul>
            <li>Total Tests: ${result.summary.totalTests}</li>
            <li>Passed: ${result.summary.passedTests}</li>
            <li>Failed: ${result.summary.failedTests}</li>
            <li>Total Time: ${result.summary.totalTime}ms</li>
            <li>Average Parse Time: ${result.summary.averageParseTime.toFixed(2)}ms</li>
        </ul>
    </div>
    
    <div class="test-results">
        <h2>Test Results</h2>
        ${result.testResults.map(test => `
            <div class="test-result ${test.passed ? 'pass' : 'fail'}">
                <strong>${test.passed ? '✅' : '❌'} ${test.testName}</strong> (${test.performance.parseTimeMs}ms)
                ${test.errors.map(error => `<div class="error">ERROR: ${error}</div>`).join('')}
                ${test.warnings.map(warning => `<div class="warning">WARN: ${warning}</div>`).join('')}
            </div>
        `).join('')}
    </div>
</body>
</html>`;
  }
}

// Testing utilities are exported above with their class definitions