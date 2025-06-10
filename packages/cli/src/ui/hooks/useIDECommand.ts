/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { Config, MCPServerStatus, getMCPServerStatus } from '@gemini-cli/core';
import { Message, MessageType } from '../types.js';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import os from 'os';

const execAsync = promisify(exec);

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
  const installVSCodeExtension = async (addMessage: (message: Message) => void) => {
    console.log('[DEBUG] installVSCodeExtension called');
    
    // Add debug message to see if function is called
    addMessage({
      type: MessageType.INFO,
      content: 'Starting VS Code extension installation...',
      timestamp: new Date(),
    });
    
    try {
      // Debug environment
      console.log('[DEBUG] VS Code environment check:');
      console.log('  TERM_PROGRAM:', process.env.TERM_PROGRAM);
      console.log('  VSCODE_GIT_IPC_HANDLE:', process.env.VSCODE_GIT_IPC_HANDLE);
      console.log('  VSCODE_INJECTION:', process.env.VSCODE_INJECTION);
      console.log('  GEMINI_VSCODE_EXTENSION:', process.env.GEMINI_VSCODE_EXTENSION);
      
      // Check if running in VS Code terminal - be more lenient
      const isVSCodeTerminal = process.env.TERM_PROGRAM === 'vscode' || 
                               process.env.VSCODE_GIT_IPC_HANDLE ||
                               process.env.VSCODE_INJECTION ||
                               process.env.GEMINI_VSCODE_EXTENSION;
      
      if (!isVSCodeTerminal) {
        addMessage({
          type: MessageType.INFO,
          content: 'Warning: This doesn\'t appear to be a VS Code terminal.\n' +
                   'The extension installation works best from VS Code\'s integrated terminal.\n' +
                   'Proceeding with installation anyway...',
          timestamp: new Date(),
        });
      }


      // Get the bundled VSIX path
      console.log('[DEBUG] Looking for VSIX file...');
      console.log('[DEBUG] import.meta.url:', import.meta.url);
      
      // The VSIX should be in the same directory as the bundle
      const bundleDir = new URL('.', import.meta.url).pathname;
      const bundledVsixPath = join(bundleDir, 'gemini-cli-vscode.vsix');
      console.log('[DEBUG] Bundle dir:', bundleDir);
      console.log('[DEBUG] VSIX path:', bundledVsixPath);
      
      // Check if the bundled VSIX exists
      try {
        await fs.access(bundledVsixPath);
        console.log('[DEBUG] VSIX file found!');
      } catch (accessError) {
        console.log('[DEBUG] VSIX file not found:', accessError);
        addMessage({
          type: MessageType.ERROR,
          content: `VS Code extension not found in bundle.\nLooking for: ${bundledVsixPath}\nBundle directory: ${bundleDir}`,
          timestamp: new Date(),
        });
        return;
      }

      // Create a persistent location for the VSIX in ~/.gemini/extensions/
      const geminiDir = join(os.homedir(), '.gemini');
      const extensionsDir = join(geminiDir, 'extensions');
      
      // Ensure the directory exists
      await fs.mkdir(extensionsDir, { recursive: true });
      
      // Copy VSIX to the persistent location
      const vsixPath = join(extensionsDir, 'gemini-cli-vscode.vsix');
      await fs.copyFile(bundledVsixPath, vsixPath);
      
      addMessage({
        type: MessageType.INFO,
        content: `Extension saved to: ${vsixPath}`,
        timestamp: new Date(),
      });

      // Install the extension using the 'code' command
      try {
        // Try different VS Code command names
        let installCommand = 'code';
        console.log('[DEBUG] Checking for VS Code command...');
        try {
          // Check if 'code' command exists
          const whichResult = await execAsync('which code');
          console.log('[DEBUG] Found code at:', whichResult.stdout.trim());
        } catch (e) {
          console.log('[DEBUG] code command not found, trying alternatives...');
          // Try 'code-insiders' if 'code' doesn't exist
          try {
            await execAsync('which code-insiders');
            installCommand = 'code-insiders';
          } catch {
            // On Windows, try direct paths
            if (process.platform === 'win32') {
              installCommand = 'code.cmd';
            }
          }
        }

        const command = `${installCommand} --install-extension "${vsixPath}"`;
        console.log('[DEBUG] Running command:', command);
        
        addMessage({
          type: MessageType.INFO,
          content: `Executing: ${command}`,
          timestamp: new Date(),
        });
        
        let stdout = '';
        let stderr = '';
        
        try {
          const result = await execAsync(command);
          stdout = result.stdout || '';
          stderr = result.stderr || '';
        } catch (execError: any) {
          // Even if the command "fails", it might have succeeded
          stdout = execError.stdout || '';
          stderr = execError.stderr || '';
          console.log('[DEBUG] Exec error:', execError.message);
        }
        
        console.log('[DEBUG] stdout:', stdout);
        console.log('[DEBUG] stderr:', stderr);
        
        // Check if installation was successful - VS Code outputs to stderr
        if (stdout.includes('successfully installed') || 
            stderr.includes('successfully installed') ||
            stdout.includes('was successfully installed') ||
            stderr.includes('was successfully installed') ||
            stdout.includes('Extension') && stdout.includes('installed') ||
            stderr.includes('Extension') && stderr.includes('installed')) {
          // Success!
          addMessage({
            type: MessageType.INFO,
            content: 'VS Code extension installed successfully!\n' +
                     'Please reload VS Code window (Cmd/Ctrl+R) to activate the extension.',
            timestamp: new Date(),
          });
          return;
        }
        
        // If we get here, installation failed
        throw new Error('Installation may have failed - please check the output above');
      } catch (error) {
        console.log('[DEBUG] Installation error:', error);
        // Fallback: provide manual installation instructions
        addMessage({
          type: MessageType.INFO,
          content: `Could not install automatically. To install manually:\n` +
                   `1. The extension is saved at: ~/.gemini/extensions/gemini-cli-vscode.vsix\n` +
                   `2. Run: code --install-extension ~/.gemini/extensions/gemini-cli-vscode.vsix\n` +
                   `3. Or in VS Code, press Cmd/Ctrl+Shift+P\n` +
                   `4. Type "Install from VSIX" and browse to the file\n` +
                   `5. Reload VS Code window after installation`,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      addMessage({
        type: MessageType.ERROR,
        content: `Error installing extension: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
    }
  };

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
    // For install command, skip the VS Code check
    if (subCommand === 'install') {
      await installVSCodeExtension(addMessage);
      return;
    }
    
    // Check if running in VS Code terminal for other commands
    if (!process.env.GEMINI_VSCODE_EXTENSION) {
      addMessage({
        type: MessageType.ERROR,
        content: 'This command requires the VS Code extension to be active.\nPlease run Gemini CLI from the VS Code integrated terminal after installing the extension.',
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
  /ide install - Install the Gemini CLI VS Code extension
  /ide open <file> [line] [col] - Open a file in VS Code
  /ide active - Get info about the active file
  /ide files - List all open files
  /ide workspace - Get workspace folders
  /ide notify <msg> [type] - Show a notification
  /ide status <text> - Update status bar

Examples:
  /ide install
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