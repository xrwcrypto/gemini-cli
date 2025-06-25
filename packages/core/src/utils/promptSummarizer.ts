/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Content, PartListUnion, SchemaUnion, Type } from '@google/genai';
import { GeminiClient } from '../core/client.js';

const SUMMARIZE_PROMPT_TEMPLATE = `Summarize the following text to be a maximum of {maxLength} characters. The summary should be concise and capture the main points of the text.

Text to summarize:
"{textToSummarize}"

Respond *only* in JSON format according to the following schema. Do not include any text outside the JSON structure.
\`\`\`json
{
  "type": "object",
  "properties": {
    "summary": {
        "type": "string",
        "description": "The concise summary of the text, not exceeding the specified character limit."
    }
  },
  "required": ["summary"]
}
\`\`\`
`;

const RESPONSE_SCHEMA: SchemaUnion = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'The concise summary of the text.',
    },
  },
  required: ['summary'],
};

export interface SummarizationResponse {
  summary: string;
}

export async function summarizeText(
  textToSummarize: string,
  maxLength: number,
  geminiClient: GeminiClient,
  abortSignal: AbortSignal,
): Promise<SummarizationResponse | null> {
  if (!textToSummarize) {
    return null;
  }

  const prompt = SUMMARIZE_PROMPT_TEMPLATE.replace(
    '{maxLength}',
    String(maxLength),
  ).replace('{textToSummarize}', textToSummarize);

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

  try {
    const parsedResponse = (await geminiClient.generateJson(
      contents,
      RESPONSE_SCHEMA,
      abortSignal,
    )) as unknown as SummarizationResponse;
    console.log(parsedResponse);
    if (parsedResponse && parsedResponse.summary) {
      return parsedResponse;
    }
    return null;
  } catch (error) {
    console.warn(
      'Failed to talk to Gemini endpoint for summarization.',
      error,
    );
    return null;
  }
}
