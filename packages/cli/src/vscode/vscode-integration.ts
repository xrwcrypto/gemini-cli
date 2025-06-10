/**
 * VS Code Integration for Gemini CLI
 * Handles automatic connection to VS Code MCP server when running in VS Code terminal
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isRunningInVSCode, getVSCodeSessionInfo } from '../utils/vscode-detector.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

export interface VSCodeIntegrationOptions {
    autoConnect?: boolean;
    debug?: boolean;
}

export class VSCodeIntegration {
    private mcpClient?: Client;
    private connected: boolean = false;
    private options: VSCodeIntegrationOptions;
    private discoveryPath?: string;

    constructor(options: VSCodeIntegrationOptions = {}) {
        this.options = {
            autoConnect: true,
            debug: false,
            ...options
        };
    }

    /**
     * Initialize VS Code integration
     */
    async initialize(): Promise<boolean> {
        if (!isRunningInVSCode()) {
            this.log('Not running in VS Code terminal, skipping VS Code integration');
            return false;
        }

        const sessionInfo = getVSCodeSessionInfo();
        this.log('VS Code detected:', sessionInfo);

        // Write discovery file for the CLI to find
        await this.writeDiscoveryFile();

        if (this.options.autoConnect) {
            return await this.connect();
        }

        return true;
    }

    /**
     * Write discovery file for CLI to find the VS Code MCP server
     */
    private async writeDiscoveryFile(): Promise<void> {
        const discoveryDir = path.join(process.env.HOME || '', '.gemini', 'mcp-servers');
        const discoveryFile = path.join(discoveryDir, 'vscode.json');

        try {
            await fs.mkdir(discoveryDir, { recursive: true });
            
            const serverInfo = {
                name: 'vscode-gemini-mcp',
                description: 'VS Code integration for Gemini CLI',
                command: process.execPath,
                args: [
                    path.join(
                        process.env.HOME || '',
                        '.vscode',
                        'extensions',
                        'gemini-cli-vscode-*',
                        'dist',
                        'mcp',
                        'server-entry.js'
                    )
                ],
                env: {
                    VSCODE_WORKSPACE_FOLDER: getVSCodeSessionInfo().workspacePath || process.cwd()
                }
            };

            await fs.writeFile(discoveryFile, JSON.stringify(serverInfo, null, 2));
            this.discoveryPath = discoveryFile;
            this.log('Wrote VS Code MCP discovery file:', discoveryFile);
        } catch (error) {
            this.log('Failed to write discovery file:', error);
        }
    }

    /**
     * Connect to VS Code MCP server
     */
    async connect(): Promise<boolean> {
        if (this.connected) {
            this.log('Already connected to VS Code MCP server');
            return true;
        }

        try {
            // Try to discover the VS Code MCP server
            const serverInfo = await this.discoverServer();
            if (!serverInfo) {
                this.log('VS Code MCP server not found');
                return false;
            }

            this.log('Connecting to VS Code MCP server:', serverInfo);

            // Create MCP client
            this.mcpClient = new Client(
                {
                    name: 'gemini-cli',
                    version: '1.0.0',
                },
                {
                    capabilities: {}
                }
            );

            // Create transport based on server info
            const transport = new StdioClientTransport({
                command: serverInfo.command,
                args: serverInfo.args,
                env: {
                    ...process.env,
                    ...serverInfo.env
                }
            });

            // Connect to server
            await this.mcpClient.connect(transport);
            this.connected = true;

            this.log('Successfully connected to VS Code MCP server');
            return true;

        } catch (error) {
            this.log('Failed to connect to VS Code MCP server:', error);
            return false;
        }
    }

    /**
     * Discover VS Code MCP server
     */
    private async discoverServer(): Promise<any> {
        // First, check if there's a discovery file
        const discoveryPaths = [
            // VS Code might write discovery info to a well-known location
            path.join(process.env.HOME || '', '.vscode-mcp', 'servers.json'),
            path.join(process.env.TMPDIR || '/tmp', 'vscode-mcp-discovery.json'),
            // Check workspace-specific location
            path.join(process.cwd(), '.vscode', 'mcp-server.json')
        ];

        for (const discoveryPath of discoveryPaths) {
            try {
                const content = await fs.readFile(discoveryPath, 'utf-8');
                const servers = JSON.parse(content);
                const vscodeServer = servers.find((s: any) => 
                    s.name === 'vscode-gemini-mcp' || 
                    s.name === 'vscode-mcp-server'
                );
                if (vscodeServer) {
                    this.log('Found VS Code MCP server via discovery file:', discoveryPath);
                    return vscodeServer;
                }
            } catch {
                // File doesn't exist or isn't valid, continue
            }
        }

        // If no discovery file, try to launch the extension's server directly
        // This assumes the VS Code extension is installed globally or in a known location
        const extensionPaths = [
            // Common VS Code extension locations
            path.join(process.env.HOME || '', '.vscode', 'extensions'),
            path.join(process.env.HOME || '', '.vscode-server', 'extensions'),
            path.join(process.env.HOME || '', '.vscode-insiders', 'extensions'),
        ];

        for (const extPath of extensionPaths) {
            try {
                const dirs = await fs.readdir(extPath);
                const geminiExtension = dirs.find(d => d.includes('gemini-cli-vscode'));
                if (geminiExtension) {
                    const serverPath = path.join(extPath, geminiExtension, 'dist', 'mcp', 'server-entry.js');
                    try {
                        await fs.access(serverPath);
                        return {
                            name: 'vscode-gemini-mcp',
                            command: process.execPath,
                            args: [serverPath],
                            env: {
                                VSCODE_WORKSPACE_FOLDER: getVSCodeSessionInfo().workspacePath || process.cwd()
                            }
                        };
                    } catch {
                        // Server entry doesn't exist
                    }
                }
            } catch {
                // Directory doesn't exist
            }
        }

        // As a last resort, try to use the development location
        if (process.env.NODE_ENV === 'development') {
            const devServerPath = path.join(
                process.cwd(),
                'vscode-extension',
                'dist',
                'mcp',
                'server-entry.js'
            );
            try {
                await fs.access(devServerPath);
                return {
                    name: 'vscode-gemini-mcp-dev',
                    command: process.execPath,
                    args: [devServerPath],
                    env: {
                        VSCODE_WORKSPACE_FOLDER: getVSCodeSessionInfo().workspacePath || process.cwd()
                    }
                };
            } catch {
                // Development server not found
            }
        }

        return null;
    }

    /**
     * Get available VS Code tools
     */
    async getTools(): Promise<any[]> {
        if (!this.connected || !this.mcpClient) {
            return [];
        }

        try {
            const response = await this.mcpClient.listTools();
            return response.tools || [];
        } catch (error) {
            this.log('Failed to get VS Code tools:', error);
            return [];
        }
    }

    /**
     * Call a VS Code tool
     */
    async callTool(toolName: string, args: any): Promise<any> {
        if (!this.connected || !this.mcpClient) {
            throw new Error('Not connected to VS Code MCP server');
        }

        try {
            const response = await this.mcpClient.callTool({
                name: toolName,
                arguments: args
            });

            // Extract text content from response
            const content = response.content as Array<{ type: string; text?: string }>;
            const textContent = content
                .filter(c => c.type === 'text' && c.text)
                .map(c => c.text)
                .join('\n');

            // Parse JSON response if possible
            try {
                return JSON.parse(textContent);
            } catch {
                return textContent;
            }
        } catch (error) {
            this.log('Failed to call VS Code tool:', error);
            throw error;
        }
    }

    /**
     * Disconnect from VS Code MCP server
     */
    async disconnect(): Promise<void> {
        if (this.mcpClient) {
            await this.mcpClient.close();
            this.mcpClient = undefined;
            this.connected = false;
            this.log('Disconnected from VS Code MCP server');
        }
    }

    /**
     * Check if connected to VS Code
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Get connection status
     */
    getStatus(): { 
        inVSCode: boolean; 
        connected: boolean; 
        serverInfo?: any;
    } {
        return {
            inVSCode: isRunningInVSCode(),
            connected: this.connected,
            serverInfo: this.connected ? {
                name: 'vscode-gemini-mcp',
                version: '1.0.0'
            } : undefined
        };
    }

    /**
     * Log debug messages
     */
    private log(...args: any[]): void {
        if (this.options.debug) {
            console.log('[VSCode Integration]', ...args);
        }
    }
}