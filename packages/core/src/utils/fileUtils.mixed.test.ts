/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof path>();
  return {
    ...actual,
    posix: actual.posix,
    win32: actual.win32,
    default: actual.win32,
  };
});

import { isWithinRoot, isAbsolute } from './fileUtils.js';

describe('Mixed paths', () => {
  describe('isWithinRoot', () => {
    it('should return true for mixed-style paths within the root', () => {
      expect(isWithinRoot('C:\\a/b\\c', 'C:\\a/b')).toBe(true);
    });

    it('should return false for mixed-style paths outside the root', () => {
      expect(isWithinRoot('C:\a/c', 'C:\a/b')).toBe(false);
    });
  });

  describe('isAbsolute', () => {
    it('should return true for mixed-style absolute paths', () => {
      expect(isAbsolute('C:\\a/b')).toBe(true);
      expect(isAbsolute('/a/b')).toBe(true);
    });

    it('should return false for mixed-style relative paths', () => {
      expect(isAbsolute('a/b')).toBe(false);
      expect(isAbsolute('a\\b')).toBe(false);
    });
  });
});
