/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Diff from 'diff';
import { 
  BaseTool, 
  ToolResult, 
  ToolCallConfirmationDetails,
  ToolEditConfirmationDetails,
  ToolConfirmationOutcome,
  FileDiff
} from '../../tools.js';
import { WriteFileToolParams } from '../../write-file.js';
import { FileOperationsTool } from '../file-operations.js';
import { 
  FileOperationRequest, 
  CreateOperation, 
  EditOperation,
  FileEdit,
  FindReplaceChange
} from '../file-operations-types.js';
import { Config, ApprovalMode } from '../../../config/config.js';
import { DEFAULT_DIFF_OPTIONS } from '../../diffOptions.js';
import fs from 'fs';
import path from 'path';

/**
 * Adapter that maps WriteFileTool calls to FileOperations create/edit operations
 * Ensures 100% backward compatibility with the original WriteFileTool
 */
export class WriteFileAdapter extends BaseTool<WriteFileToolParams, ToolResult> {
  static readonly Name = 'write_file';
  private readonly fileOperationsTool: FileOperationsTool;
  
  constructor(private readonly config: Config) {
    super(
      WriteFileAdapter.Name,
      'WriteFile',
      'Writes content to a specified file in the local filesystem.',
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to write to (e.g., '/home/user/project/file.txt'). Relative paths are not supported.",
            type: 'string',
          },
          content: {
            description: 'The content to write to the file.',
            type: 'string',
          },
        },
        required: ['file_path', 'content'],
        type: 'object',
      }
    );
    
    this.fileOperationsTool = new FileOperationsTool(
      config, 
      config.getTargetDir()
    );
  }
  
  validateToolParams(params: WriteFileToolParams): string | null {
    // Check if file exists to determine operation type
    const fileExists = fs.existsSync(params.file_path);
    
    let operation;
    if (fileExists) {
      // Use edit operation for existing files
      const edit: EditOperation = {
        type: 'edit',
        edits: [{
          file: params.file_path,
          changes: [{
            type: 'find-replace',
            find: '.*', // Replace entire content
            replace: params.content,
            regex: true,
            replaceAll: true
          }]
        }],
        preserveFormatting: false
      };
      operation = edit;
    } else {
      // Use create operation for new files
      const create: CreateOperation = {
        type: 'create',
        files: [{
          path: params.file_path,
          content: params.content
        }]
      };
      operation = create;
    }
    
    const request: FileOperationRequest = {
      operations: [operation],
      options: {
        parallel: false,
        transaction: false
      }
    };
    
    return this.fileOperationsTool.validateToolParams(request);
  }
  
  getDescription(params: WriteFileToolParams): string {
    if (!params.file_path || !params.content) {
      return `Model did not provide valid parameters for write file tool`;
    }
    const relativePath = this.makeRelative(params.file_path);
    return `Writing to ${this.shortenPath(relativePath)}`;
  }
  
  async shouldConfirmExecute(
    params: WriteFileToolParams,
    abortSignal: AbortSignal
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }
    
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return false;
    }
    
    // Get current content for diff
    let originalContent = '';
    let fileExists = false;
    
    try {
      originalContent = fs.readFileSync(params.file_path, 'utf8');
      fileExists = true;
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        // File exists but couldn't be read
        return false;
      }
    }
    
    const relativePath = this.makeRelative(params.file_path);
    const fileName = path.basename(params.file_path);
    
    // Create diff
    const fileDiff = Diff.createPatch(
      fileName,
      originalContent,
      params.content,
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS
    );
    
    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Write: ${this.shortenPath(relativePath)}`,
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
    params: WriteFileToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    try {
      // Check if file exists to determine operation type
      const fileExists = fs.existsSync(params.file_path);
      let operation;
      
      if (fileExists) {
        // Read current content for edit operation
        const currentContent = fs.readFileSync(params.file_path, 'utf8');
        
        // Use edit operation with full content replacement
        const edit: EditOperation = {
          type: 'edit',
          edits: [{
            file: params.file_path,
            changes: [{
              type: 'find-replace',
              find: currentContent,
              replace: params.content,
              regex: false,
              replaceAll: false
            }]
          }],
          preserveFormatting: false,
          validateSyntax: false
        };
        operation = edit;
      } else {
        // Use create operation for new files
        const create: CreateOperation = {
          type: 'create',
          files: [{
            path: params.file_path,
            content: params.content
          }]
        };
        operation = create;
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
        const error = response.errors?.[0]?.message || 'Failed to write file';
        return {
          llmContent: `Error writing to file ${params.file_path}: ${error}`,
          returnDisplay: `Error: ${error}`
        };
      }
      
      const operationResult = response.results[0];
      if (operationResult.status === 'failed') {
        const error = operationResult.error?.message || 'Failed to write file';
        return {
          llmContent: `Error writing to file ${params.file_path}: ${error}`,
          returnDisplay: `Error: ${error}`
        };
      }
      
      // Generate diff for display (matching WriteFileTool behavior)
      const fileName = path.basename(params.file_path);
      const originalContent = fileExists ? fs.readFileSync(params.file_path, 'utf8') : '';
      
      const fileDiff = Diff.createPatch(
        fileName,
        originalContent,
        params.content,
        'Original',
        'Written',
        DEFAULT_DIFF_OPTIONS
      );
      
      const llmSuccessMessage = fileExists
        ? `Successfully overwrote file: ${params.file_path}`
        : `Successfully created and wrote to new file: ${params.file_path}`;
      
      const displayResult: FileDiff = { fileDiff, fileName };
      
      return {
        llmContent: llmSuccessMessage,
        returnDisplay: displayResult
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error writing to file ${params.file_path}: ${errorMsg}`,
        returnDisplay: `Error: ${errorMsg}`
      };
    }
  }
  
  private makeRelative(absolutePath: string): string {
    const rootDir = this.config.getTargetDir();
    if (absolutePath.startsWith(rootDir)) {
      return absolutePath.slice(rootDir.length + 1);
    }
    return absolutePath;
  }
  
  private shortenPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-3).join('/')}`;
  }
}