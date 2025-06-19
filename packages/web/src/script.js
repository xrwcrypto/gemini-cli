/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


const CLIENT_ID = '1023788818871-58e670siqp41sm92idla4k3octbhp4tj.apps.googleusercontent.com';
const useDevContainer = new URLSearchParams(window.location.search).has('dev');
const IMAGE = useDevContainer
  ? 'us-west1-docker.pkg.dev/gemini-run/containers/gemini-cli-webrun:dev'
  : 'us-west1-docker.pkg.dev/gemini-run/containers/gemini-cli-webrun:latest';

const REQUIRED_APIS = [
  'storage.googleapis.com',
  'run.googleapis.com',
  'aiplatform.googleapis.com',
];

const REDIRECT_URI = window.location.hostname === 'localhost' ?
  `${window.location.protocol}//${window.location.host}` :
  window.location.href.split('#')[0];

const region = 'europe-west1';

// Parse query string to see if page request is coming from OAuth 2.0 server.
var fragmentString = location.hash.substring(1);
var params = {};
var regex = /([^&=]+)=([^&]*)/g, m;
while (m = regex.exec(fragmentString)) {
  params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
}
if (Object.keys(params).length > 0 && params['state']) {
  if (params['state'] == localStorage.getItem('state')) {
    
    localStorage.setItem('oauth2-params', JSON.stringify(params) );

    localStorage.setItem('token', params['access_token']);
    // store token expiration time
    const expiresIn = parseInt(params['expires_in'], 10);
    const expirationTime = Date.now() + expiresIn * 1000;
    localStorage.setItem('token_expiration', expirationTime);


    console.log('Credential received and stored');
  } else {
    console.log('State mismatch. Possible CSRF attack');
  }
}

// Function to generate a random state value
function generateCryptoRandomState() {
  const randomValues = new Uint32Array(2);
  window.crypto.getRandomValues(randomValues);

  // Encode as UTF-8
  const utf8Encoder = new TextEncoder();
  const utf8Array = utf8Encoder.encode(
    String.fromCharCode.apply(null, randomValues)
  );

  // Base64 encode the UTF-8 data
  return btoa(String.fromCharCode.apply(null, utf8Array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateAgentName() {
  const consonants = 'bcdfghjklmnpqrstvwxyz';
  const vowels = 'aeiou';
  const randomConsonant = () => consonants[Math.floor(Math.random() * consonants.length)];
  const randomVowel = () => vowels[Math.floor(Math.random() * vowels.length)];
  return `gemini-cli-${randomConsonant()}${randomVowel()}${randomConsonant()}${randomVowel()}${randomConsonant()}${randomVowel()}`;
}


function getCloudRunJobPayload(project, bucket, pat, repo, githubUser, prompt, agentName) {
  const env = [
    {
      name: 'GOOGLE_CLOUD_PROJECT',
      value: project
    },
    {
      name: 'GOOGLE_CLOUD_LOCATION',
      value: 'global'
    },
    {
      name: 'GOOGLE_GENAI_USE_VERTEXAI',
      value: 'true'
    },
    {
      name: 'WEBRUN_AGENT',
      value: agentName
    }
  ];
  if (repo) {
    env.push({
      name: 'REPO',
      value: repo
    });
  }
  if (pat) {
    env.push({
      name: 'GITHUB_PAT',
      value: pat
    });
  }
  if (githubUser) {
    env.push({
      name: 'GITHUB_USERNAME',
      value: githubUser
    });
  }
  const annotations = {};
  if (repo) {
    annotations['repo'] = repo;
  }

  const container = {
    image: IMAGE,
    command: ["/usr/local/bin/entrypoint-wrapper.sh"],
    resources: {
      limits: {
        "cpu": "8",
        "memory": "32Gi"
      },
    },
    env: env,
    volumeMounts: [
      {
        name: 'gemini-home',
        mountPath: '/home/node/.gemini'
      },
      {
        name: 'agent-workspace',
        mountPath: '/home/node/.workspace'
      },
      {
        name: 'agent-gemini-in-workspace',
        mountPath: '/home/node/workspace/.gemini'
      }
    ]
  };

  if (prompt) {
    env.push({
      name: 'PROMPT',
      value: prompt
    });
  }

  return {
    labels: {
      'managed-by': 'gemini-dev',
    },
    annotations: annotations,
    template: {
      template: {
        volumes: [
          {
            name: 'gemini-home',
            gcs: {
              bucket: bucket,
              mountOptions: [
                'only-dir=.gemini'
              ]
            }
          },
          {
            name: 'agent-workspace',
            gcs: {
              bucket: bucket,
              mountOptions: ['only-dir=agents/${agentName}/workspace']
            }
          },
          {
            name: 'agent-gemini-in-workspace',
            gcs: {
              bucket: bucket,
              mountOptions: ['only-dir=agents/${agentName}/.gemini']
            }
          }
        ],
        containers: [container],
        maxRetries: 0,
      },
    },
  };
}

function getCloudRunServicePayload(project, bucket, pat, repo, githubUser, agentName) {
  const env = [
    {
      name: 'GOOGLE_CLOUD_PROJECT',
      value: project
    },
    {
      name: 'GOOGLE_CLOUD_LOCATION',
      value: 'global'
    },
    {
      name: 'GOOGLE_GENAI_USE_VERTEXAI',
      value: 'true'
    },
    {
      name: 'WEBRUN_AGENT',
      value: agentName
    }
  ];
  if (repo) {
    env.push({
      name: 'REPO',
      value: repo
    });
  }
  if (pat) {
    env.push({
      name: 'GITHUB_PAT',
      value: pat
    });
  }
  if (githubUser) {
    env.push({
      name: 'GITHUB_USERNAME',
      value: githubUser
    });
  }
  const annotations = {};
  if (repo) {
    annotations['repo'] = repo;
  }
  return {
    labels: {
      'managed-by': 'gemini-dev',
    },
    annotations: annotations,
    launchStage: 'ALPHA', // we need ALPHA to use scaling.maxInstanceCount
    scaling: {
      minInstanceCount: 0, // allows scaling to zero
      maxInstanceCount: 1, // limit to max 1 agent
    },
    invokerIamDisabled: true, // make public
    template: {
      volumes: [
        {
          name: 'gemini-home',
          gcs: {
            bucket: bucket,
            mountOptions: [
              'only-dir=.gemini'
            ]
          }
        },
        {
          name: 'agent-workspace',
          gcs: {
            bucket: bucket,
            mountOptions: ['only-dir=agents/${agentName}/workspace']
          }
        },
        {
          name: 'agent-gemini-in-workspace',
          gcs: {
            bucket: bucket,
            mountOptions: ['only-dir=agents/${agentName}/.gemini']
          }
        }
      ],
      containers: [
        {
          image: IMAGE,
          resources: {
            limits: {
              "cpu": "8",
              "memory": "32Gi"
            },
          },
          env: env,
          volumeMounts: [
            {
              name: 'gemini-home',
              mountPath: '/home/node/.gemini'
            },
            {
              name: 'agent-workspace',
              mountPath: '/home/node/.workspace'
            },
            {
              name: 'agent-gemini-in-workspace',
              mountPath: '/home/node/workspace/.gemini'
            }
          ]
        }
      ],
      executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
      healthCheckDisabled: true, // no need for startup health check, we know the container starts
      timeout: '60s',
    },
  };
}


async function enableRequiredApis(token, project) {
  console.log('Enabling required APIs...');
  const response = await fetch(`https://serviceusage.googleapis.com/v1/projects/${project}/services:batchEnable`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      serviceIds: REQUIRED_APIS
    })
  });
  
  const result = await response.json();
  if (result.error) {
    throw new Error(`Failed to enable APIs: ${result.error.message}`);
  }
  return result;
}

function getTokenAndProject() {
  let token = localStorage.getItem('token');
  const expirationTime = localStorage.getItem('token_expiration');

  if (token && expirationTime && Date.now() > parseInt(expirationTime, 10)) {
    // Token is expired, clear it
    localStorage.removeItem('token');
    localStorage.removeItem('token_expiration');
    localStorage.removeItem('oauth2-params');
    token = null;
    console.log('Token expired and removed');
  }

  if (!token) {
    console.error('No access token. Get one by signing in.');
    return {};
  }

  let project = document.getElementById('project').value;
  if (!project) {
    console.error('No project ID');
    return {};
  }

  return {token, project};
}


export async function deploy(token, project, name, bucket, asyncMode, pat, repo, githubUser, prompt, validateOnly = false) {
  console.log(`Deploying to Cloud Run: ${project} ${region} ${name}, async=${asyncMode}, validate only? ${validateOnly}`);

  let url;
  let payload;
  if (asyncMode) {
    url = `https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/jobs?jobId=${name}`;
    payload = getCloudRunJobPayload(project, bucket, pat, repo, githubUser, prompt, name);
  } else {
    url = `https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/services?serviceId=${name}`;
    payload = getCloudRunServicePayload(project, bucket, pat, repo, githubUser, name);
  }
  
  if(validateOnly) {
    url += '&validateOnly=true';
  }
  var response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  var result = await response.json();
  console.log(result);

  return result;
}

async function waitOperation(token, project, operation) {
  console.log(`Waiting for operation: ${operation}`);

  
  const response = await fetch(`https://${region}-run.googleapis.com/v2/${operation}:wait`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      timeout: '600s',
    })
  });
  const result = await response.json();
  console.log(result);

  return result;
}

async function getService(token, project, service) {
  console.log(`Getting service: ${project} ${region} ${service}`);

  const response = await fetch(`https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}`, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  });
  const result = await response.json();
  console.log(result);

  return result;
}

export async function listServices(token, project) {
  console.log(`Listing services in: ${project} ${region}`);

  const response = await fetch(`https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/services`, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  });
  const result = await response.json();
  console.log(result);

  return result;
}

async function listJobs(token, project) {
  console.log(`Listing jobs in: ${project} ${region}`);

  const response = await fetch(`https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/jobs`, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  });
  const result = await response.json();
  console.log(result);

  return result;
}

export async function deleteService(token, project, service) {
  console.log(`Deleting service: ${project} ${region} ${service}`);

  const response = await fetch(`https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}`, {
    method: 'DELETE',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  });
  const result = await response.json();
  console.log(result);

  return result;
}

async function deleteJob(token, project, job) {
  console.log(`Deleting job: ${project} ${region} ${job}`);

  const response = await fetch(`https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}`, {
    method: 'DELETE',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  });
  const result = await response.json();
  console.log(result);

  return result;
}

async function runJob(token, project, job) {
  console.log(`Running job: ${project} ${region} ${job}`);

  const response = await fetch(`https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  const result = await response.json();
  console.log(result);

  return result;
}

















async function deleteAgent(agent) {
  let {token, project} = getTokenAndProject();
  if (!token || !project) {
    return;
  }
  let deleteResult;
  const agentName = agent.name.split('/').pop();
  const isJob = agent.template && agent.template.template;
  if (isJob) {
    deleteResult = await deleteJob(token, project, agentName);
  } else {
    deleteResult = await deleteService(token, project, agentName);
  }
  if (deleteResult.error) {
    alert(`Error: ${deleteResult.error.message}`);
    return;
  }
  const operation = deleteResult.name;
  await waitOperation(token, project, operation);
  showDefaultContent();
}

async function deleteAgentsAndRefresh() {
  if (!confirm('Are you sure you want to delete all agents?')) {
    return;
  }

  let {token, project} = getTokenAndProject();
  if (!token || !project) {
    return;
  }

  const agents = await listAgents(token, project);

  await Promise.all(agents.map(agent => deleteAgent(agent)));

  await refreshAgentsList();
}

function showDefaultContent() {
  const iframeContainer = document.getElementById('iframe-container');
  iframeContainer.innerHTML = '<div class="default-content">$</div>';
}

async function deployAndWait() {
  let {token, project} = getTokenAndProject();
  if (!token || !project) {
    return;
  }

  document.getElementById('button-deploy').hidden = true;
  document.getElementById('waiting-message').hidden = false;

  try {
    await enableRequiredApis(token, project);

    const bucket = await getOrCreateGcsBucket(token, project);
    if (!bucket) {
      return;
    }

    const service = generateAgentName();
    const agentFolder = `agents/${service}/`;
    const workspaceFolder = `${agentFolder}workspace/`;
    const geminiFolder = `${agentFolder}.gemini/`;

    if (!await ensureGcsFolderExists(token, bucket, agentFolder) ||
        !await ensureGcsFolderExists(token, bucket, workspaceFolder) ||
        !await ensureGcsFolderExists(token, bucket, geminiFolder)) {
      // Stop if any folder creation fails. The helper function already shows an alert.
      document.getElementById('button-deploy').hidden = false;
      document.getElementById('waiting-message').hidden = true;
      return;
    }

    const asyncMode = document.getElementById('async-mode').checked;
    const pat = document.getElementById('pat').value;
    const repo = document.getElementById('repo').value;
    const githubUser = document.getElementById('github-user').value;
    const prompt = document.getElementById('prompt').value;

    // Deploy
    const deployResult = await deploy(token, project, service, bucket, asyncMode, pat, repo, githubUser, prompt);
    if(deployResult.error) {
      alert(`Error: ${deployResult.error.message}`);
      return;
    }
    const operation = deployResult.name;
    console.log(`Deployment operation: ${operation}`);

    // Wait for deployment to finish
    await waitOperation(token, project, operation);
    
    if (asyncMode) {
      const runOperation = await runJob(token, project, service);
      await waitOperation(token, project, runOperation.name);
    } else {
      // Get service URL
      const serviceResult = await getService(token, project, service);
      if (serviceResult && serviceResult.uri) {
        let url = serviceResult.uri;
        const repo = document.getElementById('repo').value;
        if (repo) {
          url += `?repo=${repo}`;
        }
        console.log(`Service URL: ${url}`);
      }
    }
    
    await refreshAgentsList();
  } finally {
    document.getElementById('button-deploy').hidden = false;
    document.getElementById('waiting-message').hidden = true;
  }
}

async function gcsFolderExists(token, bucket, folderName) {
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(folderName)}`, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
    }
  });
  return response.ok;
}

async function createGcsFolder(token, bucket, folderName) {
  const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(folderName)}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Length': '0'
    },
    body: ''
  });
  return response.ok;
}

async function ensureGcsFolderExists(token, bucket, folderName) {
    const folderExists = await gcsFolderExists(token, bucket, folderName);
    if (!folderExists) {
        console.log(`Folder ${folderName} does not exist in bucket ${bucket}, creating...`);
        const folderCreated = await createGcsFolder(token, bucket, folderName);
        if (folderCreated) {
            console.log(`Folder ${folderName} created`);
            return true;
        } else {
            alert(`Error creating folder ${folderName} in bucket ${bucket}`);
            return false;
        }
    } else {
        console.log(`Folder ${folderName} already exists in bucket ${bucket}`);
        return true;
    }
}

async function getOrCreateGcsBucket(token, project) {
  const bucket = `${project}-${region}-gemini-run`;
  const bucketExists = await gcsBucketExists(token, bucket);
  if (!bucketExists) {
    console.log(`Bucket ${bucket} does not exist, creating...`);
    const created = await createGcsBucket(token, project, bucket, region);
    if (created) {
      console.log(`Bucket ${bucket} created`);
    } else {
      alert(`Error creating bucket ${bucket}`);
      return null;
    }
  } else {
    console.log(`Bucket ${bucket} already exists`);
  }

  if (!await ensureGcsFolderExists(token, bucket, '.gemini/')) return null;
  if (!await ensureGcsFolderExists(token, bucket, 'agents/')) return null;

  return bucket;
}

async function gcsBucketExists(token, bucket) {
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}`, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
    }
  });
  return response.ok;
}

async function createGcsBucket(token, project, bucket, location) {
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b?project=${project}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: bucket,
      location: location,
      hierarchicalNamespace: {
        enabled: true,
      },
      iamConfiguration: {
        uniformBucketLevelAccess: {
          enabled: true,
        },
      },
    })
  });
  return response.ok;
}

document.getElementById('button-deploy').addEventListener('click', async (e) => {
  e.preventDefault();
  const { token } = getTokenAndProject();
  if (token) {
    await deployAndWait();
    await getUserInfo();
  } else {
    oauth2SignIn();
  }
});

function oauth2SignIn() {
  // create random state value and store in local storage
  var state = generateCryptoRandomState();
  localStorage.setItem('state', state);

  // Google's OAuth 2.0 endpoint for requesting an access token
  var oauth2Endpoint = 'https://accounts.google.com/o/oauth2/v2/auth';

  // Create element to open OAuth 2.0 endpoint in new window.
  var form = document.createElement('form');
  form.setAttribute('method', 'GET'); // Send as a GET request.
  form.setAttribute('action', oauth2Endpoint);

  // Parameters to pass to OAuth 2.0 endpoint.
  var params = {'client_id': CLIENT_ID,
                'redirect_uri': REDIRECT_URI,
                'scope': 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
                'state': state,
                'include_granted_scopes': 'true',
                'response_type': 'token'};

  // Add form parameters as hidden input values.
  for (var p in params) {
    var input = document.createElement('input');
    input.setAttribute('type', 'hidden');
    input.setAttribute('name', p);
    input.setAttribute('value', params[p]);
    form.appendChild(input);
  }

  // Add form to page and submit it to open the OAuth 2.0 endpoint.
  document.body.appendChild(form);
  form.submit();
  getUserInfo();
}

document.getElementById('project').addEventListener('input', (e) => {
  localStorage.setItem('project', e.target.value);
});

document.getElementById('github-user').addEventListener('input', (e) => {
  localStorage.setItem('github-user', e.target.value);
});

document.getElementById('pat').addEventListener('input', (e) => {
  localStorage.setItem('pat', e.target.value);
});

if (document.referrer) {
  const referrer = new URL(document.referrer);
  if (referrer.hostname === 'github.com') {
    document.getElementById('repo').value = referrer.href;
  }
}

const storedProject = localStorage.getItem('project');
if (storedProject) {
  document.getElementById('project').value = storedProject;
  if (localStorage.getItem('token')) {
    refreshAgentsList();
  }
}

const storedGithubUser = localStorage.getItem('github-user');
if (storedGithubUser) {
  document.getElementById('github-user').value = storedGithubUser;
}

const storedPat = localStorage.getItem('pat');
if (storedPat) {
  document.getElementById('pat').value = storedPat;
}

document.getElementById('toggle-button').addEventListener('click', () => {
  const leftColumn = document.getElementById('left-column');
  const toggleButton = document.getElementById('toggle-button');
  leftColumn.classList.toggle('hidden');
  toggleButton.classList.toggle('hidden');
  if (leftColumn.classList.contains('hidden')) {
    toggleButton.innerHTML = '<span>&gt;</span>';
  } else {
    toggleButton.innerHTML = '<span>&lt;</span>';
  }
});

async function refreshAgentsList() {
  let {token, project} = getTokenAndProject();
  if (!token || !project) {
    return;
  }
  const agents = await listAgents(token, project);

  const agentsList = document.getElementById('agents-list');
  const agentsContainer = document.getElementById('agents-container');
  const deleteAllButton = document.getElementById('delete-all-button');
  agentsList.innerHTML = '';

  if (agents.length > 0) {
    deleteAllButton.hidden = false;
    agentsList.hidden = false;
    for (const agent of agents) {
      const agentName = agent.name.split('/').pop();
      const isJob = agent.template && agent.template.template;
      let agentUrl = isJob ? '' : agent.uri;
      if (agent.annotations && agent.annotations.repo) {
        if (agentUrl) {
          agentUrl += `?repo=${agent.annotations.repo}`;
        }
      }

      const card = document.createElement('div');
      card.classList.add('service-card');
      card.dataset.url = agentUrl;

      const nameElement = document.createElement('h3');
      nameElement.textContent = agentName;
      card.appendChild(nameElement);

      const detailsElement = document.createElement('p');
      const repo = agent.annotations && agent.annotations.repo;
      const createTime = new Date(agent.createTime).toLocaleString();
      if (isJob) {
        detailsElement.innerHTML = `
          <b>Type:</b> Async<br>
          ${createTime}<br>
          ${repo ? `<b>Repo:</b> ${repo}` : '(no repo)'}
        `;
      } else {
        detailsElement.innerHTML = `
          ${createTime}<br>
          ${repo ? `<b>Repo:</b> ${repo}` : '(no repo)'}
        `;
      }
      card.appendChild(detailsElement);

      const buttonContainer = document.createElement('div');
      buttonContainer.classList.add('card-buttons');

      if (!isJob) {
        const openInTabButton = document.createElement('button');
        openInTabButton.textContent = 'Open in tab';
        openInTabButton.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(agentUrl, '_blank');
        });
        buttonContainer.appendChild(openInTabButton);
      }

      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', async (e) => {
        e.stopPropagation(); // prevent card click event
        if (confirm(`Are you sure you want to delete "${agentName}"?`)) {
          await deleteAgent(agent);
          await refreshAgentsList();
        }
      });
      buttonContainer.appendChild(deleteButton);

      card.appendChild(buttonContainer);

      card.addEventListener('click', () => {
        if (isJob) {
          return;
        }
        // Handle card selection
        const allCards = document.querySelectorAll('.service-card');
        allCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        // Handle iframe
        const iframeContainer = document.getElementById('iframe-container');
        iframeContainer.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.src = card.dataset.url;
        iframeContainer.appendChild(iframe);
      });

      agentsList.appendChild(card);
    }
  } else {
    agentsList.hidden = true;
  }
}

document.getElementById('delete-all-button').addEventListener('click', deleteAgentsAndRefresh);

async function listAgents(token, project) {
  const servicesResult = await listServices(token, project);
  const services = (servicesResult.services || []).filter(service => service.labels && service.labels['managed-by'] === 'gemini-dev');
  
  const jobsResult = await listJobs(token, project);
  const jobs = (jobsResult.jobs || []).filter(job => job.labels && job.labels['managed-by'] === 'gemini-dev');

  const agents = [...services, ...jobs];
  agents.sort((a, b) => new Date(b.createTime) - new Date(a.createTime));
  return agents;
}


document.getElementById('project').addEventListener('change', refreshAgentsList);

document.getElementById('async-mode').addEventListener('change', (e) => {
  document.getElementById('prompt-container').hidden = !e.target.checked;
});

getUserInfo();

async function getUserInfo() {
  const token = localStorage.getItem('token');
  if (!token) {
    showUnauthenticatedState();
    return;
  }

  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (response.ok) {
    const userInfo = await response.json();
    const userInfoContainer = document.getElementById('user-info');
    const userMenu = document.getElementById('user-menu');
    const userMenuInfo = document.getElementById('user-menu-info');

    userInfoContainer.innerHTML = `<img src="${userInfo.picture}" alt="User avatar" referrerpolicy="no-referrer">`;
    userMenuInfo.innerHTML = `<strong>${userInfo.name}</strong><br>${userInfo.email}`;
    
    userInfoContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenu.hidden = !userMenu.hidden;
    });

    showAuthenticatedState();
  } else if (response.status === 401) {
    showUnauthenticatedState();
  }
}

function showAuthenticatedState() {
  document.getElementById('signin-button').hidden = true;
  document.getElementById('signout-button').hidden = true;
  document.getElementById('agents-container').classList.remove('disabled');
  document.getElementById('button-deploy').classList.remove('disabled');
}

function showUnauthenticatedState() {
  document.getElementById('signin-button').hidden = false;
  document.getElementById('signout-button').hidden = true;
  document.getElementById('agents-container').classList.add('disabled');
  document.getElementById('button-deploy').classList.add('disabled');
  document.getElementById('user-info').innerHTML = '';
  document.getElementById('user-menu').hidden = true;
}

function signOut() {
  const token = localStorage.getItem('token');
  if (token) {
    // Revoke the token to sign the user out.
    fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: 'POST',
      headers: {
        'Content-type': 'application/x-www-form-urlencoded'
      }
    }).finally(() => {
      // Always clear local storage, even if revocation fails.
      localStorage.removeItem('token');
      localStorage.removeItem('token_expiration');
      localStorage.removeItem('oauth2-params');
      showUnauthenticatedState();
      console.log('User signed out.');
    });
  }
}

document.getElementById('signin-button').addEventListener('click', oauth2SignIn);
document.getElementById('signout-button').addEventListener('click', signOut);
document.getElementById('user-menu-signout').addEventListener('click', signOut);

window.addEventListener('click', (e) => {
  const userMenu = document.getElementById('user-menu');
  const userInfo = document.getElementById('user-info');
  if (!userMenu.hidden && !userInfo.contains(e.target) && !userMenu.contains(e.target)) {
    userMenu.hidden = true;
  }
});
