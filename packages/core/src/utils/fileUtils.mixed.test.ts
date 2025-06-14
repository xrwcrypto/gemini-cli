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

import { isWithinRoot } from './fileUtils.js';

describe('Mixed paths', () => {
  describe('isWithinRoot', () => {
    it('should return true for mixed-style paths within the root', () => {
      expect(isWithinRoot('C:\\a/b\\c', 'C:\\a/b')).toBe(true);
    });

    it('should return false for mixed-style paths outside the root', () => {
      expect(isWithinRoot('C:\\a/c', 'C:\\a/b')).toBe(false);
    });
  });
});
