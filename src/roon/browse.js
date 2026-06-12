'use strict';

// Compact, log-friendly description of a Roon item list, for diagnostic errors.
function describeItems(items) {
  if (!items || items.length === 0) return '<empty>';
  return items.map((it) => `${it.title || '?'}[${it.hint || '?'}]`).join(', ');
}

class RoonBrowser {
  constructor(roonBrowse, { multiSessionKey = 'spotify-importer', zoneOrOutputId = null } = {}) {
    this.svc = roonBrowse;
    this.multiSessionKey = multiSessionKey;
    this.zoneOrOutputId = zoneOrOutputId;
  }

  setZone(zoneOrOutputId) {
    this.zoneOrOutputId = zoneOrOutputId;
  }

  _opts(extra) {
    const base = { multi_session_key: this.multiSessionKey };
    if (this.zoneOrOutputId) base.zone_or_output_id = this.zoneOrOutputId;
    return Object.assign(base, extra || {});
  }

  browse(opts) {
    return new Promise((resolve, reject) => {
      this.svc.browse(this._opts(opts), (err, body) => {
        if (err) return reject(new Error(`browse: ${err}`));
        resolve(body);
      });
    });
  }

  load(opts = {}) {
    return new Promise((resolve, reject) => {
      this.svc.load(this._opts(opts), (err, body) => {
        if (err) return reject(new Error(`load: ${err}`));
        resolve(body);
      });
    });
  }

  async loadAll(level, hierarchy = 'search') {
    const out = [];
    let offset = 0;
    while (true) {
      // Roon's `load` request requires `hierarchy` (same as `browse`); omitting it
      // is rejected with "missing required string field: hierarchy".
      const body = await this.load({ hierarchy, offset, count: 100, level });
      const items = body.items || [];
      out.push(...items);
      if (items.length < 100) break;
      offset += items.length;
      if (body.list && out.length >= body.list.count) break;
    }
    return out;
  }

  async resetToHome() {
    await this.browse({ hierarchy: 'browse', pop_all: true });
  }

  async search(query) {
    await this.browse({ hierarchy: 'search', input: query, pop_all: true });
    return this.loadAll();
  }

  async openTracksList(searchItems) {
    const tracksHeader = searchItems.find(
      (it) => /^tracks$/i.test(it.title || '') && (it.hint === 'list' || it.hint === 'action_list'),
    );
    if (tracksHeader) {
      await this.browse({ hierarchy: 'search', item_key: tracksHeader.item_key });
      return this.loadAll();
    }
    return searchItems.filter(
      (it) => it.hint === 'action_list' && it.subtitle,
    );
  }

  static itemToCandidate(item) {
    const subtitle = item.subtitle || '';
    const [artistRaw, albumRaw] = subtitle.split(/\s*\/\s*/, 2);
    return {
      itemKey: item.item_key,
      title: item.title,
      artist: (artistRaw || '').trim(),
      album: (albumRaw || '').trim(),
      durationSec: null,
      raw: item,
    };
  }

  async openTrackActions(itemKey) {
    await this.browse({ hierarchy: 'search', item_key: itemKey });
    let items = await this.loadAll();
    // Some Roon builds return an intermediate single-item "track view" before the
    // actual action menu (Play Now / Add to Playlist / …). When we land on a lone
    // action_list item (the track again), drill one level deeper until we reach a
    // real menu. Capped to avoid looping on unexpected shapes.
    let guard = 0;
    while (guard < 2 && items.length === 1 && items[0].hint === 'action_list' && items[0].item_key) {
      await this.browse({ hierarchy: 'search', item_key: items[0].item_key });
      items = await this.loadAll();
      guard += 1;
    }
    return items;
  }

  findItemByTitle(items, title, opts = {}) {
    const want = String(title).toLowerCase();
    const exact = items.find((it) => (it.title || '').toLowerCase() === want);
    if (exact) return exact;
    if (opts.fuzzy) {
      return items.find((it) => (it.title || '').toLowerCase().includes(want));
    }
    return null;
  }

  async clickItem(itemKey, hierarchy = 'search') {
    await this.browse({ hierarchy, item_key: itemKey });
    return this.loadAll(undefined, hierarchy);
  }

  async submitInput(itemKey, input, hierarchy = 'search') {
    await this.browse({ hierarchy, item_key: itemKey, input });
    return this.loadAll(undefined, hierarchy);
  }

  async addTrackToPlaylist({ trackItemKey, playlistName, createNew }) {
    const actions = await this.openTrackActions(trackItemKey);
    const addToPlaylist = this.findItemByTitle(actions, 'Add to Playlist', { fuzzy: true });
    if (!addToPlaylist) {
      throw new Error(`"Add to Playlist" action not found in track menu (saw: ${describeItems(actions)})`);
    }
    const picker = await this.clickItem(addToPlaylist.item_key);

    if (createNew) {
      const newPlaylist = this.findItemByTitle(picker, 'New Playlist', { fuzzy: true });
      if (!newPlaylist) throw new Error(`"New Playlist" item not found in picker (saw: ${describeItems(picker)})`);
      const promptItems = await this.clickItem(newPlaylist.item_key);
      const promptItem = promptItems.find((it) => it.input_prompt) || newPlaylist;
      const promptKey = promptItem.input_prompt ? promptItem.item_key : newPlaylist.item_key;
      const after = await this.submitInput(promptKey, playlistName);
      await this.confirmIfNeeded(after);
      return;
    }

    const target = this.findItemByTitle(picker, playlistName, { fuzzy: false });
    if (!target) {
      throw new Error(
        `Playlist "${playlistName}" not found in picker — was it created on the first track? ` +
        `(saw: ${describeItems(picker)})`,
      );
    }
    const after = await this.clickItem(target.item_key);
    await this.confirmIfNeeded(after);
  }

  async confirmIfNeeded(items) {
    if (!items || items.length === 0) return;
    const confirm = items.find(
      (it) => /^(add|confirm|done|ok)$/i.test(it.title || '') && it.hint !== 'header',
    );
    if (confirm) {
      await this.clickItem(confirm.item_key);
    }
  }
}

module.exports = { RoonBrowser };
