import * as vscode from 'vscode';
import { ServerManager } from './mcp/ServerManager.js';
import * as path from 'path';
import * as fs from 'fs';

// Store the extension context and server manager
let extensionContext: vscode.ExtensionContext;
let serverManager: ServerManager;
let activeTerminal: vscode.Terminal | undefined;

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
        vscode.commands.registerCommand('gemini.explainCode', () => executeGeminiCommand('Please explain this code')),
        vscode.commands.registerCommand('gemini.generateTests', () => executeGeminiCommand('Please generate unit tests for this code')),
        vscode.commands.registerCommand('gemini.refactorCode', () => executeGeminiCommand('Please suggest refactoring improvements for this code')),
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
    // Check if there's already an active terminal
    if (activeTerminal) {
        activeTerminal.show();
        vscode.window.showInformationMessage('Switched to existing Gemini CLI session');
        return;
    }

    // Create a new terminal for Gemini CLI
    activeTerminal = vscode.window.createTerminal({
        name: 'Gemini CLI',
        env: {
            // Add environment variables to help CLI detect it's in VS Code
            GEMINI_VSCODE_EXTENSION: '1',
            VSCODE_WORKSPACE_FOLDER: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
        }
    });

    // Show the terminal
    activeTerminal.show();

    // Navigate to workspace folder if available
    if (vscode.workspace.workspaceFolders?.length) {
        const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        activeTerminal.sendText(`cd "${workspaceFolder}"`);
    }

    // Launch Gemini CLI
    // TODO: Make this configurable - for now assume it's installed globally
    activeTerminal.sendText('gemini');

    // Listen for terminal close
    const terminalCloseListener = vscode.window.onDidCloseTerminal(closedTerminal => {
        if (closedTerminal === activeTerminal) {
            activeTerminal = undefined;
        }
    });
    extensionContext.subscriptions.push(terminalCloseListener);

    vscode.window.showInformationMessage('Gemini CLI session started');
}

async function launchWithContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor found');
        return;
    }

    const document = editor.document;
    const fileName = document.fileName;
    const selection = editor.selection;
    const selectedText = document.getText(selection);
    const lineNumber = selection.start.line + 1;
    
    // Ensure we have a terminal
    if (!activeTerminal) {
        await startSession();
        // Wait a bit for the CLI to start
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!activeTerminal) {
        vscode.window.showErrorMessage('Failed to start Gemini CLI session');
        return;
    }

    // Show the terminal
    activeTerminal.show();

    // Build context message
    let contextMessage = `I'm looking at ${path.basename(fileName)}`;
    
    if (!selection.isEmpty) {
        contextMessage += ` at lines ${selection.start.line + 1}-${selection.end.line + 1}`;
        if (selectedText.length < 500) {
            // If selection is small, include it directly
            contextMessage += `:\n\`\`\`\n${selectedText}\n\`\`\``;
        }
    } else {
        contextMessage += ` at line ${lineNumber}`;
    }
    
    contextMessage += '\nWhat would you like me to help with?';

    // Send the context to Gemini CLI
    activeTerminal.sendText(contextMessage);
    
    vscode.window.showInformationMessage(`Sent context from ${path.basename(fileName)} to Gemini CLI`);
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

    // Ensure we have a terminal
    if (!activeTerminal) {
        await startSession();
        // Wait a bit for the CLI to start
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!activeTerminal) {
        vscode.window.showErrorMessage('Failed to start Gemini CLI session');
        return;
    }

    // Show the terminal
    activeTerminal.show();

    // Send the selected text to Gemini CLI
    const message = `Here's the selected code:\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\``;
    activeTerminal.sendText(message);
    
    vscode.window.showInformationMessage(`Sent ${text.length} characters to Gemini CLI`);
}

async function showCommandPalette() {
    const editor = vscode.window.activeTextEditor;
    const hasSelection = editor && !editor.selection.isEmpty;
    
    // Show quick pick with Gemini commands
    interface GeminiQuickPickItem extends vscode.QuickPickItem {
        action: string;
    }
    
    const items: GeminiQuickPickItem[] = [
        { 
            label: '$(file-code) Explain Code', 
            description: hasSelection ? 'Explain the selected code' : 'Explain the current file',
            action: 'explain'
        },
        { 
            label: '$(tools) Refactor Code', 
            description: hasSelection ? 'Refactor the selected code' : 'Suggest refactoring for current file',
            action: 'refactor'
        },
        { 
            label: '$(beaker) Generate Tests', 
            description: hasSelection ? 'Generate tests for the selected code' : 'Generate tests for current file',
            action: 'test'
        },
        { 
            label: '$(book) Add Documentation', 
            description: 'Add documentation to the code',
            action: 'document'
        },
        { 
            label: '$(bug) Fix Issues', 
            description: 'Find and fix issues in the code',
            action: 'fix'
        },
        { 
            label: '$(terminal) Open Terminal', 
            description: 'Open Gemini CLI in terminal',
            action: 'terminal'
        },
        { 
            label: '$(server) Server Status', 
            description: 'Show MCP server status',
            action: 'status'
        },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a Gemini CLI action'
    });

    if (!selected) {
        return;
    }

    // Execute the selected action
    switch (selected.action) {
        case 'explain':
            await executeGeminiCommand('Please explain this code');
            break;
        case 'refactor':
            await executeGeminiCommand('Please suggest refactoring improvements for this code');
            break;
        case 'test':
            await executeGeminiCommand('Please generate unit tests for this code');
            break;
        case 'document':
            await executeGeminiCommand('Please add comprehensive documentation to this code');
            break;
        case 'fix':
            await executeGeminiCommand('Please find and fix any issues in this code');
            break;
        case 'terminal':
            await startSession();
            break;
        case 'status':
            await showServerStatus();
            break;
    }
}

async function executeGeminiCommand(prompt: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor found');
        return;
    }

    // Ensure we have a terminal
    if (!activeTerminal) {
        await startSession();
        // Wait a bit for the CLI to start
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!activeTerminal) {
        vscode.window.showErrorMessage('Failed to start Gemini CLI session');
        return;
    }

    // Show the terminal
    activeTerminal.show();

    // Get context
    const selection = editor.selection;
    const selectedText = selection.isEmpty 
        ? editor.document.getText() 
        : editor.document.getText(selection);
    
    const fileName = path.basename(editor.document.fileName);
    const languageId = editor.document.languageId;

    // Build and send the message
    let message = `Looking at ${fileName}`;
    if (!selection.isEmpty) {
        message += ` (selected lines ${selection.start.line + 1}-${selection.end.line + 1})`;
    }
    message += `:\n\`\`\`${languageId}\n${selectedText}\n\`\`\`\n\n${prompt}`;
    
    activeTerminal.sendText(message);
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