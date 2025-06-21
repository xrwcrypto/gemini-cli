/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parentPort } from 'worker_threads';
import { glob } from 'glob';
import { getErrorMessage } from '@gemini-cli/core';

if (!parentPort) {
  throw new Error('This script must be run as a worker thread.');
}

parentPort.on(
  'message',
  async (msg: { query: string; prefix: string; cwd: string }) => {
    try {
      const { query, prefix, cwd } = msg;

      const globPattern = `**/${prefix}*`;
      const files = await glob(globPattern, {
        cwd,
        dot: prefix.startsWith('.'),
        nocase: true,
        absolute: true,
      });

      parentPort!.postMessage({ query, files });
    } catch (error) {
      parentPort!.postMessage({
        query: msg.query,
        files: [],
        error: getErrorMessage(error),
      });
    }
  },
);
