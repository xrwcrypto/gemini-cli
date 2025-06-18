import { execSync } from 'child_process';
import assert from 'node:assert';
import fetch from 'node-fetch';
import { describe, it, before, after } from 'node:test';

describe('WebRun Container', { timeout: 300000 }, () => {
  const imageName = 'us-west1-docker.pkg.dev/gemini-run/containers/gemini-cli-webrun:dev';
  let containerId;

  before(() => {
    // Build the container
    console.log('Building WebRun container...');
    execSync('GEMINI_SANDBOX=true npm run build:all', { stdio: 'inherit' });
  });

  after(() => {
    if (containerId) {
      console.log(`Stopping and removing container ${containerId}...`);
      execSync(`docker stop ${containerId}`);
      execSync(`docker rm ${containerId}`);
    }
  });

  it('should start successfully and serve content', async () => {
    // Run the container in detached mode
    containerId = execSync(`docker run -d -p 38080:8080 ${imageName}`).toString().trim();
    console.log(`Started container with ID: ${containerId}`);

    const startTime = Date.now();
    const timeout = 60000; // 60 seconds
    let lastError = null;

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch('http://localhost:38080/');
        if (response.status === 200) {
          const body = await response.text();
          assert.ok(body.includes('<!DOCTYPE html>'));
          return; // Success
        }
      } catch (error) {
        lastError = error;
        // Ignore and retry
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    }

    // If the loop finishes without returning, it timed out
    throw new Error(`Container did not start within ${timeout / 1000} seconds. Last error: ${lastError}`);
  });

  it('should have key processes running', () => {
    const processes = execSync(`docker exec -u root ${containerId} ps aux`).toString();
    assert.ok(processes.includes('caddy'));
    assert.ok(processes.includes('ttyd'));
    assert.ok(processes.includes('code-server'));
  });

  it('should run a prompt in async mode and return the correct output', () => {
    const prompt = "What is 2+2?";
    // Ensure the API key is available in the environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set.');
    }

    const command = `docker run --rm --privileged -e GEMINI_API_KEY=${apiKey} --entrypoint gemini ${imageName} -p "${prompt}" --yolo`;
    
    console.log('Running async container test...');
    const output = execSync(command, { encoding: 'utf-8' });

    console.log('Container output:');
    console.log(output);

    // The model's output might have slight variations, so we look for the number 4.
    // A more robust check might involve parsing the output more carefully.
    assert.ok(output.includes('4'), 'The output should contain the number 4');
  });
});
