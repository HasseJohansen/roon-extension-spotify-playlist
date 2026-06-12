'use strict';

const assert = require('node:assert/strict');
const { RoonBrowser } = require('../src/roon/browse');

// A fake node-roon-api-browse service that records the opts of every browse/load
// call and returns empty, well-formed results so loadAll() terminates.
function fakeSvc() {
  const calls = { browse: [], load: [] };
  const svc = {
    calls,
    browse(opts, cb) {
      calls.browse.push(opts);
      cb(null, { action: 'list', list: { count: 0 } });
    },
    load(opts, cb) {
      calls.load.push(opts);
      cb(null, { items: [], list: { count: 0 } });
    },
  };
  return svc;
}

// A fake service modelling Roon's stateful browse tree. browse({item_key}) moves
// to that node; load returns the current node's children. A node's `items` may be
// a function of the browse's zone_or_output_id, which lets us model Roon returning
// PLAYBACK actions when a zone is set and MANAGEMENT actions (incl. Add to
// Playlist) when it is not.
function treeSvc(tree) {
  const calls = [];
  let current = 'ROOT';
  let zone;
  const childrenOf = (key) => {
    const node = tree[key];
    if (!node) return [];
    return typeof node.items === 'function' ? node.items(zone) : node.items;
  };
  const svc = {
    calls,
    browse(opts, cb) {
      calls.push({ type: 'browse', item_key: opts.item_key, input: opts.input, zone: opts.zone_or_output_id });
      if (opts.pop_all) current = 'ROOT';
      if (opts.item_key) current = opts.item_key;
      if (opts.input != null) current = `${current}/submitted`;
      zone = opts.zone_or_output_id;
      const items = childrenOf(current);
      cb(null, { action: 'list', list: { count: items.length, level: 0 } });
    },
    load(opts, cb) {
      calls.push({ type: 'load' });
      const items = childrenOf(current);
      cb(null, { items, offset: 0, list: { count: items.length } });
    },
  };
  return svc;
}

async function main() {
  // Roon's load request REQUIRES a `hierarchy` field (same as browse). loadAll()
  // must propagate it, or the core rejects with
  // "JSON: missing required string field: hierarchy".
  {
    const svc = fakeSvc();
    const browser = new RoonBrowser(svc, { zoneOrOutputId: 'zone1' });
    await browser.search('Bohemian Rhapsody Queen');

    assert.ok(svc.calls.load.length > 0, 'search must issue a load');
    for (const opts of svc.calls.load) {
      assert.equal(opts.hierarchy, 'search', 'every load must carry hierarchy: search');
      assert.equal(opts.count, 100, 'load still paginates by 100');
    }
  }

  // Search browses must still carry the configured zone (proven-working path).
  {
    const svc = fakeSvc();
    const browser = new RoonBrowser(svc, { zoneOrOutputId: 'zone1' });
    await browser.search('Bohemian Rhapsody Queen');
    assert.equal(svc.calls.browse[0].zone_or_output_id, 'zone1', 'search keeps the zone');
  }

  // queueTrack must drill past the intermediate "track view" to the playback
  // action menu and execute "Queue". Queuing is playback, so it must carry the
  // configured zone (Roon needs to know which zone's queue to append to).
  {
    const tree = {
      // browsing the matched candidate -> intermediate single-item track view
      cand: { items: [{ title: 'Song A', subtitle: 'Artist A', hint: 'action_list', item_key: 'cand-inner' }] },
      // one level deeper -> the playback action menu Roon actually exposes
      'cand-inner': {
        items: [
          { title: 'Play Now', hint: 'action', item_key: 'play' },
          { title: 'Add Next', hint: 'action', item_key: 'next' },
          { title: 'Queue', hint: 'action', item_key: 'queue' },
          { title: 'Start Radio', hint: 'action', item_key: 'radio' },
        ],
      },
      queue: { items: [] }, // executing Queue returns no further list
    };
    const svc = treeSvc(tree);
    const browser = new RoonBrowser(svc, { zoneOrOutputId: 'zone1' });

    await browser.queueTrack('cand');

    const browses = svc.calls.filter((c) => c.type === 'browse');
    const trackBrowse = browses.find((c) => c.item_key === 'cand');
    assert.ok(trackBrowse, 'must browse the candidate track');
    assert.equal(trackBrowse.zone, 'zone1', 'queueTrack must carry the zone (Queue needs it)');
    const keys = browses.map((c) => c.item_key);
    assert.ok(keys.includes('cand-inner'), 'must drill past the intermediate track view');
    assert.ok(keys.includes('queue'), 'must execute the "Queue" action');
  }

  console.log('browse.test.js OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
