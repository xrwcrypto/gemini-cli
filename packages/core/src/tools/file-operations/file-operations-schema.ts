/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * JSON Schema for FileOperations tool parameters
 */
export const fileOperationsSchema = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      description: 'Array of operations to execute',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Optional unique identifier for the operation (used for dependencies)'
          },
          type: {
            type: 'string',
            enum: ['analyze', 'edit', 'create', 'delete', 'validate'],
            description: 'Type of operation to perform'
          },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of operation IDs that must complete before this operation'
          }
        },
        required: ['type'],
        // Conditional schemas based on type
        oneOf: [
          {
            // Analyze operation schema
            properties: {
              type: { const: 'analyze' },
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Glob patterns for files to analyze',
                minItems: 1
              },
              extract: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['imports', 'exports', 'functions', 'classes', 'interfaces', 'types', 'variables', 'todos', 'dependencies', 'complexity', 'all']
                },
                description: 'What to extract from the files'
              },
              buildIndex: {
                type: 'boolean',
                description: 'Build searchable index for future operations'
              },
              deepAnalysis: {
                type: 'boolean',
                description: 'Include complexity, security analysis'
              },
              search: {
                type: 'object',
                properties: {
                  pattern: { type: 'string' },
                  type: { type: 'string', enum: ['regex', 'literal', 'ast'] },
                  caseSensitive: { type: 'boolean' },
                  contextLines: { type: 'number', minimum: 0 }
                },
                required: ['pattern', 'type']
              }
            },
            required: ['type', 'paths']
          },
          {
            // Edit operation schema
            properties: {
              type: { const: 'edit' },
              edits: {
                type: 'array',
                description: 'Array of file edits to perform',
                items: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', description: 'File path to edit' },
                    changes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        oneOf: [
                          {
                            // Find-replace change
                            properties: {
                              type: { const: 'find-replace' },
                              find: { type: 'string' },
                              replace: { type: 'string' },
                              regex: { type: 'boolean' },
                              replaceAll: { type: 'boolean' }
                            },
                            required: ['type', 'find', 'replace']
                          },
                          {
                            // Line change
                            properties: {
                              type: { const: 'line' },
                              line: { type: 'number', minimum: 1 },
                              operation: { type: 'string', enum: ['insert', 'replace', 'delete'] },
                              content: { type: 'string' }
                            },
                            required: ['type', 'line', 'operation']
                          },
                          {
                            // Position change
                            properties: {
                              type: { const: 'position' },
                              start: { type: 'number', minimum: 0 },
                              end: { type: 'number', minimum: 0 },
                              content: { type: 'string' }
                            },
                            required: ['type', 'start', 'end', 'content']
                          },
                          {
                            // AST change
                            properties: {
                              type: { const: 'ast' },
                              query: { type: 'string' },
                              transform: {
                                type: 'object',
                                properties: {
                                  type: { type: 'string', enum: ['rename', 'wrap', 'unwrap', 'replace', 'remove'] },
                                  params: { type: 'object' }
                                },
                                required: ['type']
                              }
                            },
                            required: ['type', 'query', 'transform']
                          }
                        ]
                      }
                    },
                    createIfMissing: { type: 'boolean' }
                  },
                  required: ['file', 'changes']
                },
                minItems: 1
              },
              validateSyntax: {
                type: 'boolean',
                description: 'Check syntax after edits'
              },
              preserveFormatting: {
                type: 'boolean',
                description: 'Maintain indentation/style'
              }
            },
            required: ['type', 'edits']
          },
          {
            // Create operation schema
            properties: {
              type: { const: 'create' },
              files: {
                type: 'array',
                description: 'Files to create',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                    template: { type: 'string' },
                    templateVars: { type: 'object' },
                    mode: { type: 'string', pattern: '^[0-7]{3,4}$' }
                  },
                  required: ['path']
                },
                minItems: 1
              }
            },
            required: ['type', 'files']
          },
          {
            // Delete operation schema
            properties: {
              type: { const: 'delete' },
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Glob patterns for files to delete',
                minItems: 1
              },
              removeEmptyDirs: {
                type: 'boolean',
                description: 'Delete empty parent directories'
              },
              skipMissing: {
                type: 'boolean',
                description: 'Skip files that don\'t exist'
              }
            },
            required: ['type', 'paths']
          },
          {
            // Validate operation schema
            properties: {
              type: { const: 'validate' },
              commands: {
                type: 'array',
                items: { type: 'string' },
                description: 'Validation commands to run'
              },
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to validate'
              },
              checks: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['syntax', 'lint', 'typecheck', 'format', 'imports', 'tests']
                },
                description: 'Types of validation to perform'
              },
              autoFix: {
                type: 'boolean',
                description: 'Auto-fix issues if possible'
              }
            },
            required: ['type']
          }
        ]
      },
      minItems: 1
    },
    options: {
      type: 'object',
      description: 'Execution options',
      properties: {
        parallel: {
          type: 'boolean',
          description: 'Execute independent operations in parallel (default: true)',
          default: true
        },
        transaction: {
          type: 'boolean',
          description: 'Execute all operations in a transaction with rollback on failure (default: false)',
          default: false
        },
        continueOnError: {
          type: 'boolean',
          description: 'Continue executing remaining operations if one fails (default: false)',
          default: false
        },
        returnFormat: {
          type: 'string',
          enum: ['raw', 'structured', 'minimal'],
          description: 'Format of the response data',
          default: 'structured'
        },
        cacheStrategy: {
          type: 'string',
          enum: ['none', 'session', 'persistent'],
          description: 'Caching strategy for file contents and analysis',
          default: 'session'
        }
      }
    }
  },
  required: ['operations']
};