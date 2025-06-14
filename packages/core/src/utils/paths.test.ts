/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from 'vitest';
import { escapePath, unescapePath } from './paths.js';

describe('paths', () => {
  describe('escapePath', () => {
    it('should escape spaces in a path', () => {
      expect(escapePath('foo bar')).toBe('foo\\ bar');
    });

    it('should not escape already escaped spaces', () => {
      expect(escapePath('foo\\ bar')).toBe('foo\\ bar');
    });
  });

  describe('unescapePath', () => {
    it('should unescape spaces in a path', () => {
      expect(unescapePath('foo\\ bar')).toBe('foo bar');
    });

    it('should not unescape already unescaped spaces', () => {
      expect(unescapePath('foo bar')).toBe('foo bar');
    });
  });
});
