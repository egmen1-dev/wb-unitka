import { readFileSync } from 'fs';
import { SignJWT, importPKCS8 } from 'jose';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function getCredentials() {
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim();
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) return JSON.parse(json);
  if (path) return JSON.parse(readFileSync(path, 'utf8'));
  throw new Error('Задайте GOOGLE_SERVICE_ACCOUNT_PATH или GOOGLE_SERVICE_ACCOUNT_JSON');
}

async function getAccessToken(credentials) {
  const key = await importPKCS8(credentials.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: SHEETS_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.access_token;
}

async function sheetsRequest(path, { method = 'GET', body = null, token }) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Sheets API ${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

export async function getSheetValues(spreadsheetId, range) {
  const credentials = getCredentials();
  const token = await getAccessToken(credentials);
  const data = await sheetsRequest(
    `/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { token }
  );
  return data.values || [];
}

export async function batchUpdateValues(spreadsheetId, data) {
  const credentials = getCredentials();
  const token = await getAccessToken(credentials);
  return sheetsRequest(`/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    token,
    body: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });
}
