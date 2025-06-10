#!/bin/bash

# Set environment
export GEMINI_VSCODE_EXTENSION="1"
export GEMINI_VSCODE_EXTENSION_PATH="/Users/keithballinger/Desktop/projects/gemini-cli/vscode-extension"
export VSCODE_WORKSPACE_FOLDER="/Users/keithballinger/Desktop/projects/gemini-cli"

# Run with a delay before the command
echo "Testing /ide active with delay..."
(sleep 2 && echo "/ide active") | npm start 2>&1 | tail -20