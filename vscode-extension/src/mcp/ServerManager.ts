import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { VSCodeMCPServer } from './VSCodeMCPServer';

export class ServerManager {
    private server?: VSCodeMCPServer;
    private serverProcess?: ChildProcess;
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('Gemini MCP Server');
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.setupStatusBar();
    }

    private setupStatusBar() {
        this.statusBarItem.text = '$(sync~spin) Gemini: Starting...';
        this.statusBarItem.tooltip = 'Gemini MCP Server';
        this.statusBarItem.command = 'gemini.showServerStatus';
        this.statusBarItem.show();
    }

    async start(): Promise<void> {
        try {
            this.outputChannel.appendLine('Starting MCP server...');
            
            // Get configuration
            const config = vscode.workspace.getConfiguration('gemini');
            const port = config.get<string | number>('mcpServer.port', 'auto');
            
            // Create server instance
            this.server = new VSCodeMCPServer();
            // Server initialization happens in start()
            
            // Start server in a separate process
            const serverScriptPath = path.join(
                this.context.extensionPath,
                'dist',
                'mcp',
                'server-entry.js'
            );
            
            // For now, we'll use stdio transport
            // In production, we might want to use a different transport
            this.outputChannel.appendLine(`Server script path: ${serverScriptPath}`);
            
            // Update status
            this.updateStatus('connected');
            this.outputChannel.appendLine('MCP server started successfully');
            
            // Register the server for discovery
            await this.registerServer();
            
        } catch (error) {
            this.outputChannel.appendLine(`Failed to start MCP server: ${error}`);
            this.updateStatus('error');
            throw error;
        }
    }

    async stop(): Promise<void> {
        try {
            this.outputChannel.appendLine('Stopping MCP server...');
            
            if (this.serverProcess) {
                this.serverProcess.kill();
                this.serverProcess = undefined;
            }
            
            if (this.server) {
                await this.server.stop();
                this.server = undefined;
            }
            
            this.updateStatus('disconnected');
            this.outputChannel.appendLine('MCP server stopped');
            
        } catch (error) {
            this.outputChannel.appendLine(`Error stopping MCP server: ${error}`);
        }
    }

    private async registerServer() {
        // This will make the server discoverable by Gemini CLI
        // For now, we'll write a discovery file
        const discoveryInfo = {
            name: 'vscode-gemini-mcp',
            version: '1.0.0',
            transport: 'stdio',
            command: process.execPath,
            args: [
                path.join(this.context.extensionPath, 'dist', 'mcp', 'server-entry.js')
            ],
            env: {
                VSCODE_WORKSPACE_FOLDER: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
            }
        };
        
        // In a real implementation, we'd write this to a well-known location
        // or use IPC to communicate with the CLI
        this.outputChannel.appendLine(`Server discovery info: ${JSON.stringify(discoveryInfo, null, 2)}`);
    }

    private updateStatus(status: 'connected' | 'disconnected' | 'error') {
        switch (status) {
            case 'connected':
                this.statusBarItem.text = '$(check) Gemini: Connected';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'disconnected':
                this.statusBarItem.text = '$(x) Gemini: Disconnected';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'error':
                this.statusBarItem.text = '$(error) Gemini: Error';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }
    }

    getStatus(): { isRunning: boolean; serverInfo?: any } {
        return {
            isRunning: !!this.server,
            serverInfo: this.server ? {
                name: 'vscode-gemini-mcp',
                version: '1.0.0',
                transport: 'stdio'
            } : undefined
        };
    }

    showOutput() {
        this.outputChannel.show();
    }

    dispose() {
        this.stop();
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }
}