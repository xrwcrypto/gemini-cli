/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import { vol } from 'memfs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof path>();
  return {
    ...actual,
    default: actual.posix,
    posix: actual.posix,
    win32: actual.win32,
  };
});

import { isWithinRoot, isAbsolute } from './fileUtils.js';

describe('POSIX paths', () => {
  describe('isWithinRoot', () => {
    it('should return true for paths within the root', () => {
      expect(isWithinRoot('/a/b/c', '/a/b')).toBe(true);
    });

    it('should return false for paths outside the root', () => {
      expect(isWithinRoot('/a/c', '/a/b')).toBe(false);
    });
  });

  describe('isAbsolute', () => {
    it('should return true for absolute paths', () => {
      expect(isAbsolute('/a/b')).toBe(true);
      expect(isAbsolute('/')).toBe(true);
    });

    it('should return false for relative paths', () => {
      expect(isAbsolute('a/b')).toBe(false);
      expect(isAbsolute('../a/b')).toBe(false);
    });
  });
});
