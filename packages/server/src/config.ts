/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { MCPServerConfig } from '@gemini-code/core';
import stripJsonComments from 'strip-json-comments';

export const SETTINGS_DIRECTORY_NAME = '.gemini';
export const USER_SETTINGS_DIR = path.join(homedir(), SETTINGS_DIRECTORY_NAME);
export const USER_SETTINGS_PATH = path.join(USER_SETTINGS_DIR, 'settings.json');

export interface Settings {
  mcpServers?: Record<string, MCPServerConfig>;
}

export function loadSettings(): Settings {
  let userSettings: Settings = {};

  // Load user settings
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
      userSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
    }
  } catch (error) {
    console.error('Error reading user settings file:', error);
  }

  return userSettings;
}
