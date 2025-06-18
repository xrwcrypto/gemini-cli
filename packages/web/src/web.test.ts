import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fetch function
const fetchMock = vi.fn();
global.fetch = fetchMock;

// Mock the DOM elements
document.body.innerHTML = `
  <input id="project" value="test-project" />
  <input id="pat" value="test-pat" />
  <input id="repo" value="test-repo" />
  <input id="github-user" value="test-user" />
  <input id="prompt" value="test-prompt" />
  <input id="async-mode" type="checkbox" />
  <button id="button-deploy"></button>
  <div id="waiting-message"></div>
  <button id="signin-button"></button>
  <button id="signout-button"></button>
  <button id="user-menu-signout"></button>
  <div id="toggle-button"></div>
  <button id="delete-all-button"></button>
  <div id="prompt-container"></div>
  <div id="iframe-container"></div>
  <div id="agents-list"></div>
  <div id="agents-container"></div>
  <div id="user-info"></div>
  <div id="user-menu"></div>
  <div id="user-menu-info"></div>
`;

// Dynamically import the script to be tested after setting up the mock
const { deploy, listServices, deleteService } = await import('./script.js');

describe('Web App API interactions', () => {

  beforeEach(() => {
    fetchMock.mockClear();
    localStorage.clear();
    localStorage.setItem('token', 'test-token');
  });

  describe('deploy', () => {
    it('should call the Cloud Run API to deploy a service in sync mode', async () => {
      document.getElementById('async-mode').checked = false;
      fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: 'operations/123' }) });

      await deploy('test-token', 'test-project', 'test-service', 'test-bucket', false, 'test-pat', 'test-repo', 'test-user', '');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://europe-west1-run.googleapis.com/v2/projects/test-project/locations/europe-west1/services?serviceId=test-service',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          },
          body: expect.stringContaining('"image":"us-west1-docker.pkg.dev/gemini-run/containers/gemini-cli-webrun:latest"')
        })
      );
    });

    it('should call the Cloud Run API to deploy a job in async mode', async () => {
      document.getElementById('async-mode').checked = true;
      fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: 'operations/123' }) });

      await deploy('test-token', 'test-project', 'test-job', 'test-bucket', true, 'test-pat', 'test-repo', 'test-user', 'test-prompt');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://europe-west1-run.googleapis.com/v2/projects/test-project/locations/europe-west1/jobs?jobId=test-job',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"args":["-p","\\"test-prompt\\"","--yolo"]')
        })
      );
    });

    it('should handle errors from the API', async () => {
        fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: { message: 'API Error' } }) });
        const result = await deploy('test-token', 'test-project', 'test-service', 'test-bucket', false, 'test-pat', 'test-repo', 'test-user', '');
        expect(result.error.message).toBe('API Error');
    });
  });

  describe('listServices', () => {
    it('should call the Cloud Run API to list services', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ services: [] }) });
      await listServices('test-token', 'test-project');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://europe-west1-run.googleapis.com/v2/projects/test-project/locations/europe-west1/services',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });
  });

  describe('deleteService', () => {
    it('should call the Cloud Run API to delete a service', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: 'operations/456' }) });
        await deleteService('test-token', 'test-project', 'test-service');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://europe-west1-run.googleapis.com/v2/projects/test-project/locations/europe-west1/services/test-service',
            expect.objectContaining({
                method: 'DELETE'
            })
        );
    });
  });
});
