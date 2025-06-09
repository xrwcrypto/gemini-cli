/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitIgnoreParser } from '../utils/gitIgnoreParser.js';
import { AIExcludeParser } from '../utils/aiExcludeParser.js';
import { IgnoreFilter } from '../utils/ignoreFilter.js';
import { isGitRepository } from '../utils/gitUtils.js';
import { makeRelative } from '../utils/paths.js';
import * as path from 'path';
import fg from 'fast-glob';
import micromatch from 'micromatch';

export interface FileDiscoveryOptions {
  respectGitIgnore?: boolean;
  respectAIExclude?: boolean;
  geminiIgnorePatterns?: string[];
  includeBuildArtifacts?: boolean;
  isGitRepo?: boolean;
}

export class FileDiscoveryService {
  private gitIgnoreFilter: IgnoreFilter | null = null;
  private aiExcludeFilter: IgnoreFilter | null = null;
  private geminiIgnorePatterns: string[] = [];
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  async initialize(options: FileDiscoveryOptions = {}): Promise<void> {
    const isGitRepo = options.isGitRepo ?? isGitRepository(this.projectRoot);

    if (options.respectAIExclude !== false) {
      const parser = new AIExcludeParser(this.projectRoot);
      await parser.initialize();
      this.aiExcludeFilter = parser;
    }

    if (options.respectGitIgnore !== false && isGitRepo) {
      const parser = new GitIgnoreParser(this.projectRoot);
      await parser.initialize();
      this.gitIgnoreFilter = parser;
    }

    this.geminiIgnorePatterns = options.geminiIgnorePatterns ?? [];
  }

  async glob(
    pattern: string | string[],
    options: GlobOptions = {},
  ): Promise<string[]> {
    const files = (await glob(pattern, {
      ...options,
      nocase: true,
    })) as string[];
    return this.filterFiles(files);
  }

  /**
   * Filters a list of file paths based on ignore rules
   */
  filterFiles(
    filePaths: string[],
    options: FileDiscoveryOptions = {},
  ): string[] {
    return filePaths.filter((filePath) => {
      if (this.geminiIgnoreMatch(filePath, options.geminiIgnorePatterns)) {
        return false;
      }

      // aiexclude takes precedence over gitignore
      // see https://cloud.google.com/gemini/docs/codeassist/create-aiexclude-file#write_an_aiexclude_file
      if (
        options.respectAIExclude !== false &&
        this.aiExcludeFilter?.isIgnored(filePath)
      ) {
        return false;
      }

      // Always respect git ignore unless explicitly disabled
      if (
        this.isGitRepository(options) &&
        options.respectGitIgnore !== false &&
        this.gitIgnoreFilter?.isIgnored(filePath)
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Checks if a single file should be ignored
   */
  shouldIgnoreFile(
    filePath: string,
    options: FileDiscoveryOptions = {},
  ): boolean {
    if (this.geminiIgnoreMatch(filePath, options.geminiIgnorePatterns)) {
      return true;
    }

    // aiexclude takes precedence over gitignore
    // see https://cloud.google.com/gemini/docs/codeassist/create-aiexclude-file#write_an_aiexclude_file
    if (
      options.respectAIExclude !== false &&
      this.aiExcludeFilter?.isIgnored(filePath)
    ) {
      return true;
    }

    if (
      this.isGitRepository(options) &&
      options.respectGitIgnore !== false &&
      this.gitIgnoreFilter?.isIgnored(filePath)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Returns whether the project is a git repository
   */
  isGitRepository(options: FileDiscoveryOptions = {}): boolean {
    return options.isGitRepo ?? isGitRepository(this.projectRoot);
  }

  /**
   * Returns true if the filePath matches any glob pattern in geminiIgnorePatterns
   */
  geminiIgnoreMatch(filePath: string, patterns?: string[]): boolean {
    const allPatterns = (this.geminiIgnorePatterns ?? []).concat(
      patterns ?? [],
    );
    const relativePath = makeRelative(filePath, this.projectRoot);
    const isMatch = micromatch.isMatch(relativePath, allPatterns);
    return isMatch;
  }
}
