# VS Code Integration Technical Design for Gemini CLI

## Overview
This document outlines the technical design for integrating VS Code with the Gemini CLI, allowing users to interact with their VS Code environment through the CLI when running inside VS Code's integrated terminal.

## Goals
1. Enable bidirectional communication between Gemini CLI and VS Code
2. Provide VS Code-specific tools and commands through `/ide` slash command
3. Allow the CLI to manipulate VS Code workspace (open files, navigate, execute commands)
4. Maintain compatibility with other environments (graceful degradation)
5. Integrate deeply with VS Code UI through keyboard shortcuts, menus, and panels

## Architecture Approach

### 1. **MCP Server Extension for VS Code**
Create a VS Code extension that acts as an MCP (Model Context Protocol) server, exposing VS Code functionality as tools.

**Benefits:**
- Leverages existing MCP infrastructure in Gemini CLI
- Clean separation of concerns
- Standard protocol for tool discovery and execution
- Can be published separately as VS Code extension

**Components:**
- VS Code Extension (`vscode-gemini-mcp-server`)
  - MCP server implementation
  - VS Code API wrappers as MCP tools
  - WebSocket/IPC communication layer
  - Keyboard shortcuts and command registration
  - Menu contributions (context menus, command palette)
  - Custom views and panels
  - CodeLens and hover providers
- Gemini CLI modifications
  - Auto-detection of VS Code terminal environment
  - Automatic MCP server connection when in VS Code

### 2. **VS Code Detection and Connection**

#### Environment Detection
```typescript
// In packages/cli/src/utils/vscode-detector.ts
export function isRunningInVSCode(): boolean {
  return !!(
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.VSCODE_IPC_HOOK ||
    process.env.VSCODE_GIT_IPC_HANDLE
  );
}

export function getVSCodeWorkspacePath(): string | undefined {
  // Check for workspace folder passed via environment
  return process.env.VSCODE_WORKSPACE_FOLDER;
}
```

#### Auto-Connection Flow
1. CLI startup detects VS Code environment
2. Checks if VS Code MCP extension is installed/running
3. Establishes connection to local MCP server
4. Registers VS Code tools in tool registry

### 3. **VS Code MCP Tools**

The VS Code extension will expose the following tools via MCP:

#### File Operations
- `vscode.openFile` - Open file in editor with optional line/column
- `vscode.createFile` - Create new file in workspace
- `vscode.showDiff` - Show diff view between two files/versions

#### Navigation
- `vscode.goToDefinition` - Navigate to symbol definition
- `vscode.goToLine` - Jump to specific line in current file
- `vscode.search` - Trigger workspace search with query

#### Workspace Information
- `vscode.getOpenFiles` - List currently open editors
- `vscode.getWorkspaceFolders` - Get workspace folder information
- `vscode.getActiveFile` - Get current active editor file

#### Editor Commands
- `vscode.executeCommand` - Execute any VS Code command
- `vscode.showQuickPick` - Show VS Code quick pick UI
- `vscode.showInputBox` - Show VS Code input box

#### Debugging
- `vscode.setBreakpoint` - Set breakpoint at line
- `vscode.startDebugging` - Start debugging session

#### UI Manipulation
- `vscode.showNotification` - Display notifications
- `vscode.updateStatusBar` - Update status bar text
- `vscode.registerCodeLens` - Add CodeLens dynamically
- `vscode.showWebview` - Display custom webview panel

### 4. **Slash Command Integration**

Add `/ide` command to slash command processor:

```typescript
// In packages/cli/src/ui/hooks/processors/slashCommandProcessor.ts
{
  command: 'ide',
  description: 'VS Code IDE operations (when running in VS Code terminal)',
  handler: async (args: string[]) => {
    if (!isRunningInVSCode()) {
      return {
        type: 'error',
        content: 'This command is only available when running in VS Code terminal'
      };
    }
    
    // Handle subcommands like:
    // /ide open <file>
    // /ide goto <line>
    // /ide search <query>
    // /ide command <vscode-command>
  }
}
```

### 5. **Communication Protocol**

#### MCP Server (VS Code Extension Side)
```typescript
// VS Code extension implementation
class VSCodeMCPServer {
  private server: MCPServer;
  
  constructor() {
    this.server = new MCPServer({
      name: 'vscode-mcp-server',
      version: '1.0.0',
      tools: this.registerTools()
    });
  }
  
  private registerTools() {
    return [
      {
        name: 'vscode.openFile',
        description: 'Open a file in VS Code',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            line: { type: 'number', optional: true },
            column: { type: 'number', optional: true }
          }
        },
        handler: async (params) => {
          const doc = await vscode.workspace.openTextDocument(params.path);
          const editor = await vscode.window.showTextDocument(doc);
          if (params.line) {
            const position = new vscode.Position(params.line - 1, params.column || 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
          }
        }
      },
      // ... other tools
    ];
  }
}
```

#### CLI Side Integration
```typescript
// In packages/cli/src/vscode/vscode-integration.ts
export class VSCodeIntegration {
  private mcpClient?: MCPClient;
  
  async initialize() {
    if (!isRunningInVSCode()) return;
    
    try {
      // Connect to local VS Code MCP server
      this.mcpClient = await MCPClient.connect({
        transport: 'stdio',
        command: 'code',
        args: ['--mcp-server']
      });
      
      // Register tools with main tool registry
      const tools = await this.mcpClient.listTools();
      tools.forEach(tool => {
        toolRegistry.register(new MCPToolAdapter(tool, this.mcpClient));
      });
    } catch (error) {
      console.warn('VS Code MCP server not available:', error);
    }
  }
}
```

### 6. **Enhanced Features**

#### Context Awareness
- Automatically include current file context when in VS Code
- Access to VS Code's language services for better code understanding
- Integration with VS Code's Git information

#### Bi-directional Communication
- VS Code can send events to CLI (file saves, selection changes)
- CLI can update VS Code UI (status bar, notifications)

#### Workspace Management
- Create/manage VS Code tasks from CLI
- Access VS Code's terminal API for better integration
- Manage VS Code extensions

### 7. **VS Code UI Integration**

#### Keyboard Shortcuts
The extension will register the following keyboard shortcuts:

```json
{
  "keybindings": [
    {
      "command": "gemini.launchWithContext",
      "key": "ctrl+shift+g",
      "mac": "cmd+shift+g",
      "when": "editorTextFocus"
    },
    {
      "command": "gemini.sendSelection",
      "key": "ctrl+shift+alt+g",
      "mac": "cmd+shift+alt+g",
      "when": "editorHasSelection"
    },
    {
      "command": "gemini.showCommandPalette",
      "key": "ctrl+k g",
      "mac": "cmd+k g"
    }
  ]
}
```

#### Context Menu Contributions

```typescript
// package.json contributions
{
  "menus": {
    "editor/context": [
      {
        "submenu": "gemini.editorSubmenu",
        "group": "gemini",
        "when": "editorTextFocus"
      }
    ],
    "explorer/context": [
      {
        "submenu": "gemini.explorerSubmenu",
        "group": "gemini"
      }
    ],
    "gemini.editorSubmenu": [
      {
        "command": "gemini.explainCode",
        "when": "editorHasSelection"
      },
      {
        "command": "gemini.refactorCode",
        "when": "editorHasSelection"
      },
      {
        "command": "gemini.generateTests"
      },
      {
        "command": "gemini.fixIssues"
      },
      {
        "command": "gemini.addDocumentation"
      }
    ]
  }
}
```

#### Command Palette Commands

```typescript
// Command registration
const commands = [
  {
    id: 'gemini.startSession',
    title: 'Gemini: Start CLI Session',
    handler: startCLISession
  },
  {
    id: 'gemini.explainCode',
    title: 'Gemini: Explain Selected Code',
    handler: explainSelectedCode
  },
  {
    id: 'gemini.refactorCode',
    title: 'Gemini: Refactor Selected Code',
    handler: refactorSelectedCode
  },
  {
    id: 'gemini.generateTests',
    title: 'Gemini: Generate Tests for Function',
    handler: generateTests
  },
  {
    id: 'gemini.analyzeProject',
    title: 'Gemini: Analyze Project Structure',
    handler: analyzeProject
  }
];
```

#### Status Bar Integration

```typescript
// Status bar item
const statusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,
  100
);
statusBarItem.text = '$(gemini-icon) Gemini: Connected';
statusBarItem.tooltip = 'Click for Gemini CLI options';
statusBarItem.command = 'gemini.showStatusMenu';
```

#### CodeLens Provider

```typescript
class GeminiCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    
    // Add CodeLens above functions and classes
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );
    
    symbols.forEach(symbol => {
      if (symbol.kind === vscode.SymbolKind.Function || 
          symbol.kind === vscode.SymbolKind.Class) {
        codeLenses.push(
          new vscode.CodeLens(symbol.location.range, {
            title: '📖 Explain',
            command: 'gemini.explainSymbol',
            arguments: [symbol]
          }),
          new vscode.CodeLens(symbol.location.range, {
            title: '🧪 Generate Tests',
            command: 'gemini.generateTests',
            arguments: [symbol]
          })
        );
      }
    });
    
    return codeLenses;
  }
}
```

#### Custom Views and Panels

```typescript
// Sidebar view provider
class GeminiSidebarProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.html = this.getWebviewContent();
    webviewView.webview.onDidReceiveMessage(this.handleMessage);
  }
  
  private getWebviewContent(): string {
    return `
      <div class="gemini-sidebar">
        <h3>Active Session</h3>
        <div class="session-info">...</div>
        <h3>Recent Commands</h3>
        <div class="command-history">...</div>
        <h3>Saved Prompts</h3>
        <div class="prompts">...</div>
      </div>
    `;
  }
}

// Register in extension activation
vscode.window.registerWebviewViewProvider(
  'geminiSidebar',
  new GeminiSidebarProvider()
);
```

#### Hover Provider

```typescript
class GeminiHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const wordRange = document.getWordRangeAtPosition(position);
    const word = document.getText(wordRange);
    
    const hoverContent = new vscode.MarkdownString();
    hoverContent.appendMarkdown(`**${word}**\n\n`);
    hoverContent.appendMarkdown('Description from context...\n\n');
    hoverContent.appendMarkdown('[Ask Gemini](command:gemini.askAbout?${encodeURIComponent(word)}) | ');
    hoverContent.appendMarkdown('[View Examples](command:gemini.showExamples?${encodeURIComponent(word)})');
    hoverContent.isTrusted = true;
    
    return new vscode.Hover(hoverContent, wordRange);
  }
}
```

#### Quick Fix Provider

```typescript
class GeminiQuickFixProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    
    // Add quick fixes for diagnostics
    context.diagnostics.forEach(diagnostic => {
      const fixAction = new vscode.CodeAction(
        '💡 Fix with Gemini CLI',
        vscode.CodeActionKind.QuickFix
      );
      fixAction.command = {
        command: 'gemini.fixIssue',
        arguments: [diagnostic, document, range]
      };
      actions.push(fixAction);
      
      const explainAction = new vscode.CodeAction(
        '💡 Explain this error',
        vscode.CodeActionKind.QuickFix
      );
      explainAction.command = {
        command: 'gemini.explainError',
        arguments: [diagnostic]
      };
      actions.push(explainAction);
    });
    
    return actions;
  }
}
```

### 8. **Implementation Phases**

**Phase 1: Basic Integration**
- VS Code detection
- Basic MCP server in VS Code extension
- File open/navigation tools
- `/ide` command structure
- Basic keyboard shortcuts

**Phase 2: Enhanced Tools**
- Full tool suite implementation
- Bi-directional events
- Context awareness
- Context menus and command palette
- Status bar integration

**Phase 3: Advanced Features**
- Debugging integration
- Extension management
- Custom UI components (sidebar, webviews)
- CodeLens and hover providers
- Quick fixes and code actions

## Security Considerations

1. **Permission Model**
   - VS Code extension requires explicit user consent
   - Limited to workspace boundaries
   - No access to system-level operations beyond VS Code API

2. **Communication Security**
   - Local-only communication (no network exposure)
   - Process isolation between CLI and VS Code

## Configuration

```yaml
# .gemini/config.yaml
vscode:
  enabled: true
  autoConnect: true
  mcpServer:
    port: 'auto'  # or specific port
  features:
    contextAwareness: true
    bidirectionalSync: true
    ui:
      shortcuts: true
      contextMenus: true
      statusBar: true
      codeLens: true
      sidebar: true
      quickFixes: true
  shortcuts:
    launchWithContext: 'cmd+shift+g'
    sendSelection: 'cmd+shift+alt+g'
    commandPalette: 'cmd+k g'
```

## Error Handling

- Graceful fallback when VS Code integration unavailable
- Clear error messages for missing VS Code extension
- Timeout handling for MCP connection attempts

## Testing Strategy

1. Unit tests for detection logic
2. Integration tests with mock MCP server
3. E2E tests with real VS Code instance
4. Manual testing of all tools and edge cases

## Documentation Updates

1. Add VS Code integration guide to CLI documentation
2. Create VS Code extension documentation
3. Add examples and tutorials for common workflows
4. Update troubleshooting guide

## Success Metrics

- Successful detection rate in VS Code terminals
- Tool execution performance (<100ms latency)
- User adoption and feedback
- Reduction in context switching between CLI and IDE