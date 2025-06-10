#!/bin/bash

echo "Building and installing VS Code extension..."

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Install vsce if not already installed
if ! command -v vsce &> /dev/null; then
    echo "Installing vsce..."
    npm install -g vsce
fi

# Package the extension
echo "Packaging extension..."
vsce package --out gemini-cli-vscode.vsix

# Install the extension
echo "Installing extension..."
code --install-extension gemini-cli-vscode.vsix --force

echo "Done! Please reload VS Code window (Cmd+R in command palette)"