#!/bin/bash
# Test script for VS Code IDE integration

echo "Testing VS Code MCP integration..."

# Set VS Code environment variables as if running in VS Code terminal
export GEMINI_VSCODE_EXTENSION="1"
export GEMINI_VSCODE_EXTENSION_PATH="/Users/keithballinger/Desktop/projects/gemini-cli/vscode-extension"
export VSCODE_WORKSPACE_FOLDER="/Users/keithballinger/Desktop/projects/gemini-cli"

echo "Running: echo '/ide active' | npm start"
echo ""

# Run the command and capture output
echo "/ide active" | npm start 2>&1