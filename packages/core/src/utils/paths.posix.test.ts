/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path');
  return { ...actual, default: actual.posix };
});

import { makeRelative, shortenPath } from './paths.js';

describe('POSIX paths', () => {
  describe('makeRelative', () => {
    it('should correctly make a path relative', () => {
      expect(makeRelative('/a/b/c', '/a/b')).toBe('c');
    });
  });

  describe('shortenPath', () => {
    it('should shorten a long path', () => {
      const longPath = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z';
      expect(shortenPath(longPath, 30).length).toBeLessThanOrEqual(30);
    });
  });
});
