'use strict';

const { distance } = require('fastest-levenshtein');
const { normalize } = require('./normalize');

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const max = Math.max(na.length, nb.length);
  return 1 - distance(na, nb) / max;
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

// Best similarity between ANY Spotify artist and ANY name Roon lists. Returns 1
// as soon as one pair matches exactly (normalized), so a performer buried after
// the composers still scores a full artist match.
function artistSimilarity(spotifyArtists, candidateArtist) {
  const a = splitArtists(spotifyArtists);
  const b = splitArtists(candidateArtist);
  let best = 0;
  for (const x of a) {
    for (const y of b) {
      const s = similarity(x, y);
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
  }

  return { tier, confidence, titleSim, artistSim, albumSim, durationOk: durOk };
}

function pickBest(spotify, candidates) {
  let best = null;
  for (const c of candidates) {
    const s = scoreCandidate(spotify, c);
    if (s.tier == null) continue;
    if (!best || s.confidence > best.score.confidence ||
        (s.confidence === best.score.confidence && s.tier < best.score.tier)) {
      best = { candidate: c, score: s };
    }
  }
  return best;
}

module.exports = { similarity, durationOk, scoreCandidate, pickBest };
