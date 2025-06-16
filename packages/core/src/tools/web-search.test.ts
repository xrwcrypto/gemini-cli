/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSearchTool } from './web-search.js';
import { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';

describe('WebSearchTool', () => {
  let webSearchTool: WebSearchTool;
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;

  beforeEach(() => {
    mockGeminiClient = {
      generateContent: vi.fn(),
    } as unknown as GeminiClient;

    mockConfig = {
      getGeminiClient: () => mockGeminiClient,
    } as unknown as Config;

    webSearchTool = new WebSearchTool(mockConfig);
  });

  describe('validateParams', () => {
    it('should return null for valid parameters', () => {
      const params = { query: 'test query' };
      expect(webSearchTool.validateParams(params)).toBeNull();
    });

    it('should return an error for an empty query', () => {
      const params = { query: ' ' };
      expect(webSearchTool.validateParams(params)).toContain('cannot be empty');
    });
  });

  describe('execute', () => {
    it('should call the gemini client with the correct parameters', async () => {
      const params = { query: 'test query' };
      vi.mocked(mockGeminiClient.generateContent).mockResolvedValue({} as unknown as GenerateContentResponse);

      await webSearchTool.execute(params, new AbortController().signal);

      expect(mockGeminiClient.generateContent).toHaveBeenCalledWith(
        [{ role: 'user', parts: [{ text: params.query }] }],
        { tools: [{ googleSearch: {} }] },
        expect.any(AbortSignal),
      );
    });

    it('should format the response with sources', async () => {
      const mockApiResponse = {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { title: 'Test Title', uri: 'https://example.com' } },
              ],
              groundingSupports: [],
            },
            content: { parts: [{ text: 'This is the search result.' }] },
          },
        ],
      };
      vi.mocked(mockGeminiClient.generateContent).mockResolvedValue(
        mockApiResponse as unknown as GenerateContentResponse,
      );

      const result = await webSearchTool.execute(
        { query: 'test query' },
        new AbortController().signal,
      );

      expect(result.llmContent).toContain('This is the search result.');
      expect(result.llmContent).toContain('Sources:');
      expect(result.llmContent).toContain(
        '[1] Test Title (https://example.com)',
      );
    });

    it('should handle API errors gracefully', async () => {
      const error = new Error('API Error');
      vi.mocked(mockGeminiClient.generateContent).mockRejectedValue(error);

      const result = await webSearchTool.execute(
        { query: 'test query' },
        new AbortController().signal,
      );

      expect(result.llmContent).toContain('Error: Error during web search');
    });

    it('should handle no results found', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: { parts: [{ text: ' ' }] },
          },
        ],
      };
      vi.mocked(mockGeminiClient.generateContent).mockResolvedValue(
        mockApiResponse as unknown as GenerateContentResponse,
      );

      const result = await webSearchTool.execute(
        { query: 'test query' },
        new AbortController().signal,
      );

      expect(result.llmContent).toContain(
        'No search results or information found',
      );
    });
  });
});
