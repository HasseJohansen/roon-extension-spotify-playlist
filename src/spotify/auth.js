'use strict';

const crypto = require('crypto');
const http = require('http');

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
];

const REDIRECT_HOST = '127.0.0.1';
const REDIRECT_PORT = 8888;
const REDIRECT_PATH = '/callback';
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${REDIRECT_PATH}`;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthUrl(clientId, challenge, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES.join(' '),
    state,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function awaitCallback(expectedState, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${REDIRECT_HOST}:${REDIRECT_PORT}`);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      const body = error
        ? `Spotify auth error: ${error}. You can close this tab.`
        : 'Spotify connected. You can close this tab and return to Roon.';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(body);

      server.close();

      if (error) return reject(new Error(error));
      if (state !== expectedState) return reject(new Error('state mismatch'));
      if (!code) return reject(new Error('no code in callback'));
      resolve(code);
    });
    server.on('error', reject);
    server.listen(REDIRECT_PORT, REDIRECT_HOST);

    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out'));
    }, timeoutMs).unref();
  });
}

async function exchangeCodeForTokens({ clientId, code, verifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

async function refreshTokens({ clientId, refreshToken }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

async function startInteractiveAuth(clientId, onAuthUrl) {
  const { verifier, challenge } = generatePkce();
  const state = base64url(crypto.randomBytes(16));
  const authUrl = buildAuthUrl(clientId, challenge, state);

  const codePromise = awaitCallback(state);
  if (onAuthUrl) onAuthUrl(authUrl);

  const code = await codePromise;
  return exchangeCodeForTokens({ clientId, code, verifier });
}

class SpotifyTokenStore {
  constructor({ clientId, tokens, persist }) {
    this.clientId = clientId;
    this.tokens = tokens || null;
    this.persist = persist || (() => {});
  }

  isConnected() {
    return !!(this.tokens && this.tokens.refreshToken);
  }

  async getAccessToken() {
    if (!this.tokens) throw new Error('not connected');
    if (Date.now() < this.tokens.expiresAt - 30_000) return this.tokens.accessToken;
    const fresh = await refreshTokens({
      clientId: this.clientId,
      refreshToken: this.tokens.refreshToken,
    });
    this.tokens = fresh;
    await this.persist(fresh);
    return fresh.accessToken;
  }

  setTokens(tokens) {
    this.tokens = tokens;
  }
}

module.exports = {
  REDIRECT_URI,
  startInteractiveAuth,
  refreshTokens,
  SpotifyTokenStore,
};
