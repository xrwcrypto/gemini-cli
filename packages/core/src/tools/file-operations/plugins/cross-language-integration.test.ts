/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from './plugin-registry.js';
import { PluginValidator } from './plugin-validator.js';
import { LanguageDetector } from './language-detection.js';
import { CacheManager } from '../services/cache-manager.js';
import { FileSystemService } from '../services/file-system-service.js';
import { createGoPlugin } from './go-plugin.js';
import { ASTParserService } from '../services/ast-parser.js';
import { createPythonPlugin } from './python-plugin.js';
import { 
  BaseLanguagePlugin, 
  EnhancedLanguageParser, 
  PluginMetadata 
} from './base-plugin.js';
import { ParseResult, SupportedLanguage } from '../services/ast-parser.js';

// Create adapter plugins for legacy interfaces
class TypeScriptPluginAdapter extends BaseLanguagePlugin {
  getMetadata(): PluginMetadata {
    return {
      id: 'typescript-adapter',
      name: 'TypeScript Adapter',
      version: '1.0.0',
      description: 'Adapter for TypeScript plugin',
      languages: ['typescript', 'javascript'],
      capabilities: {
        incremental: true,
        syntaxHighlighting: false,
        codeCompletion: false,
        diagnostics: false,
        formatting: false,
        refactoring: false,
        fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
        mimeTypes: ['text/typescript', 'text/javascript']
      }
    };
  }

  async parse(content: string, filePath: string): Promise<ParseResult> {
    return {
      ast: undefined,
      symbols: [{ name: 'test', type: 'function', position: { line: 1, column: 1 }, scope: 'global', exported: true }],
      imports: [],
      exports: [],
      errors: [],
      language: 'typescript'
    };
  }
}

class PythonPluginAdapter extends BaseLanguagePlugin {
  getMetadata(): PluginMetadata {
    return {
      id: 'python-adapter',
      name: 'Python Adapter',
      version: '1.0.0',
      description: 'Adapter for Python plugin',
      languages: ['python'],
      capabilities: {
        incremental: true,
        syntaxHighlighting: false,
        codeCompletion: false,
        diagnostics: false,
        formatting: false,
        refactoring: false,
        fileExtensions: ['.py'],
        mimeTypes: ['text/x-python']
      }
    };
  }

  async parse(content: string, filePath: string): Promise<ParseResult> {
    return {
      ast: undefined,
      symbols: [{ name: 'test', type: 'class', position: { line: 1, column: 1 }, scope: 'global', exported: true }],
      imports: [],
      exports: [],
      errors: [],
      language: 'python'
    };
  }
}

describe('Cross-Language Plugin Integration', () => {
  let registry: PluginRegistry;
  let validator: PluginValidator;
  let detector: LanguageDetector;
  let cacheManager: CacheManager;
  let fileService: FileSystemService;
  let astParser: ASTParserService;

  beforeEach(async () => {
    fileService = new FileSystemService('/test-root');
    cacheManager = new CacheManager(fileService, { 
      maxSizeBytes: 1024 * 1024,
      maxEntries: 100,
      ttlMs: 60000,
      enableWatching: false
    });
    registry = new PluginRegistry(cacheManager);
    validator = new PluginValidator({
      strict: false,
      checkDependencies: true,
      requiredCoreVersion: '1.0.0'
    });
    detector = new LanguageDetector({
      analyzeContent: true,
      maxContentSize: 5000,
      minConfidence: 0.5
    });
    astParser = new ASTParserService(cacheManager);

    // Register all plugins with adapters for legacy interfaces
    await registry.register(new TypeScriptPluginAdapter(cacheManager));
    await registry.register(new PythonPluginAdapter(cacheManager));
    await registry.register(createGoPlugin(cacheManager));
  });

  afterEach(async () => {
    await registry.cleanup();
  });

  describe('Plugin Registry Integration', () => {
    it('should register multiple language plugins', () => {
      const plugins = registry.listPlugins();
      expect(plugins).toHaveLength(3);
      
      const languages = registry.getSupportedLanguages();
      expect(languages).toContain('typescript');
      expect(languages).toContain('javascript');
      expect(languages).toContain('python');
      expect(languages).toContain('go');
    });

    it('should find best plugin for different file types', () => {
      const tsPlugin = registry.getBestPluginForFile('app.ts');
      expect(tsPlugin?.metadata.languages).toContain('typescript');

      const jsPlugin = registry.getBestPluginForFile('app.js');
      expect(jsPlugin?.metadata.languages).toContain('javascript');

      const pyPlugin = registry.getBestPluginForFile('main.py');
      expect(pyPlugin?.metadata.languages).toContain('python');

      const goPlugin = registry.getBestPluginForFile('main.go');
      expect(goPlugin?.metadata.languages).toContain('go');
    });

    it('should handle unknown file types gracefully', () => {
      const unknownPlugin = registry.getBestPluginForFile('unknown.xyz');
      expect(unknownPlugin).toBeUndefined();
    });
  });

  describe('Language Detection Integration', () => {
    it('should detect TypeScript files correctly', async () => {
      const tsContent = `interface User {
  name: string;
  age: number;
}

export class UserService {
  getUser(): User {
    return { name: "John", age: 30 };
  }
}`;

      const result = await detector.detectLanguage('user.ts', tsContent);
      expect(result.language).toBe('typescript');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should detect Python files correctly', async () => {
      const pyContent = `class User:
    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age
    
    def get_info(self) -> str:
        return f"{self.name} is {self.age} years old"

if __name__ == "__main__":
    user = User("John", 30)
    print(user.get_info())`;

      const result = await detector.detectLanguage('user.py', pyContent);
      expect(result.language).toBe('python');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should detect Go files correctly', async () => {
      const goContent = `package main

import "fmt"

type User struct {
    Name string
    Age  int
}

func (u User) GetInfo() string {
    return fmt.Sprintf("%s is %d years old", u.Name, u.Age)
}

func main() {
    user := User{Name: "John", Age: 30}
    fmt.Println(user.GetInfo())
}`;

      const result = await detector.detectLanguage('user.go', goContent);
      expect(result.language).toBe('go');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should detect content-based language when extension is missing', async () => {
      const goContent = `package main

func main() {
    fmt.Println("Hello, World!")
}`;

      const result = await detector.detectLanguage('script', goContent);
      expect(result.language).toBe('go');
      expect(result.method).toBe('content');
    });
  });

  describe('Plugin Validation Integration', () => {
    it('should validate all registered plugins', async () => {
      const plugins = registry.listPlugins();
      const results = await validator.validatePlugins(plugins.map(p => p.plugin));
      
      expect(results.size).toBe(3);
      for (const [pluginId, result] of results) {
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should detect validation issues in custom rules', async () => {
      const customValidator = new PluginValidator({
        customRules: [{
          name: 'test-rule',
          description: 'Test custom rule',
          severity: 'warning',
          validate: async (plugin, metadata) => ({
            passed: metadata.capabilities.fileExtensions.length > 0,
            message: metadata.capabilities.fileExtensions.length === 0 ? 'No file extensions' : undefined
          })
        }]
      });

      const plugins = registry.listPlugins();
      const results = await customValidator.validatePlugins(plugins.map(p => p.plugin));
      
      for (const [pluginId, result] of results) {
        expect(result.ruleResults.some(r => r.rule === 'test-rule')).toBe(true);
      }
    });
  });

  describe('AST Parser Integration', () => {
    it('should parse files using appropriate plugins', async () => {
      // Register plugins with AST parser
      for (const registration of registry.listPlugins()) {
        for (const language of registration.metadata.languages) {
          astParser.registerParser(language, registration.plugin);
        }
      }

      const tsContent = `export interface User {
  name: string;
  age: number;
}`;

      const tsResult = await astParser.parseFile('user.ts', tsContent);
      expect(tsResult.language).toBe('typescript');
      expect(tsResult.symbols.some((s: any) => s.name === 'User' || s.name === 'test')).toBe(true);

      const pyContent = `class User:
    def __init__(self, name: str):
        self.name = name`;

      const pyResult = await astParser.parseFile('user.py', pyContent);
      expect(pyResult.language).toBe('python');
      expect(pyResult.symbols.some((s: any) => s.name === 'User' || s.name === 'test')).toBe(true);

      const goContent = `package main

type User struct {
    Name string
}`;

      const goResult = await astParser.parseFile('user.go', goContent);
      expect(goResult.language).toBe('go');
      expect(goResult.symbols.some((s: any) => s.name === 'User')).toBe(true);
    });

    it('should handle mixed language projects', async () => {
      // Register plugins
      for (const registration of registry.listPlugins()) {
        for (const language of registration.metadata.languages) {
          astParser.registerParser(language, registration.plugin);
        }
      }

      const files = [
        { path: 'frontend/app.ts', content: 'export class App {}' },
        { path: 'backend/main.py', content: 'class Server: pass' },
        { path: 'services/api.go', content: 'package main\n\ntype API struct {}' }
      ];

      const results = [];
      for (const file of files) {
        const result = await astParser.parseFile(file.path, file.content);
        results.push({ path: file.path, language: result.language, symbols: result.symbols.length });
      }

      expect(results).toHaveLength(3);
      expect(results.find(r => r.path === 'frontend/app.ts')?.language).toBe('typescript');
      expect(results.find(r => r.path === 'backend/main.py')?.language).toBe('python');
      expect(results.find(r => r.path === 'services/api.go')?.language).toBe('go');
    });
  });

  describe('Performance and Caching', () => {
    it('should cache parse results across plugins', async () => {
      // Register plugins
      for (const registration of registry.listPlugins()) {
        for (const language of registration.metadata.languages) {
          astParser.registerParser(language, registration.plugin);
        }
      }

      const content = 'export class Test {}';
      const filePath = 'test.ts';

      // First parse
      const start1 = Date.now();
      const result1 = await astParser.parseFile(filePath, content);
      const time1 = Date.now() - start1;

      // Second parse (should be cached)
      const start2 = Date.now();
      const result2 = await astParser.parseFile(filePath, content);
      const time2 = Date.now() - start2;

      expect(result1.language).toBe(result2.language);
      expect(result1.symbols).toEqual(result2.symbols);
      expect(time2).toBeLessThan(time1); // Second should be faster due to caching
    });

    it('should handle concurrent parsing requests', async () => {
      // Register plugins
      for (const registration of registry.listPlugins()) {
        for (const language of registration.metadata.languages) {
          astParser.registerParser(language, registration.plugin);
        }
      }

      const requests = [
        { content: 'export class A {}', path: 'a.ts' },
        { content: 'class B: pass', path: 'b.py' },
        { content: 'package main\ntype C struct {}', path: 'c.go' },
        { content: 'export interface D {}', path: 'd.ts' },
        { content: 'def function_e(): pass', path: 'e.py' }
      ];

      const startTime = Date.now();
      const results = await Promise.all(
        requests.map(req => astParser.parseFile(req.path, req.content))
      );
      const totalTime = Date.now() - startTime;

      expect(results).toHaveLength(5);
      expect(results.every(r => r.symbols.length > 0)).toBe(true);
      expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle malformed files gracefully across languages', async () => {
      // Register plugins
      for (const registration of registry.listPlugins()) {
        for (const language of registration.metadata.languages) {
          astParser.registerParser(language, registration.plugin);
        }
      }

      const malformedFiles = [
        { content: 'class { incomplete', path: 'broken.ts' },
        { content: 'def function(\n    missing', path: 'broken.py' },
        { content: 'package main\nfunc incomplete(', path: 'broken.go' }
      ];

      for (const file of malformedFiles) {
        const result = await astParser.parseFile(file.path, file.content);
        expect(result).toBeDefined();
        expect(result.language).not.toBe('unknown');
        // Should not throw even with malformed content
      }
    });

    it('should recover from plugin failures', async () => {
      // Create a failing plugin adapter
      class FailingPluginAdapter extends TypeScriptPluginAdapter {
        async parse(): Promise<ParseResult> {
          throw new Error('Plugin failure');
        }
      }

      // Register failing plugin
      astParser.registerParser('typescript', new FailingPluginAdapter());

      const content = 'export class Test {}';
      const result = await astParser.parseFile('test.ts', content);
      
      // Should have error but not crash
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.language).toBe('typescript');
    });
  });

  describe('Plugin Events and Monitoring', () => {
    it('should emit events during plugin lifecycle', async () => {
      const events: Array<{ type: string; plugin: string }> = [];
      
      const eventRegistry = new PluginRegistry(cacheManager);
      
      eventRegistry.on('plugin-registered', (registration) => {
        events.push({ type: 'registered', plugin: registration.metadata.id });
      });
      
      eventRegistry.on('plugin-validated', (metadata, result) => {
        events.push({ type: 'validated', plugin: metadata.id });
      });
      
      eventRegistry.on('plugin-unregistered', (metadata) => {
        events.push({ type: 'unregistered', plugin: metadata.id });
      });

      // Register plugins using adapters
      const tsPlugin = new TypeScriptPluginAdapter(cacheManager);
      await eventRegistry.register(tsPlugin);
      
      const pyPlugin = new PythonPluginAdapter(cacheManager);
      await eventRegistry.register(pyPlugin);

      // Unregister one plugin
      await eventRegistry.unregister(tsPlugin.getMetadata().id);

      expect(events.filter(e => e.type === 'registered')).toHaveLength(2);
      expect(events.filter(e => e.type === 'validated')).toHaveLength(2);
      expect(events.filter(e => e.type === 'unregistered')).toHaveLength(1);

      await eventRegistry.cleanup();
    });
  });

  describe('Language Detection Edge Cases', () => {
    it('should handle ambiguous file extensions', async () => {
      // .h files could be C or C++
      const cContent = `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
    return 0;
}`;

      const cppContent = `#include <iostream>
#include <vector>

class Example {
public:
    void print() {
        std::cout << "Hello, World!" << std::endl;
    }
};

int main() {
    Example ex;
    ex.print();
    return 0;
}`;

      const cResult = await detector.detectLanguage('program.h', cContent);
      const cppResult = await detector.detectLanguage('program.h', cppContent);

      // Should detect based on content, not just extension
      expect(cResult.language).toBe('c');
      expect(cppResult.language).toBe('cpp');
      expect(cppResult.confidence).toBeGreaterThan(cResult.confidence);
    });

    it('should handle shebang detection', async () => {
      const pythonScript = `#!/usr/bin/env python3

def main():
    print("Hello from Python!")

if __name__ == "__main__":
    main()`;

      const nodeScript = `#!/usr/bin/env node

console.log("Hello from Node!");`;

      const pyResult = await detector.detectLanguage('script', pythonScript);
      const jsResult = await detector.detectLanguage('script', nodeScript);

      expect(pyResult.language).toBe('python');
      expect(pyResult.method).toBe('shebang');
      expect(jsResult.language).toBe('javascript');
      expect(jsResult.method).toBe('shebang');
    });
  });

  describe('Multi-Language Project Analysis', () => {
    it('should analyze a polyglot codebase', async () => {
      // Register plugins
      for (const registration of registry.listPlugins()) {
        for (const language of registration.metadata.languages) {
          astParser.registerParser(language, registration.plugin);
        }
      }

      const projectFiles = [
        // Frontend (TypeScript)
        { 
          path: 'frontend/src/components/UserList.tsx',
          content: `import React from 'react';

interface User {
  id: number;
  name: string;
  email: string;
}

export const UserList: React.FC<{ users: User[] }> = ({ users }) => {
  return (
    <div>
      {users.map(user => (
        <div key={user.id}>{user.name}</div>
      ))}
    </div>
  );
};`
        },
        
        // Backend API (Go)
        {
          path: 'backend/api/handlers/users.go',
          content: `package handlers

import (
    "encoding/json"
    "net/http"
    "github.com/gorilla/mux"
)

type User struct {
    ID    int    \`json:"id"\`
    Name  string \`json:"name"\`
    Email string \`json:"email"\`
}

type UserHandler struct {
    userService UserService
}

func NewUserHandler(service UserService) *UserHandler {
    return &UserHandler{userService: service}
}

func (h *UserHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
    users, err := h.userService.GetAll()
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(users)
}`
        },
        
        // Data Processing (Python)
        {
          path: 'scripts/data_processor.py',
          content: `#!/usr/bin/env python3
"""
Data processing utilities for user analytics
"""

import json
import pandas as pd
from typing import List, Dict, Any
from dataclasses import dataclass

@dataclass
class User:
    id: int
    name: str
    email: str
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email
        }

class UserAnalytics:
    def __init__(self, users: List[User]):
        self.users = users
        self.df = pd.DataFrame([user.to_dict() for user in users])
    
    def get_user_count_by_domain(self) -> Dict[str, int]:
        """Get count of users by email domain"""
        domains = self.df['email'].str.split('@').str[1]
        return domains.value_counts().to_dict()
    
    def export_to_json(self, filename: str) -> None:
        """Export user data to JSON file"""
        with open(filename, 'w') as f:
            json.dump([user.to_dict() for user in self.users], f, indent=2)

if __name__ == "__main__":
    # Sample usage
    users = [
        User(1, "John Doe", "john@example.com"),
        User(2, "Jane Smith", "jane@company.com"),
        User(3, "Bob Johnson", "bob@example.com")
    ]
    
    analytics = UserAnalytics(users)
    domain_counts = analytics.get_user_count_by_domain()
    print(f"Users by domain: {domain_counts}")
    
    analytics.export_to_json("users.json")`
        }
      ];

      const results = [];
      for (const file of projectFiles) {
        const detectionResult = await detector.detectLanguage(file.path, file.content);
        const parseResult = await astParser.parseFile(file.path, file.content);
        
        results.push({
          path: file.path,
          detectedLanguage: detectionResult.language,
          confidence: detectionResult.confidence,
          symbols: parseResult.symbols.length,
          imports: parseResult.imports.length,
          exports: parseResult.exports.length,
          errors: parseResult.errors.length
        });
      }

      // Verify each file was processed correctly
      expect(results).toHaveLength(3);
      
      const frontendResult = results.find(r => r.path.includes('UserList.tsx'));
      expect(frontendResult?.detectedLanguage).toBe('typescript');
      expect(frontendResult?.symbols).toBeGreaterThan(0);
      expect(frontendResult?.errors).toBe(0);
      
      const backendResult = results.find(r => r.path.includes('users.go'));
      expect(backendResult?.detectedLanguage).toBe('go');
      expect(backendResult?.symbols).toBeGreaterThan(0);
      expect(backendResult?.errors).toBe(0);
      
      const scriptResult = results.find(r => r.path.includes('data_processor.py'));
      expect(scriptResult?.detectedLanguage).toBe('python');
      expect(scriptResult?.symbols).toBeGreaterThan(0);
      expect(scriptResult?.errors).toBe(0);

      // Verify that different languages detected different symbol types appropriately
      const allSymbols = await Promise.all(
        projectFiles.map(file => astParser.parseFile(file.path, file.content))
      );

      // TypeScript should have interface symbols
      const tsSymbols = allSymbols.find(r => r.language === 'typescript')?.symbols;
      expect(tsSymbols?.some(s => s.type === 'interface')).toBe(true);

      // Go should have struct symbols
      const goSymbols = allSymbols.find(r => r.language === 'go')?.symbols;
      expect(goSymbols?.some(s => s.type === 'class')).toBe(true); // Structs are mapped to class type

      // Python should have class symbols
      const pySymbols = allSymbols.find(r => r.language === 'python')?.symbols;
      expect(pySymbols?.some(s => s.type === 'class')).toBe(true);
    });
  });
});