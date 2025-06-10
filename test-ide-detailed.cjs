#!/usr/bin/env node

// Set VS Code environment variables
process.env.GEMINI_VSCODE_EXTENSION = '1';
process.env.GEMINI_VSCODE_EXTENSION_PATH = '/Users/keithballinger/Desktop/projects/gemini-cli/vscode-extension';
process.env.VSCODE_WORKSPACE_FOLDER = '/Users/keithballinger/Desktop/projects/gemini-cli';

console.log('Testing VS Code MCP server connection...\n');

// Import the necessary modules
const { spawn } = require('child_process');
const path = require('path');

// Test 1: Check if server script exists
const serverScript = path.join(process.env.GEMINI_VSCODE_EXTENSION_PATH, 'dist/mcp/server-entry.js');
const fs = require('fs');

console.log('1. Checking server script:', serverScript);
if (fs.existsSync(serverScript)) {
  console.log('   ✓ Server script exists');
} else {
  console.log('   ✗ Server script NOT found');
  process.exit(1);
}

// Test 2: Try to start the server manually
console.log('\n2. Starting MCP server manually...');
const server = spawn('node', [serverScript], {
  stdio: ['pipe', 'pipe', 'pipe']
});

server.stderr.on('data', (data) => {
  console.log('   Server stderr:', data.toString().trim());
});

server.stdout.on('data', (data) => {
  console.log('   Server stdout:', data.toString().trim());
});

server.on('error', (err) => {
  console.log('   Server error:', err);
});

// Test 3: Send a test request
setTimeout(() => {
  console.log('\n3. Sending tools/list request...');
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  }) + '\n';
  
  server.stdin.write(request);
}, 1000);

// Test 4: Send initialize request first
setTimeout(() => {
  console.log('\n4. Sending initialize request...');
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '1.0',
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      },
      capabilities: {}
    }
  }) + '\n';
  
  server.stdin.write(request);
}, 500);

// Cleanup after 5 seconds
setTimeout(() => {
  console.log('\n5. Cleaning up...');
  server.kill();
  process.exit(0);
}, 5000);