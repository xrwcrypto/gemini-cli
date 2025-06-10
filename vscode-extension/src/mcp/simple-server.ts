#!/usr/bin/env node
/**
 * Simple MCP Server for VS Code integration
 * Returns mock data for now - can be enhanced later
 */

// Import MCP SDK using the wrapper to handle CommonJS compatibility
const { MCPImports } = require('./mcp-imports');

async function main() {
    try {
        console.error('Loading MCP SDK components...');
        
        // Load MCP SDK components
        const Server = await MCPImports.getServer();
        const StdioServerTransport = await MCPImports.getStdioServerTransport();
        const ListToolsRequestSchema = await MCPImports.getListToolsRequestSchema();
        const CallToolRequestSchema = await MCPImports.getCallToolRequestSchema();
        
        console.error('Creating MCP server...');
        
        const server = new Server(
            {
                name: 'vscode-gemini-mcp',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        // Tool definitions
        const tools = [
            {
                name: 'vscode.openFile',
                description: 'Open a file in VS Code editor',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path to open' },
                        line: { type: 'number', description: 'Line number (1-based)' },
                        column: { type: 'number', description: 'Column number (1-based)' },
                    },
                    required: ['path'],
                },
            },
            {
                name: 'vscode.getActiveFile',
                description: 'Get the currently active file in VS Code',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'vscode.getOpenFiles',
                description: 'Get all currently open files in VS Code',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'vscode.getWorkspaceFolders',
                description: 'Get all workspace folders',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'vscode.showNotification',
                description: 'Show a notification in VS Code',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', description: 'Notification message' },
                        type: { type: 'string', enum: ['info', 'warning', 'error'] },
                    },
                    required: ['message'],
                },
            },
        ];

        // Handle tool listing
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            console.error('Received list tools request');
            return { tools };
        });

        // Handle tool execution
        server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
            const { name, arguments: args } = request.params;
            console.error(`Received tool call: ${name}`, args);
            
            // For now, return mock responses
            // In a real implementation, this would communicate with VS Code
            let result: any;
            
            switch (name) {
                case 'vscode.getActiveFile':
                    result = {
                        success: true,
                        activeFile: {
                            path: process.env.VSCODE_WORKSPACE_FOLDER + '/example.ts',
                            languageId: 'typescript',
                            lineCount: 100,
                            isDirty: false,
                        },
                    };
                    break;
                    
                case 'vscode.getOpenFiles':
                    result = {
                        success: true,
                        openFiles: [
                            { path: process.env.VSCODE_WORKSPACE_FOLDER + '/example.ts', isDirty: false },
                            { path: process.env.VSCODE_WORKSPACE_FOLDER + '/test.js', isDirty: true },
                        ],
                    };
                    break;
                    
                case 'vscode.getWorkspaceFolders':
                    result = {
                        success: true,
                        workspaceFolders: [
                            { name: 'dev', path: process.env.VSCODE_WORKSPACE_FOLDER || '/workspace' },
                        ],
                    };
                    break;
                    
                case 'vscode.openFile':
                    result = {
                        success: true,
                        message: `Would open file: ${args.path}${args.line ? ` at line ${args.line}` : ''}`,
                    };
                    break;
                    
                case 'vscode.showNotification':
                    result = {
                        success: true,
                        message: `Notification shown: ${args.message}`,
                    };
                    break;
                    
                default:
                    result = {
                        success: false,
                        error: `Unknown tool: ${name}`,
                    };
            }
            
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        });

        // Start the server
        console.error('Starting MCP server on stdio...');
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('Simple MCP Server started successfully');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.error('Shutting down MCP Server...');
            await server.close();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            console.error('Shutting down MCP Server...');
            await server.close();
            process.exit(0);
        });
        
    } catch (error: any) {
        console.error('Failed to start MCP Server:', error);
        console.error('Error details:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});