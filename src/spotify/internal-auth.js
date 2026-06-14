'use strict';

// OAuth profile for Spotify's first-party "librespot/keymaster" client. This
// token is what unlocks the internal spclient metadata endpoint (see
// internal-metadata.js) so we can read ISRCs for ARBITRARY public tracks.
//
// It needs NO developer-app registration: the client_id, redirect URI and scopes
// are the fixed values librespot itself uses (core/src/config.rs + src/main.rs).
// The redirect path MUST be "/login" (the keymaster client only accepts loopback
// "/login" redirects, on any port). We reuse the dev-app's PKCE + paste-the-code
// primitives from auth.js so the Kubernetes paste flow works here too.

const {
  REDIRECT_HOST,
  REDIRECT_PORT,
  beginAuth,
  startCallbackServer,
  exchangeCodeForTokens,
} = require('./auth');
const { KEYMASTER_CLIENT_ID } = require('./internal-metadata');

// librespot src/main.rs OAUTH_SCOPES (trimmed to the reads we actually need).
const INTERNAL_SCOPES = [
  'streaming',
  'playlist-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-email',
  'user-read-private',
];

const INTERNAL_REDIRECT_PATH = '/login';
const INTERNAL_REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${INTERNAL_REDIRECT_PATH}`;

const INTERNAL_OAUTH = { redirectUri: INTERNAL_REDIRECT_URI, scopes: INTERNAL_SCOPES };

function beginInternalAuth() {
  return beginAuth(KEYMASTER_CLIENT_ID, INTERNAL_OAUTH);
}

function startInternalCallbackServer(expectedState, onResult, timeoutMs) {
  return startCallbackServer(expectedState, onResult, timeoutMs, {
    port: REDIRECT_PORT,
    path: INTERNAL_REDIRECT_PATH,
  });
}

function exchangeInternalCode({ code, verifier }) {
  return exchangeCodeForTokens({
    clientId: KEYMASTER_CLIENT_ID,
    code,
    verifier,
    redirectUri: INTERNAL_REDIRECT_URI,
  });
}

module.exports = {
  KEYMASTER_CLIENT_ID,
  INTERNAL_REDIRECT_URI,
  INTERNAL_SCOPES,
  beginInternalAuth,
  startInternalCallbackServer,
  exchangeInternalCode,
};
