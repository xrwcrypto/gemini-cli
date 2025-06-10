import * as vscode from 'vscode';
import { ServerManager } from './mcp/ServerManager.js';

// Store the extension context and server manager
let extensionContext: vscode.ExtensionContext;
let serverManager: ServerManager;

/**
 * This method is called when the extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Gemini CLI VS Code extension is now active!');
    
    extensionContext = context;

    // Initialize MCP server manager
    serverManager = new ServerManager(context);
    context.subscriptions.push(serverManager);

    // Register commands
    const commands = [
        vscode.commands.registerCommand('gemini.startSession', startSession),
        vscode.commands.registerCommand('gemini.launchWithContext', launchWithContext),
        vscode.commands.registerCommand('gemini.sendSelection', sendSelection),
        vscode.commands.registerCommand('gemini.showCommandPalette', showCommandPalette),
        vscode.commands.registerCommand('gemini.showServerStatus', showServerStatus),
    ];

    // Add all commands to subscriptions
    commands.forEach(cmd => context.subscriptions.push(cmd));

    // Auto-start server if configured
    const config = vscode.workspace.getConfiguration('gemini');
    if (config.get<boolean>('autoConnect', true)) {
        try {
            await serverManager.start();
            vscode.window.showInformationMessage('Gemini MCP server started');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start Gemini MCP server: ${error}`);
        }
    }
}

/**
 * This method is called when the extension is deactivated
 */
export async function deactivate() {
    console.log('Gemini CLI VS Code extension is deactivating');
    if (serverManager) {
        await serverManager.stop();
    }
}

// Command implementations

async function startSession() {
    vscode.window.showInformationMessage('Starting Gemini CLI session...');
    // TODO: Implement terminal launch and CLI connection
}

async function launchWithContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor found');
        return;
    }

    const document = editor.document;
    const fileName = document.fileName;
    
    vscode.window.showInformationMessage(`Launching Gemini CLI with context from ${fileName}`);
    // TODO: Launch CLI with file context
}

async function sendSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor found');
        return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);
    
    if (!text) {
        vscode.window.showWarningMessage('No text selected');
        return;
    }

    vscode.window.showInformationMessage(`Sending selected text to Gemini CLI (${text.length} characters)`);
    // TODO: Send selection to active CLI session
}

async function showCommandPalette() {
    // Show quick pick with Gemini commands
    const items: vscode.QuickPickItem[] = [
        { label: '$(file-code) Explain Code', description: 'Explain the selected code' },
        { label: '$(tools) Refactor Code', description: 'Refactor the selected code' },
        { label: '$(beaker) Generate Tests', description: 'Generate tests for the selected code' },
        { label: '$(book) Add Documentation', description: 'Add documentation to the code' },
        { label: '$(bug) Fix Issues', description: 'Fix issues in the code' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a Gemini CLI action'
    });

    if (selected) {
        vscode.window.showInformationMessage(`Selected: ${selected.label}`);
        // TODO: Execute selected action
    }
}

async function showServerStatus() {
    const status = serverManager.getStatus();
    
    if (status.isRunning) {
        const items = [
            { label: '$(output) Show Server Logs', value: 'logs' },
            { label: '$(debug-stop) Stop Server', value: 'stop' },
            { label: '$(info) Server Info', value: 'info' },
        ];
        
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'MCP Server is running'
        });
        
        switch (selected?.value) {
            case 'logs':
                serverManager.showOutput();
                break;
            case 'stop':
                await serverManager.stop();
                vscode.window.showInformationMessage('MCP Server stopped');
                break;
            case 'info':
                vscode.window.showInformationMessage(
                    `MCP Server: ${status.serverInfo?.name} v${status.serverInfo?.version}`
                );
                break;
        }
    } else {
        const result = await vscode.window.showInformationMessage(
            'MCP Server is not running',
            'Start Server'
        );
        
        if (result === 'Start Server') {
            try {
                await serverManager.start();
                vscode.window.showInformationMessage('MCP Server started');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start server: ${error}`);
            }
        }
    }
}