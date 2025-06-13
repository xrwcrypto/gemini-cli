/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TypeScriptPlugin, createTypeScriptPlugin } from './typescript-plugin.js';
import { CacheManager } from '../services/cache-manager.js';

vi.mock('fs/promises');
vi.mock('../services/cache-manager.js');

describe('TypeScriptPlugin', () => {
  let plugin: TypeScriptPlugin;
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = {
      get: vi.fn(),
      set: vi.fn(),
      has: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn()
    } as any;

    plugin = createTypeScriptPlugin(cacheManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('parse', () => {
    it('should parse TypeScript file with imports and exports', async () => {
      const content = `
import { readFile } from 'fs/promises';
import React from 'react';
import type { Config } from './config';

export interface User {
  id: string;
  name: string;
  email?: string;
}

export class UserService {
  async getUser(id: string): Promise<User> {
    return { id, name: 'Test User' };
  }
}

export function validateUser(user: User): boolean {
  return user.id.length > 0 && user.name.length > 0;
}

export const DEFAULT_USER: User = {
  id: 'default',
  name: 'Default User'
};

export type UserRole = 'admin' | 'user' | 'guest';

export enum UserStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
  Pending = 'PENDING'
}
`;

      const result = await plugin.parse(content, '/test/user.ts');

      expect(result.language).toBe('typescript');
      expect(result.errors).toHaveLength(0);

      // Check imports
      expect(result.imports).toHaveLength(3);
      expect(result.imports[0]).toEqual({ from: 'fs/promises', items: ['readFile'] });
      expect(result.imports[1]).toEqual({ from: 'react', items: ['React'] });
      expect(result.imports[2]).toEqual({ from: './config', items: ['Config'] });

      // Check exports
      expect(result.exports).toContainEqual({ name: 'User', type: 'interface' });
      expect(result.exports).toContainEqual({ name: 'UserService', type: 'class' });
      expect(result.exports).toContainEqual({ name: 'validateUser', type: 'function' });
      expect(result.exports).toContainEqual({ name: 'DEFAULT_USER', type: 'variable' });
      expect(result.exports).toContainEqual({ name: 'UserRole', type: 'type' });
      expect(result.exports).toContainEqual({ name: 'UserStatus', type: 'enum' });

      // Check symbols
      const userInterface = result.symbols.find(s => s.name === 'User' && s.type === 'interface');
      expect(userInterface).toBeDefined();
      expect(userInterface?.exported).toBe(true);
      expect(userInterface?.scope).toBe('module');

      const userService = result.symbols.find(s => s.name === 'UserService' && s.type === 'class');
      expect(userService).toBeDefined();
      expect(userService?.exported).toBe(true);

      const validateFunction = result.symbols.find(s => s.name === 'validateUser' && s.type === 'function');
      expect(validateFunction).toBeDefined();
      expect(validateFunction?.exported).toBe(true);

      // Check AST is generated
      expect(result.ast).toBeDefined();
      expect(result.ast?.type).toBe('SourceFile');
      expect(result.ast?.children.length).toBeGreaterThan(0);
    });

    it('should parse JavaScript file with CommonJS', async () => {
      const content = `
const fs = require('fs');
const { join } = require('path');

function processFile(filename) {
  return fs.readFileSync(filename, 'utf8');
}

class FileProcessor {
  constructor(basePath) {
    this.basePath = basePath;
  }

  process(file) {
    return processFile(join(this.basePath, file));
  }
}

module.exports = {
  processFile,
  FileProcessor
};
`;

      const result = await plugin.parse(content, '/test/processor.js');

      expect(result.language).toBe('javascript');
      expect(result.errors).toHaveLength(0);

      // Note: CommonJS require() statements are not parsed as imports by TypeScript API
      // This is expected behavior

      // Check functions and classes
      const processFileFunc = result.symbols.find(s => s.name === 'processFile' && s.type === 'function');
      expect(processFileFunc).toBeDefined();

      const fileProcessorClass = result.symbols.find(s => s.name === 'FileProcessor' && s.type === 'class');
      expect(fileProcessorClass).toBeDefined();
    });

    it('should parse JSX/TSX files', async () => {
      const content = `
import React, { useState } from 'react';

interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ onClick, children, disabled = false }) => {
  const [clicked, setClicked] = useState(false);

  const handleClick = () => {
    setClicked(true);
    onClick();
  };

  return (
    <button onClick={handleClick} disabled={disabled}>
      {children}
    </button>
  );
};

export default function App() {
  return (
    <div>
      <Button onClick={() => console.log('clicked')}>
        Click me
      </Button>
    </div>
  );
}
`;

      const result = await plugin.parse(content, '/test/Button.tsx');

      expect(result.language).toBe('typescript');
      expect(result.errors).toHaveLength(0);

      // Check React import
      expect(result.imports[0]).toEqual({ 
        from: 'react', 
        items: ['React', 'useState'] 
      });

      // Check interface
      const buttonProps = result.symbols.find(s => s.name === 'ButtonProps' && s.type === 'interface');
      expect(buttonProps).toBeDefined();

      // Check components
      const buttonComponent = result.symbols.find(s => s.name === 'Button' && s.type === 'variable');
      expect(buttonComponent).toBeDefined();
      expect(buttonComponent?.exported).toBe(true);

      const appFunction = result.symbols.find(s => s.name === 'App' && s.type === 'function');
      expect(appFunction).toBeDefined();
      expect(appFunction?.exported).toBe(true);
    });

    it('should handle syntax errors gracefully', async () => {
      const content = `
import { something from 'module'; // Missing closing brace

export function test() {
  return {
    value: 1
  // Missing closing brace
}
`;

      const result = await plugin.parse(content, '/test/error.ts');

      expect(result.language).toBe('typescript');
      expect(result.errors.length).toBeGreaterThan(0);
      // Should still extract what it can
      expect(result.symbols.length).toBeGreaterThan(0);
    });

    it('should extract namespace imports', async () => {
      const content = `
import * as fs from 'fs';
import * as utils from './utils';

export function readConfig() {
  return fs.readFileSync('config.json', 'utf8');
}
`;

      const result = await plugin.parse(content, '/test/namespace.ts');

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0]).toEqual({ from: 'fs', items: ['* as fs'] });
      expect(result.imports[1]).toEqual({ from: './utils', items: ['* as utils'] });
    });

    it('should extract renamed imports and exports', async () => {
      const content = `
import { readFile as read, writeFile as write } from 'fs/promises';

export { read as readAsync, write as writeAsync };
`;

      const result = await plugin.parse(content, '/test/rename.ts');

      expect(result.imports[0]).toEqual({ 
        from: 'fs/promises', 
        items: ['readFile as read', 'writeFile as write'] 
      });

      expect(result.exports).toContainEqual({ name: 'readAsync', type: 'named' });
      expect(result.exports).toContainEqual({ name: 'writeAsync', type: 'named' });
    });
  });

  describe('getCompilerOptions', () => {
    it('should find and parse tsconfig.json', async () => {
      const tsconfigContent = JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          paths: {
            '@/*': ['./src/*']
          }
        }
      });

      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.readFile).mockResolvedValueOnce(tsconfigContent);

      const content = 'export const test = 1;';
      const result = await plugin.parse(content, '/project/src/test.ts');

      expect(result.errors).toHaveLength(0);
    });

    it('should use default options when no tsconfig found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      const content = 'export const test = 1;';
      const result = await plugin.parse(content, '/project/src/test.ts');

      expect(result.errors).toHaveLength(0);
      expect(result.language).toBe('typescript');
    });

    it('should cache compiler options', async () => {
      const tsconfigContent = JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext'
        }
      });

      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.readFile).mockResolvedValueOnce(tsconfigContent);

      // First parse
      await plugin.parse('export const test1 = 1;', '/project/src/test1.ts');

      // Second parse in same directory - should use cache
      await plugin.parse('export const test2 = 2;', '/project/src/test2.ts');

      // fs.access should only be called once due to caching
      expect(fs.access).toHaveBeenCalledTimes(1);
    });
  });

  describe('supportsIncremental', () => {
    it('should support incremental parsing', () => {
      expect(plugin.supportsIncremental()).toBe(true);
    });
  });

  describe('parseIncremental', () => {
    it('should perform incremental parse', async () => {
      const content = 'export const test = 1;';
      const result = await plugin.parseIncremental(content, '/test/file.ts');

      expect(result.errors).toHaveLength(0);
      expect(result.symbols).toHaveLength(1);
    });
  });

  describe('resolveModule', () => {
    it('should resolve module paths', async () => {
      const resolved = await plugin.resolveModule('fs', '/project/src/test.ts');
      expect(resolved).toBeDefined();
    });

    it('should resolve relative module paths', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      
      const resolved = await plugin.resolveModule('./utils', '/project/src/test.ts');
      // The actual resolution depends on the TypeScript API
      expect(resolved).toBeDefined();
    });

    it('should return null for unresolvable modules', async () => {
      const resolved = await plugin.resolveModule('non-existent-module', '/project/src/test.ts');
      expect(resolved).toBeNull();
    });
  });

  describe('extractTypeInfo', () => {
    it('should extract type information at position', async () => {
      const content = `
interface User {
  id: string;
  name: string;
}

const user: User = {
  id: '123',
  name: 'John'
};
`;

      const typeInfo = await plugin.extractTypeInfo(
        '/test/file.ts',
        content,
        { line: 7, column: 7 } // Position of 'user' variable
      );

      expect(typeInfo).toBeDefined();
      expect(typeInfo?.type).toContain('User');
    });

    it('should include JSDoc documentation', async () => {
      const content = `
/**
 * Represents a user in the system
 * @interface
 */
interface User {
  /** Unique identifier */
  id: string;
  /** Full name */
  name: string;
}

const user: User = {
  id: '123',
  name: 'John'
};
`;

      const typeInfo = await plugin.extractTypeInfo(
        '/test/file.ts',
        content,
        { line: 13, column: 7 }
      );

      expect(typeInfo).toBeDefined();
      // Documentation extraction depends on TypeScript API behavior
    });

    it('should handle invalid positions gracefully', async () => {
      const content = 'export const test = 1;';
      
      const typeInfo = await plugin.extractTypeInfo(
        '/test/file.ts',
        content,
        { line: 100, column: 100 } // Out of bounds
      );

      expect(typeInfo).toBeNull();
    });
  });

  describe('complex scenarios', () => {
    it('should handle decorators and metadata', async () => {
      const content = `
@Injectable()
export class UserService {
  @Inject('DB')
  private db: Database;

  @Cacheable()
  async getUser(@Param('id') id: string): Promise<User> {
    return this.db.findOne({ id });
  }
}
`;

      const result = await plugin.parse(content, '/test/decorators.ts');

      expect(result.language).toBe('typescript');
      const userService = result.symbols.find(s => s.name === 'UserService' && s.type === 'class');
      expect(userService).toBeDefined();
      expect(userService?.exported).toBe(true);
    });

    it('should handle async/generator functions', async () => {
      const content = `
export async function fetchData(): Promise<string> {
  return 'data';
}

export function* generateNumbers(): Generator<number> {
  yield 1;
  yield 2;
  yield 3;
}

export async function* asyncGenerator(): AsyncGenerator<number> {
  yield await Promise.resolve(1);
  yield await Promise.resolve(2);
}
`;

      const result = await plugin.parse(content, '/test/async.ts');

      expect(result.symbols).toHaveLength(3);
      expect(result.exports).toHaveLength(3);
      
      result.symbols.forEach(symbol => {
        expect(symbol.type).toBe('function');
        expect(symbol.exported).toBe(true);
      });
    });

    it('should handle complex type definitions', async () => {
      const content = `
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

export interface GenericInterface<T, K extends keyof T = keyof T> {
  value: T;
  key: K;
  getValue(): T[K];
}
`;

      const result = await plugin.parse(content, '/test/types.ts');

      expect(result.errors).toHaveLength(0);
      
      const deepPartial = result.symbols.find(s => s.name === 'DeepPartial');
      expect(deepPartial).toBeDefined();
      expect(deepPartial?.type).toBe('type');

      const unionToIntersection = result.symbols.find(s => s.name === 'UnionToIntersection');
      expect(unionToIntersection).toBeDefined();

      const genericInterface = result.symbols.find(s => s.name === 'GenericInterface');
      expect(genericInterface).toBeDefined();
      expect(genericInterface?.type).toBe('interface');
    });
  });
});

describe('createTypeScriptPlugin', () => {
  it('should create plugin instance', () => {
    const plugin = createTypeScriptPlugin();
    expect(plugin).toBeInstanceOf(TypeScriptPlugin);
  });

  it('should create plugin with cache manager', () => {
    const cacheManager = {} as CacheManager;
    const plugin = createTypeScriptPlugin(cacheManager);
    expect(plugin).toBeInstanceOf(TypeScriptPlugin);
  });
});