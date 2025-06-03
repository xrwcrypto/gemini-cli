/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolExecuteConfirmationDetails,
  ToolConfirmationOutcome,
} from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import { spawn } from 'child_process';

export interface OpenInVSCodeToolParams {
  filePath: string;
}

const openInVSCodeParameterSchema = {
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: 'The absolute or relative path to the file to open in Visual Studio Code.',
    },
  },
  required: ['filePath'],
};

export class OpenInVSCodeTool extends BaseTool<OpenInVSCodeToolParams, ToolResult> {
  static Name: string = 'open_in_vscode';
  private whitelist: Set<string> = new Set(); // To whitelist the 'code' command

  constructor(private readonly config: Config) {
    const toolDisplayName = 'Open in VS Code';
    const toolDescription = "Opens a specified file in Visual Studio Code using the 'code' command. The 'code' command must be available in the system PATH.";
    
    super(
      OpenInVSCodeTool.Name,
      toolDisplayName,
      toolDescription,
      openInVSCodeParameterSchema,
      false, // output is not markdown
      false, // output cannot be updated
    );
  }

  getDescription(params: OpenInVSCodeToolParams): string {
    return `Open ${params.filePath} in VS Code`;
  }

  getCommandRoot(_command: string): string {
    return 'code'; 
  }

  validateToolParams(params: OpenInVSCodeToolParams): string | null {
    if (!SchemaValidator.validate(this.parameterSchema, params)) {
      return 'Parameters failed schema validation.';
    }
    if (!params.filePath || !params.filePath.trim()) {
      return 'File path cannot be empty.';
    }
    // No validation for path existence, as 'code' can create files or handle this.
    return null;
  }

  async shouldConfirmExecute(
    params: OpenInVSCodeToolParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      // If parameters are invalid, the tool execution will fail.
      // We return false here to skip confirmation, as the failure is immediate.
      return false; 
    }
    const rootCommand = this.getCommandRoot(''); // Always 'code' for this tool
    if (this.whitelist.has(rootCommand)) {
      return false; // Already approved and whitelisted
    }

    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Open in VS Code', // Specific title for the confirmation dialog
      command: `code "${params.filePath}"`, // Show the exact command
      rootCommand, // 'code'
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.whitelist.add(rootCommand);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(
    params: OpenInVSCodeToolParams,
    abortSignal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Command rejected: Open ${params.filePath} in VS Code. Reason: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
      };
    }

    const targetDir = this.config.getTargetDir();

    return new Promise<ToolResult>((resolve) => {
      const commandToRun = 'code';
      const args = [params.filePath]; // filePath can be relative or absolute

      const childProcess = spawn(commandToRun, args, {
        cwd: targetDir, // Execute from the target directory context
        detached: true, // Allows the CLI to exit while VS Code remains open
        stdio: 'ignore', // We don't need to capture stdio for 'code'
      });

      let errorOccurred = false;

      // Listener for errors spawning the process (e.g., 'code' not found)
      childProcess.on('error', (err) => {
        errorOccurred = true;
        let errorMessage = `Failed to start VS Code. Error: ${getErrorMessage(err)}`;
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
           errorMessage = `Error: The 'code' command was not found. Please ensure VS Code is installed and 'code' is available in your system's PATH.`;
        }
        resolve({
          llmContent: `Failed to execute: open ${params.filePath} in VS Code. ${errorMessage}`,
          returnDisplay: errorMessage,
        });
      });

      // Listener for process exit
      childProcess.on('exit', (code, signal) => {
        if (errorOccurred) return; // Error already handled by 'error' event

        if (abortSignal.aborted) {
           resolve({
            llmContent: `Command "open ${params.filePath} in VS Code" was cancelled by user.`,
            returnDisplay: `Cancelled: Opening ${params.filePath} in VS Code.`,
          });
          return;
        }
        
        if (code === 0) {
          resolve({
            llmContent: `Successfully executed: opened ${params.filePath} in VS Code.`,
            returnDisplay: `Opened ${params.filePath} in VS Code.`,
          });
        } else {
          const message = `VS Code command exited with code ${code}${signal ? ` and signal ${signal}` : ''}.`;
          resolve({
            llmContent: `Failed to open ${params.filePath} in VS Code. ${message}`,
            returnDisplay: `Error opening file in VS Code: ${message}`,
          });
        }
      });

      // Unref the process so the parent (CLI) can exit independently
      childProcess.unref();

      // Handle explicit cancellation via abortSignal
      const abortHandler = () => {
        if (!childProcess.killed && childProcess.pid && !errorOccurred) { // Check if not already resolved or errored
            // For 'code', killing the spawned process might not close VS Code itself,
            // as it often launches a separate GUI process.
            // The main thing is to resolve the promise so the tool call doesn't hang.
            resolve({
                llmContent: `Command "open ${params.filePath} in VS Code" was cancelled by user.`,
                returnDisplay: `Cancelled: Opening ${params.filePath} in VS Code.`,
            });
        }
      };
      
      if (abortSignal.aborted) {
        abortHandler();
        return;
      }
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    });
  }
} 