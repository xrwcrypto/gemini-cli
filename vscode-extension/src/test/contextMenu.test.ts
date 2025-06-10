import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';

suite('Context Menu Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Context menu commands should be registered', async () => {
        const commands = await vscode.commands.getCommands();
        
        const contextMenuCommands = [
            'gemini.addDocumentation',
            'gemini.fixIssues',
            'gemini.analyzeFile',
            'gemini.generateTestsForFile',
            'gemini.openInGemini'
        ];
        
        for (const cmd of contextMenuCommands) {
            assert.ok(commands.includes(cmd), `Context menu command ${cmd} should be registered`);
        }
    });

    test('Editor context menu should have correct structure', () => {
        const packageJson = require('../../package.json');
        const editorSubmenu = packageJson.contributes.menus['gemini.editorSubmenu'];
        
        assert.ok(Array.isArray(editorSubmenu), 'Editor submenu should be defined');
        assert.ok(editorSubmenu.length >= 5, 'Should have at least 5 items in editor submenu');
        
        // Check grouping
        const groups = new Set(editorSubmenu.map((item: any) => item.group.split('@')[0]));
        assert.ok(groups.has('1_launch'), 'Should have launch group');
        assert.ok(groups.has('2_actions'), 'Should have actions group');
        assert.ok(groups.has('3_documentation'), 'Should have documentation group');
        assert.ok(groups.has('4_fix'), 'Should have fix group');
    });

    test('Explorer context menu should have correct structure', () => {
        const packageJson = require('../../package.json');
        const explorerSubmenu = packageJson.contributes.menus['gemini.explorerSubmenu'];
        
        assert.ok(Array.isArray(explorerSubmenu), 'Explorer submenu should be defined');
        assert.equal(explorerSubmenu.length, 3, 'Should have 3 items in explorer submenu');
        
        // Check commands
        const commands = explorerSubmenu.map((item: any) => item.command);
        assert.ok(commands.includes('gemini.analyzeFile'));
        assert.ok(commands.includes('gemini.generateTestsForFile'));
        assert.ok(commands.includes('gemini.openInGemini'));
    });

    test('analyzeFile should handle file URI correctly', async () => {
        const mockUri = vscode.Uri.file('/test/file.ts');
        const mockDocument = {
            languageId: 'typescript',
            getText: () => 'const test = "hello";'
        };
        
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
        const mockTerminal = {
            show: sandbox.stub(),
            sendText: sandbox.stub()
        };
        sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal as any);
        
        await vscode.commands.executeCommand('gemini.analyzeFile', mockUri);
        
        // Verify terminal was used
        assert.ok(mockTerminal.show.called);
        assert.ok(mockTerminal.sendText.called);
        
        const sentText = mockTerminal.sendText.firstCall.args[0];
        assert.ok(sentText.includes('Please analyze this file'));
        assert.ok(sentText.includes('file.ts'));
    });

    test('generateTestsForFile should handle large files', async () => {
        const mockUri = vscode.Uri.file('/test/large-file.js');
        const largeContent = 'x'.repeat(15000); // Create content larger than 10000 chars
        const mockDocument = {
            languageId: 'javascript',
            getText: () => largeContent
        };
        
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument as any);
        const mockTerminal = {
            show: sandbox.stub(),
            sendText: sandbox.stub()
        };
        sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal as any);
        
        await vscode.commands.executeCommand('gemini.generateTestsForFile', mockUri);
        
        const sentText = mockTerminal.sendText.firstCall.args[0];
        assert.ok(sentText.includes('(truncated)'), 'Large files should be truncated');
        assert.ok(sentText.includes('generate comprehensive unit tests'));
    });

    test('openInGemini should use relative paths', async () => {
        const mockUri = vscode.Uri.file('/workspace/src/test.py');
        const mockWorkspaceFolder = {
            uri: vscode.Uri.file('/workspace')
        };
        
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);
        sandbox.stub(vscode.workspace, 'asRelativePath').returns('src/test.py');
        
        const mockTerminal = {
            show: sandbox.stub(),
            sendText: sandbox.stub()
        };
        sandbox.stub(vscode.window, 'createTerminal').returns(mockTerminal as any);
        
        await vscode.commands.executeCommand('gemini.openInGemini', mockUri);
        
        const sentText = mockTerminal.sendText.firstCall.args[0];
        assert.ok(sentText.includes('src/test.py'), 'Should use relative path');
        assert.ok(sentText.includes("What would you like me to help with"));
    });

    test('Context menu items should respect when clauses', () => {
        const packageJson = require('../../package.json');
        const editorSubmenu = packageJson.contributes.menus['gemini.editorSubmenu'];
        
        // Find send selection item
        const sendSelectionItem = editorSubmenu.find((item: any) => 
            item.command === 'gemini.sendSelection'
        );
        
        assert.ok(sendSelectionItem, 'Send selection item should exist');
        assert.equal(sendSelectionItem.when, 'editorHasSelection', 
            'Send selection should only appear when text is selected');
    });

    test('Editor title menu should filter by file type', () => {
        const packageJson = require('../../package.json');
        const editorTitleMenu = packageJson.contributes.menus['editor/title'];
        
        assert.ok(Array.isArray(editorTitleMenu), 'Editor title menu should be defined');
        
        const launchItem = editorTitleMenu.find((item: any) => 
            item.command === 'gemini.launchWithContext'
        );
        
        assert.ok(launchItem, 'Launch with context should be in editor title');
        assert.ok(launchItem.when.includes('resourceExtname'), 
            'Should filter by file extension');
    });

    test('Submenus should have proper labels and icons', () => {
        const packageJson = require('../../package.json');
        const submenus = packageJson.contributes.submenus;
        
        assert.equal(submenus.length, 2, 'Should have 2 submenus');
        
        for (const submenu of submenus) {
            assert.equal(submenu.label, 'Gemini CLI', 'Submenu should be labeled');
            assert.equal(submenu.icon, '$(sparkle)', 'Submenu should have sparkle icon');
        }
    });
});