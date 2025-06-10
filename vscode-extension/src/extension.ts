import * as vscode from 'vscode';
import { ServerManager } from './mcp/ServerManager';
import { StatusBarManager } from './ui/StatusBarManager';
import { QuickInput } from './ui/QuickInput';
import { NotificationManager } from './ui/NotificationManager';
import * as path from 'path';
import * as fs from 'fs';

// Store the extension context and server manager
let extensionContext: vscode.ExtensionContext;
let serverManager: ServerManager | null;
let statusBarManager: StatusBarManager;
let activeTerminal: vscode.Terminal | undefined;

// Make context available globally for QuickInput (will be set in activate)

/**
 * This method is called when the extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
    try {
        console.log('=== GEMINI EXTENSION ACTIVATION START ===');
        console.log('Activation called at:', new Date().toISOString());
        console.log('Extension context:', context);
        console.log('Extension path:', context.extensionPath);
        
        // Show activation message
        vscode.window.showInformationMessage('Gemini CLI extension activated!');
        
        extensionContext = context;
        (global as any).extensionContext = context;

        // Initialize managers with detailed logging
        console.log('About to initialize StatusBarManager...');
        try {
            statusBarManager = new StatusBarManager();
            console.log('StatusBarManager initialized successfully');
        } catch (e: any) {
            console.error('Failed to initialize StatusBarManager:', e);
            throw e;
        }
        
        console.log('About to initialize ServerManager...');
        try {
            serverManager = new ServerManager(context);
            console.log('ServerManager initialized successfully');
        } catch (e: any) {
            console.error('Failed to initialize ServerManager:', e);
            console.error('Error stack:', e.stack);
            vscode.window.showErrorMessage(`Failed to initialize ServerManager: ${e.message}`);
            // Don't throw - continue without server
            serverManager = null;
        }
        
        context.subscriptions.push(statusBarManager);
        if (serverManager) {
            context.subscriptions.push(serverManager);
        }

    // Register commands with better error handling
    const registerCommand = (commandId: string, handler: (...args: any[]) => any) => {
        try {
            const disposable = vscode.commands.registerCommand(commandId, async (...args) => {
                try {
                    console.log(`Executing command: ${commandId}`);
                    await handler(...args);
                } catch (error) {
                    console.error(`Error in command ${commandId}:`, error);
                    vscode.window.showErrorMessage(`Gemini CLI: ${error}`);
                }
            });
            context.subscriptions.push(disposable);
            console.log(`Registered command: ${commandId}`);
            return disposable;
        } catch (error) {
            console.error(`Failed to register command ${commandId}:`, error);
            vscode.window.showErrorMessage(`Failed to register command ${commandId}: ${error}`);
        }
    };

    // Register all commands
    
    // Test command to verify registration
    registerCommand('gemini.test', () => {
        vscode.window.showInformationMessage('Gemini CLI test command works!');
    });
    
    registerCommand('gemini.startSession', startSession);
    registerCommand('gemini.launchWithContext', launchWithContext);
    registerCommand('gemini.sendSelection', sendSelection);
    registerCommand('gemini.showCommandPalette', showCommandPalette);
    registerCommand('gemini.showServerStatus', showServerStatus);
    registerCommand('gemini.explainCode', () => executeGeminiCommand('Please explain this code'));
    registerCommand('gemini.generateTests', () => executeGeminiCommand('Please generate unit tests for this code'));
    registerCommand('gemini.refactorCode', () => executeGeminiCommand('Please suggest refactoring improvements for this code'));
    registerCommand('gemini.addDocumentation', () => executeGeminiCommand('Please add comprehensive documentation to this code'));
    registerCommand('gemini.fixIssues', () => executeGeminiCommand('Please find and fix any issues in this code'));
    registerCommand('gemini.analyzeFile', analyzeFile);
    registerCommand('gemini.generateTestsForFile', generateTestsForFile);
    registerCommand('gemini.openInGemini', openInGemini);
    registerCommand('gemini.sendQuery', sendQuery);
    registerCommand('gemini.showQuickInput', () => QuickInput.showGeminiInput());
    registerCommand('gemini.showQuickQuery', () => QuickInput.showQuickQuery());
    registerCommand('gemini.showTokenUsage', showTokenUsage);
    registerCommand('gemini.showTerminal', showTerminal);
    registerCommand('gemini.reconnect', reconnect);
    registerCommand('gemini.testMCP', testMCPServer);

    // Auto-start server if configured
    const config = vscode.workspace.getConfiguration('gemini');
    if (config.get<boolean>('autoConnect', true) && serverManager) {
        statusBarManager.updateConnectionStatus('connecting');
        try {
            await serverManager.start();
            statusBarManager.updateConnectionStatus('connected');
            NotificationManager.showConnectionStatus(true);
        } catch (error) {
            statusBarManager.updateConnectionStatus('error');
            vscode.window.showErrorMessage(`Failed to start Gemini MCP server: ${error}`);
        }
    }
    
    // Listen for terminal events
    vscode.window.onDidOpenTerminal(terminal => {
        if (terminal.name === 'Gemini CLI') {
            statusBarManager.updateSessionStatus(true);
        }
    });
    
    vscode.window.onDidCloseTerminal(terminal => {
        if (terminal === activeTerminal) {
            activeTerminal = undefined;
            statusBarManager.updateSessionStatus(false);
        }
    });
    
    console.log('Extension activation completed successfully');
    console.log('=== GEMINI EXTENSION ACTIVATION END ===');
    
    // Return an object with our API if needed by other extensions
    return {
        executeGeminiCommand
    };
    } catch (error: any) {
        console.error('=== EXTENSION ACTIVATION ERROR ===');
        console.error('Error during activation:', error);
        console.error('Error stack:', error.stack);
        vscode.window.showErrorMessage(`Gemini extension activation error: ${error.message}`);
        throw error;
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
    if (!serverManager) {
        vscode.window.showInformationMessage('Server manager not initialized');
        return;
    }
    
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

// Explorer context menu commands

async function analyzeFile(uri: vscode.Uri) {
    if (!uri) {
        vscode.window.showWarningMessage('No file selected');
        return;
    }

    const fileName = path.basename(uri.fsPath);
    
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Analyzing ${fileName} with Gemini CLI...`,
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 10 });

        // Ensure we have a terminal
        if (!activeTerminal) {
            progress.report({ increment: 20, message: 'Starting Gemini CLI...' });
            await startSession();
            // Wait a bit for the CLI to start
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!activeTerminal) {
            vscode.window.showErrorMessage('Failed to start Gemini CLI session');
            return;
        }

        progress.report({ increment: 40, message: 'Reading file...' });

        // Show the terminal
        activeTerminal.show();

        // Read the file content
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const languageId = document.languageId;
            const content = document.getText();

            // Limit content size for very large files
            const contentToSend = content.length > 10000 
                ? content.substring(0, 10000) + '\n... (truncated)'
                : content;

            progress.report({ increment: 70, message: 'Sending to Gemini...' });

            const message = `Please analyze this file (${fileName}):\n\`\`\`${languageId}\n${contentToSend}\n\`\`\`\n\nProvide a summary of what this file does and any potential improvements.`;
            
            activeTerminal.sendText(message);
            progress.report({ increment: 100 });
            
            vscode.window.showInformationMessage(`✨ Analyzing ${fileName} with Gemini CLI`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to read file: ${error}`);
        }
    });
}

async function generateTestsForFile(uri: vscode.Uri) {
    if (!uri) {
        vscode.window.showWarningMessage('No file selected');
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

    // Read the file content
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const fileName = path.basename(uri.fsPath);
        const languageId = document.languageId;
        const content = document.getText();

        // Limit content size for very large files
        const contentToSend = content.length > 10000 
            ? content.substring(0, 10000) + '\n... (truncated)'
            : content;

        const message = `Please generate comprehensive unit tests for this file (${fileName}):\n\`\`\`${languageId}\n${contentToSend}\n\`\`\``;
        
        activeTerminal.sendText(message);
        vscode.window.showInformationMessage(`Generating tests for ${fileName}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to read file: ${error}`);
    }
}

async function openInGemini(uri: vscode.Uri) {
    if (!uri) {
        vscode.window.showWarningMessage('No file selected');
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

    // Send a message about the file
    const fileName = path.basename(uri.fsPath);
    const relativePath = vscode.workspace.asRelativePath(uri.fsPath);
    
    const message = `I'm looking at the file: ${relativePath}\n\nWhat would you like me to help with regarding this file?`;
    
    activeTerminal.sendText(message);
    vscode.window.showInformationMessage(`Opened ${fileName} context in Gemini CLI`);
}

// New UI command implementations

async function sendQuery(query?: string) {
    // If no query provided, show input box
    if (!query) {
        query = await QuickInput.showGeminiInput();
        if (!query) {
            return;
        }
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
    
    // Send the query
    activeTerminal.sendText(query);
    
    // Save to recent queries
    const recent = extensionContext.globalState.get<string[]>('gemini.recentQueries', []);
    const updated = [query, ...recent.filter(q => q !== query)].slice(0, 5);
    extensionContext.globalState.update('gemini.recentQueries', updated);
}

async function showTokenUsage() {
    // This would normally get real token usage from the CLI
    // For now, show mock data
    const usage = {
        session: {
            used: 12345,
            limit: 100000
        },
        daily: {
            used: 45678,
            limit: 1000000
        }
    };

    const items = [
        `Session: ${usage.session.used.toLocaleString()} / ${usage.session.limit.toLocaleString()} (${Math.round(usage.session.used / usage.session.limit * 100)}%)`,
        `Daily: ${usage.daily.used.toLocaleString()} / ${usage.daily.limit.toLocaleString()} (${Math.round(usage.daily.used / usage.daily.limit * 100)}%)`
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Token Usage Information'
    });

    if (selected) {
        vscode.window.showInformationMessage(`Token Usage: ${selected}`);
    }
}

function showTerminal() {
    if (activeTerminal) {
        activeTerminal.show();
    } else {
        vscode.window.showInformationMessage('No active Gemini CLI session. Start one with Cmd+Shift+G');
    }
}

async function reconnect() {
    if (!serverManager) {
        vscode.window.showInformationMessage('Server manager not initialized');
        return;
    }
    
    statusBarManager.updateConnectionStatus('connecting');
    try {
        await serverManager.stop();
        await serverManager.start();
        statusBarManager.updateConnectionStatus('connected');
        NotificationManager.showConnectionStatus(true);
    } catch (error) {
        statusBarManager.updateConnectionStatus('error');
        vscode.window.showErrorMessage(`Failed to reconnect: ${error}`);
    }
}

async function testMCPServer() {
    vscode.window.showInformationMessage('Testing MCP Server...');
    
    if (!serverManager) {
        vscode.window.showErrorMessage('Server manager not initialized');
        return;
    }
    
    const status = serverManager.getStatus();
    
    // Show current status
    vscode.window.showInformationMessage(
        `MCP Server Status: ${status.isRunning ? '✅ Running' : '❌ Not Running'}`
    );
    
    // Show the output channel for debugging
    serverManager.showOutput();
    
    // If not running, try to start it
    if (!status.isRunning) {
        const result = await vscode.window.showInformationMessage(
            'MCP Server is not running. Start it now?',
            'Yes',
            'No'
        );
        
        if (result === 'Yes') {
            try {
                await serverManager.start();
                vscode.window.showInformationMessage('MCP Server started successfully!');
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to start MCP Server: ${error.message}`);
            }
        }
    } else {
        // Server is running - show info
        vscode.window.showInformationMessage(
            `MCP Server Info: ${status.serverInfo?.name} v${status.serverInfo?.version}`
        );
    }
}