/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RequestParser } from './request-parser.js';
import {
  FileOperationRequest,
  AnalyzeOperation,
  EditOperation,
  CreateOperation,
  DeleteOperation,
  ValidateOperation,
} from './file-operations-types.js';
import { ValidationError, DependencyError } from './file-operations-errors.js';
import path from 'path';

describe('RequestParser', () => {
  let parser: RequestParser;
  const rootDirectory = '/test/root';

  beforeEach(() => {
    parser = new RequestParser(rootDirectory);
  });

  describe('parseRequest', () => {
    it('should accept valid request with single operation', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe('analyze');
    });

    it('should accept valid request with multiple operations', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'analyze1',
            type: 'analyze',
            paths: ['src/**/*.ts'],
          },
          {
            id: 'edit1',
            type: 'edit',
            edits: [{
              file: 'src/index.ts',
              changes: [{
                type: 'find-replace',
                find: 'old',
                replace: 'new',
              }],
            }],
            dependsOn: ['analyze1'],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(2);
    });

    it('should reject request with no operations', async () => {
      const request: FileOperationRequest = {
        operations: [],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('At least one operation must be specified');
    });

    it('should reject request with invalid schema', async () => {
      const request = {
        // Missing operations field
        options: {},
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('schema validation');
    });

    it('should reject request with duplicate operation IDs', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'op1',
            type: 'analyze',
            paths: ['file1.ts'],
          },
          {
            id: 'op1', // Duplicate ID
            type: 'analyze',
            paths: ['file2.ts'],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Duplicate operation ID: op1');
    });
  });

  describe('analyze operation validation', () => {
    it('should accept valid analyze operation', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
          extract: ['functions', 'classes'],
          search: {
            pattern: 'TODO',
            type: 'literal',
            caseSensitive: false,
            contextLines: 2,
          },
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should reject analyze operation without paths', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: [],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify at least one path');
    });

    it('should reject analyze operation with empty search pattern', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
          search: {
            pattern: '',
            type: 'literal',
          },
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Search pattern cannot be empty');
    });

    it('should reject analyze operation with invalid regex pattern', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
          search: {
            pattern: '[invalid(regex',
            type: 'regex',
          },
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid regex pattern');
    });

    it('should reject analyze operation with invalid context lines', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
          search: {
            pattern: 'test',
            type: 'literal',
            contextLines: -1,
          },
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Context lines must be between 0 and 100');
    });

    it('should reject analyze operation with empty patterns', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
          patterns: ['valid', '', 'another'],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Pattern at index 1 cannot be empty');
    });

    it('should reject analyze operation with invalid extract type', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
          extract: ['functions', 'invalid-type' as any],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid extract type: invalid-type');
    });
  });

  describe('edit operation validation', () => {
    it('should accept valid edit operation', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [
              {
                type: 'find-replace',
                find: 'old',
                replace: 'new',
                replaceAll: true,
              },
              {
                type: 'line',
                line: 10,
                operation: 'insert',
                content: '// New comment',
              },
            ],
          }],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should reject edit operation without edits', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify at least one edit');
    });

    it('should reject edit without file', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: '',
            changes: [{
              type: 'find-replace',
              find: 'old',
              replace: 'new',
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify a file');
    });

    it('should reject edit without changes', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify at least one change');
    });

    // Find-replace change validation
    it('should reject find-replace without find field', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'find-replace',
              find: '',
              replace: 'new',
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify \'find\'');
    });

    it('should reject find-replace with invalid regex', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'find-replace',
              find: '[invalid(regex',
              replace: 'new',
              regex: true,
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid regex');
    });

    // Line change validation
    it('should reject line change with invalid line number', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'line',
              line: 0,
              operation: 'insert',
              content: 'test',
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify a positive line number');
    });

    it('should reject line change with invalid operation', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'line',
              line: 1,
              operation: 'invalid' as any,
              content: 'test',
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid line operation');
    });

    it('should reject non-delete line change without content', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'line',
              line: 1,
              operation: 'insert',
              // Missing content
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify content');
    });

    // Position change validation
    it('should reject position change with negative start', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'position',
              start: -1,
              end: 10,
              content: 'test',
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('start must be non-negative');
    });

    it('should reject position change with start > end', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'position',
              start: 20,
              end: 10,
              content: 'test',
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('start must not exceed end');
    });

    // AST change validation
    it('should reject AST change without query', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'ast',
              query: '',
              transform: {
                type: 'rename',
                params: { newName: 'test' },
              },
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify a query');
    });

    it('should reject AST change with invalid transform type', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'edit',
          edits: [{
            file: 'src/index.ts',
            changes: [{
              type: 'ast',
              query: 'FunctionDeclaration',
              transform: {
                type: 'invalid' as any,
                params: {},
              },
            }],
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid AST transform type');
    });
  });

  describe('create operation validation', () => {
    it('should accept valid create operation', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: 'src/new-file.ts',
            content: 'export const hello = "world";',
            mode: '644',
          }],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should accept create operation with template', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: 'src/component.tsx',
            template: 'react-component',
            templateVars: {
              name: 'MyComponent',
            },
          }],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should reject create operation without files', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify at least one file');
    });

    it('should reject create operation without path', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: '',
            content: 'test',
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify a path');
    });

    it('should reject create operation without content or template', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: 'src/file.ts',
            // No content or template
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify either content or template');
    });

    it('should reject create operation with invalid mode', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: 'src/file.ts',
            content: 'test',
            mode: 'invalid',
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid file mode');
    });
  });

  describe('delete operation validation', () => {
    it('should accept valid delete operation', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'delete',
          paths: ['src/old-file.ts', 'dist/**/*.js'],
          removeEmptyDirs: true,
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should reject delete operation without paths', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'delete',
          paths: [],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify at least one path');
    });
  });

  describe('validate operation validation', () => {
    it('should accept valid validate operation with commands', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'validate',
          commands: ['npm test', 'npm run lint'],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should accept valid validate operation with files and checks', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'validate',
          files: ['src/**/*.ts'],
          checks: ['syntax', 'typecheck'],
          autoFix: true,
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should reject validate operation without any validation method', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'validate',
          // No commands, files, or checks
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('must specify at least one of: commands, files, or checks');
    });

    it('should reject validate operation with invalid check type', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'validate',
          checks: ['syntax', 'invalid-check' as any],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid validation check: invalid-check');
    });

    it('should reject validate operation with empty command', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'validate',
          commands: ['npm test', '', 'npm run build'],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Command at index 1 cannot be empty');
    });
  });

  describe('path validation', () => {
    it('should accept paths within root directory', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: 'src/file.ts',
            content: 'test',
          }],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should accept absolute paths within root directory', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: path.join(rootDirectory, 'src/file.ts'),
            content: 'test',
          }],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should accept glob patterns', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts', 'test/**/*.spec.ts'],
        }],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(1);
    });

    it('should reject paths with null bytes', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'create',
          files: [{
            path: 'src/file\0.ts',
            content: 'test',
          }],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('dangerous path pattern');
    });

    it('should reject paths accessing system directories', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'delete',
          paths: ['/dev/null'],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('dangerous path pattern');
    });

    it('should reject paths with multiple parent traversals', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['../../sensitive/file.txt'],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('dangerous path pattern');
    });
  });

  describe('dependency validation', () => {
    it('should accept valid dependencies', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'op1',
            type: 'analyze',
            paths: ['src/**/*.ts'],
          },
          {
            id: 'op2',
            type: 'edit',
            edits: [{
              file: 'src/index.ts',
              changes: [{
                type: 'find-replace',
                find: 'old',
                replace: 'new',
              }],
            }],
            dependsOn: ['op1'],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      expect(result.operations).toHaveLength(2);
    });

    it('should reject non-existent dependencies', async () => {
      const request: FileOperationRequest = {
        operations: [{
          id: 'op1',
          type: 'analyze',
          paths: ['src/**/*.ts'],
          dependsOn: ['non-existent'],
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(DependencyError);
      await expect(parser.parseRequest(request)).rejects.toThrow('depends on non-existent operation');
    });

    it('should reject circular dependencies', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'op1',
            type: 'analyze',
            paths: ['file1.ts'],
            dependsOn: ['op2'],
          },
          {
            id: 'op2',
            type: 'analyze',
            paths: ['file2.ts'],
            dependsOn: ['op1'],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(DependencyError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Circular dependencies detected');
    });

    it('should reject editing file that will be deleted', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'delete1',
            type: 'delete',
            paths: ['src/file.ts'],
          },
          {
            id: 'edit1',
            type: 'edit',
            edits: [{
              file: 'src/file.ts',
              changes: [{
                type: 'find-replace',
                find: 'old',
                replace: 'new',
              }],
            }],
            dependsOn: ['delete1'],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(DependencyError);
      await expect(parser.parseRequest(request)).rejects.toThrow('attempts to edit file');
    });

    it('should reject analyzing file that will be deleted', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'delete1',
            type: 'delete',
            paths: ['src/file.ts'],
          },
          {
            id: 'analyze1',
            type: 'analyze',
            paths: ['src/file.ts'],
            dependsOn: ['delete1'],
          },
        ],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(DependencyError);
      await expect(parser.parseRequest(request)).rejects.toThrow('attempts to analyze file');
    });
  });

  describe('options validation', () => {
    it('should accept valid options', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
        }],
        options: {
          parallel: true,
          transaction: false,
          continueOnError: true,
          returnFormat: 'structured',
          cacheStrategy: 'session',
        },
      };

      const result = await parser.parseRequest(request);
      expect(result.options).toBeDefined();
    });

    it('should reject invalid return format', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
        }],
        options: {
          returnFormat: 'invalid' as any,
        },
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid return format');
    });

    it('should reject invalid cache strategy', async () => {
      const request: FileOperationRequest = {
        operations: [{
          type: 'analyze',
          paths: ['src/**/*.ts'],
        }],
        options: {
          cacheStrategy: 'invalid' as any,
        },
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Invalid cache strategy');
    });
  });

  describe('operation optimization', () => {
    it('should group edit operations by file', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'edit1',
            type: 'edit',
            edits: [{
              file: 'src/index.ts',
              changes: [{
                type: 'find-replace',
                find: 'old1',
                replace: 'new1',
              }],
            }],
          },
          {
            id: 'edit2',
            type: 'edit',
            edits: [{
              file: 'src/index.ts',
              changes: [{
                type: 'find-replace',
                find: 'old2',
                replace: 'new2',
              }],
            }],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      
      // Should group the two edits into one operation
      const editOps = result.operations.filter(op => op.type === 'edit');
      expect(editOps).toHaveLength(1);
      
      const editOp = editOps[0] as EditOperation;
      expect(editOp.edits).toHaveLength(1);
      expect(editOp.edits[0].changes).toHaveLength(2);
    });

    it('should remove analyze operations on files to be deleted', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'analyze1',
            type: 'analyze',
            paths: ['src/file-to-delete.ts'],
          },
          {
            id: 'delete1',
            type: 'delete',
            paths: ['src/file-to-delete.ts'],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      
      // Should remove the analyze operation
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe('delete');
    });

    it('should not optimize when operations have dependencies', async () => {
      const request: FileOperationRequest = {
        operations: [
          {
            id: 'edit1',
            type: 'edit',
            edits: [{
              file: 'src/index.ts',
              changes: [{
                type: 'find-replace',
                find: 'old1',
                replace: 'new1',
              }],
            }],
          },
          {
            id: 'analyze1',
            type: 'analyze',
            paths: ['src/index.ts'],
            dependsOn: ['edit1'],
          },
          {
            id: 'edit2',
            type: 'edit',
            edits: [{
              file: 'src/index.ts',
              changes: [{
                type: 'find-replace',
                find: 'old2',
                replace: 'new2',
              }],
            }],
            dependsOn: ['analyze1'],
          },
        ],
      };

      const result = await parser.parseRequest(request);
      
      // Should maintain separation due to dependencies
      const editOps = result.operations.filter(op => op.type === 'edit');
      expect(editOps.length).toBeGreaterThan(1);
    });
  });

  describe('unknown operation type', () => {
    it('should reject unknown operation type', async () => {
      const request: any = {
        operations: [{
          type: 'unknown-type',
          someField: 'value',
        }],
      };

      await expect(parser.parseRequest(request)).rejects.toThrow(ValidationError);
      await expect(parser.parseRequest(request)).rejects.toThrow('Unknown operation type');
    });
  });
});