import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Extension Test Suite', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Extension should be activated', async () => {
        const extension = vscode.extensions.getExtension('gemini-cli.gemini-cli-vscode');
        assert.ok(extension);
        
        // Activate extension if not already active
        if (!extension.isActive) {
            await extension.activate();
        }
        
        assert.ok(extension.isActive);
    });

    test('All commands should be registered', async () => {
        const commands = await vscode.commands.getCommands();
        
        const expectedCommands = [
            'gemini.startSession',
            'gemini.launchWithContext',
            'gemini.sendSelection',
            'gemini.showCommandPalette',
            'gemini.showServerStatus'
        ];
        
        for (const cmd of expectedCommands) {
            assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });

    test('Keybindings should be properly configured', async () => {
        // Note: VS Code doesn't provide a direct API to test keybindings
        // This test verifies that commands can be executed, which means keybindings can trigger them
        
        const commandsToTest = [
            'gemini.launchWithContext',
            'gemini.sendSelection',
            'gemini.showCommandPalette'
        ];

        for (const cmd of commandsToTest) {
            // Check that command exists and is executable
            const commands = await vscode.commands.getCommands();
            assert.ok(commands.includes(cmd), `Command ${cmd} should exist for keybinding`);
        }
    });

    test('startSession command should create terminal', async () => {
        // Mock terminal creation
        const mockTerminal = {
            name: 'Gemini CLI',
            show: sandbox.stub(),
            sendText: sandbox.stub()
        };
        
        sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal as any);
        const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage');
        
        // Execute command
        await vscode.commands.executeCommand('gemini.startSession');
        
        // Verify terminal was created
        assert.ok((vscode.window.createTerminal as sinon.SinonStub).calledOnce);
        assert.ok(mockTerminal.show.calledOnce);
        assert.ok(showInfoStub.calledWith('Gemini CLI session started'));
    });

    test('launchWithContext should handle no active editor', async () => {
        // Mock no active editor
        sandbox.stub(vscode.window, 'activeTextEditor').value(undefined);
        const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage');
        
        // Execute command
        await vscode.commands.executeCommand('gemini.launchWithContext');
        
        // Verify warning was shown
        assert.ok(showWarningStub.calledWith('No active editor found'));
    });

    test('sendSelection should handle no selection', async () => {
        // Mock active editor with no selection
        const mockEditor = {
            selection: new vscode.Selection(0, 0, 0, 0),
            document: {
                getText: () => ''
            }
        };
        
        sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage');
        
        // Execute command
        await vscode.commands.executeCommand('gemini.sendSelection');
        
        // Verify warning was shown
        assert.ok(showWarningStub.calledWith('No text selected'));
    });

    test('showCommandPalette should show quick pick', async () => {
        const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);
        
        // Execute command
        await vscode.commands.executeCommand('gemini.showCommandPalette');
        
        // Verify quick pick was shown
        assert.ok(showQuickPickStub.calledOnce);
        const quickPickOptions = showQuickPickStub.firstCall.args[1];
        assert.equal(quickPickOptions?.placeHolder, 'Select a Gemini CLI action');
    });

    test('Commands should handle workspace context properly', async () => {
        // Mock workspace folder
        const mockWorkspaceFolder = {
            uri: vscode.Uri.file('/test/workspace'),
            name: 'test-workspace',
            index: 0
        };
        
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
        
        // Create mock terminal to capture commands
        const mockTerminal = {
            name: 'Gemini CLI',
            show: sandbox.stub(),
            sendText: sandbox.stub()
        };
        
        sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal as any);
        
        // Execute start session
        await vscode.commands.executeCommand('gemini.startSession');
        
        // Verify workspace folder was used
        assert.ok(mockTerminal.sendText.calledWith('cd "/test/workspace"'));
    });
});

suite('Keybinding Tests', () => {
    test('Keybindings should be defined in package.json', () => {
        const packageJson = require('../../package.json');
        const keybindings = packageJson.contributes.keybindings;
        
        assert.ok(Array.isArray(keybindings), 'Keybindings should be an array');
        assert.equal(keybindings.length, 3, 'Should have 3 keybindings defined');
        
        // Verify each keybinding
        const expectedBindings = [
            { command: 'gemini.launchWithContext', key: 'ctrl+shift+g', mac: 'cmd+shift+g' },
            { command: 'gemini.sendSelection', key: 'ctrl+shift+alt+g', mac: 'cmd+shift+alt+g' },
            { command: 'gemini.showCommandPalette', key: 'ctrl+k g', mac: 'cmd+k g' }
        ];
        
        for (const expected of expectedBindings) {
            const binding = keybindings.find((k: any) => k.command === expected.command);
            assert.ok(binding, `Keybinding for ${expected.command} should exist`);
            assert.equal(binding.key, expected.key);
            assert.equal(binding.mac, expected.mac);
        }
    });
});