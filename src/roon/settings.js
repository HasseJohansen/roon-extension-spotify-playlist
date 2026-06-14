'use strict';

function buildLayout(state) {
  const groups = [];

  groups.push({
    type: 'group',
    title: 'Spotify',
    items: [
      {
        type: 'string',
        title: 'Client ID',
        subtitle:
          'From developer.spotify.com — set redirect URI to http://127.0.0.1:8888/callback',
        setting: 'spotifyClientId',
      },
      {
        type: 'dropdown',
        title: 'Connect Spotify',
        setting: 'spotifyConnect',
        values: [
          { title: 'Idle', value: 'idle' },
          { title: 'Connect now', value: 'connect' },
          { title: 'Disconnect', value: 'disconnect' },
        ],
      },
      {
        type: 'string',
        title: 'Paste Spotify auth code',
        subtitle:
          'After approving, paste the redirected URL (or just the code=… value) here. ' +
          'The 127.0.0.1 page failing to load is expected — use this when the browser is on another machine (e.g. Kubernetes).',
        setting: 'spotifyAuthCode',
      },
      {
        type: 'label',
        title: state.spotifyStatus || 'Spotify: not connected',
      },
    ],
  });

  groups.push({
    type: 'group',
    title: 'Spotify ISRC for other users’ playlists (optional, librespot)',
    items: [
      {
        type: 'dropdown',
        title: 'Connect Spotify (ISRC)',
        subtitle:
          'Logs in with a normal Spotify account (no developer app) to read ISRCs for ' +
          'other users’ public playlists, enabling Tidal ISRC matching for them. ' +
          'Personal/self-hosted use only.',
        setting: 'spotifyInternalConnect',
        values: [
          { title: 'Idle', value: 'idle' },
          { title: 'Connect now', value: 'connect' },
          { title: 'Disconnect', value: 'disconnect' },
        ],
      },
      {
        type: 'string',
        title: 'Paste Spotify ISRC auth code',
        subtitle:
          'Like the Spotify connect above, but for the ISRC login — paste the redirected ' +
          'URL (or just the code=… value). The 127.0.0.1 page failing to load is expected.',
        setting: 'spotifyInternalAuthCode',
      },
      {
        type: 'label',
        title: state.internalStatus || 'Spotify ISRC (librespot): not connected',
      },
    ],
  });

  groups.push({
    type: 'group',
    title: 'Tidal (optional, for ISRC matching)',
    items: [
      {
        type: 'string',
        title: 'Tidal Client ID',
        subtitle: 'From developer.tidal.com',
        setting: 'tidalClientId',
      },
      {
        type: 'string',
        title: 'Tidal Client Secret',
        setting: 'tidalClientSecret',
      },
      {
        type: 'string',
        title: 'Tidal Country Code',
        subtitle: 'e.g. US, DK, GB. Default US.',
        setting: 'tidalCountryCode',
      },
      {
        type: 'label',
        title: state.tidalStatus || 'Tidal ISRC lookup: disabled',
      },
    ],
  });

  groups.push({
    type: 'group',
    title: 'Import',
    items: [
      {
        type: 'string',
        title: 'Spotify playlist URL',
        setting: 'playlistUrl',
      },
      {
        type: 'string',
        title: 'Target playlist name (optional)',
        subtitle: 'Leave blank to use the Spotify playlist name',
        setting: 'targetName',
      },
      {
        type: 'zone',
        title: 'Roon zone (browse session context)',
        setting: 'zone',
      },
      {
        type: 'dropdown',
        title: 'Run import',
        setting: 'runImport',
        values: [
          { title: 'Idle', value: 'idle' },
          { title: 'Start', value: 'start' },
          { title: 'Cancel', value: 'cancel' },
        ],
      },
      {
        type: 'label',
        title: state.runStatus || 'Idle',
      },
      {
        type: 'label',
        title: state.lastSummary || '',
      },
    ],
  });

  return {
    values: state.values,
    layout: groups,
    has_error: false,
  };
}

module.exports = { buildLayout };
