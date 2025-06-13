/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PythonPlugin, createPythonPlugin } from './python-plugin.js';
import { Symbol } from '../services/ast-parser.js';

describe('PythonPlugin', () => {
  let plugin: PythonPlugin;

  beforeEach(() => {
    plugin = createPythonPlugin();
  });

  describe('basic parsing functionality', () => {
    it('should parse a simple Python file', async () => {
      const content = `
def hello_world():
    print("Hello, World!")

class MyClass:
    def __init__(self):
        self.value = 42
    
    def get_value(self):
        return self.value

CONSTANT = "test"
variable = 123
`;

      const result = await plugin.parse(content, '/test/example.py');

      expect(result.language).toBe('python');
      expect(result.errors).toHaveLength(0);
      expect(result.symbols).toHaveLength(6); // hello_world, MyClass, __init__, get_value, CONSTANT, variable
      expect(result.ast).toBeDefined();
    });

    it('should detect syntax errors', async () => {
      const content = `
def invalid_function(
    print("Missing closing parenthesis")

if True
    print("Missing colon")
`;

      const result = await plugin.parse(content, '/test/invalid.py');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.message.includes('parenthesis'))).toBe(true);
      expect(result.errors.some(e => e.message.includes('colon'))).toBe(true);
    });
  });

  describe('import parsing', () => {
    it('should parse simple imports', async () => {
      const content = `
import os
import sys
import json as js
`;

      const result = await plugin.parse(content, '/test/imports.py');

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0]).toEqual({ from: 'os', items: ['os'] });
      expect(result.imports[1]).toEqual({ from: 'sys', items: ['sys'] });
      expect(result.imports[2]).toEqual({ from: 'json', items: ['js'] });
    });

    it('should parse from imports', async () => {
      const content = `
from os import path
from sys import argv, exit
from json import loads as json_loads, dumps
from collections import *
`;

      const result = await plugin.parse(content, '/test/from_imports.py');

      expect(result.imports).toHaveLength(4);
      expect(result.imports[0]).toEqual({ from: 'os', items: ['path'] });
      expect(result.imports[1]).toEqual({ from: 'sys', items: ['argv', 'exit'] });
      expect(result.imports[2]).toEqual({ from: 'json', items: ['json_loads', 'dumps'] });
      expect(result.imports[3]).toEqual({ from: 'collections', items: ['*'] });
    });

    it('should parse complex imports with aliases', async () => {
      const content = `
import numpy as np
from typing import Dict, List, Optional
from .utils import helper_function
from ..models import BaseModel
`;

      const result = await plugin.parse(content, '/test/complex_imports.py');

      expect(result.imports).toHaveLength(4);
      expect(result.imports[0]).toEqual({ from: 'numpy', items: ['np'] });
      expect(result.imports[1]).toEqual({ from: 'typing', items: ['Dict', 'List', 'Optional'] });
      expect(result.imports[2]).toEqual({ from: '.utils', items: ['helper_function'] });
      expect(result.imports[3]).toEqual({ from: '..models', items: ['BaseModel'] });
    });
  });

  describe('function parsing', () => {
    it('should parse function definitions', async () => {
      const content = `
def simple_function():
    pass

async def async_function():
    await something()

def function_with_params(a, b, c=None):
    return a + b

def _private_function():
    pass
`;

      const result = await plugin.parse(content, '/test/functions.py');

      const functions = result.symbols.filter(s => s.type === 'function');
      expect(functions).toHaveLength(4);

      const simpleFunc = functions.find(f => f.name === 'simple_function');
      expect(simpleFunc).toBeDefined();
      expect(simpleFunc!.exported).toBe(true);
      expect(simpleFunc!.scope).toBe('module');

      const privateFunc = functions.find(f => f.name === '_private_function');
      expect(privateFunc).toBeDefined();
      expect(privateFunc!.exported).toBe(false);
    });

    it('should parse method definitions in classes', async () => {
      const content = `
class TestClass:
    def __init__(self, value):
        self.value = value
    
    def public_method(self):
        return self.value
    
    def _private_method(self):
        return None
    
    @property
    def value_property(self):
        return self.value
`;

      const result = await plugin.parse(content, '/test/class_methods.py');

      const classMethods = result.symbols.filter(s => s.type === 'function' && s.scope === 'class');
      expect(classMethods).toHaveLength(4);

      const initMethod = classMethods.find(m => m.name === '__init__');
      expect(initMethod).toBeDefined();
      expect(initMethod!.exported).toBe(false); // Dunder methods are not exported

      const publicMethod = classMethods.find(m => m.name === 'public_method');
      expect(publicMethod).toBeDefined();
      expect(publicMethod!.exported).toBe(true);
    });
  });

  describe('class parsing', () => {
    it('should parse class definitions', async () => {
      const content = `
class SimpleClass:
    pass

class InheritedClass(BaseClass):
    def method(self):
        pass

class MultipleInheritance(Base1, Base2):
    pass

class _PrivateClass:
    pass
`;

      const result = await plugin.parse(content, '/test/classes.py');

      const classes = result.symbols.filter(s => s.type === 'class');
      expect(classes).toHaveLength(4);

      const simpleClass = classes.find(c => c.name === 'SimpleClass');
      expect(simpleClass).toBeDefined();
      expect(simpleClass!.exported).toBe(true);
      expect(simpleClass!.scope).toBe('module');

      const privateClass = classes.find(c => c.name === '_PrivateClass');
      expect(privateClass).toBeDefined();
      expect(privateClass!.exported).toBe(false);
    });
  });

  describe('variable parsing', () => {
    it('should parse module-level variables', async () => {
      const content = `
CONSTANT = "test"
variable = 123
_private_var = "private"
dict_var = {"key": "value"}
list_var = [1, 2, 3]

# Type annotations
typed_var: str = "hello"
optional_var: Optional[int] = None
`;

      const result = await plugin.parse(content, '/test/variables.py');

      const variables = result.symbols.filter(s => s.type === 'variable');
      expect(variables.length).toBeGreaterThanOrEqual(5);

      const constant = variables.find(v => v.name === 'CONSTANT');
      expect(constant).toBeDefined();
      expect(constant!.exported).toBe(true);

      const privateVar = variables.find(v => v.name === '_private_var');
      expect(privateVar).toBeDefined();
      expect(privateVar!.exported).toBe(false);
    });
  });

  describe('decorator handling', () => {
    it('should handle decorators in function parsing', async () => {
      const content = `
@decorator
def decorated_function():
    pass

@staticmethod
def static_method():
    pass

@classmethod
def class_method(cls):
    pass

@property
def property_method(self):
    return self._value
`;

      const result = await plugin.parse(content, '/test/decorators.py');

      const functions = result.symbols.filter(s => s.type === 'function');
      expect(functions).toHaveLength(4);

      // All decorated functions should be parsed correctly
      expect(functions.map(f => f.name)).toContain('decorated_function');
      expect(functions.map(f => f.name)).toContain('static_method');
      expect(functions.map(f => f.name)).toContain('class_method');
      expect(functions.map(f => f.name)).toContain('property_method');
    });
  });

  describe('comprehensions and advanced syntax', () => {
    it('should handle list comprehensions', async () => {
      const content = `
numbers = [1, 2, 3, 4, 5]
squares = [x**2 for x in numbers]
filtered = [x for x in numbers if x > 2]

# Dict comprehension
square_dict = {x: x**2 for x in numbers}

# Set comprehension
unique_squares = {x**2 for x in numbers}
`;

      const result = await plugin.parse(content, '/test/comprehensions.py');

      expect(result.errors).toHaveLength(0);
      const variables = result.symbols.filter(s => s.type === 'variable');
      expect(variables.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('exports extraction', () => {
    it('should extract public symbols as exports', async () => {
      const content = `
def public_function():
    pass

def _private_function():
    pass

class PublicClass:
    pass

class _PrivateClass:
    pass

PUBLIC_CONSTANT = "test"
_private_constant = "private"
`;

      const result = await plugin.parse(content, '/test/exports.py');

      expect(result.exports).toHaveLength(3);
      expect(result.exports.map(e => e.name)).toContain('public_function');
      expect(result.exports.map(e => e.name)).toContain('PublicClass');
      expect(result.exports.map(e => e.name)).toContain('PUBLIC_CONSTANT');
      expect(result.exports.map(e => e.name)).not.toContain('_private_function');
      expect(result.exports.map(e => e.name)).not.toContain('_PrivateClass');
      expect(result.exports.map(e => e.name)).not.toContain('_private_constant');
    });
  });

  describe('incremental parsing', () => {
    it('should support incremental parsing flag', () => {
      expect(plugin.supportsIncremental()).toBe(false);
    });

    it('should fall back to full parsing for incremental', async () => {
      const content = `
def test_function():
    pass
`;

      const result1 = await plugin.parse(content, '/test/incremental.py');
      const result2 = await plugin.parseIncremental(content, '/test/incremental.py');

      expect(result1.symbols).toEqual(result2.symbols);
      expect(result1.imports).toEqual(result2.imports);
    });
  });

  describe('indentation validation', () => {
    it('should detect indentation errors', async () => {
      const content = `
def function():
    if True:
        print("correct")
      print("incorrect indentation")
`;

      const result = await plugin.parse(content, '/test/indentation.py');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.message.includes('IndentationError'))).toBe(true);
    });

    it('should handle mixed indentation styles', async () => {
      const content = `
def function():
    if True:
\t\tprint("tab indented")
    print("space indented")
`;

      const result = await plugin.parse(content, '/test/mixed_indent.py');

      // Should parse without major errors (though it's bad style)
      expect(result.symbols.filter(s => s.type === 'function')).toHaveLength(1);
    });
  });

  describe('string handling', () => {
    it('should handle various string types', async () => {
      const content = `
single_quote = 'single'
double_quote = "double"
triple_single = '''triple single'''
triple_double = """triple double"""
f_string = f"formatted {variable}"
raw_string = r"raw string \\n"
`;

      const result = await plugin.parse(content, '/test/strings.py');

      expect(result.errors).toHaveLength(0);
      const variables = result.symbols.filter(s => s.type === 'variable');
      expect(variables.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('complex syntax patterns', () => {
    it('should handle context managers', async () => {
      const content = `
def function_with_context():
    with open('file.txt') as f:
        content = f.read()
    
    with contextmanager() as cm:
        process(cm)
`;

      const result = await plugin.parse(content, '/test/context.py');

      expect(result.errors).toHaveLength(0);
      expect(result.symbols.filter(s => s.type === 'function')).toHaveLength(1);
    });

    it('should handle lambda functions', async () => {
      const content = `
square = lambda x: x**2
add = lambda a, b: a + b
filter_func = lambda items: [x for x in items if x > 0]
`;

      const result = await plugin.parse(content, '/test/lambdas.py');

      expect(result.errors).toHaveLength(0);
      const variables = result.symbols.filter(s => s.type === 'variable');
      expect(variables.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('type annotations', () => {
    it('should handle type annotations', async () => {
      const content = `
from typing import List, Dict, Optional, Union

def typed_function(
    name: str,
    age: int,
    items: List[str],
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Union[str, int]]:
    return {"name": name, "age": age}

class TypedClass:
    def __init__(self, value: int) -> None:
        self.value: int = value
    
    def get_value(self) -> int:
        return self.value
`;

      const result = await plugin.parse(content, '/test/typed.py');

      expect(result.errors).toHaveLength(0);
      expect(result.symbols.filter(s => s.type === 'function')).toHaveLength(3);
      expect(result.symbols.filter(s => s.type === 'class')).toHaveLength(1);
    });
  });

  describe('async/await syntax', () => {
    it('should handle async functions and await', async () => {
      const content = `
import asyncio

async def async_function():
    await asyncio.sleep(1)
    return "done"

async def fetch_data(url: str):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.text()

class AsyncClass:
    async def async_method(self):
        result = await async_function()
        return result
`;

      const result = await plugin.parse(content, '/test/async.py');

      expect(result.errors).toHaveLength(0);
      const functions = result.symbols.filter(s => s.type === 'function');
      expect(functions).toHaveLength(3);
      expect(functions.map(f => f.name)).toContain('async_function');
      expect(functions.map(f => f.name)).toContain('fetch_data');
      expect(functions.map(f => f.name)).toContain('async_method');
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle empty files', async () => {
      const result = await plugin.parse('', '/test/empty.py');

      expect(result.language).toBe('python');
      expect(result.errors).toHaveLength(0);
      expect(result.symbols).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
    });

    it('should handle files with only comments', async () => {
      const content = `
# This is a comment
# Another comment
"""
This is a docstring
"""
`;

      const result = await plugin.parse(content, '/test/comments.py');

      expect(result.errors).toHaveLength(0);
      expect(result.symbols).toHaveLength(0);
    });

    it('should handle malformed syntax gracefully', async () => {
      const content = `
def function(
    # Missing closing parenthesis and colon

class ClassWithoutColon
    pass

if True
    print("missing colon")
`;

      const result = await plugin.parse(content, '/test/malformed.py');

      // Should capture errors but not crash
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.language).toBe('python');
    });
  });

  describe('module import resolution', () => {
    it('should identify standard library modules', async () => {
      const content = `
import os
import sys
import json
import datetime
from pathlib import Path
from collections import defaultdict
`;

      const result = await plugin.parse(content, '/test/stdlib.py');

      expect(result.imports).toHaveLength(6);
      
      // Test that we can identify these as standard library
      // (This would be used in import resolution)
      expect(result.errors).toHaveLength(0);
    });

    it('should handle relative imports', async () => {
      const content = `
from . import sibling_module
from .utils import helper
from ..parent import parent_function
from ...grandparent import grand_function
`;

      const result = await plugin.parse(content, '/test/relative.py');

      expect(result.imports).toHaveLength(4);
      expect(result.imports[0]).toEqual({ from: '.', items: ['sibling_module'] });
      expect(result.imports[1]).toEqual({ from: '.utils', items: ['helper'] });
      expect(result.imports[2]).toEqual({ from: '..parent', items: ['parent_function'] });
      expect(result.imports[3]).toEqual({ from: '...grandparent', items: ['grand_function'] });
    });
  });
});