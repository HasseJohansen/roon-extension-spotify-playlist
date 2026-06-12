'use strict';

const { pickBest, similarity, isLikelyCover } = require('./score');
const { strip, baseTitle, primaryArtist } = require('./normalize');

// Ordered, de-duplicated Roon search queries for a title, from most specific to
// widest. Roon returns "No Results" for titles carrying version decorators
// ("- Live", "- … Edit", "(…)"), so we strip them progressively.
function titleQueries(title, artist) {
  const out = [];
  const add = (q) => {
    const cleaned = String(q || '').replace(/\s+/g, ' ').trim();
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  };
  const a = (artist || '').trim();
  add(`${strip(title)} ${a}`);     // drop feat/remaster/live decorators
  add(`${baseTitle(title)} ${a}`); // also drop "(…)" and " - …" suffixes
  add(baseTitle(title));           // title only — widen; scoring still enforces artist
  return out;
}

// Trust-ISRC picker: the ISRC already confirms the recording, so among non-cover
// candidates pick the one whose core title best matches, ignoring the artist
// (Roon often lists aggregated/various artists for the same recording).
function pickBestByTitle(refTitle, candidates) {
  let best = null;
  for (const c of candidates) {
    if (isLikelyCover(refTitle, c.title)) continue;
    const baseSim = similarity(baseTitle(refTitle), baseTitle(c.title));
    if (baseSim < 0.85) continue;
    if (!best || baseSim > best.score.baseSim) {
      best = { candidate: c, score: { tier: 1, confidence: 0.99, baseSim } };
    }
  }
  return best;
}

async function matchTrack({ spotifyTrack, tidal, roonSearch, log = () => {} }) {
  // Tier 1 — ISRC via Tidal (only owned playlists carry ISRC; non-owned don't).
  if (tidal && spotifyTrack.isrc) {
    try {
      const tidalHit = await tidal.lookupByIsrc(spotifyTrack.isrc);
      if (tidalHit) {
        log(`tidal isrc ${spotifyTrack.isrc} → "${tidalHit.title}" / ${tidalHit.artist}`);
        for (const q of titleQueries(tidalHit.title, tidalHit.artist)) {
          const candidates = await roonSearch(q);
          if (!candidates || candidates.length === 0) continue;
          const best = pickBestByTitle(tidalHit.title, candidates);
          if (best) {
            return { candidate: best.candidate, tier: 1, confidence: 0.99, score: best.score, query: q };
          }
        }
      }
    } catch (err) {
      log(`tidal isrc lookup failed for ${spotifyTrack.isrc}: ${err.message}`);
    }
  }

  // Tier 2+ — text matching. Try progressively-stripped queries until a candidate
  // passes scoring (which enforces artist + the cover guard).
  const artist = primaryArtist(spotifyTrack.artists) || '';
  for (const q of titleQueries(spotifyTrack.title, artist)) {
    const candidates = await roonSearch(q);
    if (!candidates || candidates.length === 0) continue;
    const best = pickBest(spotifyTrack, candidates);
    if (best) {
      return {
        candidate: best.candidate,
        tier: best.score.tier,
        confidence: best.score.confidence,
        score: best.score,
        query: q,
      };
    }
  }

  return null;
}

module.exports = { matchTrack };
