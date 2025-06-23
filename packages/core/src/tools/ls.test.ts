/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LSTool } from './ls.js';
import { Config } from '../config/config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';

describe('LSTool', () => {
  let lsTool: LSTool;
  let mockConfig: Config;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-tool-test-gen-'));
    mockConfig = {
      getTargetDir: () => tempDir,
      getFileFilteringRespectGitIgnore: () => true,
      getFileService: () => new FileDiscoveryService(tempDir),
    } as unknown as Config;
    lsTool = new LSTool(tempDir, mockConfig);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('validateToolParams', () => {
    it('should return null for valid parameters', () => {
      expect(lsTool.validateToolParams({ path: tempDir })).toBeNull();
    });

    it('should return an error for a relative path', () => {
      expect(
        lsTool.validateToolParams({ path: 'some/relative/path' }),
      ).toContain('Path must be absolute');
    });

    it('should return an error for a path outside the root directory', () => {
      const outsidePath = path.resolve(os.tmpdir(), 'outside-ls-test');
      expect(lsTool.validateToolParams({ path: outsidePath })).toContain(
        'Path must be within the root directory',
      );
    });
  });

  describe('execute', () => {
    it('should list files in a directory', async () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'hello');
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const result = await lsTool.execute(
        { path: tempDir },
        new AbortController().signal,
      );
      expect(result.llmContent).toContain('[DIR] subdir');
      expect(result.llmContent).toContain('file1.txt');
      expect(result.returnDisplay).toBe('Listed 2 item(s).');
    });

    it('should handle an empty directory', async () => {
      const result = await lsTool.execute(
        { path: tempDir },
        new AbortController().signal,
      );
      expect(result.llmContent).toContain('is empty');
      expect(result.returnDisplay).toBe('Directory is empty.');
    });

    it('should return an error for a non-existent directory', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent');
      const result = await lsTool.execute(
        { path: nonExistentPath },
        new AbortController().signal,
      );
      expect(result.returnDisplay).toContain('Failed to list directory');
    });

    it('should return an error if path is not a directory', async () => {
      const filePath = path.join(tempDir, 'file.txt');
      fs.writeFileSync(filePath, 'hello');
      const result = await lsTool.execute(
        { path: filePath },
        new AbortController().signal,
      );
      expect(result.returnDisplay).toContain('Path is not a directory');
    });

    it('should ignore files based on the ignore parameter', async () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'hello');
      fs.writeFileSync(path.join(tempDir, 'file2.log'), 'log');
      const result = await lsTool.execute(
        { path: tempDir, ignore: ['*.log'] },
        new AbortController().signal,
      );
      expect(result.llmContent).not.toContain('file2.log');
      expect(result.llmContent).toContain('file1.txt');
    });

    it('should respect gitignore rules', async () => {
      mockConfig.getFileService = () =>
        ({
          isGitRepository: () => true,
          shouldGitIgnoreFile: (filePath: string) => filePath.endsWith('.log'),
          shouldGeminiIgnoreFile: (filePath: string) =>
            filePath.endsWith('.log'),
        }) as unknown as FileDiscoveryService;
      lsTool = new LSTool(tempDir, mockConfig);

      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'hello');
      fs.writeFileSync(path.join(tempDir, 'file2.log'), 'log');

      const result = await lsTool.execute(
        { path: tempDir },
        new AbortController().signal,
      );
      expect(result.llmContent).not.toContain('file2.log');
      expect(result.llmContent).toContain('file1.txt');
      expect(result.returnDisplay).toContain('(1 git-ignored)');
    });
  });

  describe('Path Resilience', () => {
    describe('on POSIX', () => {
      let posixTempDir: string;
      let posixLsTool: LSTool;
      let posixMockConfig: Config;

      beforeEach(() => {
        posixTempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'ls-tool-test-posix-'),
        );
        posixMockConfig = {
          getTargetDir: () => posixTempDir,
        } as unknown as Config;
        posixLsTool = new LSTool(posixTempDir, posixMockConfig);
      });

      afterEach(() => {
        fs.rmSync(posixTempDir, { recursive: true, force: true });
      });

      it('should allow a valid posix path', () => {
        expect(
          posixLsTool.validateToolParams({ path: posixTempDir }),
        ).toBeNull();
      });

      it('should reject a path traversal attempt', () => {
        const traversalPath = path.join(posixTempDir, '..', '..');
        expect(
          posixLsTool.validateToolParams({ path: traversalPath }),
        ).toContain('Path must be within the root directory');
      });
    });

    describe('on Windows', () => {
      let windowsLsTool: LSTool;
      let windowsMockConfig: Config;

      beforeEach(() => {
        const windowsTempDir = 'C:\\temp';
        vi.spyOn(os, 'platform').mockReturnValue('win32');

        // Mock path functions to behave like win32
        vi.spyOn(path, 'relative').mockImplementation((from, to) =>
          path.win32.relative(from, to),
        );
        vi.spyOn(path, 'normalize').mockImplementation((p) =>
          path.win32.normalize(p),
        );
        vi.spyOn(path, 'sep', 'get').mockReturnValue(path.win32.sep);

        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({
          isDirectory: () => true,
        } as unknown as fs.Stats);

        windowsMockConfig = {
          getTargetDir: () => windowsTempDir,
        } as unknown as Config;

        // Instantiate the tool with a dummy root and then manually
        // set the rootDirectory to the desired Windows path.
        // This avoids issues with path.resolve being called in the
        // constructor on a non-Windows host.
        windowsLsTool = new LSTool('/', windowsMockConfig);
        // @ts-expect-error private property
        windowsLsTool.rootDirectory = windowsTempDir;
      });

      it('should allow a valid windows path', () => {
        expect(
          windowsLsTool.validateToolParams({ path: 'C:\\temp' }),
        ).toBeNull();
      });

      it('should allow a valid mixed path', () => {
        expect(
          windowsLsTool.validateToolParams({ path: 'C:/temp' }),
        ).toBeNull();
      });

      it('should reject a path traversal attempt', () => {
        const traversalPath = 'C:\\..\\..\\';
        expect(
          windowsLsTool.validateToolParams({ path: traversalPath }),
        ).toContain('Path must be within the root directory');
      });
    });
  });
});
