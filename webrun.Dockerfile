FROM gemini-cli-sandbox:latest

USER root

# Install ttyd, Caddy, and other utilities
RUN apt-get update && apt-get install -y curl procps tmux && \
    npm install -g https://github.com/GoogleCloudPlatform/cloud-run-mcp && \
    curl -L https://github.com/tsl0922/ttyd/releases/download/1.7.4/ttyd.x86_64 -o /usr/local/bin/ttyd && \
    curl -L "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy && \
    chmod +x /usr/local/bin/ttyd /usr/local/bin/caddy && \
    rm -rf /var/lib/apt/lists/*

# Copy the entrypoint script and Caddyfile
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
COPY .docker/webrun/Caddyfile /etc/caddy/Caddyfile

# Make script executable
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

USER node

# Set the working directory
WORKDIR /home/node

# preinstall extensions
COPY .docker/webrun/extensions/ /opt/extensions/

# Expose the port Caddy will run on.
EXPOSE 8080

ENV GOOGLE_CLOUD_LOCATION=global
ENV GOOGLE_GENAI_USE_VERTEXAI=true

# Start the wrapper script which launches ttyd and Caddy.
ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]

