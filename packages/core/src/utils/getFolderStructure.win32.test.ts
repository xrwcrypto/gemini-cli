/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import fsPromises from 'fs/promises';
import { Dirent as FSDirent } from 'fs';
import * as nodePath from 'path';
import { getFolderStructure } from './getFolderStructure.js';

vi.mock('path', async (importOriginal) => {
  const original = (await importOriginal()) as typeof nodePath;
  return {
    ...original,
    resolve: vi.fn((str) => str),
    normalize: vi.fn((p) => p.replace(/\\/g, '/')),
    join: vi.fn((...segments) => segments.join('/')),
  };
});

vi.mock('fs/promises');

// Import 'path' again here, it will be the mocked version
import * as path from 'path';

// Helper to create Dirent-like objects for mocking fs.readdir
const createDirent = (name: string, type: 'file' | 'dir'): FSDirent => ({
  name,
  isFile: () => type === 'file',
  isDirectory: () => type === 'dir',
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isSymbolicLink: () => false,
  isFIFO: () => false,
  isSocket: () => false,
  parentPath: '',
  path: '',
});

describe('getFolderStructure on win32', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    (path.resolve as Mock).mockImplementation((str: string) => str);
    (path.normalize as Mock).mockImplementation((p: string) =>
      p.replace(/\\/g, '/'),
    );
    (path.join as Mock).mockImplementation((...segments: string[]) =>
      segments.join('/').replace(/\\/g, '/'),
    );

    (fsPromises.readdir as Mock).mockImplementation(
      async (dirPath: string | Buffer | URL) => {
        const normalizedPath = path.normalize(dirPath.toString());
        if (mockFsStructure[normalizedPath]) {
          return mockFsStructure[normalizedPath];
        }
        throw Object.assign(
          new Error(
            `ENOENT: no such file or directory, scandir '${normalizedPath}'`,
          ),
          { code: 'ENOENT' },
        );
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockFsStructure: Record<string, FSDirent[]> = {
    'C:/Users/user/project': [
      createDirent('file1.txt', 'file'),
      createDirent('subfolderA', 'dir'),
    ],
    'C:/Users/user/project/subfolderA': [createDirent('fileA1.ts', 'file')],
  };

  it('should return basic folder structure with Windows paths', async () => {
    const structure = await getFolderStructure('C:\\Users\\user\\project');
    const expected = `
Showing up to 200 items (files + folders).

C:/Users/user/project/
├───file1.txt
└───subfolderA/
    └───fileA1.ts
`.trim();
    expect(structure.trim()).toBe(expected);
  });
});
