/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileOperationResponse } from '../file-operations-types.js';

/**
 * Extended response with security metadata
 */
export interface SecurityFileOperationResponse extends FileOperationResponse {
  metadata?: {
    security?: {
      operationsAllowed: number;
      operationsDenied: number;
      sessionId: string;
    };
    [key: string]: any;
  };
}