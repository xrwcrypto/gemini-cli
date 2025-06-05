/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ToolCallConfirmationDetails } from '@gemini-code/core';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';

export interface ToolConfirmationHandlerProps {
  initialConfirmationDetails: ToolCallConfirmationDetails;
}

export const ToolConfirmationHandler: React.FC<
  ToolConfirmationHandlerProps
> = ({ initialConfirmationDetails }) => {
  return (
    <ToolConfirmationMessage confirmationDetails={initialConfirmationDetails} />
  );
};