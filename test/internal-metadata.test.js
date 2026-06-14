'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const protobuf = require('protobufjs');
const {
  gidFromId,
  trackToCommon,
  isrcFromTrack,
} = require('../src/spotify/internal-metadata');

// --- gidFromId: 22-char base62 ID -> 32-char hex gid -----------------------
// Vectors verified live against Spotify's base62 alphabet (digits, lower, UPPER).
assert.equal(gidFromId('4cOdK2wGLETKBW3PvgPWqT'), '8a37517ba69f47c3aeeee164eecee933', 'gid vector 1');
assert.equal(gidFromId('6rqhFgbbKwnb9MLmUQDhG6'), 'd3aca7e43e3b452cbfa9ddd2eab9497e', 'gid vector 2');
// All-min and structural properties.
assert.equal(gidFromId('0000000000000000000000'), '0'.repeat(32), 'all-zero id -> all-zero gid');
assert.equal(gidFromId('4cOdK2wGLETKBW3PvgPWqT').length, 32, 'gid is 32 hex chars');

// gid round-trips back to the original id (decode then re-encode).
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function idFromGid(hex) {
  let n = BigInt('0x' + hex), out = '';
  for (let i = 0; i < 22; i++) { out = BASE62[Number(n % 62n)] + out; n /= 62n; }
  return out;
}
for (const id of ['4cOdK2wGLETKBW3PvgPWqT', '6rqhFgbbKwnb9MLmUQDhG6', '1A2b3C4d5E6f7G8h9I0jKl']) {
  assert.equal(idFromGid(gidFromId(id)), id, `gid round-trip for ${id}`);
}

// Bad inputs are rejected (a wrong gid would silently fetch the wrong track).
assert.throws(() => gidFromId('tooshort'), /22 chars/, 'rejects short id');
assert.throws(() => gidFromId('4cOdK2wGLETKBW3PvgPWq-'), /base62/, 'rejects non-base62 char');

// --- Track protobuf decode + ISRC extraction -------------------------------
const root = protobuf.loadSync(path.join(__dirname, '..', 'src', 'spotify', 'proto', 'spotify-internal.proto'));
const Track = root.lookupType('internal.Track');

const wire = Track.encode(Track.create({
  name: 'Riverside',
  album: { name: 'Late Night Tales' },
  artist: [{ name: 'Agnes Obel' }, { name: 'Someone Else' }],
  duration: 254000,
  externalId: [
    { type: 'something', id: 'ignore-me' },
    { type: 'ISRC', id: 'BEP011000054' }, // case-insensitive match
  ],
})).finish();

const decoded = Track.decode(wire);
assert.equal(isrcFromTrack(decoded), 'BEP011000054', 'extracts ISRC case-insensitively, skips other ids');

const common = trackToCommon(decoded, '4cOdK2wGLETKBW3PvgPWqT');
assert.deepEqual(common, {
  title: 'Riverside',
  artists: ['Agnes Obel', 'Someone Else'],
  album: 'Late Night Tales',
  durationMs: 254000,
  isrc: 'BEP011000054',
  spotifyUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
}, 'trackToCommon maps the full track shape');

// A track with no ISRC yields isrc: null (caller falls back to text matching).
const noIsrc = Track.decode(Track.encode(Track.create({ name: 'X', duration: 1000 })).finish());
assert.equal(isrcFromTrack(noIsrc), null, 'no external_id -> null isrc');
assert.equal(trackToCommon(noIsrc, null).spotifyUrl, null, 'no id -> null url');

console.log('internal-metadata.test.js OK');
