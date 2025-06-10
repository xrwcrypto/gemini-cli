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
      addMessage({
        type: MessageType.INFO,
        content: `VS Code server is ${status}. Waiting for connection...\n` +
                 `Server: ${vscodeServer}\n` +
                 `Try running /mcp to see server details.`,
        timestamp: new Date(),
      });
      
      // TODO: Implement connection retry logic
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
          toolName: `${vscodeServer}.vscode.openFile`,
          toolArgs: { path, line, column },
        };

      case 'active':
      case 'current':
        return {
          shouldScheduleTool: true,
          toolName: `${vscodeServer}.vscode.getActiveFile`,
          toolArgs: {},
        };

      case 'files':
      case 'open-files':
        return {
          shouldScheduleTool: true,
          toolName: `${vscodeServer}.vscode.getOpenFiles`,
          toolArgs: {},
        };

      case 'workspace':
      case 'folders':
        return {
          shouldScheduleTool: true,
          toolName: `${vscodeServer}.vscode.getWorkspaceFolders`,
          toolArgs: {},
        };

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
          toolName: `${vscodeServer}.vscode.showNotification`,
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
          toolName: `${vscodeServer}.vscode.updateStatusBar`,
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