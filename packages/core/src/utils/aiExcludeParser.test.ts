/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AIExcludeParser } from './aiExcludeParser.js';

// Mock fs module
vi.mock('fs/promises');

describe('AIExcludeParser', () => {
  let parser: AIExcludeParser;
  const mockProjectRoot = '/test/project';
  const aiexcludeContent = `
apikeys.txt
*.key
/secrets.txt

my/sensitive/dir/

foo/*
!foo/bar.txt

`;

  beforeEach(() => {
    parser = new AIExcludeParser(mockProjectRoot);
    // Reset mocks before each test
    vi.mocked(fs.readFile).mockClear();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT')); // Default to no file
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize without errors when no .gitignore exists', async () => {
      await expect(parser.initialize()).resolves.not.toThrow();
    });

    it('should load .aiexlucde patterns when file exists', async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(aiexcludeContent)
        .mockRejectedValue(new Error('ENOENT'));

      await parser.initialize();

      expect(parser.getIngoredPatterns().length).toBe(7); // .aiexclude is always ignored.
    });
  });

  describe('isIgnored', () => {
    beforeEach(async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(aiexcludeContent)
        .mockRejectedValue(new Error('ENOENT'));
      await parser.initialize();
    });

    it('should always ignore .aiexclude files', () => {
      expect(parser.isIgnored('.aiexclude')).toBe(true);
      expect(parser.isIgnored('./bar/.aiexclude')).toBe(true);
      expect(
        parser.isIgnored(path.join(mockProjectRoot, './bar/.aiexclude')),
      ).toBe(true);
    });

    it('should ignore files matching patterns', () => {
      expect(parser.isIgnored('apikeys.txt')).toBe(true);
      expect(parser.isIgnored('bar/apikeys.txt')).toBe(true);
      expect(parser.isIgnored('bar/baz/apikeys.txt')).toBe(true);
      expect(parser.isIgnored('my.key')).toBe(true);
      expect(parser.isIgnored('bar/their.key')).toBe(true);
      expect(parser.isIgnored('bar/baz/the.key')).toBe(true);
      expect(parser.isIgnored('secrets.txt')).toBe(true);
      expect(parser.isIgnored('bar/secrets.txt')).toBe(false);
      expect(parser.isIgnored('bar/baz/secrets.txt')).toBe(false);
      expect(parser.isIgnored('my/sensitive/dir/file')).toBe(true);
      expect(parser.isIgnored('my/sensitive/dir/foo/secrets.txt')).toBe(true);
      expect(parser.isIgnored('foo/file.txt')).toBe(true);
      expect(parser.isIgnored('foo/bar/file.txt')).toBe(true);
      expect(parser.isIgnored('foo/bar.txt')).toBe(false);
    });

    it('should not ignore files that do not match patterns', () => {
      expect(parser.isIgnored('src/index.ts')).toBe(false);
      expect(parser.isIgnored('README.md')).toBe(false);
    });

    it('should handle absolute paths correctly', () => {
      const absolutePath = path.join(mockProjectRoot, 'bar', 'apikeys.txt');
      expect(parser.isIgnored(absolutePath)).toBe(true);
    });

    it('should handle paths outside project root by not ignoring them', () => {
      const outsidePath = path.resolve(mockProjectRoot, '../other/file.txt');
      expect(parser.isIgnored(outsidePath)).toBe(false);
    });

    it('should handle relative paths correctly', () => {
      expect(parser.isIgnored('bar/apikeys.txt')).toBe(true);
      expect(parser.isIgnored('../some/other/file.txt')).toBe(false);
    });

    it('should normalize path separators on Windows', () => {
      expect(parser.isIgnored('bar\\apikeys.txt')).toBe(true);
    });
  });

  describe('getIgnoredPatterns', () => {
    it('should return the raw patterns added', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('apikeys.txt\n\nmy.key');

      await parser.initialize();
      expect(parser.getIngoredPatterns()).toEqual([
        '.aiexclude',
        'apikeys.txt',
        'my.key',
      ]);
    });
  });
});
