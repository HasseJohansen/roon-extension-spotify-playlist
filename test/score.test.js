'use strict';

const assert = require('node:assert/strict');
const { scoreCandidate, pickBest, similarity, isLikelyCover } = require('../src/match/score');

const spotify = {
  title: 'Bohemian Rhapsody',
  artists: ['Queen'],
  album: 'A Night at the Opera',
  durationMs: 354000,
};

const exactSameRelease = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  durationSec: 354,
};
const otherRelease = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'Greatest Hits',
  durationSec: 354,
};
const remaster = {
  title: 'Bohemian Rhapsody (Remastered 2011)',
  artist: 'Queen',
  album: 'A Night at the Opera (Deluxe Edition)',
  durationSec: 355,
};
const wrongArtist = {
  title: 'Bohemian Rhapsody',
  artist: 'Some Cover Band',
  album: 'A Night at the Opera',
  durationSec: 354,
};

assert.equal(scoreCandidate(spotify, exactSameRelease).tier, 2);
assert.equal(scoreCandidate(spotify, otherRelease).tier, 3);
const remasterScore = scoreCandidate(spotify, remaster);
assert.ok(remasterScore.tier === 2 || remasterScore.tier === 3, `remaster tier: ${remasterScore.tier}`);
assert.equal(scoreCandidate(spotify, wrongArtist).tier, null);

const best = pickBest(spotify, [otherRelease, exactSameRelease, wrongArtist]);
assert.equal(best.candidate, exactSameRelease);

assert.equal(similarity('Hello', 'Hello'), 1);
assert.ok(similarity('Hello', 'Helo') > 0.7);
assert.ok(similarity('foo', 'bar') < 0.5);

// Roon lists composers/songwriters first in a comma-separated subtitle; the
// performer that matches Spotify is often last. The match must still succeed.
const spotifyAlphabeat = {
  title: 'Fascination',
  artists: ['Alphabeat'],
  album: 'The Spell',
  durationMs: 200000,
};
const roonComposerFirst = {
  title: 'Fascination',
  artist: 'Anders Bønløkke, Rasmus Nikolaj Østergaard Nagel, Stine Bramsen, Alphabeat',
  album: '',
  durationSec: 200,
};
assert.ok(
  scoreCandidate(spotifyAlphabeat, roonComposerFirst).tier != null,
  'performer appearing later in a comma-separated artist list should still match',
);

// Any Spotify artist matching any Roon-listed name counts (multi-artist tracks).
const spotifyMulti = { title: 'Er Her', artists: ['Artigeardit', 'KESI'], album: '', durationMs: 180000 };
const roonMulti = { title: 'Er Her', artist: 'Ardit Aliti, Artigeardit, KESI', album: '', durationSec: 180 };
assert.ok(scoreCandidate(spotifyMulti, roonMulti).tier != null, 'any-to-any artist match should succeed');

// A genuinely different performer must still be rejected (no false positives).
const spotifyQueen2 = { title: 'Bohemian Rhapsody', artists: ['Queen'], album: '', durationMs: 354000 };
const roonKaraoke = { title: 'Bohemian Rhapsody', artist: 'Midifine Systems, Pop Mania', album: '', durationSec: 354 };
assert.equal(scoreCandidate(spotifyQueen2, roonKaraoke).tier, null, 'unrelated performer must not match');

// --- Step 2: token-set / subset artist matching ---
// Spotify has the fuller name; Roon lists a subset. Real case from unmatched.log.
const spAlberteW = { title: 'Lyse Nætter', artists: ['Alberte Winding'], album: '', durationMs: 200000 };
const roonAlberte = { title: 'Lyse Nætter', artist: 'Alberte, Benjamin Koppel', album: '', durationSec: 200 };
assert.ok(scoreCandidate(spAlberteW, roonAlberte).tier != null, 'subset artist (Alberte ⊂ Alberte Winding) should match');

// "X & Y" (one Spotify artist string) vs Roon "X, Y, …" — subset via &→tokens.
const spDissing = { title: 'Svantes lykkelige dag', artists: ['Povl Dissing & Benny Andersen'], album: '', durationMs: 200000 };
const roonDissing = { title: 'Svantes lykkelige dag', artist: 'Povl Dissing, Benny Andersen, Dissing/Andersen', album: '', durationSec: 200 };
assert.ok(scoreCandidate(spDissing, roonDissing).tier != null, '"A & B" should match Roon "A, B, …" via subset');

// --- Step 3: cover/karaoke guard ---
assert.equal(isLikelyCover('Barbie Girl', 'Barbie Girl (Karaoke Version)'), true, 'karaoke flagged');
assert.equal(isLikelyCover('Tusind stykker', 'Tusind Stykker (Originally Performed By Anne Linnet)'), true, 'originally-performed-by flagged');
assert.equal(isLikelyCover('Barbie Girl', 'Barbie Girl'), false, 'plain title not flagged');
// Don't flag when the Spotify track itself is the karaoke/cover.
assert.equal(isLikelyCover('Song (Karaoke)', 'Song (Karaoke Version)'), false, 'spotify-side karaoke not flagged');

// pickBest must skip a cover even when its (long) title would otherwise score,
// preferring the real track. Long title keeps titleSim high despite the suffix.
const spLong = { title: 'Den blå anemone er kommet', artists: ['Egil Harder'], album: '', durationMs: 200000 };
const coverLong = { title: 'Den blå anemone er kommet (Originally Performed By Egil Harder)', artist: 'Karaoke Crew, Egil Harder', album: '', durationSec: 200 };
const realLong = { title: 'Den blå anemone er kommet', artist: 'Egil Harder', album: '', durationSec: 200 };
assert.equal(pickBest(spLong, [coverLong]), null, 'a lone cover candidate is rejected');
assert.equal(pickBest(spLong, [coverLong, realLong]).candidate, realLong, 'real track chosen over cover');

// --- Step 3: relaxed-title tier (slight title variant, artist matches) ---
const spRelax = { title: 'Costa Del Sol', artists: ['C.V. Jørgensen'], album: '', durationMs: 200000 };
const roonRelax = { title: 'Costa Del Sol (En Inciterende Flamenco)', artist: 'C.V. Jørgensen, Billy Cross', album: '', durationSec: 200 };
assert.ok(scoreCandidate(spRelax, roonRelax).tier != null, 'relaxed title variant with matching artist should match');

console.log('score.test.js OK');
