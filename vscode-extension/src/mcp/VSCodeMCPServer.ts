import * as vscode from 'vscode';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
} from '@modelcontextprotocol/sdk/types.js';

export class VSCodeMCPServer {
    private server: Server;
    private transport?: StdioServerTransport;
    
    constructor() {
        this.server = new Server(
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
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: this.getAvailableTools(),
            };
        });

        // Handle tool execution
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            
            try {
                const result = await this.executeTool(name, args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    private getAvailableTools(): Tool[] {
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

    private async executeTool(name: string, args: any): Promise<any> {
        switch (name) {
            case 'vscode.openFile':
                return await this.openFile(args);
            
            case 'vscode.getActiveFile':
                return this.getActiveFile();
            
            case 'vscode.getOpenFiles':
                return this.getOpenFiles();
            
            case 'vscode.getWorkspaceFolders':
                return this.getWorkspaceFolders();
            
            case 'vscode.showNotification':
                return await this.showNotification(args);
            
            case 'vscode.updateStatusBar':
                return this.updateStatusBar(args);
            
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    private async openFile(args: { path: string; line?: number; column?: number }): Promise<any> {
        const uri = vscode.Uri.file(args.path);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        
        if (args.line !== undefined) {
            const position = new vscode.Position(
                Math.max(0, args.line - 1),
                Math.max(0, (args.column || 1) - 1)
            );
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        }
        
        return {
            success: true,
            path: args.path,
            line: args.line,
            column: args.column,
        };
    }

    private getActiveFile(): any {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return { activeFile: null };
        }
        
        return {
            activeFile: {
                path: editor.document.uri.fsPath,
                languageId: editor.document.languageId,
                lineCount: editor.document.lineCount,
                isDirty: editor.document.isDirty,
                selection: {
                    start: {
                        line: editor.selection.start.line + 1,
                        character: editor.selection.start.character + 1,
                    },
                    end: {
                        line: editor.selection.end.line + 1,
                        character: editor.selection.end.character + 1,
                    },
                },
            },
        };
    }

    private getOpenFiles(): any {
        const openFiles = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input instanceof vscode.TabInputText)
            .map(tab => {
                const input = tab.input as vscode.TabInputText;
                return {
                    path: input.uri.fsPath,
                    isDirty: tab.isDirty,
                    isActive: tab.isActive,
                    isPinned: tab.isPinned,
                };
            });
        
        return { openFiles };
    }

    private getWorkspaceFolders(): any {
        const folders = vscode.workspace.workspaceFolders || [];
        return {
            workspaceFolders: folders.map(folder => ({
                name: folder.name,
                path: folder.uri.fsPath,
                index: folder.index,
            })),
        };
    }

    private async showNotification(args: { message: string; type?: string }): Promise<any> {
        const { message, type = 'info' } = args;
        
        switch (type) {
            case 'error':
                vscode.window.showErrorMessage(message);
                break;
            case 'warning':
                vscode.window.showWarningMessage(message);
                break;
            default:
                vscode.window.showInformationMessage(message);
                break;
        }
        
        return { success: true, message, type };
    }

    private updateStatusBar(args: { text: string }): any {
        // This will be implemented when we have a status bar item reference
        // For now, just return success
        return { success: true, text: args.text };
    }

    async start(): Promise<void> {
        this.transport = new StdioServerTransport();
        await this.server.connect(this.transport);
        console.log('MCP Server started');
    }

    async stop(): Promise<void> {
        await this.server.close();
        console.log('MCP Server stopped');
    }
}