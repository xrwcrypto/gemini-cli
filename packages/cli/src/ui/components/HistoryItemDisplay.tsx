/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { HistoryItem, HistoryItemWithoutId } from '../types.js';
import { UserMessage } from './messages/UserMessage.js';
import { UserShellMessage } from './messages/UserShellMessage.js';
import { GeminiMessage } from './messages/GeminiMessage.js';
import { InfoMessage } from './messages/InfoMessage.js';
import { ErrorMessage } from './messages/ErrorMessage.js';
import { ToolGroupMessage } from './messages/ToolGroupMessage.js';
import { GeminiMessageContent } from './messages/GeminiMessageContent.js';
import { CompressionMessage } from './messages/CompressionMessage.js';
import { Box } from 'ink';
import { AboutBox } from './AboutBox.js';
import { StatsDisplay } from './StatsDisplay.js';
import { SessionSummaryDisplay } from './SessionSummaryDisplay.js';
import { Config } from '@gemini-cli/core';

interface HistoryItemDisplayProps {
  item: HistoryItem | HistoryItemWithoutId;
  previousItem?: HistoryItem | HistoryItemWithoutId;
  availableTerminalHeight: number;
  isPending: boolean;
  config?: Config;
  isFocused?: boolean;
}

export const HistoryItemDisplay: React.FC<HistoryItemDisplayProps> = ({
  item,
  previousItem,
  availableTerminalHeight,
  isPending,
  config,
  isFocused = true,
}) => {
  const isFirstContent =
    !previousItem ||
    previousItem.type === 'user' ||
    previousItem.type === 'user_shell';

  const suppressMargin =
    (item.type === 'tool_group' && isFirstContent) ||
    (item.type === 'tool_group' && previousItem?.type === 'tool_group') ||
    (item.type === 'tool_group' && previousItem?.type === 'gemini');

  const itemId = 'id' in item ? item.id : undefined;

  return (
    <Box
      flexDirection="column"
      key={itemId}
      marginTop={suppressMargin ? 0 : 1}
    >
      {/* Render standard message types */}
      {item.type === 'user' && <UserMessage text={item.text} />}
      {item.type === 'user_shell' && <UserShellMessage text={item.text} />}
      {item.type === 'gemini' && (
        <GeminiMessage
          text={item.text}
          isPending={isPending}
          availableTerminalHeight={availableTerminalHeight}
          isFollowedByToolGroup={false}
        />
      )}
      {item.type === 'gemini_content' && (
        <GeminiMessageContent
          text={item.text}
          isPending={isPending}
          availableTerminalHeight={availableTerminalHeight}
          isFollowedByToolGroup={false}
        />
      )}
      {item.type === 'info' && <InfoMessage text={item.text} />}
      {item.type === 'error' && <ErrorMessage text={item.text} />}
      {item.type === 'about' && (
        <AboutBox
          cliVersion={item.cliVersion}
          osVersion={item.osVersion}
          sandboxEnv={item.sandboxEnv}
          modelVersion={item.modelVersion}
        />
      )}
      {item.type === 'stats' && (
        <StatsDisplay
          stats={item.stats}
          lastTurnStats={item.lastTurnStats}
          duration={item.duration}
        />
      )}
      {item.type === 'quit' && (
        <SessionSummaryDisplay stats={item.stats} duration={item.duration} />
      )}
      {item.type === 'tool_group' && (
        <ToolGroupMessage
          toolCalls={item.tools}
          groupId={itemId}
          availableTerminalHeight={availableTerminalHeight}
          config={config}
          isFocused={isFocused}
          isFirstContent={isFirstContent}
        />
      )}
      {item.type === 'compression' && (
        <CompressionMessage compression={item.compression} />
      )}
    </Box>
  );
};
