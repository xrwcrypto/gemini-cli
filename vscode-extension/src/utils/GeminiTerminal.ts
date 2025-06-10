import * as vscode from 'vscode';

export class GeminiTerminal {
    private static instance: GeminiTerminal;
    private terminal: vscode.Terminal | undefined;
    private isReady: boolean = false;
    private readyPromise: Promise<void> | undefined;

    private constructor() {}

    static getInstance(): GeminiTerminal {
        if (!GeminiTerminal.instance) {
            GeminiTerminal.instance = new GeminiTerminal();
        }
        return GeminiTerminal.instance;
    }

    /**
     * Ensures a Gemini CLI terminal is running and ready
     */
    async ensureTerminal(context: vscode.ExtensionContext): Promise<vscode.Terminal> {
        if (this.terminal) {
            // Check if terminal is still active
            const terminals = vscode.window.terminals;
            if (terminals.includes(this.terminal)) {
                return this.terminal;
            }
            // Terminal was closed
            this.terminal = undefined;
            this.isReady = false;
        }

        // Create new terminal
        this.terminal = vscode.window.createTerminal({
            name: 'Gemini CLI',
            env: {
                GEMINI_VSCODE_EXTENSION: '1',
                GEMINI_VSCODE_EXTENSION_PATH: context.extensionPath,
                VSCODE_WORKSPACE_FOLDER: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
            }
        });

        // Navigate to workspace folder if available
        if (vscode.workspace.workspaceFolders?.length) {
            const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.terminal.sendText(`cd "${workspaceFolder}"`);
        }

        // Launch Gemini CLI
        const isDevEnvironment = vscode.workspace.workspaceFolders?.some(
            folder => folder.uri.fsPath.includes('gemini-cli')
        );

        if (isDevEnvironment) {
            this.terminal.sendText('npm start');
        } else {
            this.terminal.sendText('gemini');
        }

        // Mark as ready after startup time
        this.readyPromise = new Promise(resolve => {
            setTimeout(() => {
                this.isReady = true;
                resolve();
            }, 4000); // 4 seconds for CLI to start - increased to ensure full initialization
        });

        // Listen for terminal close
        const disposable = vscode.window.onDidCloseTerminal(closedTerminal => {
            if (closedTerminal === this.terminal) {
                this.terminal = undefined;
                this.isReady = false;
                disposable.dispose();
            }
        });

        return this.terminal;
    }

    /**
     * Sends a command to Gemini CLI and executes it immediately
     */
    async sendCommand(command: string, showTerminal: boolean = true): Promise<void> {
        if (!this.terminal) {
            throw new Error('No terminal available');
        }

        if (showTerminal) {
            this.terminal.show();
        }

        // Wait for terminal to be ready
        if (!this.isReady && this.readyPromise) {
            await this.readyPromise;
        }

        // Add a small delay to ensure the terminal is fully interactive
        await new Promise(resolve => setTimeout(resolve, 100));

        // Send command first
        this.terminal.sendText(command, false);
        
        // Small delay between text and Enter
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Send Enter key explicitly
        this.terminal.sendText('', true);
    }

    /**
     * Sends a message without Enter (for multi-line input)
     */
    async sendText(text: string, showTerminal: boolean = true): Promise<void> {
        if (!this.terminal) {
            throw new Error('No terminal available');
        }

        if (showTerminal) {
            this.terminal.show();
        }

        // Wait for terminal to be ready
        if (!this.isReady && this.readyPromise) {
            await this.readyPromise;
        }

        // Send text without Enter
        this.terminal.sendText(text, false);
    }

    /**
     * Executes a Gemini command with context
     */
    async executeWithContext(prompt: string, context: {
        fileName: string;
        languageId: string;
        content: string;
        selection?: { start: number; end: number };
    }): Promise<void> {
        if (!this.terminal) {
            throw new Error('No terminal available');
        }

        this.terminal.show();

        // Wait for terminal to be ready
        if (!this.isReady && this.readyPromise) {
            await this.readyPromise;
        }

        // Build the complete message
        let message = `Looking at ${context.fileName}`;
        if (context.selection) {
            message += ` (selected lines ${context.selection.start}-${context.selection.end})`;
        }
        message += `:\n\`\`\`${context.languageId}\n${context.content}\n\`\`\`\n\n${prompt}`;

        // Add a small delay to ensure the terminal is fully interactive
        await new Promise(resolve => setTimeout(resolve, 100));

        // Send message first
        this.terminal.sendText(message, false);
        
        // Small delay between text and Enter
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Send Enter key explicitly
        this.terminal.sendText('', true);
    }

    /**
     * Checks if terminal is ready
     */
    isTerminalReady(): boolean {
        return this.isReady && this.terminal !== undefined;
    }

    /**
     * Gets the current terminal
     */
    getTerminal(): vscode.Terminal | undefined {
        return this.terminal;
    }
}