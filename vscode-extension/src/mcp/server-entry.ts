#!/usr/bin/env node
/**
 * MCP Server entry point for stdio transport
 * This file is executed as a separate process to run the MCP server
 */

import { VSCodeMCPServer } from './VSCodeMCPServer';

async function main() {
    console.error('Starting VS Code MCP Server...');
    
    try {
        const server = new VSCodeMCPServer();
        await server.start();
        
        console.error('VS Code MCP Server started successfully');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.error('Shutting down VS Code MCP Server...');
            await server.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            console.error('Shutting down VS Code MCP Server...');
            await server.stop();
            process.exit(0);
        });
        
        // Keep the process alive
        process.stdin.resume();
        
    } catch (error) {
        console.error('Failed to start VS Code MCP Server:', error);
        process.exit(1);
    }
}

// Run the server
main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});