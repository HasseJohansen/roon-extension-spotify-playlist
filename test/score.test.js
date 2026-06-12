'use strict';

const assert = require('node:assert/strict');
const { scoreCandidate, pickBest, similarity } = require('../src/match/score');

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

console.log('score.test.js OK');
