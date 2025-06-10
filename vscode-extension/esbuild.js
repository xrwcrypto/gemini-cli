const esbuild = require('esbuild');
const path = require('path');

// Build extension
esbuild.build({
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node16',
  sourcemap: true,
  minify: process.argv.includes('--production'),
}).catch(() => process.exit(1));

// Build MCP server (needs to bundle dependencies)
esbuild.build({
  entryPoints: ['./src/mcp/standalone-server.ts'],
  bundle: true,
  outfile: 'dist/mcp/standalone-server-bundled.js',
  format: 'cjs',
  platform: 'node',
  target: 'node16',
  sourcemap: true,
  minify: process.argv.includes('--production'),
  // Don't mark any dependencies as external for the MCP server
  external: [],
}).catch(() => process.exit(1));