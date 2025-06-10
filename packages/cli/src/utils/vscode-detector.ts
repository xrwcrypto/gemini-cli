/**
 * VS Code environment detection utilities
 */

/**
 * Detects if the CLI is running inside VS Code's integrated terminal
 * @returns true if running in VS Code terminal, false otherwise
 */
export function isRunningInVSCode(): boolean {
  return !!(
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.VSCODE_IPC_HOOK ||
    process.env.VSCODE_GIT_IPC_HANDLE ||
    process.env.VSCODE_PID
  );
}

/**
 * Gets the VS Code workspace folder path if available
 * @returns workspace folder path or undefined if not in VS Code or no workspace
 */
export function getVSCodeWorkspacePath(): string | undefined {
  // Check for workspace folder passed via environment
  // VS Code sets this when launching terminals in a workspace
  return process.env.VSCODE_WORKSPACE_FOLDER || process.env.PWD;
}

/**
 * Gets VS Code session information
 * @returns object with VS Code session details
 */
export function getVSCodeSessionInfo(): {
  isVSCode: boolean;
  workspacePath?: string;
  termProgram?: string;
  vscodeVersion?: string;
  sessionId?: string;
} {
  const isVSCode = isRunningInVSCode();
  
  return {
    isVSCode,
    workspacePath: isVSCode ? getVSCodeWorkspacePath() : undefined,
    termProgram: process.env.TERM_PROGRAM,
    vscodeVersion: process.env.VSCODE_GIT_ASKPASS_NODE?.match(/(\d+\.\d+\.\d+)/)?.[1],
    sessionId: process.env.VSCODE_IPC_HOOK_CLI,
  };
}

/**
 * Checks if VS Code MCP extension is likely installed
 * This is a heuristic check - actual connection attempt will verify
 * @returns true if extension is likely available
 */
export function isVSCodeMCPExtensionAvailable(): boolean {
  // In the future, we could check for:
  // - Specific environment variables set by our extension
  // - Named pipes or IPC channels
  // - Extension-specific markers
  
  // For now, just return true if in VS Code
  return isRunningInVSCode();
}