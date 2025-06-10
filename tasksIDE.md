# IDE Integration Task Breakdown

## General Development Guidance

### **Core Principles**
- **Use TypeScript:** Implement all components using TypeScript with standard project layout
- **Test-Driven Development:** Write tests before implementing each task
- **Build and Test:** Use `make build` and `make test` commands consistently

### **Post-Task Checklist**
1. Update `archVSCodeIntegration.md` if any architectural changes were made
2. Mark the task as complete in `tasksIDE.md`
3. Document implementation notes and architectural decisions in `tasksIDE.md`
4. Update remaining tasks if architecture changes affected dependencies
5. Ensure `make build` and `make test` run successfully with no warnings
6. Run a linter and fix any issues, run tests and fix any issues
7. Stage all changes with `git add .` (or specific files)
8. Commit changes with descriptive commit message following conventional commits:
   ```bash
   git commit -m "feat(vscode): [task description]
   
   - [detail 1]
   - [detail 2]
   - [detail 3]"
   ```
9. Push to feature branch: `git push origin vscode-integration`
10. Don't include Claude as an author or coauthor

### **Code Quality Standards**
- **Testing:** Table-driven tests with subtests, >80% coverage, mock external dependencies

## Initial Setup

### Task 0: Create Feature Branch [ ]
**Priority:** Critical  
**Dependencies:** None  
**Description:** Set up Git feature branch for VS Code integration work

**Subtasks:**
- [ ] Ensure working directory is clean with `git status`
- [ ] Create and checkout feature branch: `git checkout -b vscode-integration`
- [ ] Push branch to remote: `git push -u origin vscode-integration`
- [ ] Verify branch is set up correctly

**Acceptance Criteria:**
- Feature branch created and pushed
- All work will be done on this branch
- Branch is tracking remote

---

## Phase 1: Basic Integration

### Task 1: VS Code Environment Detection [ ]
**Priority:** High  
**Dependencies:** None  
**Description:** Implement VS Code terminal detection utilities

**Subtasks:**
- [ ] Create `packages/cli/src/utils/vscode-detector.ts`
- [ ] Implement `isRunningInVSCode()` function with environment variable checks
- [ ] Implement `getVSCodeWorkspacePath()` function
- [ ] Add unit tests for detection logic with various environment configurations
- [ ] Export utilities from package index

**Acceptance Criteria:**
- Correctly detects VS Code terminal environment
- Returns workspace path when available
- 100% test coverage for detection functions

---

### Task 2: VS Code Extension Project Setup [ ]
**Priority:** High  
**Dependencies:** None  
**Description:** Create VS Code extension project structure

**Subtasks:**
- [ ] Create `vscode-extension/` directory at project root
- [ ] Initialize VS Code extension with `yo code` or manual setup
- [ ] Configure TypeScript and build pipeline
- [ ] Set up extension manifest (`package.json`) with contribution points
- [ ] Add MCP server dependencies
- [ ] Create basic extension activation logic
- [ ] Set up extension development environment
- [ ] Configure package.json for commands, menus, and keybindings
- [ ] Add VS Code API types and dependencies

**Acceptance Criteria:**
- Extension can be loaded in VS Code
- TypeScript compilation works
- Basic activation/deactivation lifecycle works
- Extension contributes commands to command palette

---

### Task 3: MCP Server Implementation in VS Code Extension [ ]
**Priority:** High  
**Dependencies:** Task 2  
**Description:** Implement MCP server within VS Code extension

**Subtasks:**
- [ ] Research and add MCP server library/implementation
- [ ] Create `VSCodeMCPServer` class
- [ ] Implement server initialization and lifecycle
- [ ] Set up communication protocol (stdio/websocket/IPC)
- [ ] Add error handling and logging
- [ ] Create server start/stop commands
- [ ] Test server connectivity

**Acceptance Criteria:**
- MCP server starts when extension activates
- Server is discoverable via standard MCP discovery
- Clean shutdown on extension deactivation

---

### Task 4: Basic VS Code Tools Implementation [ ]
**Priority:** High  
**Dependencies:** Task 3  
**Description:** Implement core VS Code tools as MCP tools

**Subtasks:**
- [ ] Implement `vscode.openFile` tool with line/column support
- [ ] Implement `vscode.getActiveFile` tool
- [ ] Implement `vscode.getOpenFiles` tool
- [ ] Implement `vscode.getWorkspaceFolders` tool
- [ ] Implement `vscode.showNotification` tool
- [ ] Implement `vscode.updateStatusBar` tool
- [ ] Add proper error handling for each tool
- [ ] Create tool schemas following MCP specification
- [ ] Add unit tests for each tool

**Acceptance Criteria:**
- Each tool executes VS Code API correctly
- Tools handle errors gracefully
- Tools return data in expected MCP format
- UI manipulation tools update VS Code interface

---

### Task 5: CLI MCP Client Integration [ ]
**Priority:** High  
**Dependencies:** Task 1  
**Description:** Add VS Code MCP server connection to CLI

**Subtasks:**
- [ ] Create `packages/cli/src/vscode/vscode-integration.ts`
- [ ] Implement `VSCodeIntegration` class
- [ ] Add auto-connection logic on CLI startup
- [ ] Integrate with existing MCP client infrastructure
- [ ] Handle connection failures gracefully
- [ ] Add connection retry logic with backoff
- [ ] Register discovered tools with tool registry

**Acceptance Criteria:**
- CLI detects and connects to VS Code MCP server automatically
- Tools from VS Code appear in tool registry
- Connection failures don't crash CLI

---

### Task 6: Slash Command Implementation [ ]
**Priority:** Medium  
**Dependencies:** Task 5  
**Description:** Add `/ide` slash command to CLI

**Subtasks:**
- [ ] Add `/ide` command to `slashCommandProcessor.ts`
- [ ] Implement command parser for subcommands
- [ ] Add `open`, `goto`, `search` subcommands
- [ ] Add help text and usage examples
- [ ] Handle VS Code unavailability gracefully
- [ ] Add command completion suggestions
- [ ] Write tests for command processing

**Acceptance Criteria:**
- `/ide` command appears in help
- Subcommands work correctly
- Appropriate error when not in VS Code

---

### Task 7: Keyboard Shortcuts and Commands [ ]
**Priority:** High  
**Dependencies:** Task 2  
**Description:** Implement keyboard shortcuts and command palette integration

**Subtasks:**
- [ ] Define keybindings in extension package.json
- [ ] Implement `gemini.launchWithContext` command handler
- [ ] Implement `gemini.sendSelection` command handler
- [ ] Implement `gemini.showCommandPalette` command handler
- [ ] Add command registration in extension activation
- [ ] Create command handlers that communicate with CLI
- [ ] Test keyboard shortcuts on Windows/Mac/Linux
- [ ] Add customizable keybinding support

**Acceptance Criteria:**
- All keyboard shortcuts work as defined
- Commands appear in command palette
- Commands correctly interact with CLI
- Keybindings are customizable

---

### Task 8: Context Menu Integration [ ]
**Priority:** High  
**Dependencies:** Task 7  
**Description:** Add context menus to editor and explorer

**Subtasks:**
- [ ] Define menu contributions in package.json
- [ ] Create editor context submenu for Gemini commands
- [ ] Create explorer context submenu
- [ ] Implement menu command handlers
- [ ] Add dynamic menu item visibility based on context
- [ ] Test menu items with different file types
- [ ] Add icons for menu items

**Acceptance Criteria:**
- Context menus appear in correct locations
- Menu items execute correct commands
- Submenus organize commands logically
- Dynamic visibility works correctly

---

### Task 9: Status Bar and UI Elements [ ]
**Priority:** Medium  
**Dependencies:** Task 4  
**Description:** Implement status bar item and other UI elements

**Subtasks:**
- [ ] Create status bar item showing connection status
- [ ] Add click handler for status menu
- [ ] Implement token usage display
- [ ] Add quick input box for Gemini queries
- [ ] Create progress indicators for long operations
- [ ] Add notification system for CLI responses
- [ ] Test UI elements in different themes

**Acceptance Criteria:**
- Status bar shows accurate connection status
- Click actions work correctly
- UI elements are theme-aware
- Progress indicators show during operations

---

## Phase 2: Enhanced Tools

### Task 10: Advanced File Operations [ ]
**Priority:** Medium  
**Dependencies:** Task 4  
**Description:** Implement advanced file manipulation tools

**Subtasks:**
- [ ] Implement `vscode.createFile` tool
- [ ] Implement `vscode.showDiff` tool
- [ ] Implement `vscode.revealInExplorer` tool
- [ ] Add file watcher integration
- [ ] Add workspace file search tool
- [ ] Test with various file types and encodings

**Acceptance Criteria:**
- File operations work across workspace
- Diff view opens correctly
- File creation respects VS Code settings

---

### Task 11: Navigation Tools [ ]
**Priority:** Medium  
**Dependencies:** Task 4  
**Description:** Implement code navigation tools

**Subtasks:**
- [ ] Implement `vscode.goToDefinition` tool
- [ ] Implement `vscode.goToLine` tool with column support
- [ ] Implement `vscode.search` workspace search tool
- [ ] Implement `vscode.findReferences` tool
- [ ] Add symbol search capabilities
- [ ] Test with different language services

**Acceptance Criteria:**
- Navigation preserves context
- Search results are actionable
- Works with VS Code's language services

---

### Task 12: Editor Command Execution [ ]
**Priority:** Medium  
**Dependencies:** Task 4  
**Description:** Enable execution of arbitrary VS Code commands

**Subtasks:**
- [ ] Implement `vscode.executeCommand` tool
- [ ] Add command discovery/listing
- [ ] Implement `vscode.showQuickPick` tool
- [ ] Implement `vscode.showInputBox` tool
- [ ] Add command parameter validation
- [ ] Create safe command allowlist

**Acceptance Criteria:**
- Commands execute correctly
- UI elements show and return values
- Dangerous commands are filtered

---

### Task 13: Bi-directional Communication [ ]
**Priority:** Low  
**Dependencies:** Task 5  
**Description:** Enable VS Code to send events to CLI

**Subtasks:**
- [ ] Design event protocol over MCP
- [ ] Implement file save event forwarding
- [ ] Implement selection change events
- [ ] Add event subscription management
- [ ] Handle event buffering/throttling
- [ ] Test event reliability

**Acceptance Criteria:**
- Events flow from VS Code to CLI
- No performance degradation
- Events can be filtered/subscribed

---

### Task 14: Context Awareness [ ]
**Priority:** Low  
**Dependencies:** Task 13  
**Description:** Automatically include VS Code context in CLI

**Subtasks:**
- [ ] Auto-detect current file context
- [ ] Include Git information from VS Code
- [ ] Add language service information
- [ ] Integrate with VS Code's problems panel
- [ ] Add workspace settings context
- [ ] Test context accuracy

**Acceptance Criteria:**
- Context is automatically available
- Context updates on VS Code changes
- No privacy/security leaks

---

## Phase 3: Advanced Features

### Task 15: CodeLens Provider Implementation [ ]
**Priority:** Medium  
**Dependencies:** Task 7  
**Description:** Add inline code actions via CodeLens

**Subtasks:**
- [ ] Create `GeminiCodeLensProvider` class
- [ ] Implement symbol detection for functions/classes
- [ ] Add CodeLens for "Explain", "Generate Tests", "Refactor"
- [ ] Register CodeLens provider for supported languages
- [ ] Handle CodeLens command execution
- [ ] Add configuration to enable/disable CodeLens
- [ ] Test performance with large files

**Acceptance Criteria:**
- CodeLens appears above functions and classes
- Clicking CodeLens executes correct actions
- Performance is acceptable (<100ms)
- Can be disabled via settings

---

### Task 16: Hover Provider and Quick Info [ ]
**Priority:** Medium  
**Dependencies:** Task 7  
**Description:** Implement hover provider for contextual help

**Subtasks:**
- [ ] Create `GeminiHoverProvider` class
- [ ] Implement hover content generation
- [ ] Add command links in hover content
- [ ] Register hover provider for all languages
- [ ] Cache hover results for performance
- [ ] Test with different symbol types

**Acceptance Criteria:**
- Hover shows relevant information
- Command links work in hover content
- Performance is acceptable
- Works across all file types

---

### Task 17: Quick Fix Provider [ ]
**Priority:** High  
**Dependencies:** Task 7  
**Description:** Add AI-powered quick fixes for errors

**Subtasks:**
- [ ] Create `GeminiQuickFixProvider` class
- [ ] Integrate with VS Code diagnostics
- [ ] Implement "Fix with Gemini" action
- [ ] Implement "Explain Error" action
- [ ] Add batch fix capabilities
- [ ] Test with various error types
- [ ] Handle async fix generation

**Acceptance Criteria:**
- Quick fixes appear for errors
- Fixes are contextually appropriate
- Explanations are helpful
- Works with all diagnostic sources

---

### Task 18: Custom Sidebar View [ ]
**Priority:** Medium  
**Dependencies:** Task 9  
**Description:** Create Gemini sidebar for session management

**Subtasks:**
- [ ] Create webview provider for sidebar
- [ ] Design sidebar UI with HTML/CSS
- [ ] Implement session history display
- [ ] Add saved prompts management
- [ ] Create context file management UI
- [ ] Add communication between sidebar and CLI
- [ ] Test in different color themes

**Acceptance Criteria:**
- Sidebar displays in activity bar
- Shows active session information
- Allows prompt management
- Theme-aware styling

---

### Task 19: Debugging Integration [ ]
**Priority:** Low  
**Dependencies:** Task 12  
**Description:** Integrate with VS Code debugging

**Subtasks:**
- [ ] Implement `vscode.setBreakpoint` tool
- [ ] Implement `vscode.startDebugging` tool
- [ ] Add debug configuration support
- [ ] Implement variable inspection tools
- [ ] Add debug console integration
- [ ] Test with multiple debuggers

**Acceptance Criteria:**
- Breakpoints can be set from CLI
- Debug sessions start correctly
- Debug information flows back to CLI

---

### Task 20: Configuration and Settings [ ]
**Priority:** Medium  
**Dependencies:** Task 5  
**Description:** Add configuration support for VS Code integration

**Subtasks:**
- [ ] Add VS Code config schema to CLI
- [ ] Implement config file parsing
- [ ] Add VS Code extension settings
- [ ] Create settings sync between CLI and VS Code
- [ ] Add feature flags for integration features
- [ ] Add UI for configuration in settings
- [ ] Document all configuration options

**Acceptance Criteria:**
- Configuration is respected
- Settings can be changed at runtime
- Defaults work out of the box
- Settings UI is intuitive

---

### Task 21: Documentation and Examples [ ]
**Priority:** High  
**Dependencies:** Task 9  
**Description:** Create comprehensive documentation

**Subtasks:**
- [ ] Write VS Code integration guide
- [ ] Create VS Code extension README
- [ ] Add examples for common workflows
- [ ] Update main CLI documentation
- [ ] Create troubleshooting guide
- [ ] Add architecture diagrams
- [ ] Create demo videos/GIFs
- [ ] Write API documentation

**Acceptance Criteria:**
- Users can follow guide to set up
- Common issues are documented
- Examples cover main use cases
- Videos demonstrate key features

---

### Task 22: Testing and Quality Assurance [ ]
**Priority:** High  
**Dependencies:** All previous tasks  
**Description:** Comprehensive testing of integration

**Subtasks:**
- [ ] Create integration test suite
- [ ] Add E2E tests with real VS Code
- [ ] Test on different VS Code versions
- [ ] Test on different operating systems
- [ ] Performance testing and optimization
- [ ] Security audit of communication
- [ ] User acceptance testing
- [ ] Accessibility testing

**Acceptance Criteria:**
- All features work reliably
- No performance regressions
- Security review passed
- Works on Windows, macOS, Linux
- Meets accessibility standards

---

### Task 23: Publishing and Distribution [ ]
**Priority:** Medium  
**Dependencies:** Task 22  
**Description:** Prepare for release and distribution

**Subtasks:**
- [ ] Prepare VS Code extension for marketplace
- [ ] Update CLI release process
- [ ] Create installation scripts
- [ ] Set up CI/CD for extension
- [ ] Add telemetry (with consent)
- [ ] Create release notes
- [ ] Plan phased rollout
- [ ] Set up update notifications

**Acceptance Criteria:**
- Extension published to marketplace
- CLI detects and guides installation
- Smooth upgrade experience
- Update mechanism works

---

## Implementation Notes

### Architecture Decisions
- *Document any changes to the original design here*

### Technical Challenges
- *Document any technical challenges encountered*

### Performance Considerations
- *Document performance optimizations and benchmarks*

### Security Review
- *Document security considerations and mitigations*

## Progress Tracking

**Initial Setup:** 0/1 task complete  
**Phase 1 Progress:** 0/9 tasks complete  
**Phase 2 Progress:** 0/5 tasks complete  
**Phase 3 Progress:** 0/9 tasks complete  
**Overall Progress:** 0/24 tasks complete

## Dependencies Graph
```
Task 0 (Feature Branch) ──→ All other tasks

Task 1 ──┬─→ Task 5 ──→ Task 6
         │
Task 2 ──┬─→ Task 3 ──→ Task 4 ──┬─→ Task 10
         │                        ├─→ Task 11
         └─→ Task 7 ──┬─→ Task 8  └─→ Task 12
                      ├─→ Task 15
                      ├─→ Task 16
                      └─→ Task 17
                      
Task 4 ──→ Task 9 ──→ Task 18

Task 5 ──→ Task 13 ──→ Task 14

Task 5 ──→ Task 20

Task 12 ──→ Task 19

All tasks → Task 21 (Documentation)
All tasks → Task 22 (Testing) → Task 23 (Publishing)
```