'use strict';

const { pickBest } = require('./score');

async function matchTrack({ spotifyTrack, tidal, roonSearch, log = () => {} }) {
  const queries = [];

  if (tidal && spotifyTrack.isrc) {
    try {
      const tidalHit = await tidal.lookupByIsrc(spotifyTrack.isrc);
      if (tidalHit) {
        queries.push({
          tier: 1,
          query: `${tidalHit.title} ${tidalHit.artist}`,
          canonical: tidalHit,
        });
        log(`tidal isrc ${spotifyTrack.isrc} → "${tidalHit.title}" / ${tidalHit.artist}`);
      }
    } catch (err) {
      log(`tidal isrc lookup failed for ${spotifyTrack.isrc}: ${err.message}`);
    }
  }

  queries.push({
    tier: 2,
    query: `${spotifyTrack.title} ${spotifyTrack.artists[0] || ''}`.trim(),
    canonical: null,
  });

  for (const q of queries) {
    const candidates = await roonSearch(q.query);
    if (!candidates || candidates.length === 0) continue;

    const reference = q.canonical
      ? {
          title: q.canonical.title,
          artists: [q.canonical.artist],
          album: q.canonical.album || spotifyTrack.album,
          durationMs: (q.canonical.durationSec || 0) * 1000 || spotifyTrack.durationMs,
        }
      : spotifyTrack;

    const best = pickBest(reference, candidates);
    if (!best) continue;

    if (q.tier === 1) {
      return {
        candidate: best.candidate,
        tier: 1,
        confidence: 0.99,
        score: best.score,
        query: q.query,
      };
    }

    return {
      candidate: best.candidate,
      tier: best.score.tier,
      confidence: best.score.confidence,
      score: best.score,
      query: q.query,
    };
  }

  return null;
}

module.exports = { matchTrack };
