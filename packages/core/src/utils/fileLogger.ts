/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOG_FILE_NAME = 'gemini-cli-log.txt';
const LOG_FILE_PATH = path.join(os.homedir(), LOG_FILE_NAME);

// Ensure the log file exists
try {
  fs.accessSync(LOG_FILE_PATH, fs.constants.F_OK);
} catch (e) {
  fs.writeFileSync(LOG_FILE_PATH, `Log started at ${new Date().toISOString()}\n`);
}

/**
 * Appends a message to the log file.
 * @param message The message to log.
 */
export function logToFile(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  fs.appendFile(LOG_FILE_PATH, logMessage, (err) => {
    if (err) {
      // Fallback to console.error if logging to file fails
      console.error('Failed to write to log file:', err);
    }
  });
}

/**
 * Logs an object to the file, converting it to a string.
 * @param data The object or data to log.
 */
export function logObjectToFile(data: unknown): void {
  let messageString: string;
  if (typeof data === 'string') {
    messageString = data;
  } else if (typeof data === 'object' && data !== null) {
    try {
      messageString = JSON.stringify(data, null, 2);
    } catch (e) {
      messageString = '[Circular object or unstringifiable data]';
    }
  } else {
    messageString = String(data);
  }
  logToFile(messageString);
}

console.log(`Logging to: ${LOG_FILE_PATH}`);
