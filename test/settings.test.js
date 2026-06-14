'use strict';

const assert = require('node:assert/strict');
const { buildLayout } = require('../src/roon/settings');

function baseState(extra) {
  return {
    values: { showResults: 'idle' },
    spotifyStatus: 'Spotify: connected',
    tidalStatus: 'Tidal ISRC lookup: disabled',
    runStatus: 'Idle',
    lastSummary: '',
    lastReport: null,
    showResults: false,
    ...extra,
  };
}

const titles = (layout) => layout.map((g) => g.title);
const groupByTitle = (layout, re) => layout.find((g) => re.test(g.title));

// 1. Collapsed by default: no result groups.
{
  const { layout } = buildLayout(baseState());
  assert.ok(!titles(layout).some((t) => /^Matched/.test(t)), 'no results groups when collapsed');
}

// 2. Show requested but nothing imported yet -> friendly placeholder.
{
  const { layout } = buildLayout(baseState({ showResults: true }));
  const g = groupByTitle(layout, /Last import results/);
  assert.ok(g, 'shows a Last import results group');
  assert.match(g.items[0].title, /No import has been run yet/);
}

// 3. With a report, the three categories render with counts + labels.
{
  const report = [
    { index: 1, matched: true, tier: 1, spotify: { title: 'Riverside', artists: ['Agnes Obel'] }, roon: { title: 'Riverside', artist: 'Agnes Obel' } },
    { index: 2, matched: false, spotify: { title: 'Lost Song', artists: ['Nobody'] } },
    { index: 3, matched: false, error: 'search failed', spotify: { title: 'Boom', artists: ['X'] } },
  ];
  const { layout } = buildLayout(baseState({ showResults: true, lastReport: report }));

  const matched = groupByTitle(layout, /^Matched/);
  const unmatched = groupByTitle(layout, /^Unmatched/);
  const errors = groupByTitle(layout, /^Errors/);
  assert.equal(matched.title, 'Matched (1)');
  assert.equal(unmatched.title, 'Unmatched (1)');
  assert.equal(errors.title, 'Errors (1)');
  assert.match(matched.items[0].title, /✓ "Riverside" — Agnes Obel.*Riverside — Agnes Obel.*T1/);
  assert.match(unmatched.items[0].title, /✗ "Lost Song" — Nobody/);
  assert.match(errors.items[0].title, /⚠ "Boom" — X — search failed/);
}

// 4. Capping: more than 80 unmatched -> 80 labels + an "and N more" note.
{
  const report = Array.from({ length: 95 }, (_, i) => ({
    index: i + 1, matched: false, spotify: { title: `T${i}`, artists: ['A'] },
  }));
  const { layout } = buildLayout(baseState({ showResults: true, lastReport: report }));
  const unmatched = groupByTitle(layout, /^Unmatched/);
  assert.equal(unmatched.title, 'Unmatched (95)');
  assert.equal(unmatched.items.length, 81, '80 capped labels + 1 overflow note');
  assert.match(unmatched.items[80].title, /and 15 more/);
}

console.log('settings.test.js OK');
