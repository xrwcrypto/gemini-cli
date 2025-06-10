# Testing MCP Integration in VS Code Extension

## Current Status
The MCP (Model Context Protocol) server is integrated but not yet connected to the Gemini CLI. Here's how to test what we have so far:

## 1. Check MCP Server Status
- Open Command Palette (Cmd+Shift+P)
- Run: `Gemini: Show Server Status`
- This will show if the MCP server is running

## 2. View MCP Server Logs
- Open the Output panel (View > Output)
- Select "Gemini MCP Server" from the dropdown
- You should see server initialization logs

## 3. Check Status Bar
- Look at the bottom right of VS Code
- You should see a Gemini status indicator
- Click it to see server status

## What's Working Now:
- ✅ MCP Server can be instantiated
- ✅ Server has VS Code tools defined (openFile, getActiveFile, etc.)
- ✅ Extension loads without errors
- ✅ All UI commands work

## What's Not Yet Connected:
- ❌ CLI doesn't discover the MCP server yet
- ❌ No actual communication between CLI and VS Code
- ❌ /ide command in CLI doesn't work yet

## Next Steps to Complete Integration:

### 1. Create MCP Server Entry Point
We need to create `server-entry.js` that actually starts the MCP server:

```typescript
// src/mcp/server-entry.ts
import { VSCodeMCPServer } from './VSCodeMCPServer';

async function main() {
    const server = new VSCodeMCPServer();
    await server.start();
    
    // Keep the process alive
    process.stdin.resume();
}

main().catch(console.error);
```

### 2. Update CLI to Discover VS Code MCP Server
The CLI needs to:
- Check if running in VS Code terminal (GEMINI_VSCODE_EXTENSION env var)
- Connect to the MCP server via stdio
- Handle /ide commands

### 3. Test Full Integration
Once connected, you can test:
- In Gemini CLI: `/ide open file.ts`
- In Gemini CLI: `/ide show files`
- In Gemini CLI: `/ide get active`

## Manual Testing for Now:
To verify the MCP server can start, you can:

1. Open VS Code Developer Tools (Help > Toggle Developer Tools)
2. In Console, you should see MCP-related logs
3. Check for any errors during server initialization

## Debug Commands:
You can also add a test command to manually trigger MCP operations:

```typescript
registerCommand('gemini.testMCP', async () => {
    if (serverManager) {
        const status = serverManager.getStatus();
        vscode.window.showInformationMessage(
            `MCP Server: ${status.isRunning ? 'Running' : 'Not Running'}`
        );
        
        // Try to start if not running
        if (!status.isRunning) {
            await serverManager.start();
        }
    }
});
```