/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { ToolMessage } from './ToolMessage.js';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import { Colors } from '../../colors.js';
import { Config } from '@gemini-cli/core';

interface ToolGroupMessageProps {
  groupId?: number;
  toolCalls: IndividualToolCallDisplay[];
  availableTerminalHeight: number;
  config?: Config;
  isFocused?: boolean;
  isFirstContent?: boolean;
  isFollowedByToolGroup?: boolean;
}

// Main component renders the border and maps the tools using ToolMessage
export const ToolGroupMessage: React.FC<ToolGroupMessageProps> = ({
  toolCalls,
  availableTerminalHeight,
  config,
  isFocused = true,
  isFirstContent = false,
  isFollowedByToolGroup = false,
}) => {
  const hasPending = !toolCalls.every(
    (t) => t.status === ToolCallStatus.Success,
  );
  const borderColor = hasPending ? Colors.AccentYellow : Colors.Gray;

  const staticHeight = /* border */ 2 + /* marginBottom */ 1;

  // only prompt for tool approval on the first 'confirming' tool in the list
  // note, after the CTA, this automatically moves over to the next 'confirming' tool
  const toolAwaitingApproval = useMemo(
    () => toolCalls.find((tc) => tc.status === ToolCallStatus.Confirming),
    [toolCalls],
  );

  if (config?.getToolCallDisplay() === 'line' && !toolAwaitingApproval) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        {toolCalls.map((tool, index) => {
          const isLastInGroup = index === toolCalls.length - 1;
          const isLastInChain = isLastInGroup && !isFollowedByToolGroup;

          let prefix: string;
          if (toolCalls.length === 1) {
            // This group has only one tool.
            if (isFirstContent) {
              // This is the very first item after a user prompt.
              prefix = isFollowedByToolGroup ? '┌── ' : '─── ';
            } else {
              // This is a single tool that follows another item.
              prefix = isLastInChain ? '╰── ' : '├── ';
            }
          } else {
            // This group has multiple tools.
            if (index === 0) {
              // First tool in the group.
              prefix = isFirstContent ? '┌── ' : '├── ';
            } else {
              // Subsequent tool in the group.
              prefix = isLastInChain ? '╰── ' : '├── ';
            }
          }

          const errorLinePrefix = isLastInChain ? '      ' : '│     ';

          return (
            <Box key={tool.callId} flexDirection="column" minHeight={1}>
              <ToolMessage
                prefix={prefix}
                errorLinePrefix={errorLinePrefix}
                callId={tool.callId}
                name={tool.name}
                description={tool.description}
                resultDisplay={tool.resultDisplay}
                status={tool.status}
                confirmationDetails={tool.confirmationDetails}
                availableTerminalHeight={
                  availableTerminalHeight - staticHeight
                }
                emphasis={'medium'}
                renderOutputAsMarkdown={tool.renderOutputAsMarkdown}
                displayMode="line"
              />
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      /*
        This width constraint is highly important and protects us from an Ink rendering bug.
        Since the ToolGroup can typically change rendering states frequently, it can cause
        Ink to render the border of the box incorrectly and span multiple lines and even
        cause tearing.
      */
      width="100%"
      marginLeft={1}
      borderDimColor={hasPending}
      borderColor={borderColor}
    >
      {toolCalls.map((tool) => {
        const isConfirming =
          !!toolAwaitingApproval && toolAwaitingApproval.callId === tool.callId;
        return (
          <Box key={tool.callId} flexDirection="column" minHeight={1}>
            <Box flexDirection="row" alignItems="center">
              <ToolMessage
                prefix=""
                errorLinePrefix=""
                callId={tool.callId}
                name={tool.name}
                description={tool.description}
                resultDisplay={tool.resultDisplay}
                status={tool.status}
                confirmationDetails={tool.confirmationDetails}
                availableTerminalHeight={availableTerminalHeight - staticHeight}
                emphasis={
                  isConfirming
                    ? 'high'
                    : toolAwaitingApproval
                      ? 'low'
                      : 'medium'
                }
                renderOutputAsMarkdown={tool.renderOutputAsMarkdown}
              />
            </Box>
            {tool.status === ToolCallStatus.Confirming &&
              isConfirming &&
              tool.confirmationDetails && (
                <ToolConfirmationMessage
                  confirmationDetails={tool.confirmationDetails}
                  config={config}
                  isFocused={isFocused}
                />
              )}
          </Box>
        );
      })}
    </Box>
  );
};
