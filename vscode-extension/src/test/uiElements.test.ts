import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { StatusBarManager } from '../ui/StatusBarManager';
import { NotificationManager } from '../ui/NotificationManager';
import { QuickInput } from '../ui/QuickInput';

suite('UI Elements Test Suite', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('StatusBarManager', () => {
        test('Should create all status bar items', () => {
            const createStatusBarItemStub = sandbox.stub(vscode.window, 'createStatusBarItem');
            createStatusBarItemStub.returns({
                show: sandbox.stub(),
                hide: sandbox.stub(),
                dispose: sandbox.stub(),
                text: '',
                tooltip: '',
                command: '',
                backgroundColor: undefined
            } as any);

            const manager = new StatusBarManager();

            // Should create 4 status bar items
            assert.equal(createStatusBarItemStub.callCount, 4);
            
            manager.dispose();
        });

        test('Should update connection status correctly', () => {
            const mockStatusItem = {
                show: sandbox.stub(),
                hide: sandbox.stub(),
                dispose: sandbox.stub(),
                text: '',
                tooltip: '',
                command: '',
                backgroundColor: undefined
            };

            sandbox.stub(vscode.window, 'createStatusBarItem').returns(mockStatusItem as any);

            const manager = new StatusBarManager();
            
            // Test different connection states
            manager.updateConnectionStatus('connected');
            assert.ok(mockStatusItem.text.includes('$(check)'));
            
            manager.updateConnectionStatus('disconnected');
            assert.ok(mockStatusItem.text.includes('$(x)'));
            
            manager.updateConnectionStatus('error');
            assert.ok(mockStatusItem.text.includes('$(error)'));
            
            manager.dispose();
        });

        test('Should update token usage with color coding', () => {
            const mockTokenItem = {
                show: sandbox.stub(),
                hide: sandbox.stub(),
                dispose: sandbox.stub(),
                text: '',
                tooltip: '',
                command: '',
                backgroundColor: undefined
            };

            sandbox.stub(vscode.window, 'createStatusBarItem').returns(mockTokenItem as any);

            const manager = new StatusBarManager();
            manager.updateSessionStatus(true);
            
            // Test low usage (no background color)
            manager.updateTokenUsage(5000, 100000);
            assert.ok(mockTokenItem.text.includes('5%'));
            assert.equal(mockTokenItem.backgroundColor, undefined);
            
            // Test warning level (>70%)
            manager.updateTokenUsage(75000, 100000);
            assert.ok(mockTokenItem.text.includes('75%'));
            assert.ok(mockTokenItem.backgroundColor);
            
            manager.dispose();
        });
    });

    suite('NotificationManager', () => {
        test('Should show different notification types', async () => {
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();
            const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves();
            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

            await NotificationManager.show({ type: 'info', message: 'Info message' });
            assert.ok(showInfoStub.calledWith('Info message'));

            await NotificationManager.show({ type: 'warning', message: 'Warning message' });
            assert.ok(showWarningStub.calledWith('Warning message'));

            await NotificationManager.show({ type: 'error', message: 'Error message' });
            assert.ok(showErrorStub.calledWith('Error message'));

            await NotificationManager.show({ type: 'success', message: 'Success message' });
            assert.ok(showInfoStub.calledWith('✅ Success message'));
        });

        test('Should execute action when selected', async () => {
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
            sandbox.stub(vscode.window, 'showInformationMessage').resolves('Test Action' as any);

            await NotificationManager.show({
                type: 'info',
                message: 'Test',
                actions: [{
                    label: 'Test Action',
                    command: 'test.command',
                    args: ['arg1', 'arg2']
                }]
            });

            assert.ok(executeCommandStub.calledWith('test.command', 'arg1', 'arg2'));
        });

        test('Should show token warning at high usage', () => {
            const showStub = sandbox.stub(NotificationManager, 'show');

            NotificationManager.showTokenWarning(95000, 100000);

            assert.ok(showStub.called);
            const notification = showStub.firstCall.args[0];
            assert.equal(notification.type, 'warning');
            assert.ok(notification.message.includes('95%'));
        });
    });

    suite('QuickInput', () => {
        test('Should show input box with validation', async () => {
            const showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
            showInputBoxStub.resolves('test query');

            const result = await QuickInput.showGeminiInput();

            assert.equal(result, 'test query');
            const options = showInputBoxStub.firstCall.args[0];
            assert.ok(options);
            assert.ok(options!.validateInput);
            
            // Test validation
            const validation = options!.validateInput!('');
            assert.ok(validation); // Should return error message for empty input
        });

        test('Should show quick query with recent queries', async () => {
            // Mock extension context
            (global as any).extensionContext = {
                globalState: {
                    get: sandbox.stub().returns(['query1', 'query2']),
                    update: sandbox.stub()
                }
            };

            const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
            showQuickPickStub.resolves({ label: '$(history) query1', query: 'query1' } as any);

            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');

            await QuickInput.showQuickQuery();

            assert.ok(showQuickPickStub.called);
            const items = showQuickPickStub.firstCall.args[0];
            assert.ok(Array.isArray(items));
            assert.ok(items.some((item: any) => item.label.includes('query1')));
            assert.ok(executeCommandStub.calledWith('gemini.sendQuery', 'query1'));

            // Clean up
            delete (global as any).extensionContext;
        });

        test('Should handle custom query action', async () => {
            (global as any).extensionContext = {
                globalState: {
                    get: sandbox.stub().returns([]),
                    update: sandbox.stub()
                }
            };

            const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
            showQuickPickStub.resolves({ label: '$(edit) Custom Query', action: 'custom' } as any);

            const showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
            showInputBoxStub.resolves('new custom query');

            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');

            await QuickInput.showQuickQuery();

            assert.ok(showInputBoxStub.called);
            assert.ok(executeCommandStub.calledWith('gemini.sendQuery', 'new custom query'));

            // Clean up
            delete (global as any).extensionContext;
        });
    });

    suite('UI Commands', () => {
        test('All UI commands should be registered', async () => {
            const commands = await vscode.commands.getCommands();
            
            const uiCommands = [
                'gemini.sendQuery',
                'gemini.showQuickInput',
                'gemini.showQuickQuery',
                'gemini.showTokenUsage',
                'gemini.showTerminal',
                'gemini.reconnect'
            ];
            
            for (const cmd of uiCommands) {
                assert.ok(commands.includes(cmd), `UI command ${cmd} should be registered`);
            }
        });
    });
});