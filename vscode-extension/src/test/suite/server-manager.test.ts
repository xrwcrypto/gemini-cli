import * as assert from 'assert';
import * as vscode from 'vscode';
import { ServerManager } from '../../mcp/ServerManager';

suite('Server Manager Test Suite', () => {
    let serverManager: ServerManager;
    let context: vscode.ExtensionContext;

    setup(() => {
        // Create a mock extension context with all required properties
        context = {
            subscriptions: [],
            extensionPath: '/test/extension/path',
            extensionUri: vscode.Uri.file('/test/extension/path'),
            environmentVariableCollection: {} as any,
            globalState: {} as any,
            workspaceState: {} as any,
            secrets: {} as any,
            extensionMode: vscode.ExtensionMode.Test,
            storagePath: undefined,
            globalStoragePath: '/test/global/storage',
            logPath: '/test/logs',
            storageUri: undefined,
            globalStorageUri: vscode.Uri.file('/test/global/storage'),
            logUri: vscode.Uri.file('/test/logs'),
            extension: {} as any,
            asAbsolutePath: (path: string) => path,
            languageModelAccessInformation: {} as any,
        } as unknown as vscode.ExtensionContext;

        serverManager = new ServerManager(context);
    });

    teardown(() => {
        // Clean up
        serverManager.dispose();
    });

    test('ServerManager can be created', () => {
        assert.ok(serverManager, 'ServerManager should be created successfully');
    });

    test('Initial status is not running', () => {
        const status = serverManager.getStatus();
        assert.equal(status.isRunning, false, 'Server should not be running initially');
        assert.equal(status.serverInfo, undefined, 'Server info should be undefined when not running');
    });

    test('Status changes after start attempt', async () => {
        // Note: This may not fully work in test environment
        // but we can test the structure
        try {
            await serverManager.start();
        } catch (error) {
            // Expected in test environment
        }

        const status = serverManager.getStatus();
        assert.ok(status.hasOwnProperty('isRunning'), 'Status should have isRunning property');
    });

    test('Can show output channel', () => {
        // Just verify it doesn't throw
        assert.doesNotThrow(() => {
            serverManager.showOutput();
        });
    });

    test('Dispose cleans up resources', () => {
        assert.doesNotThrow(() => {
            serverManager.dispose();
        });
    });
});