import * as vscode from 'vscode';

export interface StatusBarState {
    connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
    sessionActive: boolean;
    tokenUsage?: {
        used: number;
        limit?: number;
    };
    lastActivity?: Date;
}

export class StatusBarManager {
    private mainStatusItem: vscode.StatusBarItem;
    private sessionStatusItem: vscode.StatusBarItem;
    private tokenUsageItem: vscode.StatusBarItem;
    private quickActionItem: vscode.StatusBarItem;
    
    private state: StatusBarState = {
        connectionStatus: 'disconnected',
        sessionActive: false
    };

    constructor() {
        // Main status item - shows connection status
        this.mainStatusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.mainStatusItem.command = 'gemini.showServerStatus';
        
        // Session status - shows if CLI session is active
        this.sessionStatusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.sessionStatusItem.command = 'gemini.startSession';
        
        // Token usage - shows current token consumption
        this.tokenUsageItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            98
        );
        this.tokenUsageItem.command = 'gemini.showTokenUsage';
        
        // Quick action - one-click access to common action
        this.quickActionItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            97
        );
        this.quickActionItem.command = 'gemini.showCommandPalette';
        
        this.updateDisplay();
        this.showAll();
    }

    updateConnectionStatus(status: 'connected' | 'disconnected' | 'connecting' | 'error') {
        this.state.connectionStatus = status;
        this.updateDisplay();
    }

    updateSessionStatus(active: boolean) {
        this.state.sessionActive = active;
        if (active) {
            this.state.lastActivity = new Date();
        }
        this.updateDisplay();
    }

    updateTokenUsage(used: number, limit?: number) {
        this.state.tokenUsage = { used, limit };
        this.updateDisplay();
    }

    private updateDisplay() {
        // Update main status
        switch (this.state.connectionStatus) {
            case 'connected':
                this.mainStatusItem.text = '$(check) Gemini';
                this.mainStatusItem.tooltip = 'Gemini MCP Server: Connected\nClick for details';
                this.mainStatusItem.backgroundColor = undefined;
                break;
            case 'connecting':
                this.mainStatusItem.text = '$(sync~spin) Gemini';
                this.mainStatusItem.tooltip = 'Gemini MCP Server: Connecting...';
                this.mainStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'disconnected':
                this.mainStatusItem.text = '$(x) Gemini';
                this.mainStatusItem.tooltip = 'Gemini MCP Server: Disconnected\nClick to connect';
                this.mainStatusItem.backgroundColor = undefined;
                break;
            case 'error':
                this.mainStatusItem.text = '$(error) Gemini';
                this.mainStatusItem.tooltip = 'Gemini MCP Server: Error\nClick for details';
                this.mainStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }

        // Update session status
        if (this.state.sessionActive) {
            this.sessionStatusItem.text = '$(terminal) CLI Active';
            this.sessionStatusItem.tooltip = 'Gemini CLI session is active\nClick to show terminal';
            this.sessionStatusItem.show();
        } else {
            this.sessionStatusItem.text = '$(terminal) Start CLI';
            this.sessionStatusItem.tooltip = 'Start Gemini CLI session';
            if (this.state.connectionStatus === 'connected') {
                this.sessionStatusItem.show();
            } else {
                this.sessionStatusItem.hide();
            }
        }

        // Update token usage
        if (this.state.tokenUsage && this.state.sessionActive) {
            const { used, limit } = this.state.tokenUsage;
            if (limit) {
                const percentage = Math.round((used / limit) * 100);
                this.tokenUsageItem.text = `$(dashboard) ${percentage}%`;
                this.tokenUsageItem.tooltip = `Token Usage: ${used.toLocaleString()} / ${limit.toLocaleString()}`;
                
                // Color code based on usage
                if (percentage > 90) {
                    this.tokenUsageItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                } else if (percentage > 70) {
                    this.tokenUsageItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                } else {
                    this.tokenUsageItem.backgroundColor = undefined;
                }
            } else {
                this.tokenUsageItem.text = `$(dashboard) ${used.toLocaleString()}`;
                this.tokenUsageItem.tooltip = `Tokens Used: ${used.toLocaleString()}`;
                this.tokenUsageItem.backgroundColor = undefined;
            }
            this.tokenUsageItem.show();
        } else {
            this.tokenUsageItem.hide();
        }

        // Update quick action
        this.quickActionItem.text = '$(sparkle)';
        this.quickActionItem.tooltip = 'Gemini Quick Actions (Cmd+K G)';
    }

    private showAll() {
        this.mainStatusItem.show();
        this.quickActionItem.show();
        // Session and token items are conditionally shown
    }

    dispose() {
        this.mainStatusItem.dispose();
        this.sessionStatusItem.dispose();
        this.tokenUsageItem.dispose();
        this.quickActionItem.dispose();
    }
}