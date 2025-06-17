FROM gemini-cli-sandbox:latest

USER root

# Install ttyd, Caddy, and other utilities
RUN apt-get update && apt-get install -y curl procps tmux docker.io && \
    npm install -g https://github.com/GoogleCloudPlatform/cloud-run-mcp && \
    curl -L https://github.com/tsl0922/ttyd/releases/download/1.7.4/ttyd.x86_64 -o /usr/local/bin/ttyd && \
    curl -L "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy && \
    curl -L https://github.com/coder/code-server/releases/download/v4.100.3/code-server-4.100.3-linux-amd64.tar.gz -o /tmp/code-server.tar.gz && \
    tar -xzf /tmp/code-server.tar.gz -C /opt && \
    mv /opt/code-server-4.100.3-linux-amd64 /opt/code-server && \
    rm /tmp/code-server.tar.gz && \
    chmod +x /usr/local/bin/ttyd /usr/local/bin/caddy && \
    rm -rf /var/lib/apt/lists/*

# Copy the entrypoint script and Caddyfile
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
COPY .docker/webrun/Caddyfile /etc/caddy/Caddyfile

# Make script executable
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh


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

