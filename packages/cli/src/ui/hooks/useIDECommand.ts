/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { Config, MCPServerStatus, getMCPServerStatus } from '@gemini-cli/core';
import { Message, MessageType } from '../types.js';

export interface IDECommandActionReturn {
  shouldScheduleTool?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string;
}

/**
 * Creates an action handler for IDE commands that interact with VS Code via MCP
 */
export function createIDECommandAction(
  config: Config | null,
  addMessage: (message: Message) => void,
) {
  const executeToolImmediately = async (
    toolName: string,
    toolArgs: Record<string, unknown>,
    formatter?: (result: any) => string,
  ): Promise<void> => {
    try {
      const toolRegistry = await config?.getToolRegistry();
      if (!toolRegistry) {
        addMessage({
          type: MessageType.ERROR,
          content: 'Could not retrieve tool registry.',
          timestamp: new Date(),
        });
        return;
      }

      const tool = toolRegistry.getTool(toolName);
      if (!tool) {
        addMessage({
          type: MessageType.ERROR,
          content: `Tool not found: ${toolName}`,
          timestamp: new Date(),
        });
        return;
      }

      // Execute the tool with required parameters
      const abortController = new AbortController();
      const result = await tool.execute(toolArgs, abortController.signal);
      
      // Format and display the result
      let content = '';
      
      // Extract the actual result data
      let resultData: any = result;
      if (result && typeof result === 'object' && 'returnDisplay' in result) {
        // Handle ToolResult structure - returnDisplay contains the actual data
        resultData = (result as any).returnDisplay;
      }
      
      // Use custom formatter if provided
      if (formatter) {
        content = formatter(resultData);
      } else {
        // Default formatting
        if (typeof resultData === 'string') {
          content = resultData;
        } else if (resultData && typeof resultData === 'object') {
          content = JSON.stringify(resultData, null, 2);
        } else {
          content = String(resultData);
        }
      }

      addMessage({
        type: MessageType.INFO,
        content,
        timestamp: new Date(),
      });
    } catch (error) {
      addMessage({
        type: MessageType.ERROR,
        content: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
    }
  };

  return async (
    _mainCommand: string,
    subCommand?: string,
    args?: string,
  ): Promise<IDECommandActionReturn | void> => {
    // Check if running in VS Code terminal
    if (!process.env.GEMINI_VSCODE_EXTENSION) {
      addMessage({
        type: MessageType.ERROR,
        content: 'This command is only available when running in VS Code terminal.\nPlease run Gemini CLI from the VS Code integrated terminal.',
        timestamp: new Date(),
      });
      return;
    }

    // Debug: Show all MCP servers
    const mcpServers = config?.getMcpServers() || {};
    const serverNames = Object.keys(mcpServers);
    console.log('[DEBUG] Available MCP servers:', serverNames);
    
    // Show server statuses for each server
    console.log('[DEBUG] Server statuses:');
    serverNames.forEach(name => {
      console.log(`  ${name}: ${getMCPServerStatus(name)}`);
    });

    // Check if VS Code MCP server is configured
    const vscodeServer = serverNames.find(
      name => name === 'vscode' || name.includes('vscode')
    );

    if (!vscodeServer) {
      addMessage({
        type: MessageType.ERROR,
        content: 'VS Code MCP server not found. Ensure the VS Code extension is installed and active.\n' +
                 `Available servers: ${serverNames.join(', ') || 'none'}`,
        timestamp: new Date(),
      });
      return;
    }

    // Check server status
    const status = getMCPServerStatus(vscodeServer);
    console.log(`[DEBUG] VS Code server (${vscodeServer}) status:`, status);
    
    if (status !== MCPServerStatus.CONNECTED) {
      // If connecting, wait a bit and retry
      if (status === MCPServerStatus.CONNECTING) {
        addMessage({
          type: MessageType.INFO,
          content: `VS Code server is still connecting. Please wait a moment and try again.\n` +
                   `You can also use /mcp to check server status.`,
          timestamp: new Date(),
        });
        return;
      }
      
      // If disconnected, show more helpful message
      addMessage({
        type: MessageType.INFO,
        content: `VS Code server is not connected yet.\n` +
                 `This is normal when first starting the CLI. The server needs a moment to initialize.\n` +
                 `Please wait 2-3 seconds and try again, or use /mcp to check server status.`,
        timestamp: new Date(),
      });
      return;
    }

    // Parse IDE commands
    switch (subCommand) {
      case 'open':
        if (!args) {
          addMessage({
            type: MessageType.ERROR,
            content: 'Usage: /ide open <filename> [line] [column]',
            timestamp: new Date(),
          });
          return;
        }
        
        const parts = args.split(' ');
        const path = parts[0];
        const line = parts[1] ? parseInt(parts[1], 10) : undefined;
        const column = parts[2] ? parseInt(parts[2], 10) : undefined;
        
        return {
          shouldScheduleTool: true,
          toolName: `vscode.openFile`,
          toolArgs: { path, line, column },
        };

      case 'active':
      case 'current':
        await executeToolImmediately(
          `vscode.getActiveFile`,
          {},
          (result) => {
            // Parse the JSON response and extract just the filename
            try {
              const data = typeof result === 'string' ? JSON.parse(result) : result;
              if (data.success && data.activeFile?.path) {
                return `Active file: ${data.activeFile.path}`;
              } else if (!data.success) {
                return 'No active file';
              }
              return JSON.stringify(data, null, 2);
            } catch (e) {
              return String(result);
            }
          }
        );
        return;

      case 'files':
      case 'open-files':
        await executeToolImmediately(
          `vscode.getOpenFiles`,
          {},
          (result) => {
            // Parse the JSON response and format the file list
            try {
              const data = typeof result === 'string' ? JSON.parse(result) : result;
              if (data.success && data.openFiles?.length > 0) {
                return `Open files:\n${data.openFiles.map((f: any) => `  - ${f.path}`).join('\n')}`;
              } else if (data.success && data.openFiles?.length === 0) {
                return 'No open files';
              }
              return JSON.stringify(data, null, 2);
            } catch (e) {
              return String(result);
            }
          }
        );
        return;

      case 'workspace':
      case 'folders':
        await executeToolImmediately(
          `vscode.getWorkspaceFolders`,
          {},
          (result) => {
            // Parse the JSON response and format the workspace folders
            try {
              const data = typeof result === 'string' ? JSON.parse(result) : result;
              if (data.success && data.workspaceFolders?.length > 0) {
                return `Workspace folders:\n${data.workspaceFolders.map((f: any) => `  - ${f.name}: ${f.uri}`).join('\n')}`;
              } else if (data.success && data.workspaceFolders?.length === 0) {
                return 'No workspace folders';
              }
              return JSON.stringify(data, null, 2);
            } catch (e) {
              return String(result);
            }
          }
        );
        return;

      case 'notify':
        if (!args) {
          addMessage({
            type: MessageType.ERROR,
            content: 'Usage: /ide notify <message> [info|warning|error]',
            timestamp: new Date(),
          });
          return;
        }
        
        const notifyParts = args.match(/^(.+?)(?:\s+(info|warning|error))?$/);
        const message = notifyParts?.[1] || args;
        const notifyType = notifyParts?.[2] || 'info';
        
        return {
          shouldScheduleTool: true,
          toolName: `vscode.showNotification`,
          toolArgs: { message, type: notifyType },
        };

      case 'status':
        if (!args) {
          addMessage({
            type: MessageType.ERROR,
            content: 'Usage: /ide status <text>',
            timestamp: new Date(),
          });
          return;
        }
        
        return {
          shouldScheduleTool: true,
          toolName: `vscode.updateStatusBar`,
          toolArgs: { text: args },
        };

      case 'help':
      case undefined:
        addMessage({
          type: MessageType.INFO,
          content: `Available IDE commands:
  /ide open <file> [line] [col] - Open a file in VS Code
  /ide active - Get info about the active file
  /ide files - List all open files
  /ide workspace - Get workspace folders
  /ide notify <msg> [type] - Show a notification
  /ide status <text> - Update status bar

Examples:
  /ide open src/main.ts 42 10
  /ide notify "Build complete!" info
  /ide active`,
          timestamp: new Date(),
        });
        return;

      default:
        addMessage({
          type: MessageType.ERROR,
          content: `Unknown IDE command: ${subCommand}. Use /ide help for available commands.`,
          timestamp: new Date(),
        });
        return;
    }
  };
}