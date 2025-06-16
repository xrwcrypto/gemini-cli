/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitService, historyDirName } from './gitService.js';
import type * as FsPromisesModule from 'fs/promises';
import * as fs from 'fs/promises';

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
    join: path.win32.join,
  };
});

const hoistedMockMkdir = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof FsPromisesModule;
  return {
    ...actual,
    mkdir: hoistedMockMkdir,
  };
});

describe('GitService on win32', () => {
  const mockProjectRoot = 'C:\\test\\project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setupHiddenGitRepository with Windows paths', () => {
    it('should create history directory with correct path', async () => {
      const service = new GitService(mockProjectRoot);
      // We can't easily test the whole method because of its complexity,
      // so we'll spy on fs.mkdir to check the path it was called with.
      const mkdirSpy = vi.spyOn(fs, 'mkdir');
      // Mock other fs calls to prevent side effects
      vi.spyOn(fs, 'readFile').mockResolvedValue('');
      vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    checkIsRepo: vi.fn().mockResolvedValue(false),
    init: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue(''),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ commit: 'initial' }),
  })),
  CheckRepoActions: {
    IS_REPO_ROOT: 'is-repo-root',
  },
}));


      await service.setupHiddenGitRepository();

      const expectedPath = `C:\\test\\project\\${historyDirName}\\repository`;
      expect(mkdirSpy).toHaveBeenCalledWith(expectedPath, { recursive: true });
    });
  });
});
