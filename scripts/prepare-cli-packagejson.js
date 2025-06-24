/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { execSync } from 'child_process';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = yargs(hideBin(process.argv))
  .option('target', {
    description: 'The package.json to update.',
    choices: ['package', 'repo'],
    demandOption: true,
  })
  .help()
  .alias('help', 'h').argv;

const { target } = argv;

const cliPackageJsonPath =
  target === 'package'
    ? path.resolve(__dirname, '../packages/cli/package.json')
    : path.resolve(__dirname, '../package.json');
const cliPackageJson = JSON.parse(fs.readFileSync(cliPackageJsonPath, 'utf8'));

// Get version from root package.json (accessible via env var in npm scripts)
const baseVersion = process.env.npm_package_version;
let version = baseVersion;

// For root, append the git commit hash to the version.
if (target === 'repo') {
  const shortSha = execSync('git rev-parse --short HEAD').toString().trim();
  version = `${baseVersion}-${shortSha}`;
  cliPackageJson.version = version;
  console.log(`Updated version for root package.json to: ${version}`);
}

// Get Docker registry and image name directly from PUBLISH_ environment variables.
// These are expected to be set by the CI/build environment.
const containerImageRegistry = process.env.SANDBOX_IMAGE_REGISTRY;
const containerImageName = process.env.SANDBOX_IMAGE_NAME;

if (!baseVersion || !containerImageRegistry || !containerImageName) {
  console.error(
    'Error: Missing required environment variables. Need: ' +
      'npm_package_version, SANDBOX_IMAGE_REGISTRY, and SANDBOX_IMAGE_NAME.',
  );
  console.error(
    'These should be passed from the CI environment (e.g., Cloud Build substitutions) ' +
      'to the npm publish:release script.',
  );
  process.exit(1);
}

const containerImageUri = `${containerImageRegistry}/${containerImageName}:${version}`;

// Add or update fields in cliPackageJson.config to store this information
if (!cliPackageJson.config) {
  cliPackageJson.config = {};
}
cliPackageJson.config.sandboxImageUri = containerImageUri;

// Remove 'prepublishOnly' from scripts if it exists
if (cliPackageJson.scripts && cliPackageJson.scripts.prepublishOnly) {
  delete cliPackageJson.scripts.prepublishOnly;
  console.log(
    `Removed prepublishOnly script from ${path.relative(
      process.cwd(),
      cliPackageJsonPath,
    )}`,
  );
}

fs.writeFileSync(
  cliPackageJsonPath,
  JSON.stringify(cliPackageJson, null, 2) + '\n',
);
console.log(
  `Updated ${path.relative(process.cwd(), cliPackageJsonPath)} with Docker image details:`,
);
console.log(`  URI: ${containerImageUri}`);
console.log(`  Registry: ${containerImageRegistry}`);
console.log(`  Image Name: ${containerImageName}`);
