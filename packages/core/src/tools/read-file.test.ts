/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { ReadFileTool, ReadFileToolParams } from './read-file.js';
import * as fileUtils from '../utils/fileUtils.js';
import path from 'path';
import os from 'os';
import fs from 'fs'; // For actual fs operations in setup
import { Config } from '../config/config.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';

// Mock fileUtils.processSingleFileContent
vi.mock('../utils/fileUtils', async () => {
  const actualFileUtils =
    await vi.importActual<typeof fileUtils>('../utils/fileUtils');
  return {
    ...actualFileUtils, // Spread actual implementations
    processSingleFileContent: vi.fn(), // Mock specific function
    isWithinRoot: vi.fn(),
  };
});

const mockProcessSingleFileContent = fileUtils.processSingleFileContent as Mock;
const mockIsWithinRoot = fileUtils.isWithinRoot as Mock;

describe('ReadFileTool', () => {
  let tempRootDir: string;
  let tool: ReadFileTool;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    // Create a unique temporary root directory for each test run
    tempRootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'read-file-tool-root-'),
    );
    fs.writeFileSync(
      path.join(tempRootDir, '.geminiignore'),
      ['foo.*'].join('\n'),
    );
    const fileService = new FileDiscoveryService(tempRootDir);
    const mockConfigInstance = {
      getGeminiIgnorePatterns: () => ['**/foo.bar', 'foo.baz', 'foo.*'],
      getFileService: () => fileService,
    } as unknown as Partial<Config> as Config;
    tool = new ReadFileTool(tempRootDir, mockConfigInstance);
    mockProcessSingleFileContent.mockReset();
    mockIsWithinRoot.mockImplementation((p: string, root: string) => {
      const relative = path.relative(root, p);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  });

  afterEach(() => {
    // Clean up the temporary root directory
    if (fs.existsSync(tempRootDir)) {
      fs.rmSync(tempRootDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('validateToolParams', () => {
    it('should return null for valid params (absolute path within root)', () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
      };
      expect(tool.validateToolParams(params)).toBeNull();
    });

    it('should return null for valid params with offset and limit', () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: 0,
        limit: 10,
      };
      expect(tool.validateToolParams(params)).toBeNull();
    });

    it('should return error for relative path', () => {
      const params: ReadFileToolParams = { absolute_path: 'test.txt' };
      expect(tool.validateToolParams(params)).toMatch(
        /File path must be absolute/,
      );
    });

    it('should return error for path outside root', () => {
      const outsidePath = path.resolve(os.tmpdir(), 'outside-root.txt');
      const params: ReadFileToolParams = { absolute_path: outsidePath };
      expect(tool.validateToolParams(params)).toMatch(
        /File path must be within the root directory/,
      );
    });

    it('should return error for negative offset', () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: -1,
        limit: 10,
      };
      expect(tool.validateToolParams(params)).toBe(
        'Offset must be a non-negative number',
      );
    });

    it('should return error for non-positive limit', () => {
      const paramsZero: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: 0,
        limit: 0,
      };
      expect(tool.validateToolParams(paramsZero)).toBe(
        'Limit must be a positive number',
      );
      const paramsNegative: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: 0,
        limit: -5,
      };
      expect(tool.validateToolParams(paramsNegative)).toBe(
        'Limit must be a positive number',
      );
    });

    it('should return error for schema validation failure (e.g. missing path)', () => {
      const params = { offset: 0 } as unknown as ReadFileToolParams;
      expect(tool.validateToolParams(params)).toBe(
        'Parameters failed schema validation.',
      );
    });
  });

  describe('getDescription', () => {
    it('should return a shortened, relative path', () => {
      const filePath = path.join(tempRootDir, 'sub', 'dir', 'file.txt');
      const params: ReadFileToolParams = { absolute_path: filePath };
      // Assuming tempRootDir is something like /tmp/read-file-tool-root-XXXXXX
      // The relative path would be sub/dir/file.txt
      expect(tool.getDescription(params)).toBe(
        path.join('sub', 'dir', 'file.txt'),
      );
    });

    it('should return . if path is the root directory', () => {
      const params: ReadFileToolParams = { absolute_path: tempRootDir };
      expect(tool.getDescription(params)).toBe('.');
    });

    it('should return "Path unavailable" for invalid params', () => {
      expect(tool.getDescription(null as unknown as ReadFileToolParams)).toBe(
        'Path unavailable',
      );
      expect(tool.getDescription({} as unknown as ReadFileToolParams)).toBe(
        'Path unavailable',
      );
      expect(
        tool.getDescription({ path: 123 } as unknown as ReadFileToolParams),
      ).toBe('Path unavailable');
      expect(
        tool.getDescription({ path: '   ' } as unknown as ReadFileToolParams),
      ).toBe('Path unavailable');
    });
  });

  describe('execute', () => {
    it('should return validation error if params are invalid', async () => {
      const params: ReadFileToolParams = { absolute_path: 'relative/path.txt' };
      const result = await tool.execute(params, abortSignal);
      expect(result.llmContent).toMatch(/Error: Invalid parameters provided/);
      expect(result.returnDisplay).toMatch(/File path must be absolute/);
    });

    it('should return error from processSingleFileContent if it fails', async () => {
      const filePath = path.join(tempRootDir, 'error.txt');
      const params: ReadFileToolParams = { absolute_path: filePath };
      const errorMessage = 'Simulated read error';
      mockProcessSingleFileContent.mockResolvedValue({
        llmContent: `Error reading file ${filePath}: ${errorMessage}`,
        returnDisplay: `Error reading file ${filePath}: ${errorMessage}`,
        error: errorMessage,
      });

      const result = await tool.execute(params, abortSignal);
      expect(mockProcessSingleFileContent).toHaveBeenCalledWith(
        filePath,
        tempRootDir,
        undefined,
        undefined,
      );
      expect(result.llmContent).toContain(errorMessage);
      expect(result.returnDisplay).toContain(errorMessage);
    });

    it('should return success result for a text file', async () => {
      const filePath = path.join(tempRootDir, 'textfile.txt');
      const fileContent = 'This is a test file.';
      const params: ReadFileToolParams = { absolute_path: filePath };
      mockProcessSingleFileContent.mockResolvedValue({
        llmContent: fileContent,
        returnDisplay: `Read text file: ${path.basename(filePath)}`,
      });

      const result = await tool.execute(params, abortSignal);
      expect(mockProcessSingleFileContent).toHaveBeenCalledWith(
        filePath,
        tempRootDir,
        undefined,
        undefined,
      );
      expect(result.llmContent).toBe(fileContent);
      expect(result.returnDisplay).toBe(
        `Read text file: ${path.basename(filePath)}`,
      );
    });

    it('should return success result for an image file', async () => {
      const filePath = path.join(tempRootDir, 'image.png');
      const imageData = {
        inlineData: { mimeType: 'image/png', data: 'base64...' },
      };
      const params: ReadFileToolParams = { absolute_path: filePath };
      mockProcessSingleFileContent.mockResolvedValue({
        llmContent: imageData,
        returnDisplay: `Read image file: ${path.basename(filePath)}`,
      });

      const result = await tool.execute(params, abortSignal);
      expect(mockProcessSingleFileContent).toHaveBeenCalledWith(
        filePath,
        tempRootDir,
        undefined,
        undefined,
      );
      expect(result.llmContent).toEqual(imageData);
      expect(result.returnDisplay).toBe(
        `Read image file: ${path.basename(filePath)}`,
      );
    });

    it('should pass offset and limit to processSingleFileContent', async () => {
      const filePath = path.join(tempRootDir, 'paginated.txt');
      const params: ReadFileToolParams = {
        absolute_path: filePath,
        offset: 10,
        limit: 5,
      };
      mockProcessSingleFileContent.mockResolvedValue({
        llmContent: 'some lines',
        returnDisplay: 'Read text file (paginated)',
      });

      await tool.execute(params, abortSignal);
      expect(mockProcessSingleFileContent).toHaveBeenCalledWith(
        filePath,
        tempRootDir,
        10,
        5,
      );
    });

    it('should return error if path is ignored by a .geminiignore pattern', async () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'foo.bar'),
      };
      const result = await tool.execute(params, abortSignal);
      expect(result.returnDisplay).toContain('foo.bar');
      expect(result.returnDisplay).not.toContain('foo.baz');
    });
  });

  describe('Path Resilience', () => {
    describe('on POSIX', () => {
      it('should allow absolute POSIX paths within the root', () => {
        const params: ReadFileToolParams = {
          absolute_path: `${tempRootDir}/test.txt`,
        };
        expect(tool.validateToolParams(params)).toBeNull();
      });

      it('should reject relative POSIX paths', () => {
        const params: ReadFileToolParams = { absolute_path: 'test.txt' };
        expect(tool.validateToolParams(params)).toMatch(
          /File path must be absolute/,
        );
      });

      it('should reject absolute POSIX paths outside the root', () => {
        const params: ReadFileToolParams = {
          absolute_path: '/elsewhere/test.txt',
        };
        expect(tool.validateToolParams(params)).toMatch(
          /File path must be within the root directory/,
        );
      });
    });

    describe('on Windows', () => {
      let win32Root: string;

      beforeEach(() => {
        // Mock the platform to simulate running on Windows
        vi.spyOn(os, 'platform').mockReturnValue('win32');
        vi.spyOn(path, 'resolve').mockImplementation((...paths) =>
          path.win32.resolve(...paths),
        );

        win32Root = 'C:\\gemini-test-root';
        const mockConfigInstance = {
          getGeminiIgnorePatterns: () => [],
          getFileService: () => new FileDiscoveryService(win32Root),
        } as unknown as Config;
        tool = new ReadFileTool(win32Root, mockConfigInstance);

        // Mock isWithinRoot to use win32 logic for this test suite
        mockIsWithinRoot.mockImplementation((p: string, root: string) => {
          const relative = path.win32.relative(root, p);
          return !relative.startsWith('..') && !path.win32.isAbsolute(relative);
        });
      });

      it('should allow absolute Win32 paths within the root', () => {
        const params: ReadFileToolParams = {
          absolute_path: 'C:\\gemini-test-root\\test.txt',
        };
        expect(tool.validateToolParams(params)).toBeNull();
      });

      it('should reject relative Win32 paths', () => {
        const params: ReadFileToolParams = { absolute_path: 'test.txt' };
        expect(tool.validateToolParams(params)).toMatch(
          /File path must be absolute/,
        );
      });

      it('should reject absolute Win32 paths outside the root', () => {
        const params: ReadFileToolParams = {
          absolute_path: 'C:\\elsewhere\\test.txt',
        };
        expect(tool.validateToolParams(params)).toMatch(
          /File path must be within the root directory/,
        );
      });

      it('should handle mixed-separator paths correctly within the root', () => {
        const params: ReadFileToolParams = {
          absolute_path: 'C:/gemini-test-root/test.txt',
        };
        expect(tool.validateToolParams(params)).toBeNull();
      });
    });
  });
});
