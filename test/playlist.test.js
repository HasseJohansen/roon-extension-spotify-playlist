'use strict';

const assert = require('node:assert/strict');
const { fetchPlaylist } = require('../src/spotify/playlist');

const tokenStore = { getAccessToken: async () => 'fake-token' };

// Builds the HTML the Spotify embed endpoint server-renders, with the track
// list inlined in the __NEXT_DATA__ script tag (the real structure, verified
// against a live response: props.pageProps.state.data.entity.trackList[]).
function embedHtml(rows) {
  const next = {
    props: {
      pageProps: {
        state: { data: { entity: { trackList: rows } } },
      },
    },
  };
  return `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>
</body></html>`;
}

// Installs a fake global.fetch covering both hosts: api.spotify.com (the
// authenticated Web API) and open.spotify.com (the no-auth embed). `opts`
// controls playlist metadata, the embed track rows, and the /v1/tracks
// hydrate response (or an error status to simulate a gated endpoint).
function installFetch(opts) {
  const paths = [];
  const ok = (json) => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
  const okHtml = (html) => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: async () => html,
  });
  const err = (status) => ({
    status,
    ok: false,
    headers: { get: () => null },
    text: async () => `error ${status}`,
  });

  global.fetch = async (url) => {
    const u = new URL(url);
    paths.push(u.pathname);

    if (u.hostname === 'open.spotify.com') {
      // /embed/playlist/{id}
      return okHtml(embedHtml(opts.embedRows || []));
    }

    const { pathname } = u;
    if (pathname === '/v1/me') return ok({ id: 'me-id', display_name: 'Me' });
    if (/^\/v1\/playlists\/[^/]+$/.test(pathname)) return ok(opts.meta);
    if (/^\/v1\/playlists\/[^/]+\/items$/.test(pathname)) {
      return ok(opts.items || { items: [], next: null, total: 0 });
    }
    if (pathname === '/v1/tracks') {
      if (opts.tracksStatus && opts.tracksStatus !== 200) return err(opts.tracksStatus);
      return ok({ tracks: opts.tracksResponse || [] });
    }
    throw new Error(`unexpected path ${pathname}`);
  };
  return paths;
}

// A Spotify Web API track object as returned by GET /v1/tracks.
function apiTrack(id, name, artist, isrc) {
  return {
    id,
    name,
    duration_ms: 200000,
    external_ids: { isrc },
    artists: [{ name: artist }],
    album: { name: `${name} (album)` },
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  };
}

async function main() {
  // 1. Not owned / not collaborative -> falls back to the embed endpoint and
  //    re-hydrates full metadata (incl. ISRC) via GET /v1/tracks.
  {
    const paths = installFetch({
      meta: {
        id: 'pl1',
        name: 'Someone Elses Mix',
        owner: { id: 'other-id', display_name: 'Other Person' },
        collaborative: false,
        tracks: { total: 2 },
      },
      embedRows: [
        { uri: 'spotify:track:aaa', title: 'Song A', subtitle: 'Artist A', duration: 200000 },
        { uri: 'spotify:track:bbb', title: 'Song B', subtitle: 'Artist B', duration: 200000 },
      ],
      tracksResponse: [
        apiTrack('aaa', 'Song A', 'Artist A', 'ISRC-AAA'),
        apiTrack('bbb', 'Song B', 'Artist B', 'ISRC-BBB'),
      ],
    });

    const playlist = await fetchPlaylist(tokenStore, 'spotify:playlist:pl1');

    assert.equal(playlist.tracks.length, 2, 'embed fallback yields all tracks');
    assert.ok(
      paths.some((p) => p.startsWith('/embed/playlist/')),
      'must request the embed endpoint for a playlist the user does not own',
    );
    assert.ok(paths.includes('/v1/tracks'), 'must hydrate metadata via /v1/tracks');
    assert.equal(playlist.tracks[0].isrc, 'ISRC-AAA', 'ISRC preserved from hydrate');
    assert.deepEqual(playlist.tracks[0].artists, ['Artist A'], 'artists from hydrate');
    assert.equal(playlist.tracks[0].album, 'Song A (album)', 'album from hydrate');
  }

  // 2. Not owned, but /v1/tracks is gated (403) -> degrades gracefully to the
  //    embed's own title/artist/duration, with isrc null (so the matcher falls
  //    back to text matching). No track is lost.
  {
    const paths = installFetch({
      meta: {
        id: 'pl3',
        name: 'Gated Mix',
        owner: { id: 'other-id', display_name: 'Other Person' },
        collaborative: false,
        tracks: { total: 2 },
      },
      embedRows: [
        { uri: 'spotify:track:ccc', title: 'Song C', subtitle: 'Artist C', duration: 180000 },
        { uri: 'spotify:track:ddd', title: 'Song D', subtitle: 'Artist D', duration: 180000 },
      ],
      tracksStatus: 403,
    });

    const playlist = await fetchPlaylist(tokenStore, 'spotify:playlist:pl3');

    assert.equal(playlist.tracks.length, 2, 'all tracks survive a gated hydrate');
    assert.ok(paths.includes('/v1/tracks'), 'hydrate was attempted');
    assert.equal(playlist.tracks[0].isrc, null, 'no isrc when hydrate is gated');
    assert.equal(playlist.tracks[0].title, 'Song C', 'title falls back to embed data');
    assert.deepEqual(playlist.tracks[0].artists, ['Artist C'], 'artists fall back to embed subtitle');
    assert.equal(playlist.tracks[0].durationMs, 180000, 'duration falls back to embed data');
  }

  // 3. Owned by the user -> uses the official /items endpoint, never the embed.
  {
    const paths = installFetch({
      meta: {
        id: 'pl2',
        name: 'My Mix',
        owner: { id: 'me-id', display_name: 'Me' },
        collaborative: false,
        tracks: { total: 1 },
      },
      items: {
        items: [
          {
            is_local: false,
            track: apiTrack('eee', 'Owned Song', 'Owned Artist', 'ISRC-EEE'),
          },
        ],
        next: null,
        total: 1,
      },
    });

    const playlist = await fetchPlaylist(tokenStore, 'spotify:playlist:pl2');

    assert.equal(playlist.tracks.length, 1, 'owned playlist imports via official API');
    assert.equal(playlist.tracks[0].isrc, 'ISRC-EEE', 'official path keeps ISRC');
    assert.ok(
      paths.some((p) => p.endsWith('/items')),
      'owned playlist must reach the items endpoint',
    );
    assert.ok(
      !paths.some((p) => p.startsWith('/embed/playlist/')),
      'owned playlist must NOT touch the embed endpoint',
    );
  }

  console.log('playlist.test.js OK');
}

const realFetch = global.fetch;
main()
  .finally(() => { global.fetch = realFetch; })
  .catch((err) => { console.error(err); process.exit(1); });
