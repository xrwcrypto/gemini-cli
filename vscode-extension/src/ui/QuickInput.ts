import * as vscode from 'vscode';

export class QuickInput {
    static async showGeminiInput(): Promise<string | undefined> {
        const result = await vscode.window.showInputBox({
            placeHolder: 'Ask Gemini anything...',
            prompt: 'Enter your question or command for Gemini CLI',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter a question or command';
                }
                return null;
            }
        });

        return result;
    }

    static async showQuickQuery(): Promise<void> {
        // Show quick pick with recent queries and common actions
        interface QueryItem extends vscode.QuickPickItem {
            query?: string;
            action?: string;
        }

        const recentQueries = this.getRecentQueries();
        const items: QueryItem[] = [
            {
                label: '$(edit) Custom Query',
                description: 'Type a custom question',
                action: 'custom'
            },
            {
                label: '$(file-code) Explain Current File',
                description: 'Get an explanation of the active file',
                action: 'explain'
            },
            {
                label: '$(beaker) Generate Tests',
                description: 'Generate tests for current file',
                action: 'test'
            },
            {
                label: '$(tools) Refactor Selection',
                description: 'Refactor the selected code',
                action: 'refactor'
            },
            { kind: vscode.QuickPickItemKind.Separator, label: 'Recent Queries' },
            ...recentQueries.map(q => ({
                label: `$(history) ${q}`,
                query: q
            }))
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a query or action'
        });

        if (!selected) {
            return;
        }

        if (selected.action === 'custom') {
            const query = await this.showGeminiInput();
            if (query) {
                this.saveRecentQuery(query);
                await vscode.commands.executeCommand('gemini.sendQuery', query);
            }
        } else if (selected.action) {
            await vscode.commands.executeCommand(`gemini.${selected.action}Code`);
        } else if (selected.query) {
            await vscode.commands.executeCommand('gemini.sendQuery', selected.query);
        }
    }

    private static getRecentQueries(): string[] {
        const context = (global as any).extensionContext;
        if (!context) return [];
        
        return context.globalState.get('gemini.recentQueries', []) as string[];
    }

    private static saveRecentQuery(query: string) {
        const context = (global as any).extensionContext;
        if (!context) return;
        
        const recent = this.getRecentQueries();
        const updated = [query, ...recent.filter(q => q !== query)].slice(0, 5);
        context.globalState.update('gemini.recentQueries', updated);
    }
}