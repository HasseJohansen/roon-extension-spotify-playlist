'use strict';

const assert = require('node:assert/strict');
const { normalize, strip, primaryArtist } = require('../src/match/normalize');

const cases = [
  ['Song (feat. Drake)', 'song'],
  ['Song [feat. Drake]', 'song'],
  ['Song (Remastered 2011)', 'song'],
  ['Song - Remastered', 'song'],
  ['Song (2011 Remaster)', 'song'],
  ['Song (Live at Wembley)', 'song'],
  ['Song [Live]', 'song'],
  ['Song (Deluxe Edition)', 'song'],
  ['Song (Bonus Track)', 'song'],
  ['Song (Radio Edit)', 'song'],
  ['Song (Single Version)', 'song'],
  ['Béyoncé', 'beyonce'],
  ["It's Time", 'its time'],
  ['AC/DC & Friends', 'ac dc and friends'],
  ['  Multiple   spaces  ', 'multiple spaces'],
];

for (const [input, want] of cases) {
  const got = normalize(input);
  assert.equal(got, want, `normalize(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

assert.equal(strip('Song (feat. Drake) - Remastered 2011').replace(/\s+/g, ' ').trim(), 'Song');
assert.equal(primaryArtist('Drake, Future & Travis Scott'), 'Drake');
assert.equal(primaryArtist(['Drake', 'Future']), 'Drake');
assert.equal(primaryArtist([{ name: 'Drake' }, { name: 'Future' }]), 'Drake');
assert.equal(primaryArtist('Daft Punk feat. Pharrell'), 'Daft Punk');

console.log('normalize.test.js OK');
