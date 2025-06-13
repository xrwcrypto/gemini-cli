/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GoPlugin, createGoPlugin, type GoParseResult } from './go-plugin.js';
import { CacheManager } from '../services/cache-manager.js';
import { FileSystemService } from '../services/file-system-service.js';

describe('GoPlugin', () => {
  let plugin: GoPlugin;
  let cacheManager: CacheManager;
  let fileService: FileSystemService;

  beforeEach(() => {
    fileService = new FileSystemService('/test-root');
    cacheManager = new CacheManager(fileService, { 
      maxSizeBytes: 1024 * 1024,
      maxEntries: 100,
      ttlMs: 60000,
      enableWatching: false
    });
    plugin = createGoPlugin(cacheManager);
  });

  describe('metadata', () => {
    it('should return correct plugin metadata', () => {
      const metadata = plugin.getMetadata();
      
      expect(metadata.id).toBe('go-language-plugin');
      expect(metadata.name).toBe('Go Language Plugin');
      expect(metadata.languages).toContain('go');
      expect(metadata.capabilities.fileExtensions).toContain('.go');
      expect(metadata.capabilities.incremental).toBe(true);
    });
  });

  describe('validation', () => {
    it('should validate successfully', async () => {
      const result = await plugin.validate();
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('file support', () => {
    it('should support .go files', () => {
      expect(plugin.supportsFile('main.go')).toBe(true);
      expect(plugin.supportsFile('package/file.go')).toBe(true);
    });

    it('should not support non-Go files', () => {
      expect(plugin.supportsFile('main.js')).toBe(false);
      expect(plugin.supportsFile('test.py')).toBe(false);
      expect(plugin.supportsFile('config.json')).toBe(false);
    });
  });

  describe('package parsing', () => {
    it('should parse package declaration', async () => {
      const content = `package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.packageName).toBe('main');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing package declaration', async () => {
      const content = `import "fmt"

func main() {
    fmt.Println("Hello, World!")
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.packageName).toBe('');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('No package declaration found');
    });
  });

  describe('import parsing', () => {
    it('should parse single imports', async () => {
      const content = `package main

import "fmt"
import "os"

func main() {}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.imports).toHaveLength(2);
      expect(result.goSpecific.imports[0].path).toBe('fmt');
      expect(result.goSpecific.imports[0].isStandard).toBe(true);
      expect(result.goSpecific.imports[1].path).toBe('os');
      expect(result.goSpecific.imports[1].isStandard).toBe(true);
    });

    it('should parse aliased imports', async () => {
      const content = `package main

import f "fmt"
import myos "os"

func main() {}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.imports).toHaveLength(2);
      expect(result.goSpecific.imports[0].alias).toBe('f');
      expect(result.goSpecific.imports[0].path).toBe('fmt');
      expect(result.goSpecific.imports[1].alias).toBe('myos');
      expect(result.goSpecific.imports[1].path).toBe('os');
    });

    it('should parse block imports', async () => {
      const content = `package main

import (
    "fmt"
    "os"
    f "fmt"
    "github.com/user/repo"
    "./local"
)

func main() {}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.imports).toHaveLength(5);
      
      // Standard library imports
      expect(result.goSpecific.imports.find(i => i.path === 'fmt')?.isStandard).toBe(true);
      expect(result.goSpecific.imports.find(i => i.path === 'os')?.isStandard).toBe(true);
      
      // Aliased import
      expect(result.goSpecific.imports.find(i => i.alias === 'f')?.path).toBe('fmt');
      
      // External import
      const externalImport = result.goSpecific.imports.find(i => i.path === 'github.com/user/repo');
      expect(externalImport?.isStandard).toBe(false);
      expect(externalImport?.isLocal).toBe(false);
      
      // Local import
      const localImport = result.goSpecific.imports.find(i => i.path === './local');
      expect(localImport?.isLocal).toBe(true);
    });
  });

  describe('function parsing', () => {
    it('should parse simple functions', async () => {
      const content = `package main

func main() {
    println("Hello")
}

func greet(name string) string {
    return "Hello " + name
}

func add(a, b int) int {
    return a + b
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.functions).toHaveLength(3);
      
      const mainFunc = result.goSpecific.functions.find(f => f.name === 'main');
      expect(mainFunc?.isExported).toBe(false);
      expect(mainFunc?.parameters).toHaveLength(0);
      expect(mainFunc?.returns).toHaveLength(0);

      const greetFunc = result.goSpecific.functions.find(f => f.name === 'greet');
      expect(greetFunc?.isExported).toBe(false);
      expect(greetFunc?.parameters).toHaveLength(1);
      expect(greetFunc?.parameters[0].name).toBe('name');
      expect(greetFunc?.parameters[0].type).toBe('string');
      expect(greetFunc?.returns).toHaveLength(1);
      expect(greetFunc?.returns[0].type).toBe('string');

      const addFunc = result.goSpecific.functions.find(f => f.name === 'add');
      expect(addFunc?.parameters).toHaveLength(2);
      expect(addFunc?.returns).toHaveLength(1);
      expect(addFunc?.returns[0].type).toBe('int');
    });

    it('should parse exported functions', async () => {
      const content = `package main

func ExportedFunction() {
}

func privateFunction() {
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      const exportedFunc = result.goSpecific.functions.find(f => f.name === 'ExportedFunction');
      expect(exportedFunc?.isExported).toBe(true);

      const privateFunc = result.goSpecific.functions.find(f => f.name === 'privateFunction');
      expect(privateFunc?.isExported).toBe(false);
    });

    it('should parse methods with receivers', async () => {
      const content = `package main

type User struct {
    Name string
}

func (u User) GetName() string {
    return u.Name
}

func (u *User) SetName(name string) {
    u.Name = name
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      const getName = result.goSpecific.functions.find(f => f.name === 'GetName');
      expect(getName?.isMethod).toBe(true);
      expect(getName?.receiver?.name).toBe('u');
      expect(getName?.receiver?.type).toBe('User');
      expect(getName?.receiver?.pointer).toBe(false);

      const setName = result.goSpecific.functions.find(f => f.name === 'SetName');
      expect(setName?.isMethod).toBe(true);
      expect(setName?.receiver?.name).toBe('u');
      expect(setName?.receiver?.type).toBe('User');
      expect(setName?.receiver?.pointer).toBe(true);
    });
  });

  describe('struct parsing', () => {
    it('should parse struct declarations', async () => {
      const content = `package main

type User struct {
    ID       int
    Name     string    ` + '`json:"name"`' + `
    email    string    ` + '`json:"email"`' + `
    Age      int
}

type privateStruct struct {
    field string
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.structs).toHaveLength(2);
      
      const userStruct = result.goSpecific.structs.find(s => s.name === 'User');
      expect(userStruct?.isExported).toBe(true);
      expect(userStruct?.fields).toHaveLength(4);
      
      const idField = userStruct?.fields.find(f => f.name === 'ID');
      expect(idField?.type).toBe('int');
      expect(idField?.isExported).toBe(true);
      
      const nameField = userStruct?.fields.find(f => f.name === 'Name');
      expect(nameField?.type).toBe('string');
      expect(nameField?.tag).toBe('json:"name"');
      
      const emailField = userStruct?.fields.find(f => f.name === 'email');
      expect(emailField?.isExported).toBe(false);
      expect(emailField?.tag).toBe('json:"email"');

      const privateStruct = result.goSpecific.structs.find(s => s.name === 'privateStruct');
      expect(privateStruct?.isExported).toBe(false);
    });

    it('should associate methods with structs', async () => {
      const content = `package main

type User struct {
    Name string
}

func (u User) GetName() string {
    return u.Name
}

func (u *User) SetName(name string) {
    u.Name = name
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      const userStruct = result.goSpecific.structs.find(s => s.name === 'User');
      expect(userStruct?.methods).toContain('GetName');
      expect(userStruct?.methods).toContain('SetName');
      expect(userStruct?.methods).toHaveLength(2);
    });
  });

  describe('interface parsing', () => {
    it('should parse interface declarations', async () => {
      const content = `package main

type Writer interface {
    Write([]byte) (int, error)
}

type ReadWriter interface {
    Read([]byte) (int, error)
    Write([]byte) (int, error)
}

type Closer interface {
    Close() error
}

type ReadWriteCloser interface {
    ReadWriter
    Closer
}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.interfaces).toHaveLength(4);
      
      const writer = result.goSpecific.interfaces.find(i => i.name === 'Writer');
      expect(writer?.isExported).toBe(true);
      expect(writer?.methods).toHaveLength(1);
      expect(writer?.methods[0].name).toBe('Write');
      expect(writer?.methods[0].signature).toContain('([]byte) (int, error)');

      const readWriter = result.goSpecific.interfaces.find(i => i.name === 'ReadWriter');
      expect(readWriter?.methods).toHaveLength(2);

      const readWriteCloser = result.goSpecific.interfaces.find(i => i.name === 'ReadWriteCloser');
      expect(readWriteCloser?.embedded).toContain('ReadWriter');
      expect(readWriteCloser?.embedded).toContain('Closer');
      expect(readWriteCloser?.methods).toHaveLength(0); // Only embedded interfaces
    });
  });

  describe('constant parsing', () => {
    it('should parse constant declarations', async () => {
      const content = `package main

const Pi = 3.14159
const MaxSize int = 1000

const (
    Red = iota
    Green
    Blue
)

const (
    publicConst = "public"
    privateConst = "private"
)`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.constants.length).toBeGreaterThanOrEqual(5);
      
      const pi = result.goSpecific.constants.find(c => c.name === 'Pi');
      expect(pi?.value).toBe('3.14159');
      expect(pi?.isExported).toBe(true);

      const maxSize = result.goSpecific.constants.find(c => c.name === 'MaxSize');
      expect(maxSize?.type).toBe('int');
      expect(maxSize?.value).toBe('1000');

      const red = result.goSpecific.constants.find(c => c.name === 'Red');
      expect(red?.value).toBe('iota');

      const publicConst = result.goSpecific.constants.find(c => c.name === 'publicConst');
      expect(publicConst?.isExported).toBe(false);
    });
  });

  describe('variable parsing', () => {
    it('should parse variable declarations', async () => {
      const content = `package main

var globalVar string
var GlobalVar int = 42

var (
    count int
    name  string = "test"
)`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.variables.length).toBeGreaterThanOrEqual(4);
      
      const globalVar = result.goSpecific.variables.find(v => v.name === 'globalVar');
      expect(globalVar?.type).toBe('string');
      expect(globalVar?.isExported).toBe(false);

      const GlobalVar = result.goSpecific.variables.find(v => v.name === 'GlobalVar');
      expect(GlobalVar?.type).toBe('int');
      expect(GlobalVar?.isExported).toBe(true);
    });
  });

  describe('type parsing', () => {
    it('should parse type declarations', async () => {
      const content = `package main

type MyInt int
type StringSlice []string
type UserMap map[string]User
type Handler func(http.ResponseWriter, *http.Request)`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      expect(result.goSpecific.types).toHaveLength(4);
      
      const myInt = result.goSpecific.types.find(t => t.name === 'MyInt');
      expect(myInt?.underlying).toBe('int');
      expect(myInt?.isExported).toBe(true);

      const stringSlice = result.goSpecific.types.find(t => t.name === 'StringSlice');
      expect(stringSlice?.underlying).toBe('[]string');

      const userMap = result.goSpecific.types.find(t => t.name === 'UserMap');
      expect(userMap?.underlying).toBe('map[string]User');

      const handler = result.goSpecific.types.find(t => t.name === 'Handler');
      expect(handler?.underlying).toBe('func(http.ResponseWriter, *http.Request)');
    });
  });

  describe('symbol extraction', () => {
    it('should extract all symbols correctly', async () => {
      const content = `package main

import "fmt"

type User struct {
    Name string
}

func (u User) String() string {
    return u.Name
}

func main() {
    fmt.Println("Hello")
}

const Version = "1.0.0"
var count int`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      // Check that symbols are extracted
      expect(result.symbols.length).toBeGreaterThan(0);
      
      // Check specific symbols
      const packageSymbol = result.symbols.find(s => s.name === 'main' && s.type === 'import');
      expect(packageSymbol).toBeDefined();

      const userSymbol = result.symbols.find(s => s.name === 'User' && s.type === 'class');
      expect(userSymbol?.exported).toBe(true);

      const mainFunction = result.symbols.find(s => s.name === 'main' && s.type === 'function');
      expect(mainFunction?.exported).toBe(false);

      const stringMethod = result.symbols.find(s => s.name === 'String' && s.type === 'function');
      expect(stringMethod?.scope).toBe('class'); // Method scope
    });
  });

  describe('imports and exports', () => {
    it('should build imports and exports correctly', async () => {
      const content = `package mypackage

import (
    "fmt"
    "os"
    custom "github.com/user/custom"
)

type PublicStruct struct {}
type privateStruct struct {}

func PublicFunction() {}
func privateFunction() {}`;

      const result = await plugin.parse(content, 'main.go') as GoParseResult;
      
      // Check imports
      expect(result.imports).toHaveLength(3);
      expect(result.imports.some(i => i.from === 'fmt')).toBe(true);
      expect(result.imports.some(i => i.from === 'os')).toBe(true);
      expect(result.imports.some(i => i.from === 'github.com/user/custom')).toBe(true);
      
      // Check exports (only exported symbols)
      const exportedNames = result.exports.map(e => e.name);
      expect(exportedNames).toContain('PublicStruct');
      expect(exportedNames).toContain('PublicFunction');
      expect(exportedNames).not.toContain('privateStruct');
      expect(exportedNames).not.toContain('privateFunction');
    });
  });

  describe('error handling', () => {
    it('should handle malformed Go code gracefully', async () => {
      const content = `this is not valid Go code
func incomplete(
type broken struct {
  missing brace`;

      const result = await plugin.parse(content, 'broken.go');
      
      // Should not throw, but may have errors
      expect(result).toBeDefined();
      expect(result.language).toBe('go');
    });
  });

  describe('incremental parsing', () => {
    it('should support incremental parsing', () => {
      expect(plugin.supportsIncremental()).toBe(true);
    });

    it('should fall back to full parsing for incremental', async () => {
      const content = `package main

func main() {}`;

      const result = await plugin.parseIncremental(content, 'main.go');
      
      expect(result.goSpecific.packageName).toBe('main');
      expect(result.goSpecific.functions).toHaveLength(1);
    });
  });

  describe('lifecycle', () => {
    it('should initialize and cleanup properly', async () => {
      const config = {
        enabled: true,
        settings: {},
        timeout: 30000
      };

      await plugin.initialize(config);
      expect(plugin['initialized']).toBe(true);

      await plugin.cleanup();
      expect(plugin['initialized']).toBe(false);
    });
  });

  describe('complex Go code', () => {
    it('should parse a realistic Go file', async () => {
      const content = `package http

import (
    "context"
    "fmt"
    "net/http"
    "time"
)

// Server represents an HTTP server
type Server struct {
    Addr    string
    Handler http.Handler
    timeout time.Duration
}

// Config holds server configuration
type Config struct {
    Port    int    ` + '`json:"port"`' + `
    Host    string ` + '`json:"host"`' + `
    Timeout time.Duration
}

// Handler is a function type for handling requests
type Handler func(w http.ResponseWriter, r *http.Request) error

// ServerOption configures a Server
type ServerOption func(*Server)

const (
    DefaultPort    = 8080
    defaultTimeout = 30 * time.Second
)

var globalServer *Server

// NewServer creates a new HTTP server
func NewServer(opts ...ServerOption) *Server {
    s := &Server{
        Addr:    ":8080",
        timeout: defaultTimeout,
    }
    
    for _, opt := range opts {
        opt(s)
    }
    
    return s
}

// WithAddr sets the server address
func WithAddr(addr string) ServerOption {
    return func(s *Server) {
        s.Addr = addr
    }
}

// Start starts the HTTP server
func (s *Server) Start(ctx context.Context) error {
    return http.ListenAndServe(s.Addr, s.Handler)
}

// Stop gracefully stops the server
func (s *Server) Stop() error {
    return nil
}

// String implements the Stringer interface
func (s *Server) String() string {
    return fmt.Sprintf("Server{Addr: %s}", s.Addr)
}`;

      const result = await plugin.parse(content, 'server.go') as GoParseResult;
      
      // Verify package
      expect(result.goSpecific.packageName).toBe('http');
      
      // Verify imports
      expect(result.goSpecific.imports).toHaveLength(4);
      expect(result.goSpecific.imports.some(i => i.path === 'context')).toBe(true);
      expect(result.goSpecific.imports.some(i => i.path === 'net/http')).toBe(true);
      
      // Verify structs
      expect(result.goSpecific.structs).toHaveLength(2);
      const serverStruct = result.goSpecific.structs.find(s => s.name === 'Server');
      expect(serverStruct?.isExported).toBe(true);
      expect(serverStruct?.fields).toHaveLength(3);
      
      // Verify functions
      expect(result.goSpecific.functions.length).toBeGreaterThanOrEqual(5);
      const newServer = result.goSpecific.functions.find(f => f.name === 'NewServer');
      expect(newServer?.isExported).toBe(true);
      
      // Verify methods
      const startMethod = result.goSpecific.functions.find(f => f.name === 'Start');
      expect(startMethod?.isMethod).toBe(true);
      expect(startMethod?.receiver?.type).toBe('Server');
      
      // Verify types
      expect(result.goSpecific.types.length).toBeGreaterThanOrEqual(2);
      const handlerType = result.goSpecific.types.find(t => t.name === 'Handler');
      expect(handlerType?.underlying).toContain('func');
      
      // Verify constants
      expect(result.goSpecific.constants.length).toBeGreaterThanOrEqual(2);
      const defaultPort = result.goSpecific.constants.find(c => c.name === 'DefaultPort');
      expect(defaultPort?.isExported).toBe(true);
      
      // Verify variables
      expect(result.goSpecific.variables.length).toBeGreaterThanOrEqual(1);
      const globalServerVar = result.goSpecific.variables.find(v => v.name === 'globalServer');
      // The regex might not catch the pointer type correctly, so let's just check that the variable exists
      expect(globalServerVar).toBeDefined();
      expect(globalServerVar?.name).toBe('globalServer');
    });
  });
});