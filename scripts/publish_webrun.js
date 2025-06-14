/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
const { version } = packageJson;

const imageName = 'gemini-cli-webrun';
const registry = process.env.WEBRUN_IMAGE_REGISTRY;
const name = 'gemini-cli-webrun';

if (!registry) {
  console.error(
    'Error: WEBRUN_IMAGE_REGISTRY must be set as an environment variable.',
  );
  process.exit(1);
}

const fullImageName = `${registry}/${name}:${version}`;
const latestImageName = `${registry}/${name}:latest`;

try {
  console.log(`Tagging ${imageName} as ${fullImageName}`);
  execSync(`docker tag ${imageName} ${fullImageName}`, { stdio: 'inherit' });

  console.log(`Tagging ${imageName} as ${latestImageName}`);
  execSync(`docker tag ${imageName} ${latestImageName}`, { stdio: 'inherit' });

  console.log(`Pushing ${fullImageName}`);
  execSync(`docker push ${fullImageName}`, { stdio: 'inherit' });

  console.log(`Pushing ${latestImageName}`);
  execSync(`docker push ${latestImageName}`, { stdio: 'inherit' });

  console.log('Successfully published webrun image.');
} catch (error) {
  console.error('Failed to publish webrun image:', error);
  process.exit(1);
}
