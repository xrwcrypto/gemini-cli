/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Diff from 'diff';
import * as fs from 'fs';
import * as path from 'path';
import { 
  BaseTool, 
  ToolResult, 
  ToolCallConfirmationDetails,
  ToolEditConfirmationDetails,
  ToolConfirmationOutcome
} from '../../tools.js';
import { EditToolParams } from '../../edit.js';
import { FileOperationsTool } from '../file-operations.js';
import { 
  FileOperationRequest, 
  EditOperation,
  CreateOperation,
  FileEdit,
  FindReplaceChange
} from '../file-operations-types.js';
import { Config, ApprovalMode } from '../../../config/config.js';
import { DEFAULT_DIFF_OPTIONS } from '../../diffOptions.js';
import { isNodeError } from '../../../utils/errors.js';

/**
 * Adapter that maps EditTool calls to FileOperations edit operations
 * Ensures 100% backward compatibility with the original EditTool
 */
export class EditToolAdapter extends BaseTool<EditToolParams, ToolResult> {
  static readonly Name = 'replace';
  private readonly fileOperationsTool: FileOperationsTool;
  private readonly rootDirectory: string;
  
  constructor(private readonly config: Config) {
    super(
      EditToolAdapter.Name,
      'Edit',
      `Replaces text within a file. By default, replaces a single occurrence, but can replace multiple occurrences when \`expected_replacements\` is specified. This tool requires providing significant context around the change to ensure precise targeting. Always use the read_file tool to examine the file's current content before attempting a text replacement.

Expectation for required parameters:
1. \`file_path\` MUST be an absolute path; otherwise an error will be thrown.
2. \`old_string\` MUST be the exact literal text to replace (including all whitespace, indentation, newlines, and surrounding code etc.).
3. \`new_string\` MUST be the exact literal text to replace \`old_string\` with (also including all whitespace, indentation, newlines, and surrounding code etc.). Ensure the resulting code is correct and idiomatic.
4. NEVER escape \`old_string\` or \`new_string\`, that would break the exact literal text requirement.
**Important:** If ANY of the above are not satisfied, the tool will fail. CRITICAL for \`old_string\`: Must uniquely identify the single instance to change. Include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. If this string matches multiple locations, or does not match exactly, the tool will fail.
**Multiple replacements:** Set \`expected_replacements\` to the number of occurrences you want to replace. The tool will replace ALL occurrences that match \`old_string\` exactly. Ensure the number of replacements matches your expectation.`,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: 'string',
          },
          old_string: {
            description:
              'The exact literal text to replace, preferably unescaped. For single replacements (default), include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. For multiple replacements, specify expected_replacements parameter. If this string is not the exact literal text (i.e. you escaped it) or does not match exactly, the tool will fail.',
            type: 'string',
          },
          new_string: {
            description:
              'The exact literal text to replace `old_string` with, preferably unescaped. Provide the EXACT text. Ensure the resulting code is correct and idiomatic.',
            type: 'string',
          },
          expected_replacements: {
            type: 'number',
            description:
              'Number of replacements expected. Defaults to 1 if not specified. Use when you want to replace multiple occurrences.',
            minimum: 1,
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
        type: 'object',
      }
    );
    
    this.rootDirectory = path.resolve(this.config.getTargetDir());
    this.fileOperationsTool = new FileOperationsTool(config, this.rootDirectory);
  }
  
  validateToolParams(params: EditToolParams): string | null {
    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }
    
    if (!this.isWithinRoot(params.file_path)) {
      return `File path must be within the root directory (${this.rootDirectory}): ${params.file_path}`;
    }
    
    return null;
  }
  
  private isWithinRoot(pathToCheck: string): boolean {
    const normalizedPath = path.normalize(pathToCheck);
    const normalizedRoot = this.rootDirectory;
    const rootWithSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : normalizedRoot + path.sep;
    return (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(rootWithSep)
    );
  }
  
  getDescription(params: EditToolParams): string {
    if (!params.file_path || !params.old_string || !params.new_string) {
      return `Model did not provide valid parameters for edit tool`;
    }
    const relativePath = this.makeRelative(params.file_path);
    if (params.old_string === '') {
      return `Create ${this.shortenPath(relativePath)}`;
    }
    
    const oldStringSnippet =
      params.old_string.split('\n')[0].substring(0, 30) +
      (params.old_string.length > 30 ? '...' : '');
    const newStringSnippet =
      params.new_string.split('\n')[0].substring(0, 30) +
      (params.new_string.length > 30 ? '...' : '');
    
    if (params.old_string === params.new_string) {
      return `No file changes to ${this.shortenPath(relativePath)}`;
    }
    return `${this.shortenPath(relativePath)}: ${oldStringSnippet} => ${newStringSnippet}`;
  }
  
  async shouldConfirmExecute(
    params: EditToolParams,
    abortSignal: AbortSignal
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    
    const validationError = this.validateToolParams(params);
    if (validationError) {
      console.error(
        `[EditToolAdapter] Attempted confirmation with invalid parameters: ${validationError}`
      );
      return false;
    }
    
    let currentContent: string | null = null;
    let fileExists = false;
    
    try {
      currentContent = fs.readFileSync(params.file_path, 'utf8');
      currentContent = currentContent.replace(/\r\n/g, '\n');
      fileExists = true;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        fileExists = false;
      } else {
        console.error(`Error reading file for confirmation diff: ${err}`);
        return false;
      }
    }
    
    // Check for new file creation
    if (params.old_string === '' && !fileExists) {
      // Creating new file
      currentContent = '';
    } else if (!fileExists) {
      return false; // Cannot edit non-existent file
    }
    
    // Apply replacement to preview changes
    const isNewFile = params.old_string === '' && !fileExists;
    const newContent = isNewFile 
      ? params.new_string
      : (currentContent || '').replaceAll(params.old_string, params.new_string);
    
    const fileName = path.basename(params.file_path);
    const fileDiff = Diff.createPatch(
      fileName,
      currentContent || '',
      newContent,
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS
    );
    
    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${this.shortenPath(this.makeRelative(params.file_path))}`,
      fileName,
      fileDiff,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      }
    };
    
    return confirmationDetails;
  }
  
  async execute(
    params: EditToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `Error: ${validationError}`
      };
    }
    
    try {
      // Check if file exists
      let fileExists = false;
      let currentContent = '';
      
      try {
        currentContent = fs.readFileSync(params.file_path, 'utf8');
        currentContent = currentContent.replace(/\r\n/g, '\n');
        fileExists = true;
      } catch (err: unknown) {
        if (!isNodeError(err) || err.code !== 'ENOENT') {
          throw err;
        }
      }
      
      // Determine operation type
      let operation;
      const isNewFile = params.old_string === '' && !fileExists;
      
      if (isNewFile) {
        // Create new file
        const create: CreateOperation = {
          type: 'create',
          files: [{
            path: params.file_path,
            content: params.new_string
          }]
        };
        operation = create;
      } else if (!fileExists) {
        // Error: trying to edit non-existent file
        return {
          llmContent: `File not found: ${params.file_path}`,
          returnDisplay: `Error: File not found. Cannot apply edit. Use an empty old_string to create a new file.`
        };
      } else if (params.old_string === '') {
        // Error: trying to create file that already exists
        return {
          llmContent: `File already exists, cannot create: ${params.file_path}`,
          returnDisplay: `Error: Failed to edit. Attempted to create a file that already exists.`
        };
      } else {
        // Normal edit operation
        const expectedReplacements = params.expected_replacements || 1;
        const occurrences = (currentContent.match(new RegExp(
          params.old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 
          'g'
        )) || []).length;
        
        if (occurrences === 0) {
          return {
            llmContent: `Failed to edit, 0 occurrences found for old_string in ${params.file_path}. No edits made. The exact text in old_string was not found. Ensure you're not escaping content incorrectly and check whitespace, indentation, and context. Use read_file tool to verify.`,
            returnDisplay: `Error: Failed to edit, could not find the string to replace.`
          };
        } else if (occurrences !== expectedReplacements) {
          return {
            llmContent: `Failed to edit, Expected ${expectedReplacements} occurrences but found ${occurrences} for old_string in file: ${params.file_path}`,
            returnDisplay: `Error: Failed to edit, expected ${expectedReplacements} occurrence(s) but found ${occurrences}.`
          };
        }
        
        const edit: EditOperation = {
          type: 'edit',
          edits: [{
            file: params.file_path,
            changes: [{
              type: 'find-replace',
              find: params.old_string,
              replace: params.new_string,
              regex: false,
              replaceAll: expectedReplacements > 1
            }]
          }],
          preserveFormatting: true,
          validateSyntax: false
        };
        operation = edit;
      }
      
      const request: FileOperationRequest = {
        operations: [operation],
        options: {
          parallel: false,
          transaction: false,
          returnFormat: 'structured'
        }
      };
      
      // Execute through FileOperations
      const result = await this.fileOperationsTool.execute(request, signal);
      
      // Parse response
      const response = JSON.parse(result.llmContent);
      
      if (!response.success || response.results.length === 0) {
        const error = response.errors?.[0]?.message || 'Failed to execute edit';
        return {
          llmContent: `Error executing edit: ${error}`,
          returnDisplay: `Error: ${error}`
        };
      }
      
      const operationResult = response.results[0];
      if (operationResult.status === 'failed') {
        const error = operationResult.error?.message || 'Failed to execute edit';
        return {
          llmContent: `Error executing edit: ${error}`,
          returnDisplay: `Error: ${error}`
        };
      }
      
      // Build response matching EditTool format
      let displayResult;
      if (isNewFile) {
        displayResult = `Created ${this.shortenPath(this.makeRelative(params.file_path))}`;
      } else {
        const fileName = path.basename(params.file_path);
        const newContent = currentContent.replaceAll(params.old_string, params.new_string);
        const fileDiff = Diff.createPatch(
          fileName,
          currentContent,
          newContent,
          'Current',
          'Proposed',
          DEFAULT_DIFF_OPTIONS
        );
        displayResult = { fileDiff, fileName };
      }
      
      const llmSuccessMessage = isNewFile
        ? `Created new file: ${params.file_path} with provided content.`
        : `Successfully modified file: ${params.file_path} (${params.expected_replacements || 1} replacements).`;
      
      return {
        llmContent: llmSuccessMessage,
        returnDisplay: displayResult
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing edit: ${errorMsg}`,
        returnDisplay: `Error: ${errorMsg}`
      };
    }
  }
  
  private makeRelative(absolutePath: string): string {
    if (absolutePath.startsWith(this.rootDirectory)) {
      return absolutePath.slice(this.rootDirectory.length + 1);
    }
    return absolutePath;
  }
  
  private shortenPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-3).join('/')}`;
  }
}