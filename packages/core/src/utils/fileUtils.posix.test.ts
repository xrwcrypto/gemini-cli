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

import { isWithinRoot } from './fileUtils.js';

describe('POSIX paths', () => {
  describe('isWithinRoot', () => {
    it('should return true for paths within the root', () => {
      expect(isWithinRoot('/a/b/c', '/a/b')).toBe(true);
    });

    it('should return false for paths outside the root', () => {
      expect(isWithinRoot('/a/c', '/a/b')).toBe(false);
    });
  });
});
