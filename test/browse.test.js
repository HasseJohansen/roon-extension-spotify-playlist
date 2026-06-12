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

// A fake service that models Roon's stateful browse tree: browse({item_key})
// moves to that node, load returns the current node's children. `tree` maps an
// item_key to its child items.
function treeSvc(tree) {
  const calls = [];
  let current = 'ROOT';
  const svc = {
    calls,
    browse(opts, cb) {
      calls.push({ type: 'browse', item_key: opts.item_key, input: opts.input });
      if (opts.pop_all) current = 'ROOT';
      if (opts.item_key) current = opts.item_key;
      if (opts.input != null) current = `${current}/submitted`;
      const items = (tree[current] && tree[current].items) || [];
      cb(null, { action: 'list', list: { count: items.length, level: 0 } });
    },
    load(opts, cb) {
      calls.push({ type: 'load', item_key: undefined });
      const items = (tree[current] && tree[current].items) || [];
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

  // clickItem/submitInput accept a custom hierarchy and must thread it into load.
  {
    const svc = fakeSvc();
    const browser = new RoonBrowser(svc, { zoneOrOutputId: 'zone1' });
    await browser.clickItem('item-key-1', 'browse');

    assert.ok(svc.calls.load.length > 0, 'clickItem must issue a load');
    assert.equal(
      svc.calls.load[svc.calls.load.length - 1].hierarchy,
      'browse',
      'clickItem must pass its hierarchy through to load',
    );
  }

  // addTrackToPlaylist must reach the action menu even when Roon returns an
  // intermediate single-item "track view" first (observed live: browsing a
  // search-result track yields a list containing just the track again, with the
  // real Play/Add actions one level deeper).
  {
    const tree = {
      // browsing the matched candidate -> intermediate single-item track view
      cand: { items: [{ title: 'Song A', subtitle: 'Artist A', hint: 'action_list', item_key: 'cand-inner' }] },
      // one level deeper -> the real action menu
      'cand-inner': {
        items: [
          { title: 'Play Now', hint: 'action', item_key: 'play' },
          { title: 'Add to Playlist', hint: 'action_list', item_key: 'addpl' },
        ],
      },
      // the playlist picker
      addpl: {
        items: [
          { title: 'New Playlist', hint: 'action_list', item_key: 'newpl' },
          { title: 'My Playlist', hint: 'action_list', item_key: 'plkey' },
        ],
      },
      // adding to an existing playlist surfaces a confirm action
      plkey: { items: [{ title: 'Add', hint: 'action', item_key: 'confirm' }] },
      confirm: { items: [] },
    };
    const svc = treeSvc(tree);
    const browser = new RoonBrowser(svc, { zoneOrOutputId: 'zone1' });

    await browser.addTrackToPlaylist({
      trackItemKey: 'cand',
      playlistName: 'My Playlist',
      createNew: false,
    });

    const browsed = svc.calls.filter((c) => c.type === 'browse').map((c) => c.item_key);
    assert.ok(browsed.includes('cand-inner'), 'must drill past the intermediate track view to the action menu');
    assert.ok(browsed.includes('addpl'), 'must open the "Add to Playlist" action');
    assert.ok(browsed.includes('plkey'), 'must select the target playlist');
  }

  console.log('browse.test.js OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
