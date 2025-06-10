import * as vscode from 'vscode';

export interface GeminiNotification {
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    actions?: {
        label: string;
        command: string;
        args?: any[];
    }[];
}

export class NotificationManager {
    private static readonly NOTIFICATION_TIMEOUT = 5000;

    static async show(notification: GeminiNotification): Promise<void> {
        const actions = notification.actions?.map(a => a.label) || [];
        
        let selection: string | undefined;
        
        switch (notification.type) {
            case 'info':
                selection = await vscode.window.showInformationMessage(
                    notification.message,
                    ...actions
                );
                break;
            case 'warning':
                selection = await vscode.window.showWarningMessage(
                    notification.message,
                    ...actions
                );
                break;
            case 'error':
                selection = await vscode.window.showErrorMessage(
                    notification.message,
                    ...actions
                );
                break;
            case 'success':
                // VS Code doesn't have a specific success notification, use info with emoji
                selection = await vscode.window.showInformationMessage(
                    `✅ ${notification.message}`,
                    ...actions
                );
                break;
        }

        // Execute action if selected
        if (selection && notification.actions) {
            const action = notification.actions.find(a => a.label === selection);
            if (action) {
                await vscode.commands.executeCommand(action.command, ...(action.args || []));
            }
        }
    }

    static showProgress(
        title: string,
        task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>
    ): Thenable<void> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false
        }, task);
    }

    static async showQuickResponse(response: string, actions?: GeminiNotification['actions']): Promise<void> {
        // For quick responses, show a temporary notification that auto-dismisses
        const notification: GeminiNotification = {
            type: 'info',
            message: response.length > 100 ? response.substring(0, 100) + '...' : response,
            actions: actions || [{
                label: 'Show in Terminal',
                command: 'gemini.showTerminal'
            }]
        };

        await this.show(notification);
    }

    static showTokenWarning(used: number, limit: number): void {
        const percentage = Math.round((used / limit) * 100);
        
        if (percentage > 90) {
            this.show({
                type: 'warning',
                message: `Token usage is at ${percentage}% (${used.toLocaleString()} / ${limit.toLocaleString()})`,
                actions: [{
                    label: 'View Usage',
                    command: 'gemini.showTokenUsage'
                }]
            });
        }
    }

    static showConnectionStatus(connected: boolean): void {
        if (connected) {
            this.show({
                type: 'success',
                message: 'Connected to Gemini MCP Server',
                actions: [{
                    label: 'Start CLI Session',
                    command: 'gemini.startSession'
                }]
            });
        } else {
            this.show({
                type: 'error',
                message: 'Disconnected from Gemini MCP Server',
                actions: [{
                    label: 'Reconnect',
                    command: 'gemini.reconnect'
                }]
            });
        }
    }
}