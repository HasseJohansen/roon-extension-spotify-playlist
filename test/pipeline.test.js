'use strict';

const assert = require('node:assert/strict');
const { matchTrack } = require('../src/match/pipeline');

async function main() {
  // 1. A decorated title must be searched with the decorators stripped — the raw
  //    "… - The Disco Boys Edit" query returns nothing; a base-title query finds it.
  {
    const tried = [];
    const roonSearch = async (q) => {
      tried.push(q);
      if (/geronimo/i.test(q) && !/edit|disco/i.test(q)) {
        return [{ itemKey: 'geronimo', title: 'Geronimo', artist: 'Aura Dione', durationSec: null }];
      }
      return []; // raw/decorated query → no results
    };
    const m = await matchTrack({
      spotifyTrack: { title: 'Geronimo - The Disco Boys Edit', artists: ['Aura Dione'], album: null, durationMs: 200000, isrc: null },
      tidal: null,
      roonSearch,
    });
    assert.ok(m && m.candidate.itemKey === 'geronimo', 'matched via a decorator-stripped query');
    assert.ok(tried.some((q) => /geronimo/i.test(q) && !/edit|disco/i.test(q)), 'tried a base-title query');
  }

  // 2. Karaoke-only search results must yield NO match (cover guard).
  {
    const roonSearch = async () => [
      { itemKey: 'k', title: 'Barbie Girl (Karaoke Version)', artist: 'Pop Mania, Aqua', durationSec: null },
    ];
    const m = await matchTrack({
      spotifyTrack: { title: 'Barbie Girl', artists: ['Aqua'], album: null, durationMs: 0, isrc: null },
      tidal: null,
      roonSearch,
    });
    assert.equal(m, null, 'karaoke-only results must not match');
  }

  // 3. Trust ISRC: when Tidal resolves the ISRC, a title-matching Roon candidate is
  //    accepted even if the listed artist differs (ISRC already confirms identity).
  {
    const tidal = {
      lookupByIsrc: async () => ({ title: 'Riverside', artist: 'Agnes Obel', artists: ['Agnes Obel'], album: '', durationSec: 228, isrc: 'X' }),
    };
    const roonSearch = async () => [
      { itemKey: 'riv', title: 'Riverside', artist: 'Some Aggregated Listing', durationSec: null },
    ];
    const m = await matchTrack({
      spotifyTrack: { title: 'Riverside', artists: ['Agnes Obel'], album: null, durationMs: 228000, isrc: 'X' },
      tidal,
      roonSearch,
    });
    assert.ok(m && m.tier === 1 && m.candidate.itemKey === 'riv', 'ISRC trust accepts title match despite artist mismatch');
  }

  console.log('pipeline.test.js OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
