#!/bin/bash
# Test script for VS Code IDE integration

echo "Testing VS Code MCP integration..."

# Set VS Code environment variables as if running in VS Code terminal
export GEMINI_VSCODE_EXTENSION="1"
export GEMINI_VSCODE_EXTENSION_PATH="/Users/keithballinger/Desktop/projects/gemini-cli/vscode-extension"
export VSCODE_WORKSPACE_FOLDER="/Users/keithballinger/Desktop/projects/gemini-cli"

echo "Environment variables set:"
echo "  GEMINI_VSCODE_EXTENSION=$GEMINI_VSCODE_EXTENSION"
echo "  GEMINI_VSCODE_EXTENSION_PATH=$GEMINI_VSCODE_EXTENSION_PATH"
echo "  VSCODE_WORKSPACE_FOLDER=$VSCODE_WORKSPACE_FOLDER"

echo ""
echo "Starting Gemini CLI with /ide command test..."
echo "/ide active" | npm start 2>&1 | grep -A5 "ide"