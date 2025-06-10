# Gemini CLI for VS Code

This extension provides deep integration between VS Code and the Gemini CLI, enabling AI-powered coding assistance directly within your editor.

## Features

- 🚀 **Quick Launch**: Start Gemini CLI sessions with keyboard shortcuts
- 📝 **Context Aware**: Automatically include current file context
- 🎯 **Smart Selection**: Send selected code to Gemini for analysis
- 🛠️ **Rich Commands**: Access Gemini features through command palette
- 🔌 **MCP Integration**: Communicates via Model Context Protocol
- 🔧 **IDE Commands**: Use `/ide` commands to control VS Code from the CLI

## Requirements

- VS Code 1.85.0 or higher
- Gemini CLI installed (`npm install -g @gemini-cli/cli`)
- Valid Gemini API key

## Extension Settings

- `gemini.enabled`: Enable/disable the extension
- `gemini.autoConnect`: Automatically connect on startup
- `gemini.mcpServer.port`: MCP server port configuration

## IDE Commands

When running Gemini CLI from a VS Code terminal, you can use these `/ide` commands:

- `/ide active` - Get information about the currently active file
- `/ide open <file> [line] [column]` - Open a file in VS Code  
- `/ide files` - List all open files
- `/ide workspace` - Get workspace folders
- `/ide notify <message> [type]` - Show a notification in VS Code
- `/ide status <text>` - Update the status bar

**Important**: 
- The extension automatically sets environment variables for new terminals
- If you already have a terminal open, you'll need to create a new one after installing the extension
- The MCP server needs 2-3 seconds to initialize when first starting the CLI
- Use `/mcp` to check server connection status

## Keyboard Shortcuts

- `Cmd/Ctrl+Shift+G`: Launch Gemini with current file
- `Cmd/Ctrl+Shift+Alt+G`: Send selection to Gemini
- `Cmd/Ctrl+K G`: Show Gemini command palette

## Troubleshooting

### /ide commands not working

1. **Create a new terminal**: The extension sets environment variables for new terminals. If you had a terminal open before installing the extension, close it and create a new one.

2. **Check environment variables**: Run this in your terminal to verify:
   ```bash
   echo $GEMINI_VSCODE_EXTENSION
   echo $GEMINI_VSCODE_EXTENSION_PATH
   ```
   Both should have values if the extension is working correctly.

3. **Use the command palette**: Instead of manually running `gemini`, use:
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Gemini: Start Session"

4. **Manual workaround**: If needed, set the variables manually:
   ```bash
   export GEMINI_VSCODE_EXTENSION=1
   export GEMINI_VSCODE_EXTENSION_PATH="$HOME/.vscode/extensions/gemini-cli.gemini-cli-vscode-0.1.0"
   gemini
   ```

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Run tests
npm test
```

## License

Apache-2.0