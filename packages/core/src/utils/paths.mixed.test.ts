/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';

vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof path>();
  return { ...original.win32, default: original.win32 };
});

import { makeRelative, shortenPath } from './paths.js';

describe('Mixed paths', () => {
  describe('makeRelative', () => {
    it('should correctly make a mixed-style path relative', () => {
      expect(makeRelative('C:\\a/b\\c', 'C:\\a/b')).toBe('c');
    });
  });

  describe('shortenPath', () => {
    it('should shorten a long mixed-style path', () => {
      const longPath =
        'C:\\a/b\\c/d\\e/f\\g/h\\i/j\\k/l\\m/n\\o/p\\q/r\\s/t\\u/v\\w/x\\y/z';
      expect(shortenPath(longPath, 30).length).toBeLessThanOrEqual(30);
    });
  });
});
