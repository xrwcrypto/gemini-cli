/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GitIgnoreParser } from './gitIgnoreParser.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isGitRepository } from './gitUtils.js';

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal();
  return {
    ...os,
    platform: () => 'win32',
  };
});

vi.mock('path', async (importOriginal) => {
  const path = await importOriginal();
  return {
    ...path,
    resolve: path.win32.resolve,
    normalize: path.win32.normalize,
    isAbsolute: path.win32.isAbsolute,
    relative: path.win32.relative,
  };
});

// Mock fs module
vi.mock('fs/promises');

// Mock gitUtils module
vi.mock('./gitUtils.js');

describe('GitIgnoreParser on win32', () => {
  let parser: GitIgnoreParser;
  const mockProjectRoot = 'C:\\Users\\user\\project';

  beforeEach(() => {
    parser = new GitIgnoreParser(mockProjectRoot);
    // Reset mocks before each test
    vi.mocked(fs.readFile).mockClear();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT')); // Default to no file
    vi.mocked(isGitRepository).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isIgnored with Windows paths', () => {
    beforeEach(async () => {
      const gitignoreContent = `
# Windows specific tests
node_modules/
*.log
/dist
/build/
config.json
`;
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(gitignoreContent)
        .mockRejectedValue(new Error('ENOENT'));
      await parser.initialize();
    });

    it('should ignore a directory with backslashes', () => {
      expect(parser.isIgnored('node_modules\\some-package')).toBe(true);
    });

    it('should ignore a file with a wildcard pattern', () => {
      expect(parser.isIgnored('src\\logs\\app.log')).toBe(true);
    });

    it('should ignore a file in a root-anchored directory', () => {
      expect(parser.isIgnored('dist\\bundle.js')).toBe(true);
    });

    it('should not ignore a file in a similarly named nested directory', () => {
      expect(parser.isIgnored('src\\dist\\bundle.js')).toBe(false);
    });

    it('should ignore a file by its name, regardless of path separator', () => {
      expect(parser.isIgnored('config.json')).toBe(true);
      expect(parser.isIgnored('src\\config.json')).toBe(true);
    });

    it('should handle absolute Windows paths correctly', () => {
      const absolutePath = 'C:\\Users\\user\\project\\node_modules\\lib';
      expect(parser.isIgnored(absolutePath)).toBe(true);
    });

    it('should handle mixed separators gracefully', () => {
      // The underlying 'ignore' library normalizes to POSIX separators
      expect(parser.isIgnored('node_modules/some-package\\lib')).toBe(true);
    });

    it('should not ignore a file that does not match', () => {
      expect(parser.isIgnored('src\\components\\button.ts')).toBe(false);
    });
  });
});
