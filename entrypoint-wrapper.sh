#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- ROOT EXECUTION ---
# Start privileged services and then re-execute this script as the WEBRUN_USER.
if [ "$(id -u)" = "0" ]; then
  echo "Running as root. Starting privileged services..."

  # Start the Docker daemon in the background.
  echo "Starting Docker daemon..."
  dockerd &
  sleep 3 # Give dockerd a moment to initialize.

  # Create user directories and set permissions.
  mkdir -p /home/$WEBRUN_USER/.config
  mkdir -p /home/$WEBRUN_USER/.local/share
  mkdir -p /home/$WEBRUN_USER/workspace
  chown -R $WEBRUN_USER:$WEBRUN_USER /home/$WEBRUN_USER

  # Configure and start lsyncd if a GCS project is defined.
  if [ -n "$GOOGLE_CLOUD_PROJECT" ]; then
      echo "Configuring lsyncd for project: $GOOGLE_CLOUD_PROJECT"
      GCS_BUCKET="gs://${GOOGLE_CLOUD_PROJECT}-${WEBRUN_REGION}-gemini-run"
      sed -i "s|gcs_bucket_placeholder|$GCS_BUCKET/agents/$WEBRUN_AGENT/workspace|" /etc/lsyncd/lsyncd.conf.lua
      mkdir -p /var/log/lsyncd
      lsyncd /etc/lsyncd/lsyncd.conf.lua &
      echo "lsyncd started in background."
  else
      echo "GOOGLE_CLOUD_PROJECT not set. Skipping lsyncd."
  fi

  # Switch to the non-privileged user and re-run this script.
  # Pass along the original arguments.
  echo "Switching to user $WEBRUN_USER..."
  exec su -m $WEBRUN_USER -- "$0" "$@"
fi

# --- NON-ROOT (WEBRUN_USER) EXECUTION ---
echo "Running as user $(whoami)."

# Set HOME to the correct directory to ensure tools write to the user's home.
export HOME=/home/$WEBRUN_USER

# Copy pre-installed extensions at startup if they are not already present.
echo "Checking for pre-installed extensions..."
mkdir -p /home/$WEBRUN_USER/.local/share/code-server/User
cp /opt/code-server/settings.json /home/$WEBRUN_USER/.local/share/code-server/User/settings.json
mkdir -p /home/$WEBRUN_USER/.gemini/extensions
for ext_source in /opt/extensions/*; do
  if [ -e "$ext_source" ]; then
    ext_name=$(basename "$ext_source")
    ext_dest="/home/$WEBRUN_USER/.gemini/extensions/$ext_name"
    if [ ! -e "$ext_dest" ]; then
      echo "Installing default extension: $ext_name"
      cp -r "$ext_source" "$ext_dest"
    fi
  fi
done

# Determine the repository URL.
# For interactive mode, it's passed as an argument by ttyd.
# For async mode, it's passed as an environment variable.
REPO_URL=""
if [ -n "$1" ]; then
  REPO_URL="$1"
elif [ -n "$REPO" ]; then
  REPO_URL="$REPO"
fi

# Clone the repository if a URL is available.
if [ -n "$REPO_URL" ]; then
  echo "Repository URL found: $REPO_URL"
  WORKSPACE_DIR="/home/$WEBRUN_USER/workspace"
  cd "$WORKSPACE_DIR"
  echo "Cloning repository into workspace..."
  if git clone --depth 1 "$REPO_URL"; then
    # Determine the repo directory name from the URL.
    REPO_DIR_NAME=$(basename "$REPO_URL" .git)
    echo "Successfully cloned into sub-directory: $REPO_DIR_NAME"
    # Change into the newly cloned repository directory.
    cd "$REPO_DIR_NAME"
  else
    echo "Error: Failed to clone repository." >&2
    exit 1
  fi
else
  echo "No repository URL provided. Using empty workspace."
  cd /home/$WEBRUN_USER/workspace
fi

echo "Working directory: $(pwd)"

# Configure git if credentials are provided.
if [ "$GITHUB_PAT" ]; then
   git config --global user.name "GEMINI"
   git config --global user.email "gemini@google.com"
   git config --global credential.helper "!f() {echo username=$GITHUB_USERNAME; echo password=$GITHUB_PAT; }; f"
fi

# --- EXECUTION FORK: ASYNC vs. INTERACTIVE ---

# If a PROMPT is provided, run in async mode.
if [ -n "$PROMPT" ]; then
  echo "PROMPT environment variable found. Running in async mode."
  # Sanitize the prompt for safety.
  sanitized_prompt=$(echo "$PROMPT" | sed 's/"/\\"/g')
  echo "Starting Gemini CLI with prompt..."
  gemini -p "$sanitized_prompt" --yolo
  echo "Gemini CLI finished."
  exit 0
fi

# Otherwise, run in interactive mode.
echo "No PROMPT variable. Running in interactive mode."

# Define internal ports for services.
export TTYD_PORT=7681
export CODER_PORT=3000
export PUBLIC_PORT=${PORT:-8080}

echo "Starting code-server on internal port $CODER_PORT..."
/opt/code-server/bin/code-server --auth=none --port $CODER_PORT /home/$WEBRUN_USER/workspace &

echo "Starting ttyd on internal port $TTYD_PORT..."
# The ttyd command starts a tmux session, runs gemini, and then falls back to a shell.
ttyd -p "$TTYD_PORT" -W tmux new-session -A -s gemini -- bash -c 'gemini; exec /bin/bash' &

echo "Starting Caddy on public port $PUBLIC_PORT..."
# Start Caddy in the foreground. This will be the main process that keeps the container alive.
caddy run --config /etc/caddy/Caddyfile