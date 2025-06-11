/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as net from 'net';
import * as fs from 'fs/promises';
import { exec } from 'child_process';

const [port, token] = process.argv.slice(2);

if (!port || !token) {
  console.error('Port and token are required');
  process.exit(1);
}

const ALLOWED_EDITORS = ['code'];

const server = net.createServer((socket) => {
  socket.on('data', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.token !== token) {
        socket.write(JSON.stringify({ error: 'Invalid token' }));
        socket.end();
        return;
      }

      if (message.type === 'health_check') {
        try {
          await fs.access(`/Applications/Visual Studio Code.app`);
          socket.write(JSON.stringify({ installed: true }));
        } catch {
          socket.write(JSON.stringify({ installed: false }));
        }
      } else if (
        message.type === 'execute' &&
        ALLOWED_EDITORS.includes(message.command)
      ) {
        const args = message.args.join(' ');
        exec(`${message.command} ${args}`, (error, stdout, stderr) => {
          if (error) {
            socket.write(JSON.stringify({ success: false, error: stderr }));
          } else {
            socket.write(JSON.stringify({ success: true }));
          }
          socket.end();
        });
      } else {
        socket.write(JSON.stringify({ error: 'Invalid command' }));
        socket.end();
      }
    } catch (_e) {
      socket.write(JSON.stringify({ error: 'Invalid message' }));
      socket.end();
    }
  });
});

server.listen(parseInt(port, 10), '127.0.0.1', () => {
  console.log(`IPC proxy listening on port ${port}`);
});
