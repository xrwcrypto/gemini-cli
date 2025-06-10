/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MCPServerConfig } from '@gemini-cli/core';
import * as path from 'path';

/**
 * Get VS Code MCP server configuration when running in VS Code terminal
 */
export function getVSCodeMCPServer(): Record<string, MCPServerConfig> | null {
  // Check if running in VS Code terminal
  console.log('[DEBUG] Checking VS Code environment:', {
    GEMINI_VSCODE_EXTENSION: process.env.GEMINI_VSCODE_EXTENSION,
    GEMINI_VSCODE_EXTENSION_PATH: process.env.GEMINI_VSCODE_EXTENSION_PATH,
    VSCODE_WORKSPACE_FOLDER: process.env.VSCODE_WORKSPACE_FOLDER,
  });
  
  if (!process.env.GEMINI_VSCODE_EXTENSION) {
    return null;
  }

  // Get extension path from environment or try to determine it
  const extensionPath = process.env.GEMINI_VSCODE_EXTENSION_PATH || 
    path.join(process.env.HOME || '', '.vscode/extensions/gemini-cli-vscode-*');

  // Use 'node' command instead of process.execPath which might be VS Code helper
  const nodeCommand = 'node';
  const serverScriptPath = path.join(extensionPath, 'dist/mcp/server-entry.js');
  
  console.log('[DEBUG] VS Code MCP config:', {
    command: nodeCommand,
    script: serverScriptPath,
    extensionPath,
  });
  
  return {
    vscode: new MCPServerConfig(
      nodeCommand,
      [serverScriptPath],
      {
        VSCODE_WORKSPACE_FOLDER: process.env.VSCODE_WORKSPACE_FOLDER || process.cwd(),
        // Pass through VS Code environment variables
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.startsWith('VSCODE_'))
        )
      },
      undefined, // cwd
      undefined, // url
      undefined, // timeout
      undefined, // trust
      'VS Code integration via MCP' // description
    )
  };
}