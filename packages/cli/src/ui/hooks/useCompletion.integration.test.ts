/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Mocked } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCompletion } from './useCompletion.js';
import * as fs from 'fs/promises';
import { FileDiscoveryService } from '@gemini-cli/core';
import { Worker } from 'worker_threads';

// Mock dependencies
vi.mock('fs/promises');
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

// Mock the worker
vi.mock('worker_threads', () => {
  const mockPostMessage = vi.fn();
  const mockOn = vi.fn();
  const mockTerminate = vi.fn();

  const MockWorker = vi.fn(() => ({
    postMessage: mockPostMessage,
    on: mockOn,
    terminate: mockTerminate,
  }));

  return {
    default: {
      Worker: MockWorker,
    },
    Worker: MockWorker,
  };
});

describe('useCompletion git-aware filtering integration', () => {
  let mockFileDiscoveryService: Mocked<FileDiscoveryService>;
  let mockConfig: any; // Using `any` for simplicity in mock setup
  const testCwd = '/test/project';
  const slashCommands = [
    { name: 'help', description: 'Show help', action: vi.fn() },
    { name: 'clear', description: 'Clear screen', action: vi.fn() },
  ];

  let mockWorker: Mocked<Worker>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockFileDiscoveryService = {
      shouldGitIgnoreFile: vi.fn(),
      filterFiles: vi.fn(), // Not used, but part of the interface
    } as unknown as Mocked<FileDiscoveryService>;

    mockConfig = {
      getFileService: vi.fn().mockReturnValue(mockFileDiscoveryService),
    };

    // Set up the mock worker instance before each test
    mockWorker = new (vi.mocked(Worker))(
      './fileSearch.worker.js',
    ) as Mocked<Worker>;
    vi.mocked(Worker).mockClear().mockReturnValue(mockWorker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const simulateWorkerResponse = async (response: object) => {
    const messageCallback = vi
      .mocked(mockWorker.on)
      .mock.calls.find((call) => call[0] === 'message')?.[1] as (
      msg: object,
    ) => void;

    if (messageCallback) {
      await act(async () => {
        messageCallback(response);
      });
    }
  };

  it('should filter git-ignored entries from @ completions', async () => {
    const globResults = [`${testCwd}/data`, `${testCwd}/dist`];

    mockFileDiscoveryService.shouldGitIgnoreFile.mockImplementation(
      (path: string) => path.includes('dist'),
    );

    const { result } = renderHook(() =>
      useCompletion('@d', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150)); // Debounce
    });

    await simulateWorkerResponse({ query: '@d', files: globResults });

    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].label).toBe('data');
    expect(result.current.showSuggestions).toBe(true);
  });

  it('should handle directory-specific completions with git filtering (no worker)', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'component.tsx', isDirectory: () => false },
      { name: 'temp.log', isDirectory: () => false },
      { name: 'index.ts', isDirectory: () => false },
    ] as any);

    mockFileDiscoveryService.shouldGitIgnoreFile.mockImplementation(
      (path: string) => path.includes('.log'),
    );

    const { result } = renderHook(() =>
      useCompletion('@src/comp', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(mockWorker.postMessage).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual([
      { label: 'component.tsx', value: 'component.tsx' },
    ]);
  });

  it('should post message to worker for top-level @ completions', async () => {
    const { result } = renderHook(() =>
      useCompletion('@s', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      query: '@s',
      prefix: 's',
      cwd: testCwd,
    });

    // Simulate response and check results
    const globResults = [`${testCwd}/src/index.ts`, `${testCwd}/README.md`];
    await simulateWorkerResponse({ query: '@s', files: globResults });

    expect(result.current.suggestions).toEqual([
      { label: 'README.md', value: 'README.md' },
      { label: 'src/index.ts', value: 'src/index.ts' },
    ]);
  });

  it('should post message to worker for dotfiles when input starts with a dot', async () => {
    const { result } = renderHook(() =>
      useCompletion('@.', testCwd, true, slashCommands, mockConfig),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      query: '@.',
      prefix: '.',
      cwd: testCwd,
    });

    const globResults = [
      `${testCwd}/.env`,
      `${testCwd}/.gitignore`,
      `${testCwd}/src/index.ts`,
    ];
    await simulateWorkerResponse({ query: '@.', files: globResults });

    expect(result.current.suggestions).toEqual([
      { label: '.env', value: '.env' },
      { label: '.gitignore', value: '.gitignore' },
      { label: 'src/index.ts', value: 'src/index.ts' },
    ]);
  });
});
