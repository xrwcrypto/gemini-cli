/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';

interface GeminiMessageContentProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight: number;
  isFollowedByToolGroup?: boolean;
}

/*
 * Gemini message content is a semi-hacked component. The intention is to represent a partial
 * of GeminiMessage and is only used when a response gets too long. In that instance messages
 * are split into multiple GeminiMessageContent's to enable the root <Static> component in
 * App.tsx to be as performant as humanly possible.
 */
export const GeminiMessageContent: React.FC<GeminiMessageContentProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  isFollowedByToolGroup = false,
}) => {
  if (!text && !isPending) {
    return null;
  }

  const originalPrefix = '✦ ';
  const prefixWidth = originalPrefix.length;

  return (
    <Box
      flexDirection="column"
      paddingLeft={prefixWidth}
      marginBottom={isFollowedByToolGroup || isPending ? 0 : 1}
    >
      <MarkdownDisplay
        text={text}
        isPending={isPending}
        availableTerminalHeight={availableTerminalHeight}
      />
    </Box>
  );
};
