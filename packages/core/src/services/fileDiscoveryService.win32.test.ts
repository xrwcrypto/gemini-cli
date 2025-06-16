/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Mocked } from 'vitest';
import { FileDiscoveryService } from './fileDiscoveryService.js';
import { GitIgnoreParser } from '../utils/gitIgnoreParser.js';

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
  };
});

// Mock the GitIgnoreParser
vi.mock('../utils/gitIgnoreParser.js');

// Mock gitUtils module
vi.mock('../utils/gitUtils.js', () => ({
  isGitRepository: vi.fn(() => true),
  findGitRoot: vi.fn(() => 'C:\\test\\project'),
}));

describe('FileDiscoveryService on win32', () => {
  let service: FileDiscoveryService;
  let mockGitIgnoreParser: Mocked<GitIgnoreParser>;
  const mockProjectRoot = 'C:\\test\\project';

  beforeEach(() => {
    service = new FileDiscoveryService(mockProjectRoot);

    mockGitIgnoreParser = {
      initialize: vi.fn(),
      isIgnored: vi.fn(),
      getIgnoredPatterns: vi.fn(() => ['node_modules', '.git']),
    } as unknown as Mocked<GitIgnoreParser>;

    vi.mocked(GitIgnoreParser).mockImplementation(() => mockGitIgnoreParser);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('filterFiles with Windows paths', () => {
    beforeEach(async () => {
      mockGitIgnoreParser.isIgnored.mockImplementation((filePath: string) =>
        filePath.startsWith('C:\\test\\project\\node_modules'),
      );
      await service.initialize();
    });

    it('should filter out git-ignored files with backslash paths', () => {
      const files = [
        'C:\\test\\project\\src\\index.ts',
        'C:\\test\\project\\node_modules\\package\\index.js',
        'C:\\test\\project\\README.md',
      ];

      const filtered = service.filterFiles(files);

      expect(filtered).toEqual([
        'C:\\test\\project\\src\\index.ts',
        'C:\\test\\project\\README.md',
      ]);
    });
  });
});
