
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
  .option('project', {
    type: 'string',
    description:
      'Google Cloud project to deploy to. Can also be set via GOOGLE_CLOUD_PROJECT environment variable.',
  })
  .option('name', {
    type: 'string',
    default: 'gemini-cli-webrun',
    description: 'Name of the Cloud Run service.',
  })
  .option('region', {
    type: 'string',
    default: 'europe-west1',
    description: 'The GCP region to deploy to.',
  })
  .option('image', {
    type: 'string',
    description: 'Custom Gemini CLI webrun container image.',
  })
  .help().argv;

const project = argv.project || process.env.GOOGLE_CLOUD_PROJECT;

if (!project) {
  console.error(
    'Error: --project flag or GOOGLE_CLOUD_PROJECT environment variable must be set.',
  );
  process.exit(1);
}

const name = argv.name;
const region = argv.region;
const makePublicFlag = '--allow-unauthenticated'; // "--no-invoker-iam-check";

// TODO: replace the default with publicly hosted webrun image
const imageUri = argv.image || `gcr.io/${project}/gemini-cli-webrun:latest`;

// TODO: this doesn't work well with Vertex API.
const deployCommand = `gcloud alpha run deploy ${name} --image ${imageUri} --max 1 --cpu 8 --memory 32Gi ${makePublicFlag} --set-env-vars GOOGLE_CLOUD_PROJECT=${project},GOOGLE_CLOUD_LOCATION=${region} --region ${region} --project ${project}`;

console.log(`Executing: ${deployCommand}`);
execSync(deployCommand, { stdio: 'inherit' });

