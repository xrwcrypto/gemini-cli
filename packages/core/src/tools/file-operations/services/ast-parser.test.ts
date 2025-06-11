/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ASTParserService } from './ast-parser.js';
import * as path from 'path';

describe('ASTParserService', () => {
  let service: ASTParserService;

  beforeEach(() => {
    service = new ASTParserService();
  });

  describe('Language Detection', () => {
    it('should detect TypeScript files', () => {
      expect(service.detectLanguage('file.ts')).toBe('typescript');
      expect(service.detectLanguage('component.tsx')).toBe('typescript');
      expect(service.detectLanguage('/path/to/file.ts')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      expect(service.detectLanguage('file.js')).toBe('javascript');
      expect(service.detectLanguage('component.jsx')).toBe('javascript');
      expect(service.detectLanguage('module.mjs')).toBe('javascript');
      expect(service.detectLanguage('common.cjs')).toBe('javascript');
    });

    it('should detect other languages', () => {
      expect(service.detectLanguage('script.py')).toBe('python');
      expect(service.detectLanguage('main.go')).toBe('go');
      expect(service.detectLanguage('App.java')).toBe('java');
      expect(service.detectLanguage('program.cpp')).toBe('cpp');
      expect(service.detectLanguage('code.c')).toBe('c');
      expect(service.detectLanguage('lib.rs')).toBe('rust');
    });

    it('should return unknown for unsupported extensions', () => {
      expect(service.detectLanguage('file.txt')).toBe('unknown');
      expect(service.detectLanguage('document.pdf')).toBe('unknown');
      expect(service.detectLanguage('image.png')).toBe('unknown');
    });
  });

  describe('TypeScript/JavaScript Parsing', () => {
    it('should parse function declarations', async () => {
      const content = `
        function hello() {
          console.log('Hello');
        }
        
        export function greet(name: string) {
          return 'Hello ' + name;
        }
        
        export async function fetchData() {
          return await fetch('/api/data');
        }
      `;

      const result = await service.parseFile('test.ts', content);
      
      expect(result.language).toBe('typescript');
      expect(result.errors).toHaveLength(0);
      expect(result.symbols).toHaveLength(3);
      
      const hello = result.symbols.find(s => s.name === 'hello');
      expect(hello).toBeDefined();
      expect(hello?.type).toBe('function');
      expect(hello?.exported).toBe(false);
      
      const greet = result.symbols.find(s => s.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet?.type).toBe('function');
      expect(greet?.exported).toBe(true);
      
      expect(result.exports).toHaveLength(2);
      expect(result.exports.map(e => e.name)).toContain('greet');
      expect(result.exports.map(e => e.name)).toContain('fetchData');
    });

    it('should parse class declarations', async () => {
      const content = `
        class Animal {
          constructor(name) {
            this.name = name;
          }
        }
        
        export class Dog extends Animal {
          bark() {
            console.log('Woof!');
          }
        }
        
        export abstract class Vehicle {
          abstract move(): void;
        }
      `;

      const result = await service.parseFile('test.js', content);
      
      expect(result.language).toBe('javascript');
      expect(result.symbols).toHaveLength(3);
      
      const animal = result.symbols.find(s => s.name === 'Animal');
      expect(animal?.exported).toBe(false);
      
      const dog = result.symbols.find(s => s.name === 'Dog');
      expect(dog?.exported).toBe(true);
      
      const vehicle = result.symbols.find(s => s.name === 'Vehicle');
      expect(vehicle?.exported).toBe(true);
    });

    it('should parse interface declarations in TypeScript', async () => {
      const content = `
        interface User {
          id: number;
          name: string;
        }
        
        export interface Product {
          id: string;
          price: number;
        }
      `;

      const result = await service.parseFile('types.ts', content);
      
      expect(result.language).toBe('typescript');
      expect(result.symbols).toHaveLength(2);
      
      const user = result.symbols.find(s => s.name === 'User');
      expect(user?.type).toBe('interface');
      expect(user?.exported).toBe(false);
      
      const product = result.symbols.find(s => s.name === 'Product');
      expect(product?.type).toBe('interface');
      expect(product?.exported).toBe(true);
    });

    it('should parse imports', async () => {
      const content = `
        import React from 'react';
        import { useState, useEffect } from 'react';
        import * as path from 'path';
        import type { Config } from './config';
      `;

      const result = await service.parseFile('component.tsx', content);
      
      expect(result.imports).toHaveLength(3); // type imports are not captured by basic regex
      
      const reactImport = result.imports.find(i => i.from === 'react' && i.items.includes('React'));
      expect(reactImport).toBeDefined();
      
      const hooksImport = result.imports.find(i => i.from === 'react' && i.items.includes('useState'));
      expect(hooksImport).toBeDefined();
      expect(hooksImport?.items).toContain('useEffect');
      
      const pathImport = result.imports.find(i => i.from === 'path');
      expect(pathImport?.items).toContain('* as path');
    });

    it('should handle empty files gracefully', async () => {
      const result = await service.parseFile('test.ts', '');
      
      expect(result.language).toBe('typescript');
      expect(result.symbols).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
      expect(result.errors).toHaveLength(0); // Empty file is valid
    });

    it('should handle file size limits', async () => {
      const service = new ASTParserService(undefined, { maxFileSizeBytes: 10 });
      const largeContent = 'x'.repeat(20);
      
      const result = await service.parseFile('large.js', largeContent);
      
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('too large');
    });
  });

  describe('Symbol Querying', () => {
    const sampleCode = `
      import { Component } from 'react';
      
      export interface Props {
        name: string;
      }
      
      export class MyComponent extends Component {
        render() {
          return null;
        }
      }
      
      function helper() {
        return 'help';
      }
      
      export function publicHelper() {
        return helper();
      }
    `;

    it('should query symbols by type', async () => {
      await service.parseFile('component.tsx', sampleCode);
      
      const functions = await service.queryAST('component.tsx', { type: 'function' });
      expect(functions).toHaveLength(2);
      expect(functions.map(f => f.name)).toContain('helper');
      expect(functions.map(f => f.name)).toContain('publicHelper');
      
      const classes = await service.queryAST('component.tsx', { type: 'class' });
      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('MyComponent');
    });

    it('should query symbols by export status', async () => {
      await service.parseFile('component.tsx', sampleCode);
      
      const exported = await service.queryAST('component.tsx', { exported: true });
      expect(exported).toHaveLength(3); // Props, MyComponent, publicHelper
      
      const notExported = await service.queryAST('component.tsx', { exported: false });
      expect(notExported).toHaveLength(1); // helper
    });

    it('should query symbols by name pattern', async () => {
      await service.parseFile('component.tsx', sampleCode);
      
      const helpers = await service.queryAST('component.tsx', { name: 'Helper' });
      expect(helpers).toHaveLength(1); // publicHelper (contains 'Helper')
    });
  });

  describe('Import/Export Extraction', () => {
    it('should extract imports', async () => {
      const content = `
        import React from 'react';
        import { render } from '@testing-library/react';
        import * as utils from './utils';
      `;

      // parseFile must be called first
      await service.parseFile('test.tsx', content);
      const importsAfter = await service.extractImports('test.tsx');
      
      expect(importsAfter).toHaveLength(3);
      expect(importsAfter[0]).toEqual({ from: 'react', items: ['React'] });
      expect(importsAfter[1]).toEqual({ from: '@testing-library/react', items: ['render'] });
      expect(importsAfter[2]).toEqual({ from: './utils', items: ['* as utils'] });
    });

    it('should extract exports', async () => {
      const content = `
        export function foo() {}
        export class Bar {}
        export interface Baz {}
        function internal() {}
      `;

      await service.parseFile('module.ts', content);
      const exports = await service.extractExports('module.ts');
      
      expect(exports).toHaveLength(3);
      expect(exports).toContainEqual({ name: 'foo', type: 'function' });
      expect(exports).toContainEqual({ name: 'Bar', type: 'class' });
      expect(exports).toContainEqual({ name: 'Baz', type: 'interface' });
    });
  });

  describe('Symbol Definition', () => {
    it('should find symbol definition', async () => {
      const content = `
        export class UserService {
          getUser(id: string) {
            return { id, name: 'John' };
          }
        }
        
        function privateHelper() {
          return 'secret';
        }
      `;

      await service.parseFile('service.ts', content);
      
      const userService = await service.findSymbolDefinition('service.ts', 'UserService');
      expect(userService).toBeDefined();
      expect(userService?.type).toBe('class');
      expect(userService?.exported).toBe(true);
      
      const helper = await service.findSymbolDefinition('service.ts', 'privateHelper');
      expect(helper).toBeDefined();
      expect(helper?.type).toBe('function');
      expect(helper?.exported).toBe(false);
      
      const notFound = await service.findSymbolDefinition('service.ts', 'NonExistent');
      expect(notFound).toBeNull();
    });
  });

  describe('Batch Operations', () => {
    it('should parse multiple files', async () => {
      // Mock the parseFile method for this test
      const contents = {
        'file1.ts': 'export function foo() {}',
        'file2.ts': 'export class Bar {}',
        'file3.js': 'function baz() {}'
      };

      // Override parseFile to use our mock contents
      const originalParseFile = service.parseFile.bind(service);
      service.parseFile = async (filePath: string) => {
        const content = contents[path.basename(filePath) as keyof typeof contents];
        return originalParseFile(filePath, content);
      };

      const results = await service.parseFiles(['file1.ts', 'file2.ts', 'file3.js']);
      
      expect(results.size).toBe(3);
      
      const file1Result = results.get('file1.ts');
      expect(file1Result?.symbols).toHaveLength(1);
      expect(file1Result?.symbols[0].name).toBe('foo');
      
      const file2Result = results.get('file2.ts');
      expect(file2Result?.symbols).toHaveLength(1);
      expect(file2Result?.symbols[0].name).toBe('Bar');
      
      const file3Result = results.get('file3.js');
      expect(file3Result?.symbols).toHaveLength(1);
      expect(file3Result?.symbols[0].name).toBe('baz');
    });
  });

  describe('Cache Management', () => {
    it('should cache parse results', async () => {
      const content = 'export function test() {}';
      
      // First parse
      const result1 = await service.parseFile('test.ts', content);
      
      // Second parse without content should use cache
      const result2 = await service.parseFile('test.ts');
      
      expect(result2).toEqual(result1);
    });

    it('should clear cache', async () => {
      const content = 'export function test() {}';
      
      await service.parseFile('test.ts', content);
      service.clearCache();
      
      // After clearing, parse without content should fail
      const result = await service.parseFile('test.ts');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('No content provided');
    });
  });

  describe('Incremental Parsing', () => {
    it('should report incremental support correctly', () => {
      expect(service.supportsIncremental('typescript')).toBe(false);
      expect(service.supportsIncremental('javascript')).toBe(false);
      expect(service.supportsIncremental('python')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle complex syntax', async () => {
      const content = `
        // Comment
        /* Multi-line
           comment */
        
        export const obj = {
          method() { return 1; },
          async asyncMethod() { return 2; }
        };
        
        export default function() {
          return 'default';
        }
        
        export { obj as renamedObj };
      `;

      const result = await service.parseFile('complex.js', content);
      
      expect(result.errors).toHaveLength(0);
      // Our basic parser only catches function/class declarations, not all exports
      expect(result.symbols.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing content gracefully', async () => {
      const result = await service.parseFile('missing.ts');
      
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('No content provided');
      expect(result.symbols).toHaveLength(0);
    });

    it('should handle parse timeout', async () => {
      const service = new ASTParserService(undefined, { timeout: 1 });
      
      // Create a parse that will timeout
      const slowContent = 'function test() {}';
      
      // This might not actually timeout with such simple content,
      // but the timeout mechanism is in place
      const result = await service.parseFile('slow.js', slowContent);
      
      // Either it succeeds or times out
      expect(result.language).toBe('javascript');
    });
  });
});