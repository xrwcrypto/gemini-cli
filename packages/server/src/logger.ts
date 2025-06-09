/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import winston from 'winston';
import fs from 'fs';
import os from 'os';
import path from 'path';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geminiagent'));
  logger.info(`Logs will be written to ${logDir}`);
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    }),
  );
  logger.add(
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
    }),
  );
}

export { logger };
