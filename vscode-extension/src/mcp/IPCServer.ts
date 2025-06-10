import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';

const IPC_PORT = 37849; // Same port as in standalone-server.ts

export class IPCServer {
    private server: net.Server | undefined;
    private statusBarManager: any;

    constructor(private context: vscode.ExtensionContext, statusBarManager?: any) {
        this.statusBarManager = statusBarManager;
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                console.log('MCP server connected via IPC');
                
                socket.on('data', async (data) => {
                    try {
                        const request = JSON.parse(data.toString());
                        console.log('IPC request:', request);
                        
                        const response = await this.handleRequest(request);
                        socket.write(JSON.stringify(response) + '\n');
                    } catch (error) {
                        console.error('IPC error:', error);
                        socket.write(JSON.stringify({ 
                            error: error instanceof Error ? error.message : 'Unknown error' 
                        }) + '\n');
                    }
                });

                socket.on('error', (error) => {
                    console.error('IPC socket error:', error);
                });
            });

            this.server.on('error', (error) => {
                console.error('IPC server error:', error);
                reject(error);
            });

            this.server.listen(IPC_PORT, 'localhost', () => {
                console.log(`IPC server listening on port ${IPC_PORT}`);
                resolve();
            });
        });
    }

    private async handleRequest(request: any): Promise<any> {
        const { requestId, tool, args } = request;

        try {
            let result: any;

            switch (tool) {
                case 'vscode.getActiveFile':
                    result = await this.getActiveFile();
                    break;
                
                case 'vscode.openFile':
                    result = await this.openFile(args);
                    break;
                
                case 'vscode.getOpenFiles':
                    result = await this.getOpenFiles();
                    break;
                
                case 'vscode.getWorkspaceFolders':
                    result = await this.getWorkspaceFolders();
                    break;
                
                case 'vscode.showNotification':
                    result = await this.showNotification(args);
                    break;
                
                case 'vscode.updateStatusBar':
                    result = await this.updateStatusBar(args);
                    break;
                
                default:
                    throw new Error(`Unknown tool: ${tool}`);
            }

            return { requestId, result };
        } catch (error) {
            return { 
                requestId, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }

    private async getActiveFile() {
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
    }

    private async openFile(args: any) {
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

    private async getOpenFiles() {
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

    private async getWorkspaceFolders() {
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

    private async showNotification(args: any) {
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

    private async updateStatusBar(args: any) {
        if (this.statusBarManager) {
            this.statusBarManager.updateText(args.text);
        }
        return { success: true, text: args.text };
    }

    async stop(): Promise<void> {
        if (this.server) {
            return new Promise((resolve) => {
                this.server!.close(() => {
                    console.log('IPC server stopped');
                    resolve();
                });
            });
        }
    }

    dispose() {
        this.stop();
    }
}