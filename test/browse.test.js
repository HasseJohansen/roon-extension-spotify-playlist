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

  console.log('browse.test.js OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
