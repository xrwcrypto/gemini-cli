/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  ToolRegistry,
} from '@gemini-code/core';
import {
  Content,
  Part,
  FunctionCall,
  GenerateContentResponse,
} from '@google/genai';
import { GoogleGenerativeAIError } from '@google/generative-ai';
import { logToFile } from '@gemini-code/core';

function getResponseText(response: GenerateContentResponse): string | null {
  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (
      candidate.content &&
      candidate.content.parts &&
      candidate.content.parts.length > 0
    ) {
      return candidate.content.parts
        .filter((part) => part.text)
        .map((part) => part.text)
        .join('');
    }
  }
  return null;
}

const originalProcessStdoutWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = (
  message: string | Uint8Array,
  encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
  cb?: (err?: Error | null) => void
): boolean => {
  const messageStr = typeof message === 'string' ? message : new TextDecoder().decode(message);
  logToFile(`[NonInteractive STDOUT]: ${messageStr.trimEnd()}`);
  if (typeof encodingOrCb === 'function') {
    return originalProcessStdoutWrite(message, encodingOrCb);
  }
  return originalProcessStdoutWrite(message, encodingOrCb as BufferEncoding | undefined, cb);
};

export async function runNonInteractive(
  config: Config,
  input: string,
): Promise<void> {
  const geminiClient = config.getGeminiClient();
  const toolRegistry: ToolRegistry = await config.getToolRegistry();

  const chat = await geminiClient.getChat();
  const abortController = new AbortController();
  let currentMessages: Content[] = [{ role: 'user', parts: [{ text: input }] }];

  try {
    while (true) {
      const functionCalls: FunctionCall[] = [];

      const responseStream = await chat.sendMessageStream({
        message: currentMessages[0]?.parts || [], // Ensure parts are always provided
        config: {
          abortSignal: abortController.signal,
          tools: [
            { functionDeclarations: toolRegistry.getFunctionDeclarations() },
          ],
        },
      });

      for await (const resp of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }
        const textPart = getResponseText(resp);
        if (textPart) {
          process.stdout.write(textPart);
        }
        if (resp.functionCalls) {
          functionCalls.push(...resp.functionCalls);
        }
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          const callId = fc.id ?? `${fc.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: fc.name as string,
            args: (fc.args ?? {}) as Record<string, unknown>,
          };

          const toolResponse = await executeToolCall(
            requestInfo,
            toolRegistry,
            abortController.signal,
          );

          if (toolResponse.error) {
            console.error(
              `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
            toolResponseParts.push(...(toolResponse.responseParts as Part[]));
          } else {
            toolResponseParts.push(...(toolResponse.responseParts as Part[]));
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        process.stdout.write('\n'); // Ensure a final newline
        return;
      }
    }
  } catch (error) {
    console.error('Error processing input:', error);
    process.exit(1);
  }
}
