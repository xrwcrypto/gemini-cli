# Gemini CLI for VS Code

Deep VS Code integration for Gemini CLI - your AI-powered coding assistant.

## Features

- **🚀 Quick Launch**: Start Gemini CLI sessions directly from VS Code
- **📝 Context-Aware**: Send code context and selections to Gemini CLI
- **⌨️ Keyboard Shortcuts**: Quick access to common AI actions
- **🔧 MCP Integration**: Automatic VS Code tool integration via Model Context Protocol
- **💡 Smart Commands**: Explain code, generate tests, refactor, and more

## Context Menus

Right-click in the editor or file explorer to access Gemini CLI commands:

### Editor Context Menu
- **Launch with Context** - Start Gemini with the current file
- **Send Selection** - Send selected text (only appears when text is selected)
- **Explain Code** - Get an explanation of the code
- **Generate Tests** - Create unit tests
- **Refactor Code** - Get refactoring suggestions
- **Add Documentation** - Generate documentation
- **Fix Issues** - Find and fix problems

### Explorer Context Menu
- **Analyze File** - Get a comprehensive analysis of the file
- **Generate Tests for File** - Create tests for the entire file
- **Open in Gemini CLI** - Start a conversation about the file

## Status Bar

The extension adds multiple status bar items:

- **Connection Status** - Shows MCP server status (connected/disconnected/error)
- **Session Status** - Indicates if a Gemini CLI terminal is active
- **Token Usage** - Displays current token consumption with color coding
- **Quick Actions** - One-click access to Gemini commands (sparkle icon)

## Keyboard Shortcuts

- **Cmd+Shift+G** (Mac) / **Ctrl+Shift+G** (Windows/Linux): Launch Gemini with current file context
- **Cmd+Shift+Alt+G** (Mac) / **Ctrl+Shift+Alt+G** (Windows/Linux): Send selected text to Gemini
- **Cmd+K G** (Mac) / **Ctrl+K G** (Windows/Linux): Show Gemini command palette
- **Cmd+Shift+Space** (Mac) / **Ctrl+Shift+Space** (Windows/Linux): Quick query input

## Commands

All commands are available through the Command Palette (Cmd+Shift+P / Ctrl+Shift+P):

- **Gemini: Start CLI Session** - Open a new terminal with Gemini CLI
- **Gemini: Launch with Current File Context** - Start Gemini with context from the current file
- **Gemini: Send Selected Text** - Send the selected code to Gemini
- **Gemini: Show Command Palette** - Quick access to common Gemini actions
- **Gemini: Explain Code** - Get an explanation of the current code
- **Gemini: Generate Tests** - Generate unit tests for your code
- **Gemini: Refactor Code** - Get refactoring suggestions
- **Gemini: Show Server Status** - Check MCP server connection status
- **Gemini: Send Query** - Send a custom query to Gemini
- **Gemini: Quick Input** - Open input box for Gemini queries
- **Gemini: Quick Query** - Access recent queries and common actions
- **Gemini: Show Token Usage** - View detailed token consumption
- **Gemini: Show Terminal** - Focus on the Gemini CLI terminal
- **Gemini: Reconnect Server** - Restart the MCP server connection

## MCP Server Integration

The extension automatically starts an MCP (Model Context Protocol) server that provides VS Code-specific tools to Gemini CLI:

- **vscode.openFile** - Open files in the editor
- **vscode.getActiveFile** - Get information about the currently active file
- **vscode.getOpenFiles** - List all open files
- **vscode.getWorkspaceFolders** - Get workspace information
- **vscode.showNotification** - Display VS Code notifications
- **vscode.updateStatusBar** - Update the status bar

## Usage

1. **Start a Session**: Use Cmd+Shift+G to launch Gemini CLI with your current file context
2. **Send Code**: Select code and press Cmd+Shift+Alt+G to send it to Gemini
3. **Quick Actions**: Press Cmd+K G to access common actions like explaining code or generating tests
4. **IDE Commands**: In the Gemini CLI terminal, use `/ide` commands:
   - `/ide status` - Check VS Code integration status
   - `/ide open <file>` - Open a file in VS Code
   - `/ide search <query>` - Search in workspace
   - `/ide files` - List open files
   - `/ide active` - Get active file info

## Requirements

- VS Code 1.85.0 or higher
- Gemini CLI installed globally (`npm install -g @gemini-cli/cli`)

## Settings

Configure the extension through VS Code settings:

- `gemini.enabled`: Enable/disable Gemini CLI integration
- `gemini.autoConnect`: Automatically connect to Gemini CLI when VS Code starts
- `gemini.mcpServer.port`: MCP server port (default: auto)

## Installation

1. Install from the VS Code Marketplace (search for "Gemini CLI")
2. Or install manually:
   ```bash
   cd vscode-extension
   npm install
   npm run package
   code --install-extension gemini-cli-vscode-*.vsix
   ```

## Troubleshooting

- **MCP Server not starting**: Check the Output panel (View > Output > Gemini MCP Server)
- **Commands not working**: Ensure Gemini CLI is installed globally
- **No VS Code tools in CLI**: Check `/mcp` command in Gemini CLI to verify server connection

## License

Apache-2.0