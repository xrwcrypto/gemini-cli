/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Mocked } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCompletion } from './useCompletion.js';
import { FileDiscoveryService } from '@gemini-cli/core';
import { glob } from 'glob';

// Mock dependencies
vi.mock('@gemini-cli/core', async () => {
  const actual = await vi.importActual('@gemini-cli/core');
  return {
    ...actual,
    FileDiscoveryService: vi.fn(),
    isNodeError: vi.fn((error) => error.code === 'ENOENT'),
    escapePath: vi.fn((path) => path),
    unescapePath: vi.fn((path) => path),
    getErrorMessage: vi.fn((error) => error.message),
  };
});
vi.mock('glob');

describe('useCompletion integration tests', () => {
  let mockFileDiscoveryService: Mocked<FileDiscoveryService>;
  let mockConfig: Partial<Mocked<Config>>;
  const testCwd = '/test/project';
  const slashCommands = [
    { name: 'help', description: 'Show help', action: vi.fn() },
    { name: 'clear', description: 'Clear screen', action: vi.fn() },
  ];

  beforeEach(() => {
    mockFileDiscoveryService = {
      shouldGitIgnoreFile: vi.fn(),
      filterFiles: vi.fn(),
    } as unknown as Mocked<FileDiscoveryService>;

    mockConfig = {
      getFileService: vi.fn().mockReturnValue(mockFileDiscoveryService),
      getEnableRecursiveFileSearch: vi.fn(() => true),
    };

    vi.mocked(glob).mockResolvedValue([]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should perform a recursive search for queries without path separators', async () => {
    const globResults = [`${testCwd}/src/index.ts`, `${testCwd}/README.md`];
    vi.mocked(glob).mockResolvedValue(globResults);

    const { result } = renderHook(() =>
      useCompletion('@read', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(glob).toHaveBeenCalledWith('**/read*', expect.any(Object));
    expect(result.current.suggestions).toEqual([
      { label: 'README.md', value: 'README.md' },
      { label: 'src/index.ts', value: 'src/index.ts' },
    ]);
  });

  it('should perform a local search for queries with path separators', async () => {
    const globResults = [`${testCwd}/src/index.ts`, `${testCwd}/src/app.ts`];
    vi.mocked(glob).mockResolvedValue(globResults);

    const { result } = renderHook(() =>
      useCompletion('@src/', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(glob).toHaveBeenCalledWith('src/*', expect.any(Object));
    expect(result.current.suggestions).toEqual([
      { label: 'src/app.ts', value: 'src/app.ts' },
      { label: 'src/index.ts', value: 'src/index.ts' },
    ]);
  });

  it('should filter git-ignored entries from glob results', async () => {
    const globResults = [
      `${testCwd}/data/file.txt`,
      `${testCwd}/dist/bundle.js`,
    ];
    vi.mocked(glob).mockResolvedValue(globResults);

    mockFileDiscoveryService.shouldGitIgnoreFile.mockImplementation(
      (path: string) => path.startsWith('dist'),
    );

    const { result } = renderHook(() =>
      useCompletion('@d', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].label).toBe('data/file.txt');
  });

  it('should not perform search if recursive search is disabled', async () => {
    mockConfig.getEnableRecursiveFileSearch.mockReturnValue(false);

    renderHook(() =>
      useCompletion('@any', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(glob).not.toHaveBeenCalled();
  });

  it('should handle empty glob results', async () => {
    vi.mocked(glob).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useCompletion('@nonexistent', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(result.current.suggestions).toHaveLength(0);
    expect(result.current.showSuggestions).toBe(false);
  });

  it('should respect the MAX_RESULTS budget', async () => {
    // Create a large array of glob results, exceeding the budget.
    const globResults = Array.from(
      { length: 150 },
      (_, i) => `${testCwd}/file${i}.txt`,
    );
    vi.mocked(glob).mockResolvedValue(globResults);

    const { result } = renderHook(() =>
      useCompletion('@file', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // The number of suggestions should be capped at MAX_RESULTS (100).
    expect(result.current.suggestions).toHaveLength(100);
  });

  it('should abort the previous glob search when the query changes', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    // Mock glob to return a promise that never resolves, simulating a long-running search.
    vi.mocked(glob).mockImplementation(() => new Promise(() => {}));

    const { rerender } = renderHook(
      ({ query }) =>
        useCompletion(query, testCwd, true, slashCommands, mockConfig),
      { initialProps: { query: '@a' } },
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Rerender with a new query, which should trigger the cleanup function of the useEffect hook.
    rerender({ query: '@ab' });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // The abort function should have been called, cancelling the previous search.
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });
});
