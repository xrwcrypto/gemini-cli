#!/usr/bin/env node
/**
 * Standalone MCP Server that communicates with VS Code extension
 * This runs as a separate process and doesn't have access to VS Code APIs
 */

import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

// Import MCP SDK using the wrapper to handle CommonJS compatibility
const { MCPImports } = require('./mcp-imports');

// Port for IPC with VS Code extension
const IPC_PORT = 37849; // Random port for VS Code MCP communication

class StandaloneMCPServer {
    private server: any;
    private transport?: any;
    private vscodeConnection?: net.Socket;
    private Server: any;
    private StdioServerTransport: any;
    private ListToolsRequestSchema: any;
    private CallToolRequestSchema: any;
    
    constructor() {
        // Constructor will be called after async initialization
    }

    async initialize() {
        // Load MCP SDK components
        this.Server = await MCPImports.getServer();
        this.StdioServerTransport = await MCPImports.getStdioServerTransport();
        this.ListToolsRequestSchema = await MCPImports.getListToolsRequestSchema();
        this.CallToolRequestSchema = await MCPImports.getCallToolRequestSchema();

        this.server = new this.Server(
            {
                name: 'vscode-gemini-mcp',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupHandlers();
    }

    private setupHandlers() {
        // Handle tool listing
        this.server.setRequestHandler(this.ListToolsRequestSchema, async () => {
            return {
                tools: this.getAvailableTools(),
            };
        });

        // Handle tool execution
        this.server.setRequestHandler(this.CallToolRequestSchema, async (request: any) => {
            const { name, arguments: args } = request.params;
            
            // Forward the tool call to VS Code via IPC
            if (this.vscodeConnection && this.vscodeConnection.writable) {
                return new Promise((resolve) => {
                    const requestId = Math.random().toString(36).substring(7);
                    
                    // Set up one-time listener for response
                    const responseHandler = (data: Buffer) => {
                        try {
                            const response = JSON.parse(data.toString());
                            if (response.requestId === requestId) {
                                this.vscodeConnection?.off('data', responseHandler);
                                resolve({
                                    content: [
                                        {
                                            type: 'text',
                                            text: JSON.stringify(response.result, null, 2),
                                        },
                                    ],
                                });
                            }
                        } catch (e) {
                            // Ignore parse errors
                        }
                    };
                    
                    this.vscodeConnection?.on('data', responseHandler);
                    
                    // Send request to VS Code
                    this.vscodeConnection?.write(JSON.stringify({
                        requestId,
                        tool: name,
                        args
                    }) + '\n');
                    
                    // Timeout after 30 seconds
                    setTimeout(() => {
                        this.vscodeConnection?.off('data', responseHandler);
                        resolve({
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({ error: 'Timeout waiting for VS Code response' }),
                                },
                            ],
                            isError: true,
                        });
                    }, 30000);
                });
            } else {
                // Fallback: return mock data if VS Code isn't connected
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ 
                                error: 'VS Code extension not connected',
                                tool: name,
                                args 
                            }),
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    private getAvailableTools(): any[] {
        return [
            {
                name: 'vscode.openFile',
                description: 'Open a file in VS Code editor',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'File path to open',
                        },
                        line: {
                            type: 'number',
                            description: 'Line number to navigate to (1-based)',
                        },
                        column: {
                            type: 'number',
                            description: 'Column number to navigate to (1-based)',
                        },
                    },
                    required: ['path'],
                },
            },
            {
                name: 'vscode.getActiveFile',
                description: 'Get the currently active file in VS Code',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'vscode.getOpenFiles',
                description: 'Get all currently open files in VS Code',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'vscode.getWorkspaceFolders',
                description: 'Get all workspace folders',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'vscode.showNotification',
                description: 'Show a notification in VS Code',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            description: 'Notification message',
                        },
                        type: {
                            type: 'string',
                            enum: ['info', 'warning', 'error'],
                            description: 'Notification type',
                        },
                    },
                    required: ['message'],
                },
            },
            {
                name: 'vscode.updateStatusBar',
                description: 'Update the status bar text',
                inputSchema: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'Status bar text',
                        },
                    },
                    required: ['text'],
                },
            },
        ];
    }

    private async connectToVSCode() {
        try {
            console.error('Attempting to connect to VS Code extension...');
            this.vscodeConnection = net.createConnection(IPC_PORT, 'localhost');
            
            this.vscodeConnection.on('connect', () => {
                console.error('Connected to VS Code extension');
            });
            
            this.vscodeConnection.on('error', (err) => {
                console.error('VS Code connection error:', err.message);
                // Continue running even if VS Code isn't available
            });
            
            this.vscodeConnection.on('close', () => {
                console.error('VS Code connection closed');
                this.vscodeConnection = undefined;
                // Try to reconnect after 5 seconds
                setTimeout(() => this.connectToVSCode(), 5000);
            });
        } catch (error) {
            console.error('Failed to connect to VS Code:', error);
        }
    }

    async start(): Promise<void> {
        console.error('Starting standalone MCP server...');
        
        // Initialize MCP SDK components first
        await this.initialize();
        
        // Try to connect to VS Code
        this.connectToVSCode();
        
        // Start MCP server
        this.transport = new this.StdioServerTransport();
        await this.server.connect(this.transport);
        console.error('MCP Server started on stdio');
    }

    async stop(): Promise<void> {
        if (this.vscodeConnection) {
            this.vscodeConnection.end();
        }
        await this.server.close();
        console.error('MCP Server stopped');
    }
}

// Main entry point
async function main() {
    const server = new StandaloneMCPServer();
    
    try {
        await server.start();
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.error('Shutting down MCP Server...');
            await server.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            console.error('Shutting down MCP Server...');
            await server.stop();
            process.exit(0);
        });
        
        // Keep the process alive
        process.stdin.resume();
        
    } catch (error) {
        console.error('Failed to start MCP Server:', error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});