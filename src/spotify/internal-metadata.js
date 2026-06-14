'use strict';

// Pure-Node slice of Spotify's internal ("librespot") protocol, used to fetch a
// track's ISRC (and clean metadata) for ARBITRARY public tracks — including
// other users' playlists, which the public Web API no longer exposes with ISRC.
//
// The flow needs no encrypted AP/mercury session (confirmed against librespot):
//   1. apresolve            -> a spclient host
//   2. clienttoken.spotify  -> a `client-token` (protobuf POST, no auth needed)
//   3. GET /metadata/4/track/{gid}  with  Authorization: Bearer <oauth>
//                                    and   client-token: <client-token>
//      -> Track protobuf, whose external_id[type=isrc] carries the ISRC.
//
// All constants below are taken verbatim from librespot's source so the requests
// look like a real first-party desktop client.

const crypto = require('crypto');
const path = require('path');
const protobuf = require('protobufjs');

const PROTO_PATH = path.join(__dirname, 'proto', 'spotify-internal.proto');

// librespot core/src/config.rs + version.rs
const KEYMASTER_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
const CLIENT_VERSION = '1.2.52.442';
// librespot core/src/spotify_id.rs BASE62_DIGITS (digits, lower, UPPER)
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const APRESOLVE_URL = 'https://apresolve.spotify.com/?type=spclient';
const CLIENTTOKEN_URL = 'https://clienttoken.spotify.com/v1/clienttoken';

let _root = null;
function types() {
  if (!_root) {
    const root = protobuf.loadSync(PROTO_PATH);
    _root = {
      ClientTokenRequest: root.lookupType('internal.ClientTokenRequest'),
      ClientTokenResponse: root.lookupType('internal.ClientTokenResponse'),
      Track: root.lookupType('internal.Track'),
    };
  }
  return _root;
}

// Convert a 22-char base62 Spotify ID into the 32-char hex "gid" the metadata-4
// endpoint expects (128-bit big-endian).
function gidFromId(id) {
  const s = String(id || '');
  if (s.length !== 22) throw new Error(`bad spotify id (need 22 chars): ${id}`);
  let n = 0n;
  for (const ch of s) {
    const d = BASE62.indexOf(ch);
    if (d < 0) throw new Error(`bad base62 char "${ch}" in id: ${id}`);
    n = n * 62n + BigInt(d);
  }
  const hex = n.toString(16);
  if (hex.length > 32) throw new Error(`id overflows 128 bits: ${id}`);
  return hex.padStart(32, '0');
}

function isrcFromTrack(track) {
  const ext = track.externalId || [];
  for (const e of ext) {
    if (e && typeof e.type === 'string' && e.type.toLowerCase() === 'isrc' && e.id) {
      return e.id;
    }
  }
  return null;
}

// Map a decoded Track protobuf to the extension's common track shape.
function trackToCommon(track, spotifyId) {
  return {
    title: track.name || null,
    artists: (track.artist || []).map((a) => a.name).filter(Boolean),
    album: (track.album && track.album.name) || null,
    durationMs: typeof track.duration === 'number' ? track.duration : null,
    isrc: isrcFromTrack(track),
    spotifyUrl: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : null,
  };
}

class InternalMetadataClient {
  // tokenStore: a SpotifyTokenStore holding the librespot/keymaster OAuth token.
  constructor({ tokenStore, deviceId } = {}) {
    this.tokenStore = tokenStore;
    this.deviceId = deviceId || crypto.randomBytes(20).toString('hex'); // 40 hex chars
    this._clientToken = null; // { token, expiresAt }
    this._spclientHost = null; // { host, expiresAt }
    this._cache = new Map(); // spotifyId -> common track (or null)
  }

  isConnected() {
    return !!(this.tokenStore && this.tokenStore.isConnected());
  }

  async getSpclientHost() {
    if (this._spclientHost && Date.now() < this._spclientHost.expiresAt) {
      return this._spclientHost.host;
    }
    let host = 'spclient.wg.spotify.com:443';
    try {
      const res = await fetch(APRESOLVE_URL);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.spclient) && json.spclient[0]) host = json.spclient[0];
      }
    } catch (_) {
      /* fall back to the well-known default host */
    }
    this._spclientHost = { host, expiresAt: Date.now() + 60 * 60 * 1000 };
    return host;
  }

  async getClientToken() {
    if (this._clientToken && Date.now() < this._clientToken.expiresAt - 60_000) {
      return this._clientToken.token;
    }
    const { ClientTokenRequest, ClientTokenResponse } = types();
    const message = ClientTokenRequest.create({
      requestType: 'REQUEST_CLIENT_DATA_REQUEST',
      clientData: {
        clientVersion: CLIENT_VERSION,
        clientId: KEYMASTER_CLIENT_ID,
        connectivitySdkData: {
          deviceId: this.deviceId,
          platformSpecificData: {
            desktopLinux: {
              systemName: 'Linux',
              systemRelease: '6.1.0',
              systemVersion: '#1 SMP',
              hardware: 'x86_64',
            },
          },
        },
      },
    });
    const body = ClientTokenRequest.encode(message).finish();
    const res = await fetch(CLIENTTOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/x-protobuf',
        'content-type': 'application/x-protobuf',
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`clienttoken ${res.status}: ${await res.text()}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const decoded = ClientTokenResponse.decode(buf);
    // protobufjs decodes enums to their numeric value; 1 == GRANTED, 2 == CHALLENGES.
    if (!decoded.grantedToken || !decoded.grantedToken.token) {
      throw new Error(
        `clienttoken returned response_type=${decoded.responseType} with no granted token ` +
        '(a hash-cash challenge would be type 2) — not yet supported. A different network may help.',
      );
    }
    const g = decoded.grantedToken;
    const ttl = (g.refreshAfterSeconds || g.expiresAfterSeconds || 1209600) * 1000;
    this._clientToken = { token: g.token, expiresAt: Date.now() + ttl };
    return g.token;
  }

  // Fetch one track's metadata. Returns the common track shape, or null if the
  // track can't be fetched (missing / transient error) so callers can fall back.
  async getTrackMetadata(spotifyId) {
    if (this._cache.has(spotifyId)) return this._cache.get(spotifyId);
    let result = null;
    try {
      const [accessToken, clientToken, host] = await Promise.all([
        this.tokenStore.getAccessToken(),
        this.getClientToken(),
        this.getSpclientHost(),
      ]);
      const gid = gidFromId(spotifyId);
      const res = await fetch(`https://${host}/metadata/4/track/${gid}`, {
        headers: {
          accept: 'application/x-protobuf',
          authorization: `Bearer ${accessToken}`,
          'client-token': clientToken,
        },
      });
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after') || '1');
        await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
        return this.getTrackMetadata(spotifyId);
      }
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        result = trackToCommon(types().Track.decode(buf), spotifyId);
      } else if (res.status === 401 || res.status === 403) {
        // auth/permission problem is not per-track; surface it.
        throw new Error(`metadata ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      if (/metadata (401|403)/.test(err.message)) throw err;
      result = null; // transient / decode error -> caller falls back
    }
    this._cache.set(spotifyId, result);
    return result;
  }

  // Hydrate many ids with bounded concurrency. Returns an array aligned with ids
  // (entries are the common track shape, or null when unavailable).
  async hydrateTracks(ids, { concurrency = 6 } = {}) {
    const out = new Array(ids.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const i = next++;
        out[i] = await this.getTrackMetadata(ids[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return out;
  }
}

module.exports = {
  InternalMetadataClient,
  gidFromId,
  trackToCommon,
  isrcFromTrack,
  KEYMASTER_CLIENT_ID,
  CLIENT_VERSION,
};
