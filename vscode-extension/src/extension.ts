import * as vscode from 'vscode';

// Store the extension context
let extensionContext: vscode.ExtensionContext;

/**
 * This method is called when the extension is activated
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Gemini CLI VS Code extension is now active!');
    
    extensionContext = context;

    // Register commands
    const commands = [
        vscode.commands.registerCommand('gemini.startSession', startSession),
        vscode.commands.registerCommand('gemini.launchWithContext', launchWithContext),
        vscode.commands.registerCommand('gemini.sendSelection', sendSelection),
        vscode.commands.registerCommand('gemini.showCommandPalette', showCommandPalette),
    ];

    // Add all commands to subscriptions
    commands.forEach(cmd => context.subscriptions.push(cmd));

    // Show activation message
    vscode.window.showInformationMessage('Gemini CLI extension activated');

    // TODO: Initialize MCP server in next task
}

/**
 * This method is called when the extension is deactivated
 */
export function deactivate() {
    console.log('Gemini CLI VS Code extension is deactivating');
    // TODO: Clean up MCP server in next task
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