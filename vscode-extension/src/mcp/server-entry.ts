#!/usr/bin/env node
/**
 * MCP Server entry point - delegates to standalone server with IPC
 */

// Use the standalone server that communicates with VS Code via IPC
import './standalone-server-bundled.js';