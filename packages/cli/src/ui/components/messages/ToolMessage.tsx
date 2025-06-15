/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors } from '../../colors.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { GeminiRespondingSpinner } from '../GeminiRespondingSpinner.js';

const STATIC_HEIGHT = 1;
const RESERVED_LINE_COUNT = 5; // for tool name, status, padding etc.
const STATUS_INDICATOR_WIDTH = 3;
const MIN_LINES_SHOWN = 2; // show at least this many lines
const MIN_LINES_HIDDEN = 3; // hide at least this many lines (or don't hide any)

export type TextEmphasis = 'high' | 'medium' | 'low';

export interface ToolMessageProps extends IndividualToolCallDisplay {
  prefix: string;
  errorLinePrefix: string;
  availableTerminalHeight: number;
  emphasis?: TextEmphasis;
  renderOutputAsMarkdown?: boolean;
  displayMode?: 'box' | 'line';
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  prefix,
  errorLinePrefix,
  name,
  description,
  resultDisplay,
  status,
  availableTerminalHeight,
  emphasis = 'medium',
  renderOutputAsMarkdown = true,
  displayMode = 'box',
}) => {
  const resultIsString =
    typeof resultDisplay === 'string' && resultDisplay.trim().length > 0;
  const lines = React.useMemo(
    () => (resultIsString ? resultDisplay.split('\n') : []),
    [resultIsString, resultDisplay],
  );
  let contentHeightEstimate = Math.max(
    availableTerminalHeight - STATIC_HEIGHT - RESERVED_LINE_COUNT,
    MIN_LINES_SHOWN + 1, // enforce minimum lines shown
  );
  // enforce minimum lines hidden (don't hide any otherwise)
  if (lines.length - contentHeightEstimate < MIN_LINES_HIDDEN) {
    contentHeightEstimate = lines.length;
  }

  // Truncate the overall string content if it's too long.
  // MarkdownRenderer will handle specific truncation for code blocks within this content.
  // Estimate available height for this specific tool message content area
  // This is a rough estimate; ideally, we'd have a more precise measurement.
  const displayableResult = React.useMemo(
    () =>
      resultIsString
        ? lines.slice(-contentHeightEstimate).join('\n')
        : resultDisplay,
    [lines, resultIsString, contentHeightEstimate, resultDisplay],
  );
  const hiddenLines = Math.max(0, lines.length - contentHeightEstimate);

  if (displayMode === 'line') {
    const resultIsShortString =
      typeof resultDisplay === 'string' &&
      resultDisplay.trim().length > 0 &&
      resultDisplay.length < 80 &&
      !resultDisplay.includes('\n');

    return (
      <Box paddingY={0} flexDirection="column">
        <Box minHeight={1}>
          <LineToolStatusIndicator status={status} prefix={prefix} />
          <ToolInfo
            name={name}
            status={status}
            description={description}
            emphasis={emphasis}
          />
          {resultIsShortString &&
            (status === ToolCallStatus.Success ||
              status === ToolCallStatus.Error) && (
              <Text>
                {' '}
                -{' '}
                <Text color={Colors.Gray}>
                  {status === ToolCallStatus.Error ? (
                    <Text color={Colors.AccentRed}>{resultDisplay}</Text>
                  ) : (
                    resultDisplay
                  )}
                </Text>
              </Text>
            )}
          {emphasis === 'high' && <TrailingIndicator />}
        </Box>
        {status === ToolCallStatus.Error &&
          resultIsString &&
          !resultIsShortString && (
            <Box width="100%" flexDirection="row">
              <Text color={Colors.AccentRed}>{errorLinePrefix}</Text>
              <Box>
                <Text color={Colors.AccentRed}>{resultDisplay}</Text>
              </Box>
            </Box>
          )}
      </Box>
    );
  }

  return (
    <Box paddingX={1} paddingY={0} flexDirection="column">
      <Box minHeight={1}>
        <ToolStatusIndicator status={status} />

        <ToolInfo
          name={name}
          status={status}
          description={description}
          emphasis={emphasis}
        />
        {emphasis === 'high' && <TrailingIndicator />}
      </Box>
      {displayableResult && (
        <Box paddingLeft={STATUS_INDICATOR_WIDTH} width="100%" marginTop={1}>
          <Box flexDirection="column">
            {hiddenLines > 0 && (
              <Box>
                <Text color={Colors.Gray}>
                  ... first {hiddenLines} line{hiddenLines === 1 ? '' : 's'}{' '}
                  hidden ...
                </Text>
              </Box>
            )}
            {typeof displayableResult === 'string' &&
              renderOutputAsMarkdown && (
                <Box flexDirection="column">
                  <MarkdownDisplay
                    text={displayableResult}
                    isPending={false}
                    availableTerminalHeight={availableTerminalHeight}
                  />
                </Box>
              )}
            {typeof displayableResult === 'string' &&
              !renderOutputAsMarkdown && (
                <Box flexDirection="column">
                  <Text>{displayableResult}</Text>
                </Box>
              )}
            {typeof displayableResult !== 'string' && (
              <DiffRenderer
                diffContent={displayableResult.fileDiff}
                filename={displayableResult.fileName}
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

type ToolStatusIndicatorProps = {
  status: ToolCallStatus;
};

const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({
  status,
}) => (
  <Box minWidth={STATUS_INDICATOR_WIDTH}>
    {status === ToolCallStatus.Pending && (
      <Text color={Colors.AccentGreen}>o</Text>
    )}
    {status === ToolCallStatus.Executing && (
      <GeminiRespondingSpinner
        spinnerType="toggle"
        nonRespondingDisplay={'⊷'}
      />
    )}
    {status === ToolCallStatus.Success && (
      <Text color={Colors.AccentGreen}>✔</Text>
    )}
    {status === ToolCallStatus.Confirming && (
      <Text color={Colors.AccentYellow}>?</Text>
    )}
    {status === ToolCallStatus.Canceled && (
      <Text color={Colors.AccentYellow} bold>
        -
      </Text>
    )}
    {status === ToolCallStatus.Error && (
      <Text color={Colors.AccentRed} bold>
        x
      </Text>
    )}
  </Box>
);

type ToolInfo = {
  name: string;
  description: string;
  status: ToolCallStatus;
  emphasis: TextEmphasis;
};
const ToolInfo: React.FC<ToolInfo> = ({
  name,
  description,
  status,
  emphasis,
}) => {
  const nameColor = React.useMemo<string>(() => {
    switch (emphasis) {
      case 'high':
        return Colors.Foreground;
      case 'medium':
        return Colors.Foreground;
      case 'low':
        return Colors.Gray;
      default: {
        const exhaustiveCheck: never = emphasis;
        return exhaustiveCheck;
      }
    }
  }, [emphasis]);
  return (
    <Box>
      <Text
        wrap="truncate-end"
        strikethrough={status === ToolCallStatus.Canceled}
      >
        <Text color={nameColor} bold>
          {name}
        </Text>{' '}
        <Text color={Colors.Gray}>{description}</Text>
      </Text>
    </Box>
  );
};

const TrailingIndicator: React.FC = () => (
  <Text color={Colors.Foreground}> ←</Text>
);

type LineToolStatusIndicatorProps = {
  status: ToolCallStatus;
  prefix: string;
};

const LineToolStatusIndicator: React.FC<LineToolStatusIndicatorProps> = ({
  status,
  prefix,
}) => {
  return (
    <Box>
      {status === ToolCallStatus.Pending && (
        <Text color={Colors.AccentGreen}>{prefix}o </Text>
      )}
      {status === ToolCallStatus.Executing && (
        <Text>
          {prefix}
          <GeminiRespondingSpinner
            spinnerType="toggle"
            nonRespondingDisplay={'⊷'}
          />{' '}
        </Text>
      )}
      {status === ToolCallStatus.Success && (
        <Text color={Colors.AccentGreen}>{prefix}✔ </Text>
      )}
      {status === ToolCallStatus.Confirming && (
        <Text color={Colors.AccentYellow}>{prefix}? </Text>
      )}
      {status === ToolCallStatus.Canceled && (
        <Text color={Colors.AccentYellow} bold>
          {prefix}-{' '}
        </Text>
      )}
      {status === ToolCallStatus.Error && (
        <Text color={Colors.AccentRed} bold>
          {prefix}✘{'  '}
        </Text>
      )}
    </Box>
  );
};


