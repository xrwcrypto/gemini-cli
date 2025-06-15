FROM gemini-cli-sandbox:latest

USER root

# Install ttyd from GitHub releases and the cloud-run-mcp package
RUN apt-get update && apt-get install -y curl procps tmux && \
    npm install -g https://github.com/GoogleCloudPlatform/cloud-run-mcp && \
    curl -L https://github.com/tsl0922/ttyd/releases/download/1.7.4/ttyd.x86_64 -o /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd && \
    rm -rf /var/lib/apt/lists/*

COPY webrun-entrypoint.sh /usr/local/bin/webrun-entrypoint.sh
RUN chmod +x /usr/local/bin/webrun-entrypoint.sh

USER node

# Set the working directory
WORKDIR /home/node

COPY .gemini/settings.json.preinstall .gemini/settings.json

# Expose the port ttyd will run on. Cloud Run will provide the $PORT environment variable.
EXPOSE 8080

ENV GCP_STDIO=true
ENV GOOGLE_CLOUD_LOCATION=global
ENV GOOGLE_GENAI_USE_VERTEXAI=true

# Start ttyd and launch the gemini CLI.
# -p $PORT: ttyd will listen on the port specified by the environment variable.
# gemini: This is the command that will be executed in the terminal.
CMD ["ttyd", "-p", "8080", "-W", "tmux", "new-session", "-A", "-s", "gemini", "/bin/bash", "-c", "/usr/local/bin/webrun-entrypoint.sh; exec /bin/bash"]
