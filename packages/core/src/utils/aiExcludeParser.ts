/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { IgnoreFilter } from './ignoreFilter.js';
import { normalizeFilePath } from './fileUtils.js';

export class AIExcludeParser implements IgnoreFilter {
  private ig: Ignore = ignore();
  private aiExcludeRoot: string;
  private _patterns: string[] = [];

  constructor(aiExcludeRoot: string) {
    this.aiExcludeRoot = path.resolve(aiExcludeRoot);
  }

  async initialize(): Promise<void> {
    this._patterns.push('.aiexclude');

    try {
      const content = await fs.readFile(
        path.join(this.aiExcludeRoot, '.aiexclude'),
        'utf-8',
      );
      const loaded = content
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p !== '');
      this._patterns.push(...loaded);
      this.ig.add(this._patterns);
    } catch (_error) {
      // File doesn't exist or can't be read, continue silently
    }
  }

  isIgnored(filePath: string): boolean {
    const normalizedPath = normalizeFilePath(this.aiExcludeRoot, filePath);

    if (normalizedPath === '' || normalizedPath.startsWith('..')) {
      return false;
    }

    const ignored = this.ig.ignores(normalizedPath);
    return ignored;
  }

  getIngoredPatterns(): string[] {
    return this._patterns;
  }
}
