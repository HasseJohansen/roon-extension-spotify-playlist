'use strict';

const assert = require('node:assert/strict');
const { fetchPlaylist, parsePlaylistUrl } = require('../src/spotify/playlist');

// parsePlaylistUrl accepts URL, embed URL, and uri forms.
assert.equal(parsePlaylistUrl('https://open.spotify.com/playlist/abc123'), 'abc123');
assert.equal(parsePlaylistUrl('https://open.spotify.com/embed/playlist/abc123'), 'abc123');
assert.equal(parsePlaylistUrl('spotify:playlist:abc123'), 'abc123');
assert.equal(parsePlaylistUrl(''), null);

// A common-shape track as InternalMetadataClient.hydrateTracks would return it.
function track(id, name, artist, isrc) {
  return {
    title: name,
    artists: [artist],
    album: `${name} (album)`,
    durationMs: 200000,
    isrc,
    spotifyUrl: `https://open.spotify.com/track/${id}`,
  };
}

// A fake InternalMetadataClient: drives getPlaylistContents + hydrateTracks.
function fakeInternal({ connected = true, contents, hydrate }) {
  return {
    isConnected: () => connected,
    getPlaylistContents: async () => contents,
    hydrateTracks: async (ids) => ids.map(hydrate),
  };
}

async function main() {
  // 1. Happy path: every track hydrates with ISRC (works the same whether the
  //    playlist is owned or belongs to someone else — one internal path).
  {
    const internal = fakeInternal({
      contents: { name: 'Someone Elses Mix', total: 2, truncated: false, trackIds: ['aaa', 'bbb'] },
      hydrate: (id) => track(id, `Song ${id}`, `Artist ${id}`, `ISRC-${id.toUpperCase()}`),
    });

    const playlist = await fetchPlaylist(internal, 'spotify:playlist:pl1');

    assert.equal(playlist.id, 'pl1');
    assert.equal(playlist.name, 'Someone Elses Mix');
    assert.equal(playlist.tracks.length, 2, 'all tracks returned');
    assert.equal(playlist.tracks[0].isrc, 'ISRC-AAA', 'ISRC from internal metadata');
    assert.deepEqual(playlist.tracks[0].artists, ['Artist aaa']);
  }

  // 2. A track whose metadata couldn't be fetched (null) becomes a placeholder
  //    (so it's not lost; it just won't match) — the rest keep their ISRC.
  {
    const internal = fakeInternal({
      contents: { name: 'Mixed', total: 2, truncated: false, trackIds: ['ccc', 'ddd'] },
      hydrate: (id) => (id === 'ccc' ? track(id, 'Song C', 'Artist C', 'ISRC-CCC') : null),
    });

    const playlist = await fetchPlaylist(internal, 'pl2');

    assert.equal(playlist.tracks.length, 2, 'no track is dropped');
    assert.equal(playlist.tracks[0].isrc, 'ISRC-CCC');
    assert.equal(playlist.tracks[1].isrc, null, 'unfetchable track -> null isrc placeholder');
    assert.equal(
      playlist.tracks[1].spotifyUrl,
      'https://open.spotify.com/track/ddd',
      'placeholder still carries the spotify url',
    );
  }

  // 3. Empty playlist -> clear error.
  {
    const internal = fakeInternal({
      contents: { name: 'Empty', total: 0, truncated: false, trackIds: [] },
      hydrate: () => null,
    });
    await assert.rejects(() => fetchPlaylist(internal, 'pl3'), /no tracks/, 'empty playlist errors');
  }

  // 4. Not connected -> refuses with a helpful message (single-login model).
  {
    const internal = fakeInternal({ connected: false, contents: null, hydrate: () => null });
    await assert.rejects(() => fetchPlaylist(internal, 'pl4'), /not connected/, 'requires connection');
  }

  console.log('playlist.test.js OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
