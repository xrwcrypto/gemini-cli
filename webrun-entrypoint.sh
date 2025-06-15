#!/bin/bash

set -e

REPO_URL=$1

if [ -z "$REPO_URL" ]; then
  echo "No repository URL provided. Starting Gemini CLI in default directory."
  exec gemini
fi

echo "Received repository URL: $REPO_URL"

# Security check for github.com URLs
if ! [[ "$REPO_URL" =~ ^https://github\.com/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+(\.git)?$ ]]; then
  echo "Error: Invalid repository URL. Only public github.com repositories are supported." >&2
  echo "Example: https://github.com/google-gemini/gemini-cli.git" >&2
  echo "Starting Gemini in default directory..." >&2
  exec gemini
fi

# Clean and create workspace
echo "Preparing workspace..."
rm -rf /home/node/workspace
mkdir -p /home/node/workspace
echo "Workspace ready."

echo "Cloning repository into /home/node/workspace..."
if git clone --depth 1 "$REPO_URL" /home/node/workspace; then
  echo "Successfully cloned repository."
  cd /home/node/workspace
  echo "Changed directory to $(pwd)."
  echo "Starting Gemini CLI in cloned repository..."
else
  echo "Error: Failed to clone repository." >&2
  echo "Starting Gemini in default directory..." >&2
fi

exec gemini
