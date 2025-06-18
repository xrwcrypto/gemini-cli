FROM gemini-cli-sandbox:latest

USER root

ARG USERNAME=node
ENV WEBRUN_USER=$USERNAME

# Install ttyd, Caddy, and other utilities
RUN apt-get update && apt-get install -y curl procps tmux docker.io apt-transport-https ca-certificates gnupg lsyncd && \
    npm install -g https://github.com/GoogleCloudPlatform/cloud-run-mcp && \
    curl -L https://github.com/tsl0922/ttyd/releases/download/1.7.4/ttyd.x86_64 -o /usr/local/bin/ttyd && \
    curl -L "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy && \
    curl -L https://github.com/coder/code-server/releases/download/v4.100.3/code-server-4.100.3-linux-amd64.tar.gz -o /tmp/code-server.tar.gz && \
    tar -xzf /tmp/code-server.tar.gz -C /opt && \
    mv /opt/code-server-4.100.3-linux-amd64 /opt/code-server && \
    rm /tmp/code-server.tar.gz && \
    chmod +x /usr/local/bin/ttyd /usr/local/bin/caddy && \
    usermod -aG docker $USERNAME && \
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - && \
    apt-get update && apt-get install -y google-cloud-sdk && \
    rm -rf /var/lib/apt/lists/*

# Copy the entrypoint script and Caddyfile
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
COPY .docker/webrun/Caddyfile /etc/caddy/Caddyfile
COPY .docker/webrun/code-server/settings.json /opt/code-server/settings.json
COPY .docker/webrun/lsyncd.conf.lua /etc/lsyncd/lsyncd.conf.lua

# Make script executable
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh && chmod 644 /etc/caddy/Caddyfile


# Set the working directory
WORKDIR /home/$USERNAME

# preinstall extensions
COPY .docker/webrun/extensions/ /opt/extensions/


# Expose the port Caddy will run on.
EXPOSE 8080

ENV GOOGLE_CLOUD_LOCATION=global
ENV GOOGLE_GENAI_USE_VERTEXAI=true
ENV WEBRUN_REGION=europe-west1

# Start the wrapper script which launches ttyd and Caddy.
ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]

