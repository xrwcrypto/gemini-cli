# Gemini CLI for VS Code

This extension provides deep integration between VS Code and the Gemini CLI, enabling AI-powered coding assistance directly within your editor.

## Features

- 🚀 **Quick Launch**: Start Gemini CLI sessions with keyboard shortcuts
- 📝 **Context Aware**: Automatically include current file context
- 🎯 **Smart Selection**: Send selected code to Gemini for analysis
- 🛠️ **Rich Commands**: Access Gemini features through command palette
- 🔌 **MCP Integration**: Communicates via Model Context Protocol

## Requirements

- VS Code 1.85.0 or higher
- Gemini CLI installed (`npm install -g @gemini-cli/cli`)
- Valid Gemini API key

## Extension Settings

- `gemini.enabled`: Enable/disable the extension
- `gemini.autoConnect`: Automatically connect on startup
- `gemini.mcpServer.port`: MCP server port configuration

## Keyboard Shortcuts

- `Cmd/Ctrl+Shift+G`: Launch Gemini with current file
- `Cmd/Ctrl+Shift+Alt+G`: Send selection to Gemini
- `Cmd/Ctrl+K G`: Show Gemini command palette

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