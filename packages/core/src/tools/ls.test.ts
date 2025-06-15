
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LSTool } from './ls.js';
import { Config } from '../config/config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('LSTool', () => {
  let lsTool: LSTool;
  let mockConfig: Config;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-tool-test-'));
    mockConfig = {
      getTargetDir: () => tempDir,
      getFileFilteringRespectGitIgnore: () => true,
      getFileService: async () => ({
        isGitRepository: () => false,
        shouldIgnoreFile: () => false,
      }),
    } as unknown as Config;
    lsTool = new LSTool(tempDir, mockConfig);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('validateToolParams', () => {
    it('should return null for valid parameters', () => {
      expect(lsTool.validateToolParams({ path: tempDir })).toBeNull();
    });

    it('should return an error for a relative path', () => {
      expect(lsTool.validateToolParams({ path: 'some/relative/path' })).toContain('Path must be absolute');
    });

    it('should return an error for a path outside the root directory', () => {
      const outsidePath = path.resolve(os.tmpdir(), 'outside-ls-test');
      expect(lsTool.validateToolParams({ path: outsidePath })).toContain('Path must be within the root directory');
    });
  });

  describe('execute', () => {
    it('should list files in a directory', async () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'hello');
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const result = await lsTool.execute({ path: tempDir }, new AbortController().signal);
      expect(result.llmContent).toContain('[DIR] subdir');
      expect(result.llmContent).toContain('file1.txt');
      expect(result.returnDisplay).toBe('Listed 2 item(s).');
    });

    it('should handle an empty directory', async () => {
      const result = await lsTool.execute({ path: tempDir }, new AbortController().signal);
      expect(result.llmContent).toContain('is empty');
      expect(result.returnDisplay).toBe('Directory is empty.');
    });

    it('should return an error for a non-existent directory', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent');
      const result = await lsTool.execute({ path: nonExistentPath }, new AbortController().signal);
      expect(result.returnDisplay).toContain('Failed to list directory');
    });

    it('should return an error if path is not a directory', async () => {
        const filePath = path.join(tempDir, 'file.txt');
        fs.writeFileSync(filePath, 'hello');
        const result = await lsTool.execute({ path: filePath }, new AbortController().signal);
        expect(result.returnDisplay).toContain('Path is not a directory');
    });

    it('should ignore files based on the ignore parameter', async () => {
        fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'hello');
        fs.writeFileSync(path.join(tempDir, 'file2.log'), 'log');
        const result = await lsTool.execute({ path: tempDir, ignore: ['*.log'] }, new AbortController().signal);
        expect(result.llmContent).not.toContain('file2.log');
        expect(result.llmContent).toContain('file1.txt');
    });

    it('should respect gitignore rules', async () => {
        mockConfig.getFileService = async () => ({
            isGitRepository: () => true,
            shouldIgnoreFile: (filePath: string) => filePath.endsWith('.log'),
        } as any);
        lsTool = new LSTool(tempDir, mockConfig);

        fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'hello');
        fs.writeFileSync(path.join(tempDir, 'file2.log'), 'log');

        const result = await lsTool.execute({ path: tempDir }, new AbortController().signal);
        expect(result.llmContent).not.toContain('file2.log');
        expect(result.llmContent).toContain('file1.txt');
        expect(result.returnDisplay).toContain('(1 git-ignored)');
    });
  });
});
