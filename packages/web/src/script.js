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
const IMAGE = 'us-west1-docker.pkg.dev/gemini-run/containers/gemini-cli-webrun:latest';

const REQUIRED_APIS = [
  'storage.googleapis.com',
  'run.googleapis.com',
];

const REDIRECT_URI = window.location.href.split('#')[0];

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

function generateServiceName() {
  const consonants = 'bcdfghjklmnpqrstvwxyz';
  const vowels = 'aeiou';
  const randomConsonant = () => consonants[Math.floor(Math.random() * consonants.length)];
  const randomVowel = () => vowels[Math.floor(Math.random() * vowels.length)];
  return `gemini-cli-${randomConsonant()}${randomVowel()}${randomConsonant()}`;
}


function getCloudRunServicePayload(project, bucket) {
  const pat = document.getElementById('pat').value;
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
    }
  ];
  if (pat) {
    env.push({
      name: 'GITHUB_PAT',
      value: pat
    });
  }
  return {
    labels: {
      'managed-by': 'gemini-dev',
    },
    launchStage: 'ALPHA', // we need ALPHA to use scaling.maxInstanceCount
    scaling: {
      minInstanceCount: 0, // allows scaling to zero
      maxInstanceCount: 1, // limit to max 1 instance
    },
    invokerIamDisabled: true, // make public
    template: {
      volumes: [
        {
          name: 'gemini-home',
          gcs: {
            bucket: bucket,
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
  localStorage.setItem('project', project);

  return {token, project};
}


async function deploy(token, project, service, bucket, validateOnly = false) {
  console.log(`Deploying to Cloud Run: ${project} ${region} ${service}, validate only? ${validateOnly}`);

  let url = `https://${region}-run.googleapis.com/v2/projects/${project}/locations/${region}/services?serviceId=${service}`
  if(validateOnly) {
    url += '&validateOnly=true';
  }
  var response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(getCloudRunServicePayload(project, bucket))
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

async function listServices(token, project) {
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

async function deleteService(token, project, service) {
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

async function deleteServiceAndRefresh(service) {
  let {token, project} = getTokenAndProject();
  if (!token || !project) {
    return;
  }
  const deleteResult = await deleteService(token, project, service);
  if (deleteResult.error) {
    alert(`Error: ${deleteResult.error.message}`);
    return;
  }
  const operation = deleteResult.name;
  await waitOperation(token, project, operation);
  await refreshServicesList();
}



async function deployAndWait() {
  let {token, project} = getTokenAndProject();
  if (!token || !project) {
    return;
  }

  await enableRequiredApis(token, project);

  const bucket = await getOrCreateGcsBucket(token, project);
  if (!bucket) {
    return;
  }

  const service = generateServiceName();

  document.getElementById('waiting-message').hidden = false;
  // Deploy
  const deployResult = await deploy(token, project, service, bucket);
  if(deployResult.error) {
    alert(`Error: ${deployResult.error.message}`);
    return;
  }
  const operation = deployResult.name;
  console.log(`Deployment operation: ${operation}`);
  
  // Get service URL
  const serviceResult = await getService(token, project, service);
  let url = serviceResult.urls[0];
  const repo = document.getElementById('repo').value;
  if (repo) {
    url += `?repo=${encodeURIComponent(repo)}`;
  }
  console.log(`Service URL: ${url}`);
  document.getElementById('service-url').href = url;

  // Wait for deployment to finish
  await waitOperation(token, project, operation);
  document.getElementById('waiting-message').hidden = true;
  document.getElementById('deployed-message').hidden = false;
  window.open(url, '_blank');
  
  await refreshServicesList();
}

async function getOrCreateGcsBucket(token, project) {
  const bucket = `${project}-${region}-gemini-run`;
  const exists = await gcsBucketExists(token, bucket);
  if (exists) {
    console.log(`Bucket ${bucket} already exists`);
    return bucket;
  }
  console.log(`Bucket ${bucket} does not exist, creating...`);
  const created = await createGcsBucket(token, project, bucket, region);
  if (created) {
    console.log(`Bucket ${bucket} created`);
    return bucket;
  }
  alert(`Error creating bucket ${bucket}`);
  return null;
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
    })
  });
  return response.ok;
}

document.getElementById('button-deploy').addEventListener('click', async (e) => {
  e.preventDefault();
  const { token } = getTokenAndProject();
  if (token) {
    await deployAndWait();
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
                'scope': 'https://www.googleapis.com/auth/cloud-platform',
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
}

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
    refreshServicesList();
  }
}

async function refreshServicesList() {
  let {token, project} = getTokenAndProject();
  if (!token || !project) {
    return;
  }
  const servicesResult = await listServices(token, project);
  const services = (servicesResult.services || []).filter(service => service.labels && service.labels['managed-by'] === 'gemini-dev');
  const servicesList = document.getElementById('services-list');
  servicesList.innerHTML = '';
  if (services.length > 0) {
    document.getElementById('existing-services').hidden = false;
    for (const service of services) {
      const serviceName = service.name.split('/').pop();
      const serviceUrl = service.uri;
      const listItem = document.createElement('li');
      
      const link = document.createElement('a');
      link.href = serviceUrl;
      link.textContent = serviceName;
      link.target = '_blank';
      listItem.appendChild(link);

      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete "${serviceName}"?`)) {
          await deleteServiceAndRefresh(serviceName);
        }
      });
      listItem.appendChild(deleteButton);

      servicesList.appendChild(listItem);
    }
  }
}
