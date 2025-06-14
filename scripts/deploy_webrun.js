
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

const name = 'gemini-cli-webrun';
const region = 'europe-west1';
const makePublicFlag = "--allow-unauthenticated" // "--no-invoker-iam-check";

// TODO: replace with publicly hosted webrun image
const imageUri = `gcr.io/steren-serverless/gemini-cli-webrun:latest`;

const deployCommand = `gcloud alpha run deploy ${name} --image ${imageUri} --max 1 --cpu 8 --memory 32Gi --region ${region} ${makePublicFlag}`;

console.log(`Executing: ${deployCommand}`);
execSync(deployCommand, { stdio: 'inherit' });

