// Wrapper for MCP imports to handle CommonJS/ESM issues
export const MCPImports = {
    async getServer() {
        try {
            const serverModule = require('@modelcontextprotocol/sdk/server/index.js');
            return serverModule.Server;
        } catch (e) {
            console.error('Failed to import Server:', e);
            throw e;
        }
    },
    
    async getStdioServerTransport() {
        try {
            const stdioModule = require('@modelcontextprotocol/sdk/server/stdio.js');
            return stdioModule.StdioServerTransport;
        } catch (e) {
            console.error('Failed to import StdioServerTransport:', e);
            throw e;
        }
    },
    
    async getListToolsRequestSchema() {
        try {
            const typesModule = require('@modelcontextprotocol/sdk/types.js');
            return typesModule.ListToolsRequestSchema;
        } catch (e) {
            console.error('Failed to import ListToolsRequestSchema:', e);
            throw e;
        }
    },
    
    async getCallToolRequestSchema() {
        try {
            const typesModule = require('@modelcontextprotocol/sdk/types.js');
            return typesModule.CallToolRequestSchema;
        } catch (e) {
            console.error('Failed to import CallToolRequestSchema:', e);
            throw e;
        }
    },
    
    async getTypes() {
        try {
            const typesModule = require('@modelcontextprotocol/sdk/types.js');
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