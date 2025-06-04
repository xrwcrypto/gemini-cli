// npm run generate &&
//  node_modules/.bin/esbuild packages/cli/index.ts 
// --bundle 
// --outfile=bundle/gemini.js 
// --platform=node 
// --format=esm 
// --banner:js=\"
//   import { createRequire } from 'module';
//   const require = createRequire(import.meta.url);
//   globalThis.__filename = require('url').fileURLToPath(import.meta.url);
//   globalThis.__dirname = require('path').dirname(globalThis.__filename);\" 
// && bash scripts/copy_bundle_assets.sh
import { build } from 'esbuild'
import { copy } from 'esbuild-plugin-copy';

const requireHotFix = `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.__filename = require('url').fileURLToPath(import.meta.url);
globalThis.__dirname = require('path').dirname(globalThis.__filename);
`;

await build({
  // input/output
  entryPoints: ['index.ts'],
  outfile: 'bundle/gemini.js',
  // configs
  bundle: true,
  platform: 'node',
  format: 'esm',
  // hotfixes
  banner: {
    ['js']: requireHotFix
  },
  // plugins
  plugins: [
    copy({
        resolveFrom: 'cwd',
        assets: {
            from: ['../core/src/tools/shell.md', '../core/src/tools/shell.json'],
            to: ['./bundle']
        }
    })
  ]
})