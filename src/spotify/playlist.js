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

async function fetchPlaylistItems(tokenStore, playlistId) {
  const items = [];
  let offset = 0;
  const limit = 50;
  const fields =
    'items(is_local,track(name,duration_ms,external_ids(isrc),artists(name),album(name,release_date),external_urls(spotify))),next,total';
  while (true) {
    const page = await spotifyGet(tokenStore, `/playlists/${playlistId}/tracks`, {
      offset,
      limit,
      fields,
    });
    const pageItems = page.items || [];
    if (pageItems.length === 0 && offset === 0 && page.total === 0) {
      throw new Error(
        'Spotify returned 0 items for this playlist. Since Feb 2026 only playlists you own or collaborate on return tracks via the API. ' +
        'Either fork this playlist into your own account or pick one you own.',
      );
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

async function fetchPlaylist(tokenStore, urlOrId) {
  const id = parsePlaylistUrl(urlOrId) || urlOrId;
  const meta = await fetchPlaylistMeta(tokenStore, id);
  const tracks = await fetchPlaylistItems(tokenStore, id);
  return { id, name: meta.name, owner: meta.owner, total: meta.tracks.total, tracks };
}

module.exports = { parsePlaylistUrl, fetchPlaylist };
