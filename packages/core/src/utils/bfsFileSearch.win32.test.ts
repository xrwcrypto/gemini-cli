/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dirent, PathLike } from 'fs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { bfsFileSearch } from './bfsFileSearch.js';

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>();
  return {
    ...os,
    platform: () => 'win32',
  };
});

vi.mock('path', async (importOriginal) => {
  const path = await importOriginal<typeof import('path')>();
  return {
    ...path,
    resolve: path.win32.resolve,
    join: path.win32.join,
  };
});

vi.mock('fs/promises');

const createMockDirent = (name: string, isFile: boolean): Dirent => {
  const dirent = new Dirent();
  dirent.name = name;
  dirent.isFile = () => isFile;
  dirent.isDirectory = () => !isFile;
  return dirent;
};

// Type for the specific overload we're using
type ReaddirWithFileTypes = (
  path: PathLike,
  options: { withFileTypes: true },
) => Promise<Dirent[]>;

describe('bfsFileSearch on win32', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should find a file in a subdirectory with Windows paths', async () => {
    const mockFs = vi.mocked(fs);
    const mockReaddir = mockFs.readdir as unknown as ReaddirWithFileTypes;
    vi.mocked(mockReaddir).mockImplementation(async (dir) => {
      if (dir === 'C:\\test') {
        return [createMockDirent('subdir', false)];
      }
      if (dir === 'C:\\test\\subdir') {
        return [createMockDirent('file1.txt', true)];
      }
      return [];
    });

    const result = await bfsFileSearch('C:\\test', { fileName: 'file1.txt' });
    expect(result).toEqual(['C:\\test\\subdir\\file1.txt']);
  });
});
