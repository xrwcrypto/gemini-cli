import * as assert from 'assert';
import { VSCodeMCPServer } from '../mcp/VSCodeMCPServer';

suite('MCP Server Test Suite', () => {
    test('Server can be created', () => {
        const server = new VSCodeMCPServer();
        assert.ok(server, 'Server should be created successfully');
    });

    test('Server provides expected tools', () => {
        const server = new VSCodeMCPServer();
        // Access private method through any type (for testing)
        const tools = (server as any).getAvailableTools();
        
        assert.ok(Array.isArray(tools), 'Tools should be an array');
        assert.ok(tools.length > 0, 'Should have at least one tool');
        
        const toolNames = tools.map((t: any) => t.name);
        assert.ok(toolNames.includes('vscode.openFile'), 'Should include openFile tool');
        assert.ok(toolNames.includes('vscode.getActiveFile'), 'Should include getActiveFile tool');
    });
});