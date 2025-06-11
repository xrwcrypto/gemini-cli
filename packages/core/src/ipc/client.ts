/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as net from 'net';

const port = process.env.GEMINI_IPC_PORT;
const token = process.env.GEMINI_IPC_TOKEN;

async function sendMessage(message: object): Promise<unknown> {
  if (!port || !token) {
    throw new Error('IPC environment variables not set');
  }

  return new Promise((resolve, reject) => {
    const client = net.createConnection(
      { port: parseInt(port, 10), host: '127.0.0.1' },
      () => {
        client.write(JSON.stringify({ ...message, token }));
      },
    );

    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      } catch (_e) {
        reject(new Error('Invalid response from proxy'));
      }
      client.end();
    });

    client.on('error', (err) => {
      reject(err);
    });
  });
}

export async function isAppInstalled(appName: string): Promise<boolean> {
  try {
    const response = (await sendMessage({
      type: 'health_check',
      application: appName,
    })) as { installed: boolean };
    return response.installed;
  } catch (_e) {
    return false;
  }
}

export async function openInEditor(
  editor: string,
  filePath: string,
  line?: number,
): Promise<void> {
  const args = line ? [`--goto`, `${filePath}:${line}`] : [filePath];
  await sendMessage({ type: 'execute', command: editor, args });
}
