/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShellTool } from './shell.js';
import { Config } from '../config/config.js';
import { ToolConfirmationOutcome } from './tools.js';
import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';

vi.mock('child_process');

describe('ShellTool', () => {
  let shellTool: ShellTool;
  let mockConfig: Config;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-tool-test-'));
    mockConfig = {
      getTargetDir: () => tempDir,
      getDebugMode: () => false,
    } as unknown as Config;
    shellTool = new ShellTool(mockConfig);
  });

  afterEach(() => {
    vi.resetAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getCommandRoot', () => {
    it('should extract the command root from a simple command', () => {
      expect(shellTool.getCommandRoot('ls -la')).toBe('ls');
    });

    it('should extract the command root from a command with a path', () => {
      expect(shellTool.getCommandRoot('/bin/ls -la')).toBe('ls');
    });

    it('should extract the command root from a command with windows path', () => {
      expect(
        shellTool.getCommandRoot(
          'C:\\Windows\\System32\\cmd.exe /c echo hello',
        ),
      ).toBe('cmd.exe');
    });

    it('should handle commands with pipes and redirects', () => {
      expect(shellTool.getCommandRoot('grep "foo" | wc -l > count.txt')).toBe(
        'grep',
      );
    });

    it('should handle commands with && and ||', () => {
      expect(shellTool.getCommandRoot('command1 && command2')).toBe('command1');
    });

    it('should handle commands with backticks', () => {
      expect(shellTool.getCommandRoot('echo `cat file.txt`')).toBe('echo');
    });

    it('should return an empty string for an empty command', () => {
      expect(shellTool.getCommandRoot(' ')).toBe('');
    });
  });

  describe('getDescription', () => {
    it('should generate a description for a simple command', () => {
      expect(shellTool.getDescription({ command: 'ls -la' })).toBe('ls -la');
    });

    it('should generate a description for a command with a directory', () => {
      expect(
        shellTool.getDescription({ command: 'ls -la', directory: 'src' }),
      ).toBe('ls -la [in src]');
    });

    it('should generate a description for a command with a description', () => {
      expect(
        shellTool.getDescription({
          command: 'ls -la',
          description: 'list files',
        }),
      ).toBe('ls -la (list files)');
    });

    it('should generate a description for a command with a directory and a description', () => {
      expect(
        shellTool.getDescription({
          command: 'ls -la',
          directory: 'src',
          description: 'list files',
        }),
      ).toBe('ls -la [in src] (list files)');
    });

    it('should handle newlines in the description', () => {
      expect(
        shellTool.getDescription({ command: 'ls', description: 'a\nb' }),
      ).toBe('ls (a b)');
    });
  });

  describe('validateToolParams', () => {
    it('should return null for valid parameters', () => {
      expect(shellTool.validateToolParams({ command: 'ls -la' })).toBeNull();
    });

    it('should return an error for an empty command', () => {
      expect(shellTool.validateToolParams({ command: ' ' })).toBe(
        'Command cannot be empty.',
      );
    });

    it('should return an error if command root cannot be identified', () => {
      expect(shellTool.validateToolParams({ command: '  ' })).toBe(
        'Command cannot be empty.',
      );
    });

    it('should return an error for an absolute directory path', () => {
      expect(
        shellTool.validateToolParams({ command: 'ls', directory: '/abs/path' }),
      ).toBe(
        'Directory cannot be absolute. Must be relative to the project root directory.',
      );
    });

    it('should return an error for a non-existent directory', () => {
      expect(
        shellTool.validateToolParams({
          command: 'ls',
          directory: 'non-existent-dir',
        }),
      ).toBe('Directory must exist.');
    });

    it('should return null for a valid directory', () => {
      const validDir = 'src';
      fs.mkdirSync(path.join(tempDir, validDir), { recursive: true });
      expect(
        shellTool.validateToolParams({ command: 'ls', directory: validDir }),
      ).toBeNull();
    });
  });

  describe('shouldConfirmExecute', () => {
    it('should return false if params are invalid', async () => {
      const result = await shellTool.shouldConfirmExecute(
        { command: ' ' },
        new AbortController().signal,
      );
      expect(result).toBe(false);
    });

    it('should return false if the command is whitelisted', async () => {
      const params = { command: 'ls -la' };
      const confirmationDetails = await shellTool.shouldConfirmExecute(
        params,
        new AbortController().signal,
      );
      if (typeof confirmationDetails !== 'boolean') {
        await confirmationDetails.onConfirm(
          ToolConfirmationOutcome.ProceedAlways,
        );
      }

      const result = await shellTool.shouldConfirmExecute(
        params,
        new AbortController().signal,
      );
      expect(result).toBe(false);
    });

    it('should return confirmation details if the command is not whitelisted', async () => {
      const result = await shellTool.shouldConfirmExecute(
        { command: 'ls -la' },
        new AbortController().signal,
      );
      expect(result).toEqual(
        expect.objectContaining({
          type: 'exec',
          title: 'Confirm Shell Command',
          command: 'ls -la',
          rootCommand: 'ls',
        }),
      );
    });
  });

  describe('execute', () => {
    let mockSpawn: vi.Mocked<ReturnType<typeof spawn>>;

    beforeEach(() => {
      mockSpawn = {
        stdout: { on: vi.fn(), destroy: vi.fn() },
        stderr: { on: vi.fn(), destroy: vi.fn() },
        on: vi.fn(
          (
            event: string,
            cb: (code: number | null, signal: string | null) => void,
          ) => {
            if (event === 'exit') {
              setTimeout(() => cb(0, null), 10);
            }
          },
        ),
        kill: vi.fn(),
        pid: 1234,
      };
      vi.mocked(spawn).mockReturnValue(mockSpawn);
    });

    it('should execute a command successfully', async () => {
      const result = await shellTool.execute(
        { command: 'echo "hello"' },
        new AbortController().signal,
      );
      expect(result.llmContent).toContain('Stdout:');
      expect(result.llmContent).toContain('Exit Code: 0');
    });

    it('should handle command with stderr output', async () => {
      mockSpawn.on = vi.fn(
        (
          event: string,
          cb: (code: number | null, signal: string | null) => void,
        ) => {
          if (event === 'exit') {
            setTimeout(() => cb(1, null), 10);
          }
        },
      );
      mockSpawn.stderr.on.mockImplementation(
        (event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            cb(Buffer.from('error message'));
          }
        },
      );

      const result = await shellTool.execute(
        { command: 'error_command' },
        new AbortController().signal,
      );
      expect(result.llmContent).toContain('Stderr: error message');
      expect(result.llmContent).toContain('Exit Code: 1');
    });

    it('should handle command failure', async () => {
      const error = new Error('spawn error');
      mockSpawn.on = vi.fn(
        (event: string, cb: (error: Error | null) => void) => {
          if (event === 'error') {
            cb(error);
          }
          if (event === 'exit') {
            setTimeout(() => cb(new Error('test error')), 10);
          }
        },
      );

      const result = await shellTool.execute(
        { command: 'fail_command' },
        new AbortController().signal,
      );
      expect(result.llmContent).toContain('Error: Error: spawn error');
    });

    it('should handle command cancellation', async () => {
      const abortController = new AbortController();
      const promise = shellTool.execute(
        { command: 'long_running_command' },
        abortController.signal,
      );
      abortController.abort();
      const result = await promise;
      expect(result.llmContent).toContain('Command was cancelled by user');
    });

    it('should execute command in the specified directory', async () => {
      const dir = 'src';
      fs.mkdirSync(path.join(tempDir, dir), { recursive: true });
      await shellTool.execute(
        { command: 'ls', directory: dir },
        new AbortController().signal,
      );
      expect(spawn).toHaveBeenCalledWith(
        'bash',
        expect.any(Array),
        expect.objectContaining({
          cwd: path.join(tempDir, dir),
        }),
      );
    });

    it('should handle windows platform', async () => {
      vi.spyOn(os, 'platform').mockReturnValue('win32');
      shellTool = new ShellTool(mockConfig);
      await shellTool.execute({ command: 'dir' }, new AbortController().signal);
      expect(spawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'dir'],
        expect.any(Object),
      );
    });
  });
});
