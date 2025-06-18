/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getMCPServerStatus,
  MCPServerStatus,
} from '../tools/mcp-client.js';

export function isIdeConnected(): boolean {
  return getMCPServerStatus('ide') === MCPServerStatus.CONNECTED;
}
