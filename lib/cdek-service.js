const DEFAULT_API_URL = 'https://api.cdek.ru/v2';
const SERVICE_VERSION = '3.11.1';

function startMetrics() {
  return Date.now();
}

function endMetrics(start) {
  return Date.now() - start;
}

function pickXHeaders(headers) {
  if (!headers) return [];
  return [...headers.entries()]
    .filter(([name]) => name.toLowerCase().startsWith('x-'))
    .map(([name, value]) => `${name}: ${value}`);
}

async function cdekRequest(baseUrl, path, { token, method = 'GET', query, body, form }) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  const headers = {
    Accept: 'application/json',
    'User-Agent': `widget/${SERVICE_VERSION}`,
    'X-App-Name': 'widget_pvz',
    'X-App-Version': SERVICE_VERSION,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const init = { method, headers };

  if (form) {
    init.body = new URLSearchParams(form);
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (query && Object.keys(query).length) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, init);
  const text = await response.text();
  const xHeaders = pickXHeaders(response.headers);

  if (!response.ok) {
    const error = new Error(text || `CDEK API error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return { result: text, addedHeaders: xHeaders };
}

async function getAuthToken(baseUrl, login, secret) {
  const started = startMetrics();
  const { result } = await cdekRequest(baseUrl, 'oauth/token', {
    method: 'POST',
    form: {
      grant_type: 'client_credentials',
      client_id: login,
      client_secret: secret,
    },
  });

  const payload = JSON.parse(result);
  if (!payload.access_token) {
    throw new Error('Server not authorized to CDEK API');
  }

  return {
    token: payload.access_token,
    authMs: endMetrics(started),
  };
}

export async function processCdekRequest({ login, secret, query = {}, body = {} }) {
  const baseUrl = process.env.CDEK_API_URL?.trim() || DEFAULT_API_URL;
  const requestData = { ...query, ...(body && typeof body === 'object' ? body : {}) };
  const metrics = [];
  const totalStarted = startMetrics();

  if (!requestData.action) {
    const error = new Error('Action is required');
    error.status = 400;
    throw error;
  }

  const { token, authMs } = await getAuthToken(baseUrl, login, secret);
  metrics.push({ name: 'auth', description: 'Server Auth Time', time: authMs });

  let response;
  const actionStarted = startMetrics();

  switch (requestData.action) {
    case 'offices':
      response = await cdekRequest(baseUrl, 'deliverypoints', {
        token,
        query: requestData,
      });
      metrics.push({
        name: 'office',
        description: 'Offices Request',
        time: endMetrics(actionStarted),
      });
      break;
    case 'calculate':
      response = await cdekRequest(baseUrl, 'calculator/tarifflist', {
        token,
        method: 'POST',
        body: requestData,
      });
      metrics.push({
        name: 'calc',
        description: 'Calculate Request',
        time: endMetrics(actionStarted),
      });
      break;
    default: {
      const error = new Error('Unknown action');
      error.status = 400;
      throw error;
    }
  }

  metrics.push({
    name: 'total',
    description: 'Total Time',
    time: endMetrics(totalStarted),
  });

  return {
    data: response.result,
    addedHeaders: response.addedHeaders,
    serverTiming: metrics
      .map((item) => `${item.name};desc="${item.description}";dur=${item.time.toFixed(2)}`)
      .join(','),
  };
}
