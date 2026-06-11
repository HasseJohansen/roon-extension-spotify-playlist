'use strict';

const RoonApi = require('node-roon-api');
const RoonApiStatus = require('node-roon-api-status');
const RoonApiSettings = require('node-roon-api-settings');
const RoonApiBrowse = require('node-roon-api-browse');
const RoonApiTransport = require('node-roon-api-transport');

function createExtension({ onCorePaired, onCoreUnpaired, makeLayout, onSettingsSaved }) {
  const roon = new RoonApi({
    extension_id: 'com.hhj.spotify-playlist-importer',
    display_name: 'Spotify Playlist Importer',
    display_version: '0.1.0',
    publisher: 'hhj',
    email: 'hhj@cloud2.net',
    website: 'https://github.com/hhj/roon-extension-spotify-playlist',
    core_paired(core) {
      onCorePaired(core);
    },
    core_unpaired(core) {
      if (onCoreUnpaired) onCoreUnpaired(core);
    },
  });

  const status = new RoonApiStatus(roon);

  const settings = new RoonApiSettings(roon, {
    get_settings(cb) {
      cb(makeLayout());
    },
    save_settings(req, isdryrun, payload) {
      const layout = onSettingsSaved(payload.values, isdryrun);
      req.send_complete(layout.has_error ? 'NotValid' : 'Success', { settings: layout });
      if (!isdryrun && !layout.has_error) {
        settingsRef.update_settings(makeLayout());
      }
    },
    button_pressed() {},
  });
  const settingsRef = settings;

  roon.init_services({
    required_services: [RoonApiBrowse, RoonApiTransport],
    provided_services: [status, settings],
  });

  roon.start_discovery();

  return { roon, status, settings };
}

module.exports = { createExtension };
