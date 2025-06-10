import * as vscode from 'vscode';
import { MCPImports } from './mcp-imports';

export class VSCodeMCPServer {
    private server: any;
    private transport?: any;
    private Server: any;
    private StdioServerTransport: any;
    private CallToolRequestSchema: any;
    private ListToolsRequestSchema: any;
    
    constructor() {
        // Constructor will be empty - initialization happens in init()
    }
    
    async init() {
        // Load MCP modules
        this.Server = await MCPImports.getServer();
        this.StdioServerTransport = await MCPImports.getStdioServerTransport();
        const types = await MCPImports.getTypes();
        this.CallToolRequestSchema = types.CallToolRequestSchema;
        this.ListToolsRequestSchema = types.ListToolsRequestSchema;
        
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
        try {
            if (!args.path) {
                throw new Error('Path is required');
            }

            const uri = vscode.Uri.file(args.path);
            
            // Check if file exists
            try {
                await vscode.workspace.fs.stat(uri);
            } catch {
                throw new Error(`File not found: ${args.path}`);
            }

            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            
            if (args.line !== undefined) {
                // Validate line number
                if (args.line < 1 || args.line > doc.lineCount) {
                    throw new Error(`Line ${args.line} is out of range (1-${doc.lineCount})`);
                }
                
                const position = new vscode.Position(
                    args.line - 1,
                    Math.max(0, (args.column || 1) - 1)
                );
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            }
            
            return {
                success: true,
                path: args.path,
                line: args.line,
                column: args.column,
                fileInfo: {
                    lineCount: doc.lineCount,
                    languageId: doc.languageId,
                    isUntitled: doc.isUntitled
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                path: args.path
            };
        }
    }

    private getActiveFile(): any {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return { 
                    success: true,
                    activeFile: null,
                    message: 'No active editor' 
                };
            }
            
            const document = editor.document;
            const selection = editor.selection;
            
            return {
                success: true,
                activeFile: {
                    path: document.uri.fsPath,
                    languageId: document.languageId,
                    lineCount: document.lineCount,
                    isDirty: document.isDirty,
                    isUntitled: document.isUntitled,
                    version: document.version,
                    selection: {
                        start: {
                            line: selection.start.line + 1,
                            character: selection.start.character + 1,
                        },
                        end: {
                            line: selection.end.line + 1,
                            character: selection.end.character + 1,
                        },
                        isEmpty: selection.isEmpty,
                        isSingleLine: selection.isSingleLine,
                    },
                    visibleRange: {
                        start: {
                            line: editor.visibleRanges[0]?.start.line + 1 || 1,
                            character: editor.visibleRanges[0]?.start.character + 1 || 1,
                        },
                        end: {
                            line: editor.visibleRanges[0]?.end.line + 1 || 1,
                            character: editor.visibleRanges[0]?.end.character + 1 || 1,
                        }
                    }
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private getOpenFiles(): any {
        try {
            const openFiles = vscode.window.tabGroups.all
                .flatMap(group => group.tabs)
                .filter(tab => tab.input instanceof vscode.TabInputText)
                .map(tab => {
                    const input = tab.input as vscode.TabInputText;
                    return {
                        path: input.uri.fsPath,
                        isDirty: tab.isDirty || false,
                        isActive: tab.isActive || false,
                        isPinned: tab.isPinned || false,
                        label: tab.label,
                        group: tab.group.viewColumn,
                    };
                });
            
            return { 
                success: true,
                openFiles,
                totalCount: openFiles.length,
                groupCount: vscode.window.tabGroups.all.length
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                openFiles: []
            };
        }
    }

    private getWorkspaceFolders(): any {
        try {
            const folders = vscode.workspace.workspaceFolders || [];
            const workspaceName = vscode.workspace.name;
            const workspaceFile = vscode.workspace.workspaceFile?.fsPath;
            
            return {
                success: true,
                workspaceName,
                workspaceFile,
                workspaceFolders: folders.map(folder => ({
                    name: folder.name,
                    path: folder.uri.fsPath,
                    index: folder.index,
                })),
                folderCount: folders.length,
                isSingleFolder: folders.length === 1,
                hasWorkspace: folders.length > 0
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                workspaceFolders: []
            };
        }
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
        if (!this.server) {
            await this.init();
        }
        this.transport = new this.StdioServerTransport();
        await this.server.connect(this.transport);
        console.log('MCP Server started');
    }

    async stop(): Promise<void> {
        await this.server.close();
        console.log('MCP Server stopped');
    }
}