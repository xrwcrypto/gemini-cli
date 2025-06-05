/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors } from '../../colors.js';
import {
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolExecuteConfirmationDetails,
  ToolMcpConfirmationDetails,
  ToolEditConfirmationDetails,
} from '@gemini-code/core';
import {
  RadioButtonSelect,
  RadioSelectItem,
} from '../shared/RadioButtonSelect.js';
import { InlineEditor } from './InlineEditor.js';
import * as Diff from 'diff';
import { promises as fs } from 'fs';

export interface ToolConfirmationMessageProps {
  confirmationDetails: ToolCallConfirmationDetails;
}

export const ToolConfirmationMessage: React.FC<
  ToolConfirmationMessageProps
> = ({ confirmationDetails }) => {
  const { onConfirm } = confirmationDetails;
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [originalFileContent, setOriginalFileContent] = useState<string | null>(
    null,
  );
  const [proposedFileContent, setProposedFileContent] = useState<string | null>(
    null,
  );
  const [editedDiff, setEditedDiff] = useState<string | null>(null);

  useEffect(() => {
    if (
      !isEditing ||
      confirmationDetails.type !== 'edit' ||
      originalFileContent ||
      isLoading
    ) {
      return;
    }

    setIsLoading(true);
    const { fileName, fileDiff } =
      confirmationDetails as ToolEditConfirmationDetails;
    const patch = Diff.parsePatch(fileDiff)[0];
    const isNewFile = patch.oldFileName === '/dev/null';

    const getOriginalContent = () => {
      if (isNewFile) {
        return Promise.resolve('');
      }
      return fs.readFile(fileName, 'utf-8');
    };

    getOriginalContent()
      .then((content) => {
        setOriginalFileContent(content);
        const patchedContent = Diff.applyPatch(content, fileDiff);
        if (patchedContent === false) {
          // TODO(asashour): report this error to the user.
          setIsEditing(false);
          return;
        }
        setProposedFileContent(patchedContent);
      })
      .catch(() => {
        // TODO(asashour): report this error to the user.
        setIsEditing(false);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isEditing, confirmationDetails, originalFileContent, isLoading]);

  useInput((_, key) => {
    if (key.escape) {
      onConfirm(ToolConfirmationOutcome.Cancel, confirmationDetails);
    }
  });

  const handleSelect = (item: ToolConfirmationOutcome) => {
    if (item === ToolConfirmationOutcome.Edit) {
      setIsEditing(true);
    } else {
      const detailsToConfirm = { ...confirmationDetails };
      if (editedDiff && detailsToConfirm.type === 'edit') {
        detailsToConfirm.fileDiff = editedDiff;
      }
      onConfirm(item, detailsToConfirm);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setOriginalFileContent(null);
    setProposedFileContent(null);
  };

  const handleSave = (newContent: string) => {
    if (confirmationDetails.type === 'edit' && originalFileContent) {
      const { fileName } = confirmationDetails as ToolEditConfirmationDetails;
      const newDiff = Diff.createPatch(
        fileName,
        originalFileContent,
        newContent,
        'Current',
        'Proposed',
      );
      setEditedDiff(newDiff);
    }
    handleCancel();
  };

  if (isEditing && confirmationDetails.type === 'edit') {
    if (isLoading) {
      return <Text>Loading file for editing...</Text>;
    }

    if (proposedFileContent === null) {
      return <Text>Error loading file content for editing.</Text>;
    }

    return (
      <InlineEditor
        initialContent={proposedFileContent}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  let bodyContent: React.ReactNode | null = null;
  let question: string;

  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = new Array<
    RadioSelectItem<ToolConfirmationOutcome>
  >();

  if (confirmationDetails.type === 'edit') {
    bodyContent = (
      <DiffRenderer
        diffContent={editedDiff ?? confirmationDetails.fileDiff}
        filename={confirmationDetails.fileName}
      />
    );

    question = `Apply this change?`;
    options.push(
      {
        label: 'Yes, allow once',
        value: ToolConfirmationOutcome.ProceedOnce,
      },
      {
        label: 'Yes, allow always',
        value: ToolConfirmationOutcome.ProceedAlways,
      },
      {
        label: 'Edit proposed change',
        value: ToolConfirmationOutcome.Edit,
      },
      { label: 'No (esc)', value: ToolConfirmationOutcome.Cancel },
    );
  } else if (confirmationDetails.type === 'exec') {
    const executionProps =
      confirmationDetails as ToolExecuteConfirmationDetails;

    bodyContent = (
      <Box flexDirection="column">
        <Box paddingX={1} marginLeft={1}>
          <Text color={Colors.AccentCyan}>{executionProps.command}</Text>
        </Box>
      </Box>
    );

    question = `Allow execution?`;
    options.push(
      {
        label: 'Yes, allow once',
        value: ToolConfirmationOutcome.ProceedOnce,
      },
      {
        label: `Yes, allow always "${executionProps.rootCommand} ..."`,
        value: ToolConfirmationOutcome.ProceedAlways,
      },
      { label: 'No (esc)', value: ToolConfirmationOutcome.Cancel },
    );
  } else {
    // mcp tool confirmation
    const mcpProps = confirmationDetails as ToolMcpConfirmationDetails;

    bodyContent = (
      <Box flexDirection="column" paddingX={1} marginLeft={1}>
        <Text color={Colors.AccentCyan}>MCP Server: {mcpProps.serverName}</Text>
        <Text color={Colors.AccentCyan}>Tool: {mcpProps.toolName}</Text>
      </Box>
    );

    question = `Allow execution of MCP tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"?`;
    options.push(
      {
        label: 'Yes, allow once',
        value: ToolConfirmationOutcome.ProceedOnce,
      },
      {
        label: `Yes, always allow tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"`,
        value: ToolConfirmationOutcome.ProceedAlwaysTool,
      },
      {
        label: `Yes, always allow all tools from server "${mcpProps.serverName}"`,
        value: ToolConfirmationOutcome.ProceedAlwaysServer,
      },
      { label: 'No (esc)', value: ToolConfirmationOutcome.Cancel },
    );
  }

  return (
    <Box flexDirection="column" padding={1} minWidth="90%">
      <Box flexGrow={1} flexShrink={1} overflow="hidden" marginBottom={1}>
        {bodyContent}
      </Box>

      <Box marginBottom={1} flexShrink={0}>
        <Text>{question}</Text>
      </Box>

      <Box flexShrink={0}>
        <RadioButtonSelect items={options} onSelect={handleSelect} />
      </Box>
    </Box>
  );
};