/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Main entry point for the a2alib package

// Schema exports (already directly in src, so dist/schema.js)
export * from './schema.js';

// Client exports (from src/client/index.js -> dist/client/index.js)
export * from './client/index.js';

// Server exports (from src/server/index.js -> dist/server/index.js)
export * from './server/index.js';
