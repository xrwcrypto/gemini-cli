import * as assert from 'assert';
import * as vscode from 'vscode';
import { VSCodeMCPServer } from '../../mcp/VSCodeMCPServer';

suite('MCP Tools Test Suite', () => {
    let server: VSCodeMCPServer;

    setup(() => {
        server = new VSCodeMCPServer();
    });

    suite('Tool Registration', () => {
        test('All required tools are registered', () => {
            const tools = (server as any).getAvailableTools();
            const toolNames = tools.map((t: any) => t.name);
            
            const requiredTools = [
                'vscode.openFile',
                'vscode.getActiveFile',
                'vscode.getOpenFiles',
                'vscode.getWorkspaceFolders',
                'vscode.showNotification',
                'vscode.updateStatusBar'
            ];
            
            requiredTools.forEach(toolName => {
                assert.ok(
                    toolNames.includes(toolName),
                    `Tool ${toolName} should be registered`
                );
            });
        });

        test('Tool schemas are valid', () => {
            const tools = (server as any).getAvailableTools();
            
            tools.forEach((tool: any) => {
                assert.ok(tool.name, 'Tool should have a name');
                assert.ok(tool.description, 'Tool should have a description');
                assert.ok(tool.inputSchema, 'Tool should have an input schema');
                assert.equal(tool.inputSchema.type, 'object', 'Input schema should be an object');
            });
        });
    });

    suite('Tool Execution', () => {
        test('executeTool handles unknown tools', async () => {
            try {
                await (server as any).executeTool('unknown.tool', {});
                assert.fail('Should throw error for unknown tool');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes('Unknown tool'));
            }
        });

        test('getActiveFile returns proper structure', () => {
            const result = (server as any).getActiveFile();
            
            assert.ok(result.hasOwnProperty('success'), 'Result should have success property');
            assert.ok(result.hasOwnProperty('activeFile'), 'Result should have activeFile property');
            
            if (result.activeFile) {
                assert.ok(result.activeFile.path, 'Active file should have path');
                assert.ok(result.activeFile.languageId, 'Active file should have languageId');
            }
        });

        test('getWorkspaceFolders returns proper structure', () => {
            const result = (server as any).getWorkspaceFolders();
            
            assert.ok(result.hasOwnProperty('success'), 'Result should have success property');
            assert.ok(result.hasOwnProperty('workspaceFolders'), 'Result should have workspaceFolders');
            assert.ok(Array.isArray(result.workspaceFolders), 'workspaceFolders should be an array');
            assert.ok(result.hasOwnProperty('folderCount'), 'Result should have folderCount');
        });

        test('getOpenFiles returns proper structure', () => {
            const result = (server as any).getOpenFiles();
            
            assert.ok(result.hasOwnProperty('success'), 'Result should have success property');
            assert.ok(result.hasOwnProperty('openFiles'), 'Result should have openFiles');
            assert.ok(Array.isArray(result.openFiles), 'openFiles should be an array');
            assert.ok(result.hasOwnProperty('totalCount'), 'Result should have totalCount');
        });
    });

    suite('Error Handling', () => {
        test('openFile validates required path', async () => {
            const result = await (server as any).openFile({ path: '' });
            
            assert.equal(result.success, false, 'Should fail with empty path');
            assert.ok(result.error.includes('Path is required'), 'Should have appropriate error message');
        });

        test('openFile handles non-existent files', async () => {
            const result = await (server as any).openFile({ 
                path: '/non/existent/file.txt' 
            });
            
            assert.equal(result.success, false, 'Should fail for non-existent file');
            assert.ok(result.error.includes('File not found'), 'Should have file not found error');
        });

        test('showNotification handles all notification types', async () => {
            const types = ['info', 'warning', 'error'];
            
            for (const type of types) {
                const result = await (server as any).showNotification({
                    message: `Test ${type} message`,
                    type
                });
                
                assert.equal(result.success, true, `Should succeed for ${type} notification`);
                assert.equal(result.type, type, `Should return correct type`);
            }
        });
    });

    suite('Input Validation', () => {
        test('openFile validates line numbers', async () => {
            // This test would need a real file to test properly
            // For now, just verify the schema
            const tools = (server as any).getAvailableTools();
            const openFileTool = tools.find((t: any) => t.name === 'vscode.openFile');
            
            assert.ok(openFileTool.inputSchema.properties.line);
            assert.equal(openFileTool.inputSchema.properties.line.type, 'number');
        });

        test('Tool schemas have proper required fields', () => {
            const tools = (server as any).getAvailableTools();
            
            const openFileTool = tools.find((t: any) => t.name === 'vscode.openFile');
            assert.deepEqual(openFileTool.inputSchema.required, ['path']);
            
            const notificationTool = tools.find((t: any) => t.name === 'vscode.showNotification');
            assert.deepEqual(notificationTool.inputSchema.required, ['message']);
            
            const statusBarTool = tools.find((t: any) => t.name === 'vscode.updateStatusBar');
            assert.deepEqual(statusBarTool.inputSchema.required, ['text']);
        });
    });
});