'use strict';

const { distance } = require('fastest-levenshtein');
const { normalize, baseTitle } = require('./normalize');

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const max = Math.max(na.length, nb.length);
  return 1 - distance(na, nb) / max;
}

// Cover/karaoke/tribute markers (English + Danish). A candidate carrying one of
// these — when the Spotify track does not — is almost certainly the wrong
// recording even if title/artist look close, so it must never be selected.
const COVER_RE =
  /\bkaraoke\b|originally performed by|originalt sunget af|made popular by|in the style of|tribute to|\btribute\b|\bcover\b/i;

function isLikelyCover(spotifyTitle, candidateTitle) {
  return COVER_RE.test(candidateTitle || '') && !COVER_RE.test(spotifyTitle || '');
}

// Split an artist field into individual names. Spotify gives an array; Roon gives
// a single comma-separated subtitle that often lists songwriters/composers first
// and the actual performer last. Don't split on "&"/"and" so names like
// "Nik & Jay" stay intact.
function splitArtists(field) {
  if (Array.isArray(field)) return field.map((a) => (a && (a.name || a)) || '').filter(Boolean);
  return String(field || '')
    .split(/\s*,\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s*\/\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Score one Spotify artist name against one Roon name. 1.0 = exact (normalized);
// 0.9 = token subset (one name's word set ⊆ the other's) — handles "Alberte" ⊂
// "Alberte Winding" and "Povl Dissing" ⊂ "Povl Dissing & Benny Andersen" (the &
// normalizes to "and", so the shorter is still a subset); else Levenshtein.
function artistPairScore(x, y) {
  const nx = normalize(x);
  const ny = normalize(y);
  if (!nx || !ny) return 0;
  if (nx === ny) return 1;
  const sx = new Set(nx.split(' ').filter(Boolean));
  const sy = new Set(ny.split(' ').filter(Boolean));
  const [small, large] = sx.size <= sy.size ? [sx, sy] : [sy, sx];
  let subset = small.size > 0;
  for (const t of small) if (!large.has(t)) { subset = false; break; }
  if (subset) return 0.9;
  const max = Math.max(nx.length, ny.length);
  return 1 - distance(nx, ny) / max;
}

// Best score between ANY Spotify artist and ANY name Roon lists.
function artistSimilarity(spotifyArtists, candidateArtist) {
  const a = splitArtists(spotifyArtists);
  const b = splitArtists(candidateArtist);
  let best = 0;
  for (const x of a) {
    for (const y of b) {
      const s = artistPairScore(x, y);
      if (s > best) best = s;
      if (best === 1) return 1;
    }
  }
  return best;
}

function durationOk(spotifyMs, candidateSeconds, toleranceSec = 3) {
  if (!spotifyMs || !candidateSeconds) return null;
  const diff = Math.abs(spotifyMs / 1000 - candidateSeconds);
  return diff <= toleranceSec;
}

function scoreCandidate(spotify, candidate) {
  const titleSim = similarity(spotify.title, candidate.title);
  // Compare core titles too, ignoring "(…)" and " - …" version suffixes, so
  // "Costa Del Sol" matches "Costa Del Sol (En Inciterende Flamenco)".
  const baseSim = similarity(baseTitle(spotify.title), baseTitle(candidate.title));
  const artistSim = artistSimilarity(spotify.artists, candidate.artist);
  const albumSim = candidate.album ? similarity(spotify.album, candidate.album) : 0;
  const durOk = durationOk(spotify.durationMs, candidate.durationSec);

  let tier = null;
  let confidence = 0;

  if (titleSim === 1 && artistSim === 1 && albumSim === 1) {
    tier = 2;
    confidence = 0.95;
  } else if (titleSim === 1 && artistSim === 1) {
    tier = 3;
    confidence = 0.85;
  } else if (titleSim >= 0.85 && artistSim === 1 && (durOk === true || (durOk === null && titleSim >= 0.92))) {
    tier = 4;
    confidence = 0.7 + (titleSim - 0.85) * 0.5;
  } else if (baseSim >= 0.9 && artistSim >= 0.9) {
    // Relaxed: core titles match and the artist matches fully or as a subset.
    // Lower confidence than the strict tiers; the cover guard in pickBest keeps
    // karaoke/cover candidates out of this path.
    tier = 5;
    confidence = 0.5 + (baseSim - 0.9) * 0.5;
  }

  return { tier, confidence, titleSim, baseSim, artistSim, albumSim, durationOk: durOk };
}

function pickBest(spotify, candidates) {
  let best = null;
  for (const c of candidates) {
    if (isLikelyCover(spotify.title, c.title)) continue;
    const s = scoreCandidate(spotify, c);
    if (s.tier == null) continue;
    if (!best || s.confidence > best.score.confidence ||
        (s.confidence === best.score.confidence && s.tier < best.score.tier)) {
      best = { candidate: c, score: s };
    }
  }
  return best;
}

module.exports = { similarity, durationOk, scoreCandidate, pickBest, isLikelyCover };
