/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { execSync } from 'child_process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('s', {
    alias: 'skip-npm-install-build',
    type: 'boolean',
    default: false,
    description: 'skip npm install + npm run build',
  })
  .option('i', {
    alias: 'image',
    type: 'string',
    default: 'gemini-cli-webrun',
    description: 'use <image> name for custom image',
  }).argv;

if (!argv.s) {
  execSync('npm install', { stdio: 'inherit' });
  execSync('npm run build --workspaces', { stdio: 'inherit' });
}

const buildStdout = process.env.VERBOSE ? 'inherit' : 'ignore';

function buildImage(imageName, dockerfile) {
  console.log(`building ${imageName} ... (can be slow first time)`);
  const buildCommand = 'docker buildx build';

  execSync(
    `${buildCommand} ${process.env.BUILD_WEBRUN_FLAGS || ''} -f "${dockerfile}" -t "${imageName}" .`,
    { stdio: buildStdout, shell: '/bin/bash' },
  );
  console.log(`built ${imageName}`);
}

buildImage(argv.i, 'Dockerfile.webrun');

execSync(`docker image prune -f`, { stdio: 'ignore' });
