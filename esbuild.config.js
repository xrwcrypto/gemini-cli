/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import esbuild from 'esbuild';

esbuild
  .build({
    entryPoints: {
      gemini: 'packages/cli/index.ts',
      proxy: 'packages/core/src/ipc/proxy.ts',
    },
    bundle: true,
    outdir: 'bundle',
    platform: 'node',
    format: 'esm',
    external: [],
    banner: {
      js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
    },
  })
  .catch(() => process.exit(1));
