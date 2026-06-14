'use strict';

// Playlist fetch via Spotify's internal ("librespot") endpoints only — one login
// (the keymaster token in InternalMetadataClient) serves every playlist, whether
// you own it or it belongs to another user:
//   1. /playlist/v2/playlist/{id}  -> ordered track IDs + playlist name
//   2. /metadata/4/track/{gid}     -> ISRC + title/artist/album/duration per track
// No developer app, no Web API, no embed scraping.

const PLAYLIST_RE = /(?:open\.spotify\.com\/(?:embed\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]+)/;

function parsePlaylistUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  const m = trimmed.match(PLAYLIST_RE);
  return m ? m[1] : null;
}

// Minimal track when even spclient metadata couldn't be fetched for an id, so the
// track still appears (matched by nothing — counted as unmatched downstream).
function placeholderTrack(spotifyId) {
  return {
    title: null,
    artists: [],
    album: null,
    durationMs: null,
    isrc: null,
    spotifyUrl: `https://open.spotify.com/track/${spotifyId}`,
  };
}

// `internal` is a connected InternalMetadataClient.
async function fetchPlaylist(internal, urlOrId) {
  if (!internal || !internal.isConnected()) {
    throw new Error('Spotify is not connected — connect it in the extension settings first.');
  }
  const id = parsePlaylistUrl(urlOrId) || urlOrId;

  const content = await internal.getPlaylistContents(id);
  if (!content.trackIds.length) {
    throw new Error('This playlist has no tracks (or none could be read).');
  }

  const hydrated = await internal.hydrateTracks(content.trackIds);
  const tracks = content.trackIds.map((tid, i) => hydrated[i] || placeholderTrack(tid));

  if (content.truncated || (typeof content.total === 'number' && content.total > tracks.length)) {
    console.warn(
      `Spotify returned ${tracks.length} of ${content.total} tracks for playlist ` +
      `"${content.name || id}"; the rest were truncated by the internal endpoint.`,
    );
  }

  return { id, name: content.name, owner: null, total: content.total, tracks };
}

module.exports = { parsePlaylistUrl, fetchPlaylist };
