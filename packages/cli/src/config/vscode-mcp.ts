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
  if (!process.env.GEMINI_VSCODE_EXTENSION) {
    return null;
  }

  // Get extension path from environment or try to determine it
  const extensionPath = process.env.GEMINI_VSCODE_EXTENSION_PATH || 
    path.join(process.env.HOME || '', '.vscode/extensions/gemini-cli-vscode-*');

  return {
    vscode: {
      command: process.execPath || 'node',
      args: [
        path.join(extensionPath, 'dist/mcp/server-entry.js')
      ],
      env: {
        VSCODE_WORKSPACE_FOLDER: process.env.VSCODE_WORKSPACE_FOLDER || process.cwd(),
        // Pass through VS Code environment variables
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.startsWith('VSCODE_'))
        )
      },
      description: 'VS Code integration via MCP',
      transport: 'stdio' as const,
    }
  };
}