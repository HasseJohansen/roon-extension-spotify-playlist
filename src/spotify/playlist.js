'use strict';

const PLAYLIST_RE = /(?:open\.spotify\.com\/(?:embed\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]+)/;

function parsePlaylistUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  const m = trimmed.match(PLAYLIST_RE);
  return m ? m[1] : null;
}

async function spotifyGet(tokenStore, path, params) {
  const accessToken = await tokenStore.getAccessToken();
  const url = new URL(`https://api.spotify.com/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') || '1');
    await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
    return spotifyGet(tokenStore, path, params);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`spotify ${res.status} on ${path}: ${body}`);
  }
  return res.json();
}

async function fetchPlaylistMeta(tokenStore, playlistId) {
  return spotifyGet(tokenStore, `/playlists/${playlistId}`, {
    fields: 'id,name,owner(id,display_name),public,collaborative,tracks(total)',
  });
}

async function fetchCurrentUser(tokenStore) {
  return spotifyGet(tokenStore, '/me'); // no fields param; returns id, display_name
}

async function fetchPlaylistItems(tokenStore, playlistId) {
  const items = [];
  let offset = 0;
  const limit = 50;
  const fields =
    'items(is_local,track(name,duration_ms,external_ids(isrc),artists(name),album(name,release_date),external_urls(spotify))),next,total';
  while (true) {
    const page = await spotifyGet(tokenStore, `/playlists/${playlistId}/items`, {
      offset,
      limit,
      fields,
    });
    const pageItems = page.items || [];
    if (pageItems.length === 0 && offset === 0 && page.total === 0) {
      throw new Error('This playlist has no tracks.');
    }
    for (const it of pageItems) {
      if (!it.track || it.is_local) continue;
      items.push(toTrack(it.track));
    }
    if (!page.next) break;
    offset += limit;
  }
  return items;
}

function toTrack(t) {
  return {
    title: t.name,
    artists: (t.artists || []).map((a) => a.name),
    album: t.album && t.album.name,
    durationMs: t.duration_ms,
    isrc: t.external_ids && t.external_ids.isrc,
    spotifyUrl: t.external_urls && t.external_urls.spotify,
  };
}

// --- Non-owned public playlists -------------------------------------------
// Since Feb 2026 the Web API returns items only for playlists the user owns or
// collaborates on. For other users' public playlists we read the ordered track
// IDs from the no-auth embed page, then re-hydrate full metadata (incl. ISRC)
// via GET /v1/tracks. NOTE: scraping the embed violates Spotify's Developer /
// Embed Terms and the format is undocumented — acceptable for personal use, and
// it degrades gracefully if either source changes.

// Fetch the embed page and parse its inlined __NEXT_DATA__ JSON into an ordered
// list of { spotifyId, title, artistsText, durationMs }.
async function fetchPlaylistViaEmbed(playlistId) {
  const url = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const res = await fetch(url, {
    headers: {
      // Spotify serves the SSR data only to browser-like clients.
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) {
    throw new Error(`spotify embed ${res.status} for playlist ${playlistId}`);
  }
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    throw new Error(
      `Could not read tracks for playlist ${playlistId}: the Spotify embed format ` +
      `changed (no __NEXT_DATA__ block). This fallback path needs updating.`,
    );
  }
  let trackList;
  try {
    const data = JSON.parse(m[1]);
    trackList = data.props.pageProps.state.data.entity.trackList;
  } catch (err) {
    throw new Error(
      `Could not parse the Spotify embed for playlist ${playlistId}: ${err.message}`,
    );
  }
  if (!Array.isArray(trackList)) {
    throw new Error(`The Spotify embed for playlist ${playlistId} had no trackList.`);
  }
  const rows = [];
  for (const it of trackList) {
    const spotifyId = parseTrackUri(it && it.uri);
    if (!spotifyId) continue; // skip local/unavailable rows without a real track id
    rows.push({
      spotifyId,
      title: it.title,
      artistsText: it.subtitle || '',
      durationMs: it.duration,
    });
  }
  return rows;
}

function parseTrackUri(uri) {
  const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri || '');
  return m ? m[1] : null;
}

// Re-hydrate full track metadata via GET /v1/tracks (≤50 ids per call). Returns
// an array aligned with `ids`; entries are null when a track is missing or the
// whole batch fails (e.g. the endpoint is gated for this app), so callers can
// fall back per track.
async function hydrateTracksByIds(tokenStore, ids) {
  const out = new Array(ids.length).fill(null);
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    let tracks;
    try {
      const page = await spotifyGet(tokenStore, '/tracks', { ids: chunk.join(',') });
      tracks = page.tracks || [];
    } catch (err) {
      continue; // leave this chunk null -> caller uses embed data
    }
    for (let i = 0; i < chunk.length; i++) {
      const t = tracks[i];
      if (t) out[start + i] = toTrack(t);
    }
  }
  return out;
}

function embedRowToTrack(row) {
  return {
    title: row.title,
    artists: row.artistsText ? row.artistsText.split(/,\s*/).filter(Boolean) : [],
    album: null,
    durationMs: row.durationMs,
    isrc: null,
    spotifyUrl: row.spotifyId
      ? `https://open.spotify.com/track/${row.spotifyId}`
      : null,
  };
}

async function fetchPlaylistViaEmbedAndHydrate(tokenStore, playlistId) {
  const rows = await fetchPlaylistViaEmbed(playlistId);
  if (rows.length === 0) {
    throw new Error('This playlist has no tracks.');
  }
  const hydrated = await hydrateTracksByIds(tokenStore, rows.map((r) => r.spotifyId));
  return rows.map((row, i) => hydrated[i] || embedRowToTrack(row));
}

function warnIfTruncated(meta, total, fetched) {
  if (typeof total === 'number' && total > fetched) {
    // The embed caps very large playlists; surface it rather than silently
    // importing a subset.
    console.warn(
      `Spotify only exposed ${fetched} of ${total} tracks for playlist ` +
      `"${meta.name}" (owned by another user); the rest could not be fetched.`,
    );
  }
}

// Other users' public playlists, WITH ISRC, via the internal librespot client:
// read the ordered track IDs from the embed, then fill in ISRC + metadata from
// spclient /metadata/4/track. (The embed is list-only; ISRC comes from spclient.)
//
// NB: we deliberately do NOT try the Web API items endpoint with the keymaster
// token — it's unverified whether a first-party token un-gates non-owned
// playlists, and a 429 there can carry a multi-hour retry-after that would hang
// the import. The spclient metadata path is the verified route to ISRC.
async function fetchNonOwnedViaInternal(internal, playlistId, meta, total) {
  const rows = await fetchPlaylistViaEmbed(playlistId);
  if (rows.length === 0) throw new Error('This playlist has no tracks.');
  let hydrated;
  try {
    hydrated = await internal.hydrateTracks(rows.map((r) => r.spotifyId));
  } catch (err) {
    console.warn(`librespot metadata unavailable (${err.message}); using embed without ISRC`);
    hydrated = rows.map(() => null);
  }
  const tracks = rows.map((row, i) => hydrated[i] || embedRowToTrack(row));
  warnIfTruncated(meta, total, tracks.length);
  return tracks;
}

// opts.internal: an optional connected InternalMetadataClient (librespot/keymaster).
// When present it provides ISRC for other users' public playlists; when absent the
// behaviour is unchanged (dev-app + embed, ISRC only for owned playlists).
async function fetchPlaylist(tokenStore, urlOrId, opts = {}) {
  const internal = opts.internal && opts.internal.isConnected() ? opts.internal : null;
  const id = parsePlaylistUrl(urlOrId) || urlOrId;
  const meta = await fetchPlaylistMeta(tokenStore, id);
  const me = await fetchCurrentUser(tokenStore);
  const ownedByMe = meta.owner && meta.owner.id === me.id;
  const total = meta.tracks && meta.tracks.total;
  let tracks;
  if (ownedByMe || meta.collaborative) {
    // Playlists we own/collaborate on: official, full-fidelity path.
    tracks = await fetchPlaylistItems(tokenStore, id);
  } else if (internal) {
    // Other users' public playlists, WITH ISRC, via librespot.
    tracks = await fetchNonOwnedViaInternal(internal, id, meta, total);
  } else {
    // Other users' public playlists: embed track IDs + /v1/tracks re-hydrate
    // (gated → text-only). No librespot connected.
    tracks = await fetchPlaylistViaEmbedAndHydrate(tokenStore, id);
    warnIfTruncated(meta, total, tracks.length);
  }
  return { id, name: meta.name, owner: meta.owner, total, tracks };
}

module.exports = { parsePlaylistUrl, fetchPlaylist };
