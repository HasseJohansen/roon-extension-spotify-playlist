'use strict';

const assert = require('node:assert/strict');
const { parseAuthInput, beginAuth } = require('../src/spotify/auth');

// parseAuthInput accepts the whole redirected URL, a bare query, or just the code.
assert.deepEqual(
  parseAuthInput('http://127.0.0.1:8888/callback?code=ABC123&state=XYZ'),
  { code: 'ABC123', state: 'XYZ' },
  'full redirected URL',
);
assert.deepEqual(
  parseAuthInput('  http://127.0.0.1:8888/callback?state=XYZ&code=ABC123  '),
  { code: 'ABC123', state: 'XYZ' },
  'param order + surrounding whitespace',
);
assert.deepEqual(
  parseAuthInput('code=ABC&state=XYZ'),
  { code: 'ABC', state: 'XYZ' },
  'bare query string',
);
assert.deepEqual(
  parseAuthInput('AQB7xyz_-bareCode'),
  { code: 'AQB7xyz_-bareCode', state: null },
  'bare code only',
);
assert.deepEqual(parseAuthInput(''), { code: null, state: null }, 'empty');
assert.deepEqual(parseAuthInput(null), { code: null, state: null }, 'null');

// beginAuth produces a Spotify consent URL carrying the PKCE challenge + state,
// and returns the verifier/state needed to complete the exchange later.
const b = beginAuth('myclient');
assert.ok(/^https:\/\/accounts\.spotify\.com\/authorize\?/.test(b.authUrl), 'authorize URL');
assert.ok(b.authUrl.includes('client_id=myclient'), 'has client id');
assert.ok(b.authUrl.includes('code_challenge=') && b.authUrl.includes('code_challenge_method=S256'), 'has PKCE challenge');
assert.ok(b.authUrl.includes(`state=${b.state}`), 'URL state matches returned state');
assert.ok(b.verifier && b.verifier.length > 20, 'returns a PKCE verifier');

console.log('auth.test.js OK');
