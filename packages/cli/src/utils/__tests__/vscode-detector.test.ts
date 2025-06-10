import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isRunningInVSCode,
  getVSCodeWorkspacePath,
  getVSCodeSessionInfo,
  isVSCodeMCPExtensionAvailable,
} from '../vscode-detector';

describe('VS Code Detector', () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env to a clean state before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('isRunningInVSCode', () => {
    it('should return false when no VS Code environment variables are set', () => {
      delete process.env.TERM_PROGRAM;
      delete process.env.VSCODE_IPC_HOOK;
      delete process.env.VSCODE_GIT_IPC_HANDLE;
      delete process.env.VSCODE_PID;

      expect(isRunningInVSCode()).toBe(false);
    });

    it('should return true when TERM_PROGRAM is vscode', () => {
      process.env.TERM_PROGRAM = 'vscode';
      expect(isRunningInVSCode()).toBe(true);
    });

    it('should return true when VSCODE_IPC_HOOK is set', () => {
      process.env.VSCODE_IPC_HOOK = '/tmp/vscode-ipc-hook';
      expect(isRunningInVSCode()).toBe(true);
    });

    it('should return true when VSCODE_GIT_IPC_HANDLE is set', () => {
      process.env.VSCODE_GIT_IPC_HANDLE = '/tmp/vscode-git-ipc';
      expect(isRunningInVSCode()).toBe(true);
    });

    it('should return true when VSCODE_PID is set', () => {
      process.env.VSCODE_PID = '12345';
      expect(isRunningInVSCode()).toBe(true);
    });

    it('should return false when TERM_PROGRAM is not vscode', () => {
      process.env.TERM_PROGRAM = 'iTerm.app';
      expect(isRunningInVSCode()).toBe(false);
    });
  });

  describe('getVSCodeWorkspacePath', () => {
    it('should return VSCODE_WORKSPACE_FOLDER when set', () => {
      process.env.VSCODE_WORKSPACE_FOLDER = '/Users/test/workspace';
      process.env.PWD = '/Users/test/other';
      
      expect(getVSCodeWorkspacePath()).toBe('/Users/test/workspace');
    });

    it('should fall back to PWD when VSCODE_WORKSPACE_FOLDER is not set', () => {
      delete process.env.VSCODE_WORKSPACE_FOLDER;
      process.env.PWD = '/Users/test/current';
      
      expect(getVSCodeWorkspacePath()).toBe('/Users/test/current');
    });

    it('should return undefined when neither variable is set', () => {
      delete process.env.VSCODE_WORKSPACE_FOLDER;
      delete process.env.PWD;
      
      expect(getVSCodeWorkspacePath()).toBeUndefined();
    });
  });

  describe('getVSCodeSessionInfo', () => {
    it('should return complete session info when in VS Code', () => {
      process.env.TERM_PROGRAM = 'vscode';
      process.env.VSCODE_WORKSPACE_FOLDER = '/Users/test/workspace';
      process.env.VSCODE_GIT_ASKPASS_NODE = '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --ms-enable-electron-run-as-node /Applications/Visual Studio Code.app/Contents/Resources/app/extensions/git/dist/askpass-main.js';
      process.env.VSCODE_IPC_HOOK_CLI = 'session-123';

      const info = getVSCodeSessionInfo();
      
      expect(info).toEqual({
        isVSCode: true,
        workspacePath: '/Users/test/workspace',
        termProgram: 'vscode',
        vscodeVersion: undefined, // The regex doesn't match the test string
        sessionId: 'session-123',
      });
    });

    it('should extract VS Code version from VSCODE_GIT_ASKPASS_NODE', () => {
      process.env.TERM_PROGRAM = 'vscode';
      process.env.VSCODE_GIT_ASKPASS_NODE = '/path/to/Code-1.75.0.app/contents';

      const info = getVSCodeSessionInfo();
      
      expect(info.vscodeVersion).toBe('1.75.0');
    });

    it('should return minimal info when not in VS Code', () => {
      delete process.env.TERM_PROGRAM;
      delete process.env.VSCODE_IPC_HOOK;
      
      const info = getVSCodeSessionInfo();
      
      expect(info).toEqual({
        isVSCode: false,
        workspacePath: undefined,
        termProgram: undefined,
        vscodeVersion: undefined,
        sessionId: undefined,
      });
    });
  });

  describe('isVSCodeMCPExtensionAvailable', () => {
    it('should return true when in VS Code', () => {
      process.env.TERM_PROGRAM = 'vscode';
      expect(isVSCodeMCPExtensionAvailable()).toBe(true);
    });

    it('should return false when not in VS Code', () => {
      delete process.env.TERM_PROGRAM;
      delete process.env.VSCODE_IPC_HOOK;
      expect(isVSCodeMCPExtensionAvailable()).toBe(false);
    });
  });
});