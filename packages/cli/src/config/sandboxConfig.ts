/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SandboxConfig } from '@gemini-cli/core';
import commandExists from 'command-exists';
import * as os from 'node:os';
import { getPackageJson } from '../utils/package.js';
import { Settings } from './settings.js';
import { GIT_COMMIT_INFO } from '../generated/git-commit.js';

// This is a stripped-down version of the CliArgs interface from config.ts
// to avoid circular dependencies.
interface SandboxCliArgs {
  sandbox?: boolean | string;
  'sandbox-image'?: string;
}

const VALID_SANDBOX_COMMANDS: ReadonlyArray<SandboxConfig['command']> = [
  'docker',
  'podman',
  'sandbox-exec',
];

function isSandboxCommand(value: string): value is SandboxConfig['command'] {
  return (VALID_SANDBOX_COMMANDS as readonly string[]).includes(value);
}

function getSandboxCommand(
  sandbox?: boolean | string,
): SandboxConfig['command'] | '' {
  // If the SANDBOX env var is set, we're already inside the sandbox.
  if (process.env.SANDBOX) {
    return '';
  }

  // note environment variable takes precedence over argument (from command line or settings)
  const environmentConfiguredSandbox =
    process.env.GEMINI_SANDBOX?.toLowerCase().trim() ?? '';
  sandbox =
    environmentConfiguredSandbox?.length > 0
      ? environmentConfiguredSandbox
      : sandbox;
  if (sandbox === '1' || sandbox === 'true') sandbox = true;
  else if (sandbox === '0' || sandbox === 'false' || !sandbox) sandbox = false;

  if (sandbox === false) {
    return '';
  }

  if (typeof sandbox === 'string' && sandbox) {
    if (!isSandboxCommand(sandbox)) {
      console.error(
        `ERROR: invalid sandbox command '${sandbox}'. Must be one of ${VALID_SANDBOX_COMMANDS.join(
          ', ',
        )}`,
      );
      process.exit(1);
    }
    // confirm that specfied command exists
    if (commandExists.sync(sandbox)) {
      return sandbox;
    }
    console.error(
      `ERROR: missing sandbox command '${sandbox}' (from GEMINI_SANDBOX)`,
    );
    process.exit(1);
  }

  // look for seatbelt, docker, or podman, in that order
  // for container-based sandboxing, require sandbox to be enabled explicitly
  if (os.platform() === 'darwin' && commandExists.sync('sandbox-exec')) {
    return 'sandbox-exec';
  } else if (commandExists.sync('docker') && sandbox === true) {
    return 'docker';
  } else if (commandExists.sync('podman') && sandbox === true) {
    return 'podman';
  }

  // throw an error if user requested sandbox but no command was found
  if (sandbox === true) {
    console.error(
      'ERROR: GEMINI_SANDBOX is true but failed to determine command for sandbox; ' +
        'install docker or podman or specify command in GEMINI_SANDBOX',
    );
    process.exit(1);
  }

  return '';
}

export async function loadSandboxConfig(
  settings: Settings,
  argv: SandboxCliArgs,
): Promise<SandboxConfig | undefined> {
  const sandboxOption = argv.sandbox ?? settings.sandbox;
  const command = getSandboxCommand(sandboxOption);

  const image = await buildImageName(argv['sandbox-image']);
  console.log(image);

  return command && image ? { command, image } : undefined;
}

export async function buildImageName(imageNameOverride: string | undefined) {
  const packageJson = await getPackageJson();
  const imageName = String(
    imageNameOverride ??
      process.env.GEMINI_SANDBOX_IMAGE ??
      process.env.SANDBOX_IMAGE_NAME ??
      packageJson?.config?.sandboxImageUri ??
      'gemini-cli-sandbox',
  );

  console.log("buildImangeName:imageName ", imageName)
  console.log("buildImangeName:imageNameOverride ", imageNameOverride)
  console.log("buildImangeName:GEMINI_SANDBOX_IMAGE ", process.env.GEMINI_SANDBOX_IMAGE)

  let repository = String(
    process.env.SANDBOX_IMAGE_REGISTRY ??
      packageJson?.config?.sandboxRepository ??
      '',
  );

  console.log("buildImangeName:repository ", repository)
  console.log("buildImangeName:SANDBOX_IMAGE_REGISTRY ", process.env.SANDBOX_IMAGE_REGISTRY)
  console.log("buildImangeName:packgeJson.sandboxRepository ", packageJson?.config?.sandboxRepository)

  if (repository && !repository.endsWith('/')) {
    console.log("buildImangeName:repository Adding /")
    repository = `${repository}/`;
    console.log("buildImangeName:repository Added /", repository)
  }

  const gitSHA = GIT_COMMIT_INFO;
  const version = packageJson?.version;

  console.log("buildImangeName:gitSHA ", gitSHA)
  console.log("buildImangeName:version ", packageJson?.version)
  
  const image = `${repository}${imageName}:${version}-${gitSHA}`;
  
  console.log("buildbuildImangeName:image ", image)
  return image;
}
