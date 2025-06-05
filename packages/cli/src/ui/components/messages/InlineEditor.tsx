/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InlineEditorProps {
  initialContent: string;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}

export const InlineEditor: React.FC<InlineEditorProps> = ({
  initialContent,
  onSave,
  onCancel,
}) => {
  const [content, setContent] = useState(initialContent);

  useInput((_, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const handleSave = () => {
    onSave(content);
  };

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Box marginBottom={1}>
        <Text>
          Edit the proposed change below. Press Enter to save, or Esc to
          cancel.
        </Text>
      </Box>
      <TextInput value={content} onChange={setContent} onSubmit={handleSave} />
    </Box>
  );
};