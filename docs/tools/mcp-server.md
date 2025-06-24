# MCP servers with the Gemini CLI

This document explains how to configure and use Model Context Protocol (MCP) servers with the Gemini CLI.

## What is an MCP server?

An MCP server is an application that exposes tools and resources to the Gemini CLI, allowing it to interact with external systems and data sources. MCP servers act as a bridge between the Gemini model and your local environment or other services.

An MCP server lets the Gemini CLI:

- **Discover tools:** List available tools, their descriptions, and parameters.
- **Execute tools:** Call specific tools with defined arguments.
- **Access resources:** Read data from specific resources.

With an MCP server, you can extend the Gemini CLI's capabilities to perform actions beyond its built-in features, such as interacting with databases, APIs, or custom scripts.

You can learn more about MCP servers by reading the [Gemini CLI configuration documentation](../cli/configuration.md).

## How to set up your MCP server

The Gemini CLI uses the `mcpServers` configuration defined in your `settings.json` file to locate your MCP servers. Learn how to set up an MCP server here: [Setting up a Model Context Protocol (MCP) server](../cli/tutorials.md#setting-up-a-model-context-protocol-mcp-server).

## How to interact with your MCP server

The `/mcp` command lists configured MCP servers, their connection status, server details, and available tools. Learn how to use the MCP command in this document: [CLI commands](../cli/commands.md).

## Important notes

- **Security:** Be security-aware when using third-party MCP servers and when managing your access tokens. Using a broadly scoped personal access token that has access to personal and private repositories can lead to information from the private repository being leaked into the public repository.
