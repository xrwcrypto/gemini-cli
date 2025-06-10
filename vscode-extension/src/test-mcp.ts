// Test file to debug MCP imports
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
    console.log('=== MCP IMPORT TEST START ===');
    
    try {
        console.log('About to import MCP Server...');
        const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
        console.log('Server imported successfully:', Server);
        
        console.log('About to import StdioServerTransport...');
        const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
        console.log('StdioServerTransport imported successfully:', StdioServerTransport);
        
        console.log('About to import types...');
        const types = await import('@modelcontextprotocol/sdk/types.js');
        console.log('Types imported successfully:', Object.keys(types));
        
        vscode.window.showInformationMessage('MCP imports successful!');
    } catch (error: any) {
        console.error('MCP import failed:', error);
        console.error('Error stack:', error.stack);
        vscode.window.showErrorMessage(`MCP import failed: ${error.message}`);
    }
    
    console.log('=== MCP IMPORT TEST END ===');
}

export function deactivate() {}