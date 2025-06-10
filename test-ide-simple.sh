#!/bin/bash

# Set environment
export GEMINI_VSCODE_EXTENSION="1"
export GEMINI_VSCODE_EXTENSION_PATH="/Users/keithballinger/Desktop/projects/gemini-cli/vscode-extension"
export VSCODE_WORKSPACE_FOLDER="/Users/keithballinger/Desktop/projects/gemini-cli"

# Run with more debug output
echo "Testing /ide active command..."
echo "/ide active" | npm start 2>&1 | grep -E "(DEBUG|MCP|vscode|ide|server|connect)" | head -30