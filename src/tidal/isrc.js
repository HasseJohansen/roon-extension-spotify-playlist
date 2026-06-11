'use strict';

const TIDAL_AUTH = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_API = 'https://openapi.tidal.com/v2';

class TidalClient {
  constructor({ clientId, clientSecret, countryCode = 'US' }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.countryCode = countryCode;
    this.token = null;
    this.expiresAt = 0;
  }

  static fromConfig(cfg) {
    if (!cfg || !cfg.tidalClientId || !cfg.tidalClientSecret) return null;
    return new TidalClient({
      clientId: cfg.tidalClientId,
      clientSecret: cfg.tidalClientSecret,
      countryCode: cfg.tidalCountryCode || 'US',
    });
  }

  async getAccessToken() {
    if (this.token && Date.now() < this.expiresAt - 30_000) return this.token;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(TIDAL_AUTH, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!res.ok) throw new Error(`tidal auth failed: ${res.status} ${await res.text()}`);
    const j = await res.json();
    this.token = j.access_token;
    this.expiresAt = Date.now() + j.expires_in * 1000;
    return this.token;
  }

  async lookupByIsrc(isrc) {
    if (!isrc) return null;
    const token = await this.getAccessToken();
    const url = new URL(`${TIDAL_API}/tracks`);
    url.searchParams.set('countryCode', this.countryCode);
    url.searchParams.set('filter[isrc]', isrc);
    url.searchParams.set('include', 'artists,albums');
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.api+json',
        authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`tidal isrc ${isrc} → ${res.status}: ${await res.text()}`);
    const j = await res.json();

    const track = (j.data || [])[0];
    if (!track) return null;

    const included = j.included || [];
    const artists = (track.relationships?.artists?.data || [])
      .map((ref) => included.find((x) => x.type === ref.type && x.id === ref.id))
      .filter(Boolean)
      .map((a) => a.attributes && a.attributes.name)
      .filter(Boolean);
    const album = (track.relationships?.albums?.data || [])
      .map((ref) => included.find((x) => x.type === ref.type && x.id === ref.id))
      .filter(Boolean)[0];

    return {
      title: track.attributes && track.attributes.title,
      artist: artists[0] || '',
      artists,
      album: album?.attributes?.title || '',
      durationSec: parseDurationSec(track.attributes?.duration),
      isrc,
    };
  }
}

function parseDurationSec(d) {
  if (!d) return null;
  if (typeof d === 'number') return d;
  const m = String(d).match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (Number(m[1] || 0) * 60) + Number(m[2] || 0);
}

module.exports = { TidalClient };
