# Web-Based Gemini CLI Agent Runner

This document provides a high-level overview of the web-based agent runner for Gemini CLI. This feature allows you to deploy and manage Gemini CLI agents in your own Google Cloud project using a simple web interface.

## Architecture

The web-based agent runner consists of two main components:

*   **Web Frontend:** A static web application that provides a user interface for managing agents. It is a client-side application that runs entirely in your browser.
*   **WebRun Container:** A Docker container that runs the Gemini CLI agent. This container is deployed to Cloud Run in your Google Cloud project.

## User Journey

The process of deploying and managing an agent is as follows:

1.  **Authentication:** You start by opening the web interface and signing in with your Google account. This is required to authorize the application to manage resources in your Google Cloud project.

2.  **Configuration:** You need to provide your Google Cloud project ID. Optionally, you can also provide your GitHub username and a Personal Access Token (PAT) if you want to use a private GitHub repository as the agent's workspace.

3.  **Deployment:** You can deploy a new agent by clicking the "New agent" button. You have two deployment modes to choose from:
    *   **Sync Mode:** This deploys the agent as a Cloud Run service. The agent will be continuously running and can be interacted with through a web-based terminal. This is useful for long-running tasks or interactive sessions.
    *   **Async Mode:** This deploys the agent as a Cloud Run job. The agent will run once to execute a specific prompt and then terminate. This is suitable for one-off tasks.

4.  **State Management:** When you deploy your first agent, a Google Cloud Storage (GCS) bucket is automatically created in your project. This bucket is used to persist the state of your agents, including the `.gemini` directory and the agent's workspace. This ensures that your agent's history and configuration are preserved across deployments.

5.  **Interaction:** You can view a list of your deployed agents in the web interface. For agents running in sync mode, you can open a web-based terminal to interact with the Gemini CLI directly. You can also open the agent's URL in a new tab.

6.  **Deletion:** You can delete individual agents or all agents at once. This will remove the corresponding Cloud Run service or job.

## WebRun Container

The WebRun container is a pre-configured environment for running Gemini CLI agents. It includes:

*   **Gemini CLI:** The latest version of the Gemini CLI.
*   **ttyd:** A tool that provides a web-based terminal.
*   **Caddy:** A web server that acts as a reverse proxy.
*   **code-server:** A version of VS Code that runs in the browser.
*   **Google Cloud SDK:** For interacting with Google Cloud services.

The container is configured to mount the GCS bucket for state persistence, allowing your agents to maintain their context and history.
