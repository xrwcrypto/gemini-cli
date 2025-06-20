/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getMCPServerStatus,
  MCPServerStatus,
} from '../tools/mcp-client.js';
import { ToolConfirmationOutcome } from './tools.js';
import { Config } from '../config/config.js'

export function isIdeConnected(): boolean {
  return getMCPServerStatus('ide') === MCPServerStatus.CONNECTED;
}

export async function showDiff(
  config: Config,
  filePath: string,
  updatedContent: string,
): Promise<ToolConfirmationOutcome> {
  const toolRegistry = await config.getToolRegistry();
  const ideTool = toolRegistry.getTool('openFileDiff');
  if (!ideTool) {
    throw new Error('IDE tool not found in registry.');
  }

  ideTool.execute(
    {
      filePath,
      updatedContent,
    },
    new AbortController().signal,
  );

  await new Promise((resolve) => setTimeout(resolve, 15000));

  return ToolConfirmationOutcome.ProceedOnce;
}
