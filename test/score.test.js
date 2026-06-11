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

console.log('score.test.js OK');
