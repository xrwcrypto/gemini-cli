#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Copy pre-installed extensions at startup if they are not already present.
# This ensures default extensions are available without overwriting user-installed ones.
echo "Checking for pre-installed extensions..."
mkdir -p /home/node/.gemini/extensions
for ext_source in /opt/extensions/*; do
  if [ -e "$ext_source" ]; then
    ext_name=$(basename "$ext_source")
    ext_dest="/home/node/.gemini/extensions/$ext_name"
    if [ ! -e "$ext_dest" ]; then
      echo "Installing default extension: $ext_name"
      cp -r "$ext_source" "$ext_dest"
    fi
  fi
done

# Define the internal port for ttyd and the public port for Caddy.
export TTYD_PORT=7681
export PUBLIC_PORT=${PORT:-8080}

echo "Starting ttyd on internal port $TTYD_PORT..."

# Start ttyd in the background. The -a flag tells it to pass the URL
# argument to the command.
ttyd -p "$TTYD_PORT" -W -a tmux new-session -A -s gemini -- bash -c '
# This script runs inside the tmux session.

# The repo URL is passed as the first argument ($1) from ttyd.
REPO_URL="$0"
TARGET_DIR="/home/node"

if [ -n "$REPO_URL" ]; then
  echo "Received repository URL: $REPO_URL"
  if [[ "$REPO_URL" =~ ^https://github\.com/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+(\.git)?$ ]]; then
    CLONE_DIR="/home/node/workspace"
    echo "Preparing workspace..."
    rm -rf "$CLONE_DIR" && mkdir -p "$CLONE_DIR"
    echo "Cloning repository..."
    if git clone --depth 1 "$REPO_URL" "$CLONE_DIR"; then
      echo "Successfully cloned repository."
      TARGET_DIR="$CLONE_DIR"
    else
      echo "Error: Failed to clone repository." >&2
    fi
  else
    echo "Error: Invalid repository URL." >&2
  fi
fi

cd "$TARGET_DIR"
echo "Working directory: $(pwd)"
echo "Starting Gemini CLI..."

gemini

echo "Gemini CLI exited. Starting interactive shell..."
exec /bin/bash
' &

echo "Starting Caddy on public port $PUBLIC_PORT..."

# Start Caddy in the foreground.
caddy run --config /etc/caddy/Caddyfile