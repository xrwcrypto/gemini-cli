import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Gemini CLI extension activated - minimal version');
    
    const disposable = vscode.commands.registerCommand('gemini.test', () => {
        vscode.window.showInformationMessage('Gemini CLI test command works!');
    });
    
    context.subscriptions.push(disposable);
    
    console.log('Command registered successfully');
}

export function deactivate() {
    console.log('Gemini CLI extension deactivated');
}