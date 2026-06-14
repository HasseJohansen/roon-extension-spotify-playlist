'use strict';

function buildLayout(state) {
  const groups = [];

  groups.push({
    type: 'group',
    title: 'Spotify',
    items: [
      {
        type: 'dropdown',
        title: 'Connect Spotify',
        subtitle:
          'Logs in with a normal Spotify account (no developer app needed) to read your ' +
          'playlists and other users’ public playlists, with ISRC. Personal/self-hosted use only.',
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
      {
        type: 'dropdown',
        title: 'Per-track results',
        subtitle: 'Show how each track from the last import was matched.',
        setting: 'showResults',
        values: [
          { title: 'Hidden', value: 'idle' },
          { title: 'Show matched / unmatched / errors', value: 'show' },
          { title: 'Hide', value: 'hide' },
        ],
      },
    ],
  });

  if (state.showResults) {
    for (const g of buildResultGroups(state)) groups.push(g);
  }

  return {
    values: state.values,
    layout: groups,
    has_error: false,
  };
}

// Per-group cap so a huge playlist doesn't produce an unwieldy settings page;
// the full detail is always in match-report.json.
const RESULTS_CAP = 80;

function spotifyLabel(track) {
  const title = (track && track.title) || '(unknown title)';
  const artist = (track && track.artists && track.artists.join(', ')) || 'unknown artist';
  return `"${title}" — ${artist}`;
}

function cappedLabels(entries, render) {
  const items = entries.slice(0, RESULTS_CAP).map((e) => ({ type: 'label', title: render(e) }));
  if (entries.length > RESULTS_CAP) {
    items.push({
      type: 'label',
      title: `…and ${entries.length - RESULTS_CAP} more — see match-report.json for the full list.`,
    });
  }
  return items;
}

// Build the matched / unmatched / errored groups from the last import's report.
function buildResultGroups(state) {
  const report = state.lastReport;
  if (!report || !report.length) {
    return [{
      type: 'group',
      title: 'Last import results',
      items: [{ type: 'label', title: 'No import has been run yet.' }],
    }];
  }

  const matched = report.filter((e) => e.matched);
  const errored = report.filter((e) => e.error);
  const unmatched = report.filter((e) => !e.matched && !e.error);

  const out = [];

  out.push({
    type: 'group',
    title: `Matched (${matched.length})`,
    items: matched.length
      ? cappedLabels(matched, (e) => {
          const roon = e.roon
            ? `  →  ${e.roon.title || ''} — ${e.roon.artist || ''}`.replace(/ — $/, '')
            : '';
          const tier = e.tier ? ` (T${e.tier})` : '';
          return `✓ ${spotifyLabel(e.spotify)}${roon}${tier}`;
        })
      : [{ type: 'label', title: 'None.' }],
  });

  out.push({
    type: 'group',
    title: `Unmatched (${unmatched.length})`,
    items: unmatched.length
      ? cappedLabels(unmatched, (e) => `✗ ${spotifyLabel(e.spotify)}`)
      : [{ type: 'label', title: 'None.' }],
  });

  out.push({
    type: 'group',
    title: `Errors (${errored.length})`,
    items: errored.length
      ? cappedLabels(errored, (e) => `⚠ ${spotifyLabel(e.spotify)} — ${e.error}`)
      : [{ type: 'label', title: 'None.' }],
  });

  return out;
}

module.exports = { buildLayout };
