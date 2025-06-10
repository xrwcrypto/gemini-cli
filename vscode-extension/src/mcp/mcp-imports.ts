// Wrapper for MCP imports to handle CommonJS/ESM issues
export const MCPImports = {
    async getServer() {
        try {
            const serverModule = require('@modelcontextprotocol/sdk/dist/cjs/server/index.js');
            return serverModule.Server;
        } catch (e) {
            console.error('Failed to import Server:', e);
            throw e;
        }
    },
    
    async getStdioServerTransport() {
        try {
            const stdioModule = require('@modelcontextprotocol/sdk/dist/cjs/server/stdio.js');
            return stdioModule.StdioServerTransport;
        } catch (e) {
            console.error('Failed to import StdioServerTransport:', e);
            throw e;
        }
    },
    
    async getTypes() {
        try {
            const typesModule = require('@modelcontextprotocol/sdk/dist/cjs/types.js');
            return {
                CallToolRequestSchema: typesModule.CallToolRequestSchema,
                ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
                Tool: typesModule.Tool
            };
        } catch (e) {
            console.error('Failed to import types:', e);
            throw e;
        }
    }
};