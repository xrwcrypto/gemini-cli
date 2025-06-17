/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { WebFetchTool } from './web-fetch.js';
import { Config, ApprovalMode } from '../config/config.js';
import { ToolConfirmationOutcome } from './tools.js';
import { GeminiClient } from '../core/client.js';
import { GenerateContentResponse } from '@google/genai';

describe('WebFetchTool', () => {
  let webFetchTool: WebFetchTool;
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;
  let setApprovalMode: Mock;

  beforeEach(() => {
    mockGeminiClient = {
      generateContent: vi.fn(),
    } as unknown as GeminiClient;

    setApprovalMode = vi.fn();

    mockConfig = {
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
      setApprovalMode,
      getGeminiClient: () => mockGeminiClient,
    } as unknown as Config;

    webFetchTool = new WebFetchTool(mockConfig);
  });

  describe('shouldConfirmExecute', () => {
    it('should return confirmation details with the correct prompt and urls', async () => {
      const params = { prompt: 'fetch https://example.com' };
      const confirmationDetails =
        await webFetchTool.shouldConfirmExecute(params);

      expect(confirmationDetails).toEqual({
        type: 'info',
        title: 'Confirm Web Fetch',
        prompt: 'fetch https://example.com',
        urls: ['https://example.com'],
        onConfirm: expect.any(Function),
      });
    });

    it('should convert github urls to raw format', async () => {
      const params = {
        prompt:
          'fetch https://github.com/google/gemini-react/blob/main/README.md',
      };
      const confirmationDetails =
        await webFetchTool.shouldConfirmExecute(params);

      expect(confirmationDetails).toEqual({
        type: 'info',
        title: 'Confirm Web Fetch',
        prompt:
          'fetch https://github.com/google/gemini-react/blob/main/README.md',
        urls: [
          'https://raw.githubusercontent.com/google/gemini-react/main/README.md',
        ],
        onConfirm: expect.any(Function),
      });
    });

    it('should return false if approval mode is AUTO_EDIT', async () => {
      // Override config for this specific test
      vi.mocked(mockConfig.getApprovalMode).mockReturnValue(
        ApprovalMode.AUTO_EDIT,
      );
      const params = { prompt: 'fetch https://example.com' };
      const confirmationDetails =
        await webFetchTool.shouldConfirmExecute(params);

      expect(confirmationDetails).toBe(false);
    });

    it('should call setApprovalMode when onConfirm is called with ProceedAlways', async () => {
      const params = { prompt: 'fetch https://example.com' };
      const confirmationDetails =
        await webFetchTool.shouldConfirmExecute(params);

      if (
        confirmationDetails &&
        typeof confirmationDetails === 'object' &&
        'onConfirm' in confirmationDetails
      ) {
        await confirmationDetails.onConfirm(
          ToolConfirmationOutcome.ProceedAlways,
        );
      }

      expect(setApprovalMode).toHaveBeenCalledWith(ApprovalMode.AUTO_EDIT);
    });
  });

  describe('validateParams', () => {
    it('should return null for valid parameters', () => {
      const params = { prompt: 'Summarize https://example.com' };
      expect(webFetchTool.validateParams(params)).toBeNull();
    });

    it('should return an error for an empty prompt', () => {
      const params = { prompt: ' ' };
      expect(webFetchTool.validateParams(params)).toContain('cannot be empty');
    });

    it('should return an error if no URL is present', () => {
      const params = { prompt: 'Summarize the content' };
      expect(webFetchTool.validateParams(params)).toContain(
        'must contain at least one valid URL',
      );
    });
  });

  describe('execute', () => {
    it('should call the gemini client with the correct parameters', async () => {
      const params = { prompt: 'Summarize https://example.com' };
      vi.mocked(mockGeminiClient.generateContent).mockResolvedValue(
        {} as unknown as GenerateContentResponse,
      );

      await webFetchTool.execute(params, new AbortController().signal);

      expect(mockGeminiClient.generateContent).toHaveBeenCalledWith(
        [{ role: 'user', parts: [{ text: params.prompt }] }],
        { tools: [{ urlContext: {} }] },
        expect.any(AbortSignal),
      );
    });

    it('should format the response with sources', async () => {
      const mockApiResponse = {
        candidates: [
          {
            urlContextMetadata: {
              urlMetadata: [
                { urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' },
              ],
            },
            groundingMetadata: {
              groundingChunks: [
                { web: { title: 'Test Title', uri: 'https://example.com' } },
              ],
              groundingSupports: [],
            },
            content: { parts: [{ text: 'This is the summary.' }] },
          },
        ],
      };
      vi.mocked(mockGeminiClient.generateContent).mockResolvedValue(
        mockApiResponse as unknown as GenerateContentResponse,
      );

      const result = await webFetchTool.execute(
        { prompt: 'Summarize https://example.com' },
        new AbortController().signal,
      );

      expect(result.llmContent).toContain('This is the summary.');
      expect(result.llmContent).toContain('Sources:');
      expect(result.llmContent).toContain(
        '[1] Test Title (https://example.com)',
      );
    });

    it('should handle API errors gracefully', async () => {
      const error = new Error('API Error');
      vi.mocked(mockGeminiClient.generateContent).mockRejectedValue(error);

      const result = await webFetchTool.execute(
        { prompt: 'Summarize https://example.com' },
        new AbortController().signal,
      );

      expect(result.llmContent).toContain(
        'Error: Error processing web content',
      );
    });
  });
});
